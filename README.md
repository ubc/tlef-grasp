# GRASP — Generative AI-powered Research-informed Assessment System for Practice

GRASP is a web application that helps UBC instructors turn course materials into
evidence-based formative assessments. Instructors upload lecture content, generate
and review AI-authored questions, and publish quizzes; students get spaced,
adaptive, and elaborative practice — all behind UBC Single Sign-On.

## Key Features

- **AI question generation** — Upload lecture material (text, PDF, DOCX, URLs) and
  generate evidence-based questions grounded in your content via a
  retrieval-augmented (RAG) pipeline.
- **Multiple question types** — Multiple choice, fill-in-the-blank, calculation,
  and open-ended questions, with support for math (KaTeX) and chemistry
  (SMILES) rendering.
- **Question review & banking** — Review, edit, flag, and organize generated
  questions in a per-course question bank before they reach students.
- **Quizzes & scoring** — Build quizzes from the bank, publish them to students,
  and track scores and quiz summaries.
- **Student practice experience** — A dedicated student dashboard with quizzes,
  achievements, and adaptive practice.
- **Course materials & onboarding** — Manage uploaded materials per course and
  guide new instructors through setup.
- **User management** — Faculty can view and manage course members.
- **UBC SSO** — SAML-based Single Sign-On / Single Log-Out, with role-based access
  (faculty / staff / student).

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, React Router, TanStack Query,
  Zustand
- **Backend:** Node.js, Express 5
- **Database:** MongoDB
- **AI / RAG:** UBC GenAI Toolkit (LLM, embeddings, chunking, RAG), Qdrant vector
  store, OpenAI or Ollama as the LLM provider
- **Auth:** Passport + SAML (UBC Shibboleth)
- **Testing:** Cypress (end-to-end)

## Project Structure

```
tlef-grasp/
├── client/                   # React frontend (Vite + Tailwind)
│   ├── src/                  # pages, components, hooks, stores
│   ├── dist/                 # built assets, served in production (committed)
│   └── cypress/              # end-to-end tests
├── src/                      # Express backend
│   ├── server.js             # server entry (API + serves client/dist)
│   ├── routes/               # API + auth route definitions
│   ├── controllers/          # request handlers
│   ├── services/             # business logic, data access, RAG
│   ├── models/               # question models
│   └── middleware/           # auth, session, passport, database
├── .env.example              # environment variable template
├── package.json              # backend dependencies and scripts
└── README.md                 # this file
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- A running **MongoDB** instance
- A running **Qdrant** instance (for the question-generation vector store)
- An LLM provider — an **OpenAI** API key, or a local **Ollama** server
- For login: a SAML Identity Provider. For local development this is typically the
  `docker-simple-saml` project.

### 1. Install dependencies

Install backend and frontend dependencies:

```bash
npm install
npm --prefix client install
```

### 2. Configure environment

Copy the template and fill in your values:

```bash
cp .env.example .env
```

### 3. Start the development servers

```bash
npm run dev
```

This runs the Express backend (port `8070`) and the Vite dev server (port `5173`)
in parallel. The Vite dev server proxies `/api`, `/auth`, and `/Shibboleth.sso`
requests to the backend, so you only need to open the frontend.

### 4. Open the app

Visit **http://localhost:5173/** in your browser. You'll be taken through SSO and
into the dashboard.

## Available Scripts

Backend (run from the project root):

- **`npm run dev`** — Start backend + frontend together (development).
- **`npm run dev:server`** — Start only the Express backend (with nodemon).
- **`npm run dev:client`** — Start only the Vite frontend.
- **`npm run build`** — Build the React client into `client/dist`.
- **`npm start`** — Run the production server (serves the built client from
  `client/dist` at port `8070`).

Frontend (run from `client/`):

- **`npm run lint`** / **`npm run format`** — Lint / format the client source.
- **`npm run cypress:open`** / **`npm run test:e2e`** — Run end-to-end tests.
  See [client/cypress/README.md](client/cypress/README.md) for setup.

## License & Ownership

This project is owned by the Learning Technology Innovation Centre (LTIC) at the
University of British Columbia. All rights reserved.
