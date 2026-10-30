const demoCourses = [
  { id: 'biology', name: 'Biology 101', courseCode: 'BIO-101', term: 'Cell structure · Week 3' },
  { id: 'history', name: 'World History', courseCode: 'HIST-204', term: 'The Silk Road · Unit 4' },
  { id: 'statistics', name: 'Statistics', courseCode: 'STAT-110', term: 'Probability · Chapter 6' }
];

const demoMaterials = {
  biology: [
    { id: 'cell-page', type: 'Canvas page', title: 'Cell structure lecture notes', detail: 'Organelles, membranes, and cell transport.', terms: [['Cell membrane', 'A selectively permeable boundary that controls what enters and leaves a cell.'], ['Mitochondrion', 'An organelle that converts energy from food into ATP the cell can use.'], ['Ribosome', 'A structure that builds proteins from amino acids.']] },
    { id: 'cell-slides', type: 'Slides', title: 'Week 3: Inside the cell', detail: '18 lecture slides linked from the Canvas page.', terms: [['Nucleus', 'The membrane-bound organelle that holds most of a cell’s DNA.'], ['Cytoplasm', 'The material inside the cell membrane, outside the nucleus.']] },
    { id: 'cell-site', type: 'Website', title: 'Interactive cell explorer', detail: 'Linked reading about eukaryotic cell parts.', terms: [['Organelle', 'A specialized structure inside a cell that performs a particular function.']] },
    { id: 'cell-video', type: 'Video', title: 'Cell transport explained', detail: '12-minute class video · diffusion and osmosis.', terms: [['Diffusion', 'The net movement of particles from higher concentration to lower concentration.'], ['Osmosis', 'The diffusion of water across a selectively permeable membrane.']] }
  ],
  history: [
    { id: 'silk-page', type: 'Canvas page', title: 'The Silk Road overview', detail: 'Trade routes, cities, and cultural exchange.', terms: [['Silk Road', 'A network of trade routes connecting East Asia with Central Asia and the Mediterranean.'], ['Caravanserai', 'A roadside inn where merchants and travelers could rest and resupply.']] },
    { id: 'silk-slides', type: 'Slides', title: 'Unit 4: Routes and exchange', detail: '15 slides linked from the unit page.', terms: [['Cultural diffusion', 'The spread of ideas, technologies, and customs between societies.'], ['Oasis', 'A fertile place in a desert where water is available.']] },
    { id: 'silk-video', type: 'Video', title: 'A journey along the Silk Road', detail: '9-minute course video · trade and travel.', terms: [['Caravan', 'A group of travelers journeying together, often for safety and trade.']] }
  ],
  statistics: [
    { id: 'prob-page', type: 'Canvas page', title: 'Probability rules', detail: 'Sample spaces, events, and complements.', terms: [['Sample space', 'The set of all possible outcomes of an experiment.'], ['Complement', 'The event that an outcome is not in a specified event.']] },
    { id: 'prob-slides', type: 'Slides', title: 'Chapter 6: Probability', detail: '20 lecture slides linked from the chapter page.', terms: [['Independent events', 'Events where the occurrence of one does not change the probability of the other.'], ['Conditional probability', 'The probability of an event given that another event has occurred.']] },
    { id: 'prob-site', type: 'Website', title: 'Probability practice set', detail: 'Linked examples with worked solutions.', terms: [['Expected value', 'The long-run average outcome, calculated by weighting outcomes by their probabilities.']] }
  ]
};

const state = { step: 'welcome', mode: 'demo', courses: [], courseId: null, liveMaterials: [], selectedMaterials: new Set() };
const viewIds = ['welcome', 'classes', 'sources', 'guide'];
const courseFor = id => state.courses.find(course => String(course.id) === String(id));
const materialsFor = () => state.mode === 'demo' ? (demoMaterials[state.courseId] || []) : state.liveMaterials;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `StudyFlow could not load Canvas data (HTTP ${response.status}).`);
  return body;
}

