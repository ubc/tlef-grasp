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
  multiple answer ("select all that apply", graded all-or-nothing),
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

- Node.js 22.23.4 (pinned in `.nvmrc`; `nvm use` picks it up)
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

#### Field-level encryption key

With `GRASP_DATA_ENCRYPTION_KEY` set, GRASP encrypts the fields listed in
`src/services/encryption.config.cjs` before they reach MongoDB, using
`@ubc/genai-toolkit-encryption`. Without it, encryption is off: those fields
are stored as plaintext and the server logs a warning at boot. Generate a key
with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

PUIDs are encrypted too, and found through a blind index keyed by a second
secret, `GRASP_BLIND_INDEX_KEY` (generated the same way, never the data key).
It is required whenever `GRASP_DATA_ENCRYPTION_KEY` is set. Before migrating
`grasp_user`, build its unique PUID index once with the toolkit's
`ensure-indexes` command; until then the server warns at every boot.

Every environment has its own keys. Data written under a key can only be read
with that key, so a database copied from another environment needs that
environment's key. Turning encryption on is one-way per database: the first
start with a key records it in `grasp_field_encryption`, and from then on
GRASP refuses to run on that database without the key.

Data stored before a field was encrypted stays readable (`GRASP_ENCRYPTION_ROLLOUT`
defaults to `mixed`) until it is migrated with the toolkit's CLI, which reads
`.env` the same way the server does:

```bash
npm run encryption -- plan --config src/services/encryption.config.cjs --all-configured
```

Follow the toolkit's `docs/migration-runbook.md` (in
`node_modules/@ubc/genai-toolkit-encryption/`) for `migrate` and `verify`.

#### Optional Canvas connection

Set `CANVAS_DOMAIN`, `CANVAS_CLIENT_ID`, `CANVAS_CLIENT_SECRET`, and
`CANVAS_REDIRECT_URI` (see `.env.example`) to enable the Canvas controls in
instructor Settings, My Sections, and Course Materials. If any of them is
absent, Canvas is hidden, every section keeps syncing students from the UBC
Academic API, and materials are added by upload or pasted text only.

Each instructor connects their own Canvas account (OAuth, per GRASP user) and
links a GRASP section to one Canvas section. GRASP keeps a connection only when
the Canvas account's `integration_id` (at UBC, the PUID) is the signed-in GRASP
user's PUID, so an instructor whose browser is signed in to Canvas as someone
else gets "That Canvas account belongs to someone else" and nothing is stored.
GRASP calls these Canvas API endpoints with that instructor's token, and never
relies on `include[]` parameters (a scoped developer key strips them):

- `GET /api/v1/users/self/profile` — on connect, the account's own
  `integration_id`, checked against the GRASP user's PUID. Canvas's user object
  (`/users/self`) leaves `integration_id` out for anyone but account admins
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

Every connection needs `url:GET|/api/v1/users/:user_id/profile`, on the
developer key and in `CANVAS_SCOPES`: without it GRASP cannot confirm whose
account was authorized, refuses every new connection, and logs a warning at
startup.

Recommended value (enables linking and roster sync):

```
CANVAS_SCOPES="url:GET|/api/v1/users/:user_id/profile url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/sections url:GET|/api/v1/courses/:course_id/enrollments url:GET|/api/v1/courses/:course_id/assignments"
```

| GRASP feature | Scopes it needs |
|---|---|
| Connect Canvas (every feature) | `url:GET\|/api/v1/users/:user_id/profile` |
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

#### Canvas quiz import

