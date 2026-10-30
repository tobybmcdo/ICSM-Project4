import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

const port = Number(process.env.PORT || 3000);
const appOrigin = (process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, '');
const redirectUri = process.env.CANVAS_REDIRECT_URI || `${appOrigin}/auth/callback`;
const clientId = process.env.CANVAS_CLIENT_ID || '';
const clientSecret = process.env.CANVAS_CLIENT_SECRET || '';
const requestedScopes = process.env.CANVAS_SCOPES || 'url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/pages';
const sessions = new Map();
const sessionCookie = 'studyflow_session';
const sessionLifetime = 8 * 60 * 60 * 1000;

function randomId() { return randomBytes(32).toString('base64url'); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split(/=(.*)/s)).filter(([key, value]) => key && value !== undefined).map(([key, value]) => [key, decodeURIComponent(value)]));
}
function cookieHeader(value, maxAge = sessionLifetime / 1000) {
  const secure = appOrigin.startsWith('https://') ? '; Secure' : '';
  return `${sessionCookie}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
function getSession(req, res, create = false) {
  const sessionId = parseCookies(req.headers.cookie)[sessionCookie];
  let session = sessionId && sessions.get(sessionId);
  if (session && Date.now() - session.touchedAt > sessionLifetime) {
    sessions.delete(sessionId);
    session = null;
  }
  if (!session && create) {
    const id = randomId();
    session = { id, touchedAt: Date.now(), canvasOrigin: null, oauthState: null, tokens: null, courses: null };
    sessions.set(id, session);
    res.setHeader('Set-Cookie', cookieHeader(id));
  }
  if (session) session.touchedAt = Date.now();
  return session || null;
}
function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function redirect(res, target) {
  res.writeHead(303, { Location: target, 'Cache-Control': 'no-store' });
  res.end();
}
function redirectWithQuery(key, value) {
  const target = new URL('/', appOrigin);
  target.searchParams.set(key, value);
  return target;
}
async function readBody(req, limit = 16_384) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Request body is too large.');
  }
  return body;
}
function normalizeCanvasOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter your school’s full Canvas address, such as https://school.instructure.com.'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Enter only your official Canvas site address, beginning with https://.');
  }
  return url.origin;
}
async function canvasFetch(session, apiPath, options = {}) {
  const url = new URL(apiPath, `${session.canvasOrigin}/`);
  if (url.origin !== session.canvasOrigin || !url.pathname.startsWith('/api/v1/')) throw new Error('Invalid Canvas API path.');
  const token = await getAccessToken(session);
  return fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.headers || {}) } });
}
async function getAccessToken(session) {
  if (!session.tokens?.access_token) throw new Error('Canvas is disconnected. Please sign in again.');
  if (Date.now() < session.tokens.expiresAt - 60_000 || !session.tokens.refresh_token) return session.tokens.access_token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, refresh_token: session.tokens.refresh_token });
  const response = await fetch(`${session.canvasOrigin}/login/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) {
    session.tokens = null;
    throw new Error('Your Canvas session expired. Please sign in again.');
  }
  session.tokens = { ...session.tokens, ...token, refresh_token: token.refresh_token || session.tokens.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
  return session.tokens.access_token;
}
async function fetchCanvasPages(session, firstUrl) {
  const result = [];
  let next = firstUrl;
  for (let page = 0; next && page < 10; page += 1) {
    const response = await canvasFetch(session, next);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(response.status === 401 ? 'Canvas needs you to sign in again.' : `Canvas could not return this data (HTTP ${response.status}). ${detail.slice(0, 160)}`);
    }
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error('Canvas returned course data in an unexpected format.');
    result.push(...items);
    const link = response.headers.get('link') || '';
    const match = link.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!match) break;
    const candidate = new URL(match[1]);
    if (candidate.origin !== session.canvasOrigin || !candidate.pathname.startsWith('/api/v1/')) throw new Error('Canvas returned an invalid pagination link.');
    next = `${candidate.pathname}${candidate.search}`;
  }
  return result;
}
async function canvasErrorMessage(response) {
  const body = await response.json().catch(() => ({}));
  return body.error_description || body.errors?.[0]?.message || body.message || `Canvas returned HTTP ${response.status}.`;
}
async function serveStatic(res, name, contentType) {
  try {
    const data = await readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('File not found.');
  }
}

