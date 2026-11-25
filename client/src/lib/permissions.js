// Co-instructor permissions: the course owner (and app administrators) always
// have full access. For any other instructor in the course, the owner can hide
// specific dashboard areas/actions. Enforcement is purely client-side — these
// are trusted instructor accounts, so we gate visibility, not the API.
//
// `path` permissions gate a sidebar link + its route; `path: null` permissions
// gate an in-page action (e.g. creating a quiz). A permission is "enabled"
// unless the stored map explicitly sets it to false, so the default is full
// access and existing co-instructors are unaffected until an owner restricts.

export const CO_INSTRUCTOR_PERMISSIONS = [
  {
    key: "courseMaterials",
    label: "Course Materials",
    icon: "fa-upload",
    path: "/course-materials",
    description: "Upload and manage course source materials.",
  },
  {
    key: "questionGeneration",
    label: "Question Generation",
    icon: "fa-wand-magic-sparkles",
    path: "/question-generation",
    description: "Generate questions from learning objectives with AI.",
  },
  {
    key: "questionBank",
    label: "Question Bank",
    icon: "fa-book",
    path: "/question-bank",
    description: "View and manage the saved question library.",
  },
  {
    key: "createQuiz",
    label: "Create Quizzes",
    icon: "fa-clipboard-list",
    path: null,
    description:
      "Create new quizzes. Scheduling existing quizzes is always allowed.",
  },
  {
    key: "settings",
    label: "Settings",
    icon: "fa-cog",
    path: "/settings",
    description:
      "Open course settings, prompts, and the invite code. The Co-Instructor Permissions tab stays owner-only.",
  },
];

// Map a route path to the permission key that gates it (for nav + route guards).
export const PATH_PERMISSION = CO_INSTRUCTOR_PERMISSIONS.reduce((map, perm) => {
  if (perm.path) map[perm.path] = perm.key;
  return map;
}, {});

// TA permissions: instructors grant or withhold individual capabilities per
// TA, per course. The map is stored on the TA's course membership and enforced
// by the API (utils/ta-permissions.js on the server — keep keys in sync); the
// client mirrors it to hide navigation and guard routes. A key missing from
// the stored map means "allowed", so a freshly promoted TA has full access.
// Settings is intentionally absent: TAs can never open course settings.
//
// TA_PERMISSIONS lists every instructor page that has a TA key. TAs can only
// ever use the ones in TA_GRANTABLE_PERMISSION_KEYS below; the rest are closed
// to them and not offered to the instructor.

export const TA_PERMISSIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "fa-home",
    path: "/dashboard",
    description: "View the instructor dashboard and course analytics.",
  },
  {
    key: "courseMaterials",
    label: "Course Materials",
    icon: "fa-upload",
    path: "/course-materials",
    description: "Upload and manage course source materials.",
  },
  {
    key: "questionGeneration",
    label: "Question Generation",
    icon: "fa-wand-magic-sparkles",
    path: "/question-generation",
    description: "Generate questions from learning objectives with AI.",
  },
  {
    key: "questionBank",
    label: "Question Bank",
    icon: "fa-book",
    path: "/question-bank",
    description:
      "View and edit draft questions. Approving and deleting stay instructor-only.",
  },
  {
    key: "quizzes",
    label: "Quizzes",
    icon: "fa-clipboard-list",
    path: "/quizzes",
    description:
      "View the course quizzes. Creating and publishing stay instructor-only.",
  },
  {
    key: "quizScores",
    label: "Quiz Scores",
    icon: "fa-chart-bar",
    path: "/quiz-scores",
    description: "View student quiz scores and attempt details.",
  },
  {
    key: "questionFlags",
    label: "Question Flags",
    icon: "fa-flag",
    path: "/question-flags",
    description: "Review student-reported question flags and their notes, and resolve them.",
  },
  {
    key: "users",
    label: "Users",
    icon: "fa-users",
    path: "/users",
    description:
      "View the course roster. Adding, removing, and promoting users stay instructor-only.",
  },
  {
    key: "mySections",
    label: "My Sections",
    icon: "fa-layer-group",
    path: "/my-sections",
    description: "View the sections linked to this course.",
  },
];

// The pages a TA can be granted at all. An instructor may switch any of these
// off for a TA; nothing outside this list can be switched on, and the API
// refuses it too. Grant TAs a new page by adding its key here and in
// TA_GRANTABLE_PERMISSION_KEYS in the server's utils/ta-permissions.js.
export const TA_GRANTABLE_PERMISSION_KEYS = [
  "dashboard",
  "courseMaterials",
  "questionGeneration",
  "questionBank",
];

export const isTaGrantable = (key) => TA_GRANTABLE_PERMISSION_KEYS.includes(key);

// What the instructor's TA-permissions editor offers.
export const TA_GRANTABLE_PERMISSIONS = TA_PERMISSIONS.filter((perm) =>
  isTaGrantable(perm.key)
);

export const TA_PATH_PERMISSION = TA_PERMISSIONS.reduce((map, perm) => {
  if (perm.path) map[perm.path] = perm.key;
  return map;
}, {});

const taPermissionMap = (allowedKeys) =>
  TA_GRANTABLE_PERMISSIONS.reduce((map, perm) => {
    map[perm.key] = allowedKeys.includes(perm.key);
    return map;
  }, {});

// Presets fill in the checkbox grid; the instructor can fine-tune afterwards.
// A preset is offered only once every page it grants is grantable, and not
// when it would grant exactly what an earlier preset does.
const PRESET_DEFINITIONS = [
  {
    id: "full",
    label: "Full Access",
    description: "Everything a TA can do: all pages and features.",
    keys: TA_GRANTABLE_PERMISSION_KEYS,
  },
  {
    id: "grader",
    label: "Grader",
    description: "Scores and student-reported question flags only.",
    keys: ["dashboard", "quizScores", "questionFlags"],
  },
  {
    id: "content",
    label: "Content Assistant",
    description: "Materials, question generation, and the question bank.",
    keys: ["dashboard", "courseMaterials", "questionGeneration", "questionBank"],
  },
];

const sameKeys = (a, b) => a.length === b.length && a.every((key) => b.includes(key));

export const TA_PERMISSION_PRESETS = PRESET_DEFINITIONS.filter(
  (preset, index) =>
    preset.keys.every(isTaGrantable) &&
    !PRESET_DEFINITIONS.slice(0, index).some(
      (earlier) => earlier.keys.every(isTaGrantable) && sameKeys(earlier.keys, preset.keys)
    )
).map(({ keys, ...preset }) => ({ ...preset, permissions: taPermissionMap(keys) }));
