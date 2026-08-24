# Course Archiving (Soft Deletion)

**Date:** 2026-08-24
**Status:** Approved, implementing

## Problem

A course shell lives forever. There is no way for an instructor to retire one at
the end of a term, so the course selector accumulates every course an instructor
has ever run, students keep a finished course on their dashboard indefinitely,
and a co-instructor added for one term keeps their access into the next.

Hard deletion is the obvious answer and the wrong one. A course owns materials,
generated questions, quizzes, student attempts, scores, and achievements —
deleting a course discards graded student work and the question bank the
instructor spent a term building. It is also irreversible in an app where the
only actor is a busy instructor clicking through a settings page.

## Solution

Soft deletion. A course is flagged **archived**. The owner keeps it, read-only,
in a separate part of the app; everyone else loses access as if it were gone.
The owner can bring it back.

## Decisions

These were settled with the product owner before implementation; they are
recorded here because several of them are not the obvious default.

| Question | Decision |
|---|---|
| What can the owner do in an archived course? | **Read-only + export.** Every page opens and renders; every write is refused server-side. Unarchive is the sole state-changing action. |
| Where does the owner find archived courses? | **A tab in the Manage-courses hub** (`/onboarding`), which is already the destination of "+ Manage courses..." in the sidebar. |
| What happens to students at archive time? | **Hard cut.** The course leaves their list at once; an in-progress quiz attempt is abandoned and the next request from an open quiz page is refused. |
| Course code and invite code | **Freed.** An archived course stops reserving its `courseCode`, so next term's shell can reuse it, and its `courseAccess` invite code stops admitting anyone. |
| Unarchiving when the code was taken | **Blocked.** The owner is told and must supply a new code in the same dialog. Two live courses never share a code. |
| What members see | **Nothing.** The course vanishes silently. Memberships are preserved, so unarchiving restores everyone exactly as they were. |

## Goals

- One flag flips a course out of everyone's reach but the owner's, and flips back.
- No student work, question, material, or membership is destroyed.
- The read-only guarantee is enforced by the server, not by hiding buttons.
- Existing courses (no `archived` field) behave exactly as they do today.

## Non-goals

- **Permanent deletion / retention purge.** Archiving is terminal for now. No
  purge job, no "delete forever" button. If a retention policy arrives later,
  `archivedAt` is the field it will key on.
- **Archiving by anyone but the owner or an app administrator.** Co-instructors
  and TAs cannot archive, however broad their co-instructor permissions are.
  App administrators *can*, deliberately: `isCourseManager` is the gate this
  codebase already uses for owner-only powers (it guards the owner-only settings
  keys), and an instructor who has left the university has to leave someone able
  to retire their courses. The 403 text says "owner or an app administrator" so
  the behaviour and the message agree.
- **Per-section archiving.** The unit is the course shell.
- **Qdrant/RAG teardown.** An archived course keeps its vector collection so
  unarchiving is instant and lossless. Storage cost is accepted.

## Design

### Schema

`grasp_course` gains three fields, all absent on existing documents:

```js
archived: true,           // present and true only while archived
archivedAt: Date,
archivedBy: ObjectId,     // the user who archived it
```

Every read filters on `archived: { $ne: true }`, so a document without the field
is live. This is what makes the migration a no-op.

### The two gates

Archiving has to do two different things to two different audiences, and it is
worth naming them separately because they are enforced at different points.

**Gate 0 — the unique index.** `grasp_course` carries a unique index on
`courseCode`. Filtering archived courses out of `getCourseByCode` is not enough
to release a code: the *insert* of next term's shell would still fail with a
duplicate-key error, whatever the application looked up first. So the index is
partial, covering only live courses:

```js
{ unique: true, partialFilterExpression: { archived: { $exists: false } } }
```

`$exists: false` selects exactly the documents the app treats as live —
`createCourse` never writes the field and `unarchiveCourse` `$unset`s it, so
absent means live and `true` means archived. `createOrReplaceIndex` upgrades the
plain unique index that existing databases already carry.

**Gate 1 — visibility.** Archived courses are filtered out of the course lists:
`getUserCourses` (which backs both `/api/courses/my` and `/api/student/courses`),
`listCoursesForEnrollment`, `getCourseByCode`, and `getCourseByEnrollmentCode`.
The last two are what "frees the code" means in practice — the collision check at
create time and the invite-code join stop seeing the archived course at all,
with no extra branching anywhere. The sidebar already drops a selection that is
no longer in the list and switches to the first live course
(`Sidebar.jsx:77-90`), so members are moved off an archived course with no new
client code.

**Gate 2 — enforcement.** Visibility alone is not access control. Two holes make
a server-side gate mandatory:

1. `hasStaffAccessInCourse()` (`src/utils/course-access.js:37`) returns `true`
   for *any* faculty user, member or not. A co-instructor who is faculty — most
   of them — keeps staff-level API access to an archived course they can no
   longer see. Hiding it from their list does nothing.
