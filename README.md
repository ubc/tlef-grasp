# GRASP — Generative AI-powered Research-informed Assessment System for Practice

GRASP is a web application that helps UBC instructors turn course materials into
evidence-based formative assessments. Instructors upload lecture content, generate
and review AI-authored questions, and publish quizzes; students get spaced,
adaptive, and elaborative practice — all behind UBC Single Sign-On.

## Key Features

- **AI question generation** — Upload lecture material (text, PDF, DOCX, URLs) and
  generate evidence-based questions grounded in your content via a
  retrieval-augmented (RAG) pipeline. Multiple-choice questions are drafted
  with four options unless the generation step asks for another count (two to
  eight).
- **Multiple question types** — Multiple choice (two to eight answer options),
  fill-in-the-blank, calculation, and open-ended questions, with support for
  math (KaTeX) and chemistry (SMILES) rendering.
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

#### Optional Canvas connection

Set `CANVAS_DOMAIN`, `CANVAS_CLIENT_ID`, `CANVAS_CLIENT_SECRET`, and
`CANVAS_REDIRECT_URI` (see `.env.example`) to enable the Canvas controls in
instructor Settings, My Sections, and Course Materials. If any of them is
absent, Canvas is hidden, every section keeps syncing students from the UBC
Academic API, and materials are added by upload or pasted text only.

Each instructor connects their own Canvas account (OAuth, per GRASP user) and
links a GRASP section to one Canvas section. GRASP calls these Canvas API
endpoints with that instructor's token, and never relies on `include[]`
parameters (a scoped developer key strips them):

- `GET /api/v1/courses` — the courses the instructor teaches (`enrollment_type=teacher`)
- `GET /api/v1/courses/:course_id/sections` — sections offered for linking
- `GET /api/v1/courses/:course_id/enrollments` (`type[]=StudentEnrollment`,
  `state[]=active,invited`) — the roster read by **Sync from Canvas**; Canvas
  embeds each enrollment's user, with `integration_id` when the token may read
  SIS data
- `GET /api/v1/courses/:course_id/files` (`content_types[]` = PDF, DOCX, PPTX,
  plain text) — the files offered by **From Canvas** in Course Materials
- `GET /api/v1/courses/:course_id/files/:id` — one file's name, type and size,
  read inside the course before anything is downloaded
- `GET /api/v1/files/:id/public_url` — a signed, time-limited link the file is
  downloaded through. The file's own URL (`/files/:id/download`) is not an
  `/api/v1` path, so no scope can cover it and an Enforce Scopes key is refused
  there

##### Canvas scopes (`CANVAS_SCOPES`)

A developer key with **Enforce Scopes** on refuses an OAuth request that names
no scopes (or any scope the key lacks), and answers any API call outside the
token's scopes with 401. Set `CANVAS_SCOPES` to the scopes GRASP should request
(whitespace- or comma-separated, each one of the key's scopes):

- **Unset/empty** — GRASP requests no scopes and every Canvas feature is on.
  This only works on a key **without** Enforce Scopes (e.g. local dev Canvas).
- **Set** — GRASP requests exactly that list, and each Canvas feature is on only
  when all of its scopes are listed (`src/lms/canvas-scopes.js` holds the map;
  `/api/lms/canvas/status` reports the result as `capabilities`). A disabled
  feature is hidden in the UI and its routes answer 409 `capability-disabled`.
  A Canvas-linked section whose deployment lacks the roster-sync scopes shows
  "Canvas roster sync isn't enabled on this deployment" and never falls back to
  the Academic API.

Recommended value for UBC's current production key (enables linking and
roster sync):

```
CANVAS_SCOPES="url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/sections url:GET|/api/v1/courses/:course_id/enrollments url:GET|/api/v1/courses/:course_id/assignments"
```