const server = createServer(async (req, res) => {
  const base = req.headers.host ? `http://${req.headers.host}` : appOrigin;
  const requestUrl = new URL(req.url || '/', base);
  const session = getSession(req, res);
  try {
    if (req.method === 'GET' && requestUrl.pathname === '/') return serveStatic(res, 'index.html', 'text/html; charset=utf-8');
    if (req.method === 'GET' && requestUrl.pathname === '/app.js') return serveStatic(res, 'app.js', 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && requestUrl.pathname === '/api/config') return sendJson(res, 200, { canvasReady: Boolean(clientId && clientSecret), scopes: requestedScopes.split(/\s+/).filter(Boolean) });
    if (req.method === 'GET' && requestUrl.pathname === '/api/session') return sendJson(res, 200, { connected: Boolean(session?.tokens?.access_token), user: session?.tokens?.user?.name || null, canvasOrigin: session?.canvasOrigin || null });

    if (req.method === 'POST' && requestUrl.pathname === '/auth/start') {
      if (!clientId || !clientSecret) return redirect(res, redirectWithQuery('canvas_error', 'Canvas sign-in is not configured yet. Add the developer key settings from .env.example, then restart StudyFlow.'));
      const body = new URLSearchParams(await readBody(req));
      const canvasOrigin = normalizeCanvasOrigin(body.get('canvasUrl') || '');
      const authSession = getSession(req, res, true);
      authSession.canvasOrigin = canvasOrigin;
      authSession.oauthState = randomId();
      authSession.tokens = null;
      authSession.courses = null;
      const authorize = new URL('/login/oauth2/auth', canvasOrigin);
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('state', authSession.oauthState);
      authorize.searchParams.set('scope', requestedScopes);
      authorize.searchParams.set('purpose', 'StudyFlow course and page access');
      return redirect(res, authorize.href);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/auth/callback') {
      if (!session || !safeEqual(requestUrl.searchParams.get('state'), session.oauthState)) return redirect(res, redirectWithQuery('canvas_error', 'Canvas sign-in could not be verified. Please try again.'));
      session.oauthState = null;
      if (requestUrl.searchParams.has('error')) return redirect(res, redirectWithQuery('canvas_error', `Canvas authorization failed: ${requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error')}`));
      const code = requestUrl.searchParams.get('code');
      if (!code) return redirect(res, redirectWithQuery('canvas_error', 'Canvas did not return an authorization code. Please try again.'));
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
      const response = await fetch(`${session.canvasOrigin}/login/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
      const token = await response.json().catch(() => ({}));
      if (!response.ok || !token.access_token) return redirect(res, redirectWithQuery('canvas_error', await canvasErrorMessage(response)));
      session.tokens = { ...token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
      session.courses = null;
      return redirect(res, redirectWithQuery('canvas_connected', '1'));
    }

    if (req.method === 'POST' && requestUrl.pathname === '/auth/logout') {
      if (session?.tokens?.access_token) {
        try {
          await fetch(`${session.canvasOrigin}/login/oauth2/token`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.tokens.access_token}` } });
        } catch { /* Clear the local session even if Canvas is offline. */ }
      }
      if (session) sessions.delete(session.id);
      res.setHeader('Set-Cookie', cookieHeader('', 0));
      return sendJson(res, 200, { connected: false });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/courses') {
      if (!session?.tokens?.access_token) return sendJson(res, 401, { error: 'Sign in to Canvas to see your classes.' });
      const query = new URLSearchParams({ enrollment_state: 'active', per_page: '100' });
      query.append('include[]', 'term');
      query.append('include[]', 'syllabus_body');
      const courses = await fetchCanvasPages(session, `/api/v1/courses?${query}`);
      session.courses = courses.map(course => ({
        id: String(course.id),
        name: course.name || course.course_code || 'Untitled course',
        courseCode: course.course_code || '',
        term: course.term?.name || '',
        htmlUrl: course.html_url || '',
        syllabusBody: course.syllabus_body || '',
        workflowState: course.workflow_state || ''
      }));
      return sendJson(res, 200, session.courses);
    }

    const pagesMatch = requestUrl.pathname.match(/^\/api\/courses\/(\d+)\/pages$/);
    if (req.method === 'GET' && pagesMatch) {
      if (!session?.tokens?.access_token) return sendJson(res, 401, { error: 'Sign in to Canvas to see class materials.' });
      if (!session.courses) return sendJson(res, 409, { error: 'Load your classes before opening course materials.' });
      const courseId = pagesMatch[1];
      if (!session.courses.some(course => course.id === courseId)) return sendJson(res, 403, { error: 'That course is not in your active Canvas class list.' });
      const query = new URLSearchParams({ published: 'true', per_page: '100' });
      query.append('include[]', 'body');
      const pages = await fetchCanvasPages(session, `/api/v1/courses/${courseId}/pages?${query}`);
      return sendJson(res, 200, pages.map(page => ({ id: String(page.page_id), title: page.title || page.url || 'Untitled page', body: page.body || '', htmlUrl: page.html_url || '', url: page.url || '', updatedAt: page.updated_at || '' })));
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'API route not found.' });
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
  } catch (error) {
    if (req.url?.startsWith('/api/')) return sendJson(res, 502, { error: error.message || 'StudyFlow could not reach Canvas.' });
    return redirect(res, redirectWithQuery('canvas_error', error.message || 'StudyFlow could not complete Canvas sign-in.'));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`StudyFlow is running at ${appOrigin}`);
  if (!clientId || !clientSecret) console.log('Canvas sign-in is not configured. Copy .env.example to .env and add your Canvas developer key settings.');
});