function plainText(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,svg').forEach(node => node.remove());
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function extractReviewCards(material) {
  if (material.terms?.length) return material.terms;
  const doc = new DOMParser().parseFromString(String(material.body || ''), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,svg').forEach(node => node.remove());
  const cards = [];
  let heading = material.title || 'Class material';
  let body = [];
  const flush = () => {
    const definition = body.join(' ').replace(/\s+/g, ' ').trim();
    if (definition.length > 24 && cards.length < 16) cards.push([heading, definition.slice(0, 480)]);
    body = [];
  };
  for (const node of doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li')) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^H[1-6]$/.test(node.tagName)) {
      flush();
      heading = text;
    } else if (text.length > 24) body.push(text);
  }
  flush();
  if (!cards.length) {
    const text = plainText(material.body);
    if (text) cards.push([material.title || 'Class material', text.slice(0, 480)]);
  }
  return cards;
}

function renderCourses() {
  const grid = document.getElementById('course-grid');
  const message = document.getElementById('course-message');
  message.textContent = state.courses.length ? '' : 'No active classes were returned by Canvas.';
  grid.innerHTML = state.courses.map(course => {
    const id = String(course.id);
    const selected = String(state.courseId) === id;
    const code = course.courseCode || course.course_code || '';
    const term = course.term || '';
    const details = [code, term].filter(Boolean).join(' · ');
    return `<button class="course-card${selected ? ' selected' : ''}" type="button" data-course="${esc(id)}" aria-pressed="${selected}">
      <span class="course-icon" aria-hidden="true">${esc((course.name || 'C').charAt(0).toUpperCase())}</span>
      <span><span class="course-title">${esc(course.name || course.title || 'Untitled course')}</span><span class="course-meta">${esc(details || (state.mode === 'demo' ? course.detail || '' : 'Active Canvas course'))}</span></span>
      <span class="selection-dot" aria-hidden="true"></span>
    </button>`;
  }).join('');
  grid.querySelectorAll('[data-course]').forEach(button => button.addEventListener('click', () => {
    state.courseId = button.dataset.course;
    const course = courseFor(state.courseId);
    if (state.mode === 'demo') state.liveMaterials = [];
    state.selectedMaterials = new Set(materialsFor().map(item => String(item.id)));
    if (state.mode === 'canvas') {
      const syllabus = String(course?.syllabusBody || '');
      state.selectedMaterials = new Set(syllabus.trim() ? ['syllabus'] : []);
    }
    renderCourses();
  }));
  document.getElementById('class-continue').disabled = !state.courseId;
}

async function loadCanvasMaterials(course) {
  const message = document.getElementById('course-message');
  message.textContent = 'Loading your course syllabus and published pages…';
  document.getElementById('class-continue').disabled = true;
  try {
    const pages = await api(`/api/courses/${encodeURIComponent(course.id)}/pages`);
    state.liveMaterials = [];
    if (String(course.syllabusBody || '').trim()) {
      state.liveMaterials.push({ id: 'syllabus', type: 'Course syllabus', title: `${course.name} syllabus`, body: course.syllabusBody, detail: plainText(course.syllabusBody).slice(0, 180) || 'Course syllabus' });
    }
    for (const page of pages) {
      state.liveMaterials.push({ id: `page-${page.id}`, type: 'Canvas page', title: page.title, body: page.body || '', htmlUrl: page.htmlUrl || '', detail: plainText(page.body).slice(0, 180) || 'Published course page' });
    }
    state.selectedMaterials = new Set(state.liveMaterials.map(material => String(material.id)));
    message.textContent = `${state.liveMaterials.length} course materials loaded from Canvas.`;
    return true;
  } catch (error) {
    message.textContent = '';
    showToast(error.message);
    return false;
  } finally {
    document.getElementById('class-continue').disabled = !state.courseId;
  }
}

function renderSources() {
  const course = courseFor(state.courseId);
  const sourceList = document.getElementById('source-list');
  document.getElementById('source-course-label').textContent = `${course?.name || 'Class'} · Course materials`;
  const materials = materialsFor();
  sourceList.innerHTML = materials.map(item => `
    <label class="source-card">
      <input type="checkbox" value="${esc(item.id)}" ${state.selectedMaterials.has(String(item.id)) ? 'checked' : ''}>
      <span class="source-content"><span class="source-title">${esc(item.title)}</span><span class="source-meta">${esc(item.detail || 'Course material from Canvas')}</span></span>
      <span class="source-type">${esc(item.type)}</span>
    </label>`).join('');
  if (!materials.length) sourceList.innerHTML = '<p class="notice">Canvas did not return a syllabus or published pages for this course.</p>';
  sourceList.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    if (input.checked) state.selectedMaterials.add(input.value);
    else state.selectedMaterials.delete(input.value);
    document.getElementById('make-guide').disabled = state.selectedMaterials.size === 0;
  }));
  document.getElementById('make-guide').disabled = state.selectedMaterials.size === 0;
}

