// Central registry of React Query keys.
//
// Every key used by a useQuery/useMutation in the app lives here so that
// fetching hooks and the mutations that invalidate them can never drift apart.

export const queryKeys = {
  currentUser: ["current-user"],

  myCourses: (audience) => ["my-courses", audience],
  studentCourses: ["student-courses"],

  questions: (courseId) => ["questions", courseId],
  questionBank: (courseId) => ["question-bank", courseId],
  questionDetail: (questionId) => ["question", questionId],

  objectives: (courseId) => ["objectives", courseId],
  detailedObjectives: (courseId) => ["detailed-objectives", courseId],

  materials: (courseId) => ["materials", courseId],

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
  availableUsers: (courseId) => ["available-users", courseId],

  courseSettings: (courseId) => ["course-settings", courseId],
  settingsDefaults: ["course-settings-defaults"],
  enrollmentCode: (courseId) => ["enrollment-code", courseId],

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