| GRASP feature | Scopes it needs |
|---|---|
| Link a section (`link`) | `url:GET\|/api/v1/courses`, `url:GET\|/api/v1/courses/:course_id/sections` |
| Sync from Canvas (`rosterSync`) | `url:GET\|/api/v1/courses`, `url:GET\|/api/v1/courses/:course_id/enrollments` |
| Import course files (`files`, issue #141) | `url:GET\|/api/v1/courses` plus the three below |
| Canvas assignments for scheduled quizzes (`assignments`, issue #125) | `url:GET\|/api/v1/courses`, `url:GET\|/api/v1/courses/:course_id/assignments` plus the four below |

To enable Canvas assignments for scheduled quizzes, add these four scopes to
the developer key and then to `CANVAS_SCOPES`:

```
url:POST|/api/v1/courses/:course_id/assignments
url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/overrides
url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/overrides/:id
url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/overrides
```

To enable importing course files, add these three scopes to the developer key
and then to `CANVAS_SCOPES`:

```
url:GET|/api/v1/courses/:course_id/files
url:GET|/api/v1/courses/:course_id/files/:id
url:GET|/api/v1/files/:id/public_url
```

Changing `CANVAS_SCOPES` requires instructors to **reconnect Canvas**: an
existing token keeps the scopes it was granted. Canvas answers both an expired
token and a call outside the token's scopes with 401, so GRASP reports either as
"Canvas rejected the request. Reconnect Canvas; if this keeps happening, the
GRASP Canvas developer key may be missing a permission."

**Sync from Canvas** (My Sections, per linked section) replaces the Academic API
sync for Canvas-linked sections while Canvas is configured; unlinked and
Moodle-linked sections keep the Academic API sync. It works like this:

- It reads the Canvas students (`StudentEnrollment`, active or invited) of the
  linked Canvas section only — Test Student, TAs, teachers, and observers are
  excluded — after re-checking that the instructor still teaches the linked
  Canvas course.
- Students are matched to GRASP accounts by Canvas `integration_id`, which at
  UBC is the PUID, and by nothing else. Students who have never signed in get a
  placeholder account keyed by their PUID. Rows without an `integration_id` are
  reported as unmatched, never guessed. Canvas only returns `integration_id` to
  tokens allowed to read SIS data, so the instructor's Canvas role needs that
  permission: with no `integration_id` at all the sync refuses and changes
  nothing, and below 80% coverage it adds who it can but drops no one.
- Students no longer on the Canvas section are soft-dropped from the GRASP
  section (they lose quiz access for it; a later sync restores them if they
  come back). The first sync after linking or re-linking a section never drops
  anyone without the instructor confirming the list, and neither does a sync
  that would drop more than half the section.
- Adds, restores, and drops are recorded in the course's access history with
  the syncing instructor as the actor.

**From Canvas** (Course Materials → Upload Materials) imports course files
straight from Canvas, as an alternative to uploading them. It works like this:

- The option appears only for an instructor who can use it: Canvas is
  connected, the deployment's scopes include files, and they own at least one
  section linked to Canvas. Upload and pasted text are unchanged.
- GRASP links sections, not courses, so the instructor picks from the Canvas
  courses their own linked sections point to. Files are read with that
  instructor's own Canvas token, after re-checking that they still teach the
  Canvas course. Adding materials needs the same course permissions as upload.
- The picker lists the course's PDF, DOCX, PPTX and TXT files, newest first,
  across all Canvas folders. Files over 50 MB (the upload limit) are shown but
  cannot be picked.
- Each imported file goes through the same parsing, indexing and outline step
  as an uploaded one (`src/services/material-ingest.js`) and is titled with its
  Canvas file name.
- Each material remembers the Canvas file it came from (`lms` on the
  `grasp_material` document), and a unique index allows one material per
  Canvas file per course: importing the same file again creates no second
  copy. Replacing a file in Canvas gives it a new file id, so the new version
  is offered as a new file (flagged as replacing one imported earlier) and
  importing it adds a second material; the earlier one is left untouched.

**Canvas assignments for scheduled quizzes** (issue #125) give each scheduled
quiz a gradebook column in Canvas, for the grade export of #113 item 5. It
works like this:

- When a quiz is scheduled on a Canvas-linked section, GRASP asks whether to
  create the assignment; when a section with scheduled quizzes is linked, it
  asks for those quizzes. Scheduling an unlinked section does nothing in
  Canvas. "Don't create" is remembered; the section's schedule chip on the quiz
  offers "Canvas" (create) later.
- The assignment is plain: `submission_types: ["none"]`, 100 points, published
  (Canvas's grade import only matches published assignments), visible only to
  the linked Canvas section through a section override whose `due_at` is the
  section's close time in GRASP. It is named `<quiz> — <section> (GRASP)` and
  its description tells students to take the quiz in GRASP, with a link.
- Rescheduling moves the Canvas due date automatically. If Canvas cannot be
  reached, the GRASP schedule is still saved, the chip shows the failure and
  offers a retry. Unscheduling, deleting a quiz or recycling a section never
  deletes anything in Canvas; deleting a quiz says so.
- One assignment per quiz per GRASP section: `grasp_quiz_lms_assignment` holds
  the mapping (unique on quiz + section), a row is claimed before Canvas is
  called, and a create first looks for an assignment that already carries the
  name. Both instructors must own the section; the write uses the clicking
  instructor's own Canvas token after re-checking they teach the Canvas course.
- Schedule times are sent from the browser as instants (with the zone the
  instructor typed them in), so the stored window and the Canvas due date are
  the same moment whatever timezone the server runs in.

#### Optional Moodle connection

Set `MOODLE_DOMAIN` to enable the Moodle controls in instructor Settings (for
the local Moodle container, use `http://localhost:9200`). If it is absent, the
Moodle tab and link buttons are hidden.

The Moodle site must have REST web services enabled and expose these functions
to the service used by GRASP:

- `core_webservice_get_site_info`
- `core_enrol_get_users_courses`
- `core_group_get_course_groups`

Each instructor generates their own Moodle web-service token and pastes it into
GRASP. The token is stored per GRASP user; it is not shared with co-instructors.

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
