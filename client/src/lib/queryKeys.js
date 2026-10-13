// Central registry of React Query keys.
//
// Every key used by a useQuery/useMutation in the app lives here so that
// fetching hooks and the mutations that invalidate them can never drift apart.

export const queryKeys = {
  currentUser: ["current-user"],

  myCourses: (audience) => ["my-courses", audience],
  studentCourses: ["student-courses"],
  archivedCourses: ["archived-courses"],

  questions: (courseId) => ["questions", courseId],
  questionBank: (courseId) => ["question-bank", courseId],
  questionDetail: (questionId) => ["question", questionId],

  objectives: (courseId) => ["objectives", courseId],
  detailedObjectives: (courseId) => ["detailed-objectives", courseId],

  materials: (courseId) => ["materials", courseId],
  materialOutline: (sourceId) => ["material-outline", sourceId],

  quizzes: (courseId) => ["quizzes", "course", courseId],
  quizzesWithQuestions: (courseId) => ["quizzes-with-questions", courseId],
  quizSchedules: (quizId) => ["quiz-schedules", quizId],
  quizCalendar: (courseId, from, to) => ["quiz-calendar", courseId, from, to],
  quizScores: (quizId) => ["quiz-scores", quizId],
  quizStudentAttempts: (quizId, userId) => ["quiz-attempts", quizId, userId],
  myQuizQuestionFlags: (courseId) => ["quiz-question-flags", "mine", courseId],
  courseQuizQuestionFlags: (courseId) => ["quiz-question-flags", "course", courseId],
  studentQuizList: (courseId) => ["student-quiz-list", courseId],
  studentQuizResults: (quizId) => ["quiz-results", quizId],

  achievements: (courseId) => ["achievements", "my", courseId],

  courseUsers: (courseId) => ["course-users", courseId],
  courseAccess: (courseId) => ["course-access", courseId],
  availableUsers: (courseId) => ["available-users", courseId],
  userSearch: (courseId, query) => ["user-search", courseId, query],
  courseAccessLog: (courseId) => ["course-access-log", courseId],

  courseSettings: (courseId) => ["course-settings", courseId],
  settingsDefaults: ["course-settings-defaults"],
  enrollmentCode: (courseId) => ["enrollment-code", courseId],

  canvasStatus: ["canvas", "status"],
  canvasAvailableCourses: (courseId, sectionId) => [
    "canvas",
    "available-courses",
    courseId,
    sectionId,
  ],
  canvasSections: (courseId, sectionId, canvasCourseId) => [
    "canvas",
    "sections",
    courseId,
    sectionId,
    canvasCourseId,
  ],
  canvasMaterialCourses: (courseId) => ["canvas", "material-courses", courseId],
  canvasMaterialFiles: (courseId, canvasCourseId) => [
    "canvas",
    "material-files",
    courseId,
    canvasCourseId,
  ],
  canvasQuizAssignments: (courseId, quizId) => ["canvas", "quiz-assignments", courseId, quizId],
  canvasSectionQuizAssignments: (courseId, sectionId) => [
    "canvas",
    "section-quiz-assignments",
    courseId,
    sectionId,
  ],
  moodleStatus: ["moodle", "status"],
  moodleAvailableCourses: (courseId, sectionId) => [
    "moodle",
    "available-courses",
    courseId,
    sectionId,
  ],
  moodleGroups: (courseId, sectionId, moodleCourseId) => [
    "moodle",
    "groups",
    courseId,
    sectionId,
    moodleCourseId,
  ],

  // UBC course-section integration
  ubcCampuses: ["ubc-campuses"],
  ubcAcademicPeriods: (campus) => ["ubc-academic-periods", campus],
  ubcInstructorSections: (academicPeriod) => [
    "ubc-instructor-sections",
    academicPeriod,
  ],
  course: (courseId) => ["course", courseId],
  courseSections: (courseId) => ["course-sections", courseId],
  visibleCourseSections: (courseId) => ["visible-course-sections", courseId],
  myCourseSections: (courseId) => ["my-course-sections", courseId],
};
