// Browser-side mirror of src/constants/app-constants.js
// Keep in sync with QUESTION_TYPES and DEFAULT_BLOOM_TYPE_PREFERENCES in that file.

export const QUESTION_TYPES = {
  MULTIPLE_CHOICE: "multiple-choice",
  FILL_IN_THE_BLANK: "fill-in-the-blank",
  CALCULATION: "calculation",
  OPEN_ENDED: "open-ended",
};

export const DEFAULT_BLOOM_TYPE_PREFERENCES = {
  Remember: [QUESTION_TYPES.FILL_IN_THE_BLANK, QUESTION_TYPES.MULTIPLE_CHOICE],
  Understand: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.FILL_IN_THE_BLANK],
  Apply: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.FILL_IN_THE_BLANK],
  Analyze: [QUESTION_TYPES.MULTIPLE_CHOICE, QUESTION_TYPES.FILL_IN_THE_BLANK],
  Evaluate: [QUESTION_TYPES.CALCULATION, QUESTION_TYPES.MULTIPLE_CHOICE],
  Create: [QUESTION_TYPES.OPEN_ENDED, QUESTION_TYPES.MULTIPLE_CHOICE],
};

export const USER_ROLES = {
  FACULTY: "faculty",
  STAFF: "staff",
  STUDENT: "student",
};

export const BLOOM_LEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

// Mirrors MAX_MATERIALS_PER_OBJECTIVE in src/constants/app-constants.js.
// The server rejects writes above this; the UI stops the instructor first.
export const MAX_MATERIALS_PER_OBJECTIVE = 3;

// Mirrors MAX_QUESTIONS_PER_OBJECTIVE in src/constants/app-constants.js — see
// there for why this is the only cap. It bounds one GRANULAR objective's total.
// The server clamps to it; the steppers disable at it so the instructor sees the
// limit rather than having it silently applied.
export const MAX_QUESTIONS_PER_OBJECTIVE = 20;
