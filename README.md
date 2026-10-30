# ICSM Project 4

## StudyFlow

Flashcards, the easy way. StudyFlow is a lightweight study-guide prototype for students. Choose a class, select course materials, and create a guide with review cards.

**Live preview:** [studyflow-icsm-project4.onrender.com](https://studyflow-icsm-project4.onrender.com/). Canvas login activates after the school developer key is added to the Render service environment.

### Run it

Requires Node.js 18 or newer. Copy `.env.example` to `.env`, add the Canvas Developer Key credentials, then start the app:

```sh
node server.mjs
```

Open `http://localhost:3000`. Canvas sign-in requires your school’s Canvas URL and a developer key registered with this exact redirect URL: `http://localhost:3000/auth/callback`. Your Canvas administrator may need to create or approve the key. Never commit `.env` or share its client secret.

### Deploy as a Node web service on Render

1. Push this repository to GitHub, then create a Render account and choose **New → Blueprint**. Connect `tobybmcdo/ICSM-Project4`; Render reads `render.yaml` to create the Node web service.
2. Enter the Canvas client ID and client secret when prompted. Keep the secret in Render’s environment settings; do not put it in GitHub.
3. After the first deploy, copy the service’s public `https://…onrender.com` URL. Register `<that URL>/auth/callback` as the Canvas Developer Key’s redirect URI. If you change the service URL later, update the registered redirect URI too.
4. Ask your Canvas administrator to issue or approve a developer key for this app and its read-only course/page scopes. Sign-in becomes available after the service has the key values and restarts.

Render supplies the service URL and port; `server.mjs` uses them automatically. Deploying from the linked `main` branch will redeploy the service when you push code changes. OAuth sessions are held in memory, so a service restart signs users out.

### Canvas data

StudyFlow uses Canvas OAuth 2.0. The browser never receives the developer key secret or the user's Canvas access token. The local server stores OAuth tokens in memory for the session and requests read-only access to active courses and published course pages. It loads course names, course codes, terms, syllabi, and page text. Sign out clears the local session and asks Canvas to revoke the token.

The app does not yet extract content from files, external websites, or linked videos. If Canvas sign-in is not configured, use **Preview with sample data** to explore the study-guide flow. Quizlet-compatible flashcards and print-to-PDF work in both modes.

## Team

Tristan

Toby