function renderGuide() {
  const course = courseFor(state.courseId);
  const selected = materialsFor().filter(item => state.selectedMaterials.has(String(item.id)));
  document.getElementById('guide-title').textContent = `${course?.name || 'Class'} Study Guide`;
  document.getElementById('guide-subtitle').textContent = `Made from ${selected.length} selected ${selected.length === 1 ? 'source' : 'sources'} · ${selected.map(item => item.type.toLowerCase()).join(', ')}`;
  const keyIdeas = selected.map(item => `<li><strong>${esc(item.title)}:</strong> ${esc(item.detail || plainText(item.body).slice(0, 180))}</li>`).join('');
  const cards = selected.flatMap(extractReviewCards);
  const sourceNotes = state.mode === 'canvas' ? `<section class="guide-section"><h3>Notes from your Canvas materials</h3>${selected.map(item => {
    const text = plainText(item.body);
    const link = item.htmlUrl ? `<a href="${esc(item.htmlUrl)}" target="_blank" rel="noopener noreferrer">Open in Canvas</a>` : '';
    return `<article class="guide-source"><strong>${esc(item.title)}</strong><p>${esc(text.slice(0, 1800) || item.detail || 'No text content was available for this source.')}</p>${link}</article>`;
  }).join('')}</section>` : '';
  document.getElementById('guide-body').innerHTML = `
    <section class="guide-section"><h3>Key ideas</h3><ul>${keyIdeas}</ul></section>
    <section class="guide-section"><h3>Review cards</h3><p>Use each prompt to recall the key information from your class materials.</p>${cards.map(([term, definition]) => `<article class="flashcard"><p class="term">${esc(term)}</p><p class="definition">${esc(definition)}</p></article>`).join('')}</section>
    ${sourceNotes}
    <section class="guide-section"><h3>Quick study tip</h3><p>Cover each definition, recall it in your own words, then check the answer. Revisit the terms that take more than one try.</p></section>`;
}

function go(step) {
  if (!viewIds.includes(step)) return;
  if (step === 'sources') renderSources();
  if (step === 'guide') renderGuide();
  state.step = step;
  viewIds.forEach(id => document.getElementById(id).classList.toggle('active', id === step));
  const index = viewIds.indexOf(step);
  document.getElementById('progress-value').style.width = `${index / (viewIds.length - 1) * 100}%`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow', String(index));
  document.querySelectorAll('[data-progress-label]').forEach(label => label.classList.toggle('active', Number(label.dataset.progressLabel) === index));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function startCanvasSession() {
  try {
    const session = await api('/api/session');
    if (!session.connected) return;
    document.querySelector('.top-note').textContent = session.user ? `Connected as ${session.user}` : 'Canvas connected';
    document.getElementById('logout-button').hidden = false;
    state.mode = 'canvas';
    state.courses = await api('/api/courses');
    state.courseId = null;
    renderCourses();
    go('classes');
  } catch (error) {
    showToast(error.message);
  }
}

document.getElementById('preview-button').addEventListener('click', () => {
  state.mode = 'demo';
  state.courses = demoCourses;
  state.courseId = null;
  document.querySelector('.top-note').textContent = 'Sample preview';
  document.getElementById('logout-button').hidden = true;
  renderCourses();
  go('classes');
});

document.getElementById('class-continue').addEventListener('click', async () => {
  if (!state.courseId) return;
  if (state.mode === 'canvas') {
    const course = courseFor(state.courseId);
    if (!await loadCanvasMaterials(course)) return;
  }
  go('sources');
});
document.getElementById('make-guide').addEventListener('click', () => { if (state.selectedMaterials.size) go('guide'); });
document.getElementById('edit-sources').addEventListener('click', () => go('sources'));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
document.getElementById('home-link').addEventListener('click', event => { event.preventDefault(); go('welcome'); });
document.getElementById('pdf-export').addEventListener('click', () => window.print());
document.getElementById('logout-button').addEventListener('click', async () => {
  try { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally {
    state.mode = 'demo';
    state.courses = [];
    state.courseId = null;
    state.liveMaterials = [];
    state.selectedMaterials.clear();
    document.querySelector('.top-note').textContent = 'Flashcards, the easy way.';
    document.getElementById('logout-button').hidden = true;
    go('welcome');
    showToast('Canvas signed out.');
  }
});
document.getElementById('quizlet-export').addEventListener('click', () => {
  const selected = materialsFor().filter(item => state.selectedMaterials.has(String(item.id)));
  const uniqueRows = Array.from(new Map(selected.flatMap(extractReviewCards).map(([term, definition]) => [term, definition])).entries());
  const content = uniqueRows.map(([term, definition]) => `${term}\t${definition}`).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  link.download = `${String(state.courseId || 'studyflow').replace(/[^a-z0-9_-]/gi, '-')}-quizlet-cards.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast('Flashcards downloaded in Quizlet import format (term, then definition).');
});

async function initialize() {
  try {
    const config = await api('/api/config');
    const connect = document.getElementById('connect-button');
    const note = document.getElementById('canvas-config-note');
    connect.disabled = !config.canvasReady;
    if (config.canvasReady) note.textContent = 'You’ll be redirected to Canvas to approve read access to your courses and published pages.';
  } catch {
    document.getElementById('canvas-config-note').textContent = 'Start StudyFlow with node server.mjs to connect Canvas. You can still preview the sample flow.';
    document.getElementById('connect-button').disabled = true;
  }
  const query = new URLSearchParams(location.search);
  if (query.has('canvas_error')) showToast(query.get('canvas_error'));
  if (query.has('canvas_connected')) showToast('Canvas connected. Your active classes are ready.');
  if (query.has('canvas_error') || query.has('canvas_connected')) history.replaceState({}, '', location.pathname);
  await startCanvasSession();
}

initialize();