**Import Questions** (Question Bank) also accepts a Canvas Classic Quizzes
export (`.zip`, QTI 1.2; issue #140). It needs no Canvas connection. GRASP
previews the file, the instructor picks the Canvas quizzes to bring in, and each
one becomes an unpublished GRASP quiz with one objective per Canvas question or
question group. Multiple choice and true/false, multiple answers, numerical
(as fixed-answer calculation questions), fill-in-the-blank, short answer and
formula questions are imported; matching, multiple-dropdown, essay and
file-upload questions, question-bank groups and New Quizzes exports are
reported as skipped, each with its reason. Canvas Classic always gives partial
credit on multiple answers, while GRASP marks them right only when exactly the
correct options are ticked; the review and the result say so for each quiz
that has them.

A Canvas **formula question** (issue #130) becomes a GRASP calculation question
with variables:

- `[x]` in the question text becomes `{{x}}` for the declared variables only
  (chemistry stems write concentrations as `[A]`). Each variable keeps its
  range and decimal places (0 decimals → whole numbers); the answer keeps its
  decimal places and its tolerance (`0.05` → absolute, `3%` → percent).
- The formula is translated from Canvas's dialect (`src/utils/canvas-formula.js`):
  Canvas's `log(x)` is base 10 and GRASP's is natural, so it becomes `log10(x)`;
  `log(x, b)` → `(ln(x)/ln(b))`; `e`, `pi` → `E`, `PI`; `fact` → `fac`;
  `deg_to_rad`/`rad_to_deg` are written out; several formula lines
  (`k = 2*x` …) are combined into one. A formula using a Canvas list or
  random function (`mean`, `sum`, `rand`, `if`, …) is skipped, naming it.
- As a check, the translated formula is evaluated at up to 20 of Canvas's own
  precomputed value sets and compared with the answers Canvas recorded. A
  mismatch saves the question as a Draft with a warning that shows both numbers.
- Canvas's precomputed value sets are not stored: GRASP samples fresh values
  for every attempt, as it does for its own calculation questions. An absolute
  tolerance is measured from the answer as the student sees it (rounded to the
  question's decimal places) as well as from the exact value, so a correctly
  rounded answer at the edge of the margin is accepted as it is in Canvas.

#### Canvas quiz export

**Export → Canvas (QTI)** on a quiz writes a Canvas Classic Quizzes `.zip`
(QTI 1.2) to import in Canvas under Settings → Import Course Content → "QTI
.zip file". Calculation questions (issue #63) go out as Canvas formula
questions, or as numerical questions when they have no variables
(`src/utils/canvas-calculation-export.js`):

- `{{x}}` becomes `[x]`, a variable the text doesn't mention gets the same
  "Given:" line students see in GRASP, and the formula is translated with the
  same module as the import, the other way round. Canvas's calculator only
  negates the number or name right after a `-` and works `^` left to right, so
  the export writes `-log10(h)` as `-1*log(h)` and `2^x^2` as `2^(x^2)`;
  e-notation such as `6.022e23` is written `(6.022*10^(23))`.
- Canvas serves each student one of a fixed list of value sets stored with the
  question, so the export draws 50 with GRASP's own sampling and evaluator,
  works each answer out from the values as Canvas shows them, and stores it to
  the decimal places. The translated formula is then worked out by Canvas's
  calculator rules and must give the same answer at every set.
- Canvas accepts everything GRASP accepts, sometimes a little more:
  - No tolerance: half a unit of the last shown digit. For answers GRASP shows
    as a × 10^n it is one margin when they share a power of ten, else a
    percent, the largest any set needs (up to about ten times wider than GRASP
    for an answer with a larger mantissa). When a question's value sets mix
    plain and a × 10^n answers, only the larger group is kept.
  - A percent is kept, with answers stored to four more places, since GRASP
    measures it from the exact value. Sets whose answer is 0 are left out
    (Canvas's percent of 0 accepts only 0).
  - An absolute margin grows by the rounding gap (0.05 → 0.055 at 2
    decimals), since GRASP measures it from the exact or the shown answer.
- A question Canvas can't represent (a function Canvas formulas lack, such as
  `sinh` or `roundTo`, a formula Canvas's calculator works out differently,
  such as `fac` of a decimal, or a variable name Canvas can't use) is left out,
  and the export dialog lists it with the reason. H5P exports list calculation
  questions the same way, as H5P has no type for them.

A multiple-answer question goes out as a Canvas Multiple Answers question, in
the shape Canvas exports its own. Canvas grades those with partial credit while
GRASP grades the exact set, and the export dialog says so for a quiz that has
one.

#### Grade CSV for Canvas

**Download grades (CSV)** on Quiz Scores (issue #126) writes one section's
grades in the layout Canvas's gradebook import reads (Grades → Import). It
makes no Canvas API calls and needs no Canvas connection. Only instructors and
app administrators see it; the API refuses TAs and students, and an instructor
who doesn't own the course gets only their own sections, as on Quiz Scores.

- The instructor ticks which of the section's published, scheduled quizzes go
  in, or all of them. Each becomes a `GRASP: <quiz name>` column with the
  student's percent, followed by `GRASP: Average`, the mean of the counted
  quizzes. The prefix stops a column from writing into a Canvas assignment
  that happens to share the quiz's name, and later uploads update the same
  columns.
- A quiz the student never took is 0 once it has closed for the section, and
  blank while it is open or not yet released; blanks don't count towards the
  average.
- Students are matched in Canvas by `ID` (the Canvas user id, filled in when a
  Canvas roster sync stored one), then `SIS Login ID` (the Canvas login when
  known, else the PUID), then by name. `Integration ID` carries the PUID.
- **Include questions correct** (off by default) adds a `(correct)` column
  after each quiz, such as `4 of 5`: questions right out of the questions that
  student was served, which can differ between students on a spaced quiz. The
  columns are marked read only in the Points Possible row, which makes Canvas
  skip them only when every student matches, so the dialog says to leave the
  option off for a file going to Canvas.
- The dialog warns when students have disputed AI grades that haven't been
  settled, since the file uses the current grades.

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
