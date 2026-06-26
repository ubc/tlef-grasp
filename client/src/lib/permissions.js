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