2. The owner is *supposed* to reach the course. Read-only cannot be a matter of
   which buttons the client renders.

So a middleware, `requireActiveCourse`, resolves the target course for a request
and applies:

| Requester | Read (GET) | Write (POST/PUT/PATCH/DELETE) |
|---|---|---|
| Owner / app admin | allowed | **403** `course_archived` |
| Everyone else | **403** `course_archived` | **403** `course_archived` |

The archive and unarchive endpoints are exempt — they are the way out.

### Resolving the course for a request

`courseId` reaches the API several ways, and the middleware checks them in
order: `req.params.courseId`, `req.body.courseId`, `req.body.metadata.courseId`
(the RAG add-document route), `req.body.course` (question export names it that),
`req.body.questions[0].courseId` (question review carries it only on the
questions), then `req.query.courseId`. A handler that invents a new shape has to
be added there — a shape the list misses is a write that reaches an archived
course.

That covers the course, users, material-by-course, and rag-llm routes. It does
not cover routes keyed by a child resource — `/api/quiz/:quizId`,
`/api/student/quizzes/:quizId/*`, `/api/question/:questionId`,
`/api/objective/:id`, `/api/material/delete/:sourceId`, `/api/image/:fileId` —
where the course is one lookup away. For those the middleware takes an explicit
resolver:

```js
requireActiveCourse({ resolve: async (req) => (await getQuizById(req.params.quizId))?.courseId })
```

A request whose course cannot be resolved passes through untouched. The
middleware's job is to refuse archived courses, not to be an authorization layer
— the existing `hasStaffAccessInCourse` / `assertCoInstructorPermission` checks
stay exactly where they are and still run.

The student quiz routes are the ones that matter most for the hard-cut decision:
they are what an open quiz tab calls, and the resolver is what turns "archived"
into an immediate refusal for a student mid-attempt. `/api/image/:fileId` is
part of that same cut rather than only a write block — images live in GridFS
with their course on the file metadata, and a student rendering a quiz fetches
them directly.

### Archive

`POST /api/courses/:courseId/archive`, gated on `isCourseManager` (owner or app
administrator — the helper already exists at
`src/utils/co-instructor-permissions.js:57`).

Sets the three fields. Nothing else happens: no membership is touched, no quiz
is unpublished, no schedule is cancelled. Everything downstream is a consequence
of the two gates. This is deliberate — the fewer side effects archiving has, the
more exactly unarchiving restores the course.

### Unarchive

`POST /api/courses/:courseId/unarchive`, same gate.

Before clearing the flag it re-checks the course code, because archiving
released it and a new shell may have claimed it in the meantime:

- Code still free → unarchive, return the course.
- Code taken, no `courseCode` in the body → **409** `code_conflict`, with the
  conflicting course's name so the dialog can explain itself and suggest a free
  alternative from `findAvailableCourseCode`.
- Code taken, `courseCode` supplied → validate it is free, rename, unarchive.

### The owner's portal

`GET /api/courses/archived` returns the archived courses **owned by** the caller.
It is deliberately owner-scoped rather than manager-scoped: an app administrator
passes `isCourseManager` for every course, and a global list of every archived
course in the deployment is not a useful page. Administrators can still open any
archived course by id.

The Manage-courses hub (`/onboarding`) gains an "Archived courses" tab listing
each course with **View** and **Unarchive**. "View" selects the course and sends
the owner to the dashboard, where the archived-mode banner explains the state.

One wrinkle: the sidebar ejects a selected course that is not in
`/api/courses/my`, which now excludes archived ones — it would bounce the owner
straight back out. So `CourseSelector` treats the archived list as also valid for
the current selection while still keeping archived courses out of the dropdown
options, and renders the current archived course as a labelled option so the
`<select>` is not blank. Picking any live course exits archived mode.

### Read-only in the UI

The server refuses the writes; the client's job is to not offer them. A single
`useIsArchivedCourse()` hook reads `course.archived` from the already-cached
`useCourse(courseId)` query, and feeds:

- a persistent banner in `AppLayout` naming the state and offering Unarchive,
- suppression of the primary write affordances on the instructor pages.

Export stays enabled throughout — being able to get the question bank and the
scores out is a large part of why an instructor archives rather than deletes.

## Risks

**A missed write path.** The middleware covers routes by the id shapes listed
above and by explicit resolver; a handler that invents another shape would let a
write through. The consequence is a stray edit to an archived course, not data
loss, and the list is easy to extend — but it is the part of this design most
likely to rot, so a new course-scoped route should be checked against it.

**A student loses an in-flight attempt.** This is the chosen behaviour, not an
oversight — an instructor archiving a course mid-term is the unusual case, and
the confirmation dialog says plainly that students lose access immediately.

**Two courses with the same code.** Prevented at unarchive, but a *live* course
created while another was archived is untouched — the archived one is the one
forced to rename. That is the right way round: the live course is in use.
