import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Calendar from "../components/Calendar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useMyCourses, useStudentCourses } from "../hooks/useCourses";
import { useStudentQuizList } from "../hooks/useStudentQuizzes";
import { useQuizCalendar } from "../hooks/useQuizzes";
import { useMyAchievements } from "../hooks/useAchievements";
import { useAppStore } from "../stores/appStore";

function NoCourseState({ greeting, dateLabel }) {
  return (
    <div className="p-4 md:p-8">
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-ink">{greeting}</h2>
        <p className="text-muted">{dateLabel}</p>
      </section>
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <i className="fas fa-book-open text-3xl text-primary" />
        </div>
        <h3 className="text-xl font-semibold text-ink">No Course Associated</h3>
        <p className="mt-2 text-muted">
          You haven't been added to any courses yet. Ask your instructor to add you
          to the course.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted">
          <i className="fas fa-envelope" />
          <span>Reach out to your instructor for assistance</span>
        </div>
      </div>
    </div>
  );
}

function StudentGuide() {
  return (
    <details className="rounded-2xl bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-6 py-5 font-semibold text-ink marker:hidden">
        <span className="flex items-center justify-between gap-4">
          <span><i className="fas fa-circle-question mr-2 text-primary" aria-hidden="true" />How GRASP works</span>
          <i className="fas fa-chevron-down text-sm text-muted" aria-hidden="true" />
        </span>
      </summary>
      <div className="border-t border-gray-100 px-6 py-5 text-sm leading-relaxed text-gray-600">
        <p className="mb-5">Use this guide whenever you need a refresher on learning with GRASP.</p>
        <div className="space-y-5">
          <div><h4 className="font-semibold text-ink">1. <Link to="/quiz">Take practice quizzes</Link></h4><p>Use instructor-created quizzes to test your understanding of course materials. You can take quizzes again to practise and improve.</p></div>
          <div><h4 className="font-semibold text-ink">2. <Link to="/quiz">Review your answers</Link></h4><p>After a quiz, review which answers were correct, read feedback, and identify concepts to revisit.</p></div>
          <div><h4 className="font-semibold text-ink">3. <Link to="/achievements">Track your progress</Link></h4><p>See your quiz completion history, progress over time, and milestones you have earned.</p></div>
          <div className="rounded-lg bg-primary/5 p-4"><h4 className="font-semibold text-ink">Tips for success</h4><p>Practise regularly, retake quizzes when helpful, review course materials after difficult questions, and ask your instructor when you need clarification.</p></div>
        </div>
      </div>
    </details>
  );
}

export default function StudentDashboard() {
  const { user, isStudent } = useCurrentUser();
  const { selectedCourse, setSelectedCourse, currentRole } = useAppStore();

  // Always verify course access from the API so removed students lose access
  // immediately (mirrors legacy checkCourseAccess on this page).
  const studentCoursesQuery = useStudentCourses();
  const instructorCoursesQuery = useMyCourses();
  const instructorPreview = !isStudent && currentRole === "student";
  const coursesQuery = instructorPreview ? instructorCoursesQuery : studentCoursesQuery;
  const courses = coursesQuery.courses;
  const hasCourse = courses.length > 0;

  useEffect(() => {
    if (coursesQuery.isPending) return;
    if (coursesQuery.isError || !hasCourse) {
      if (selectedCourse) setSelectedCourse(null);
      return;
    }
    const stillValid =
      selectedCourse && courses.some((course) => course.id === selectedCourse.id);
    if (!stillValid) {
      setSelectedCourse(courses[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coursesQuery.isPending, coursesQuery.isError, hasCourse, selectedCourse?.id]);

  const courseId = selectedCourse?.id;
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  const quizzesQuery = useStudentQuizList(hasCourse ? courseId : null);
  const calendarQuery = useQuizCalendar(courseId, calendarMonth, {
    enabled: !!courseId && hasCourse,
  });
  const achievementsQuery = useMyAchievements(courseId, {
    enabled: !!courseId && hasCourse,
  });

  // The student-overview endpoint already returns only quizzes that are open for
  // this student's section(s), so the count is simply its length.
  const quizCount = quizzesQuery.quizzes.length;

  const completedCount = achievementsQuery.achievements.filter(
    (achievement) => achievement.type === "quiz_completed"
  ).length;
  const progressLoading = quizzesQuery.isPending || achievementsQuery.isPending;
  const learningSteps = [
    {
      title: "Find quizzes",
      description: quizCount > 0 ? `${quizCount === 1 ? "1 quiz" : `${quizCount} quizzes`} available in this course.` : "Your instructor has not published a quiz yet.",
      to: "/quiz",
      icon: "fa-list-check",
      complete: quizCount > 0,
      status: quizCount > 0 ? "Ready" : "Waiting",
    },
    {
      title: "Complete a quiz",
      description: completedCount > 0 ? `${completedCount === 1 ? "1 quiz" : `${completedCount} quizzes`} completed.` : "Take an available quiz to begin tracking progress.",
      to: "/quiz",
      icon: "fa-circle-check",
      complete: completedCount > 0,
      status: completedCount > 0 ? "Completed" : "Not started",
    },
    {
      title: "View achievements",
      description: "Review your completed quizzes and earned milestones.",
      to: "/achievements",
      icon: "fa-trophy",
      complete: completedCount > 0,
      status: completedCount > 0 ? "Unlocked" : "Not started",
    },
  ];
  const nextStep = learningSteps.find((step) => !step.complete) || learningSteps[2];
  const completedSteps = learningSteps.filter((step) => step.complete).length;
  const pathHeading = progressLoading ? "Learning progress" : completedCount > 0 ? "Keep learning" : quizCount > 0 ? "Ready to practise" : "Waiting for your first quiz";

  const greeting = user?.displayName ? `Hello, ${user.displayName}` : "Hello, Student";
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (coursesQuery.isPending) {
    return (
      <div className="flex items-center justify-center p-20 text-muted">
        <i className="fas fa-spinner fa-spin mr-3 text-xl" />
        Loading...
      </div>
    );
  }

  if (!hasCourse) {
    return <NoCourseState greeting={greeting} dateLabel={dateLabel} />;
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-4 md:gap-8 md:p-8 xl:grid-cols-[1fr_320px]">
      {/* Left column */}
      <div className="min-w-0 space-y-8">
        <section>
          <h2 className="text-2xl font-bold text-ink">{greeting}</h2>
          <p className="text-muted">{dateLabel}</p>
        </section>

        <section>
          <h3 className="mb-4 text-lg font-semibold text-ink">Quick Start</h3>
          <div className="grid grid-cols-2 gap-4 md:max-w-md">
            <Link
              to="/quiz"
              className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <i className="fas fa-list-check text-2xl text-primary" />
              <span className="font-medium text-ink">My Quizzes</span>
            </Link>
            <Link
              to="/achievements"
              className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <i className="fas fa-trophy text-2xl text-primary" />
              <span className="font-medium text-ink">Achievements</span>
            </Link>
          </div>
        </section>

        <section aria-labelledby="learning-path-heading" className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="learning-path-heading" className="text-lg font-semibold text-ink">{pathHeading}</h3>
              <p className="mt-1 text-sm text-muted">{progressLoading ? "Checking your progress in this course…" : `${completedSteps} of ${learningSteps.length} learning steps completed in this course.`}</p>
            </div>
            <Link to={nextStep.to} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark">{nextStep.title}</Link>
          </div>
          {instructorPreview && <p className="mt-4 rounded-lg bg-primary/5 px-4 py-3 text-sm text-ink"><strong>Student preview:</strong> this shows the student experience for the selected course. Your own quiz completions and achievements are not included.</p>}
          <ol className="mt-6 grid gap-3 md:grid-cols-3">
            {learningSteps.map((step, index) => (
              <li key={step.title} className={`rounded-xl border p-4 ${step.complete ? "border-success/30 bg-success/5" : "border-gray-200"}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${step.complete ? "bg-success text-white" : "bg-primary/10 text-primary"}`}>{step.complete ? <i className="fas fa-check" aria-hidden="true" /> : index + 1}</span>
                <i className={`fas ${step.icon} mt-4 block text-lg text-primary`} aria-hidden="true" />
                <Link to={step.to} className="mt-2 block font-semibold text-ink underline-offset-2 hover:text-primary hover:underline">{step.title}</Link>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
                <p className={`mt-3 text-xs font-semibold ${step.complete ? "text-success" : "text-muted"}`}>{step.status}</p>
              </li>
            ))}
          </ol>
        </section>
        <StudentGuide />
      </div>

      {/* Right column */}
      <div className="space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-ink">Calendar</h3>
          <Calendar
            events={calendarQuery.events}
            audience="student"
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            loading={calendarQuery.isPending}
          />
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-ink">Current Course</h3>
          <div className="flex items-center gap-3 text-ink">
            <i className="fas fa-book text-primary" />
            <span className="font-medium">{selectedCourse?.name || "Loading..."}</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 text-center">
            <div className="rounded-xl bg-page p-4">
              <div className="text-2xl font-bold text-ink">
                {quizzesQuery.isPending ? "-" : quizCount}
              </div>
              <div className="text-sm text-muted">Quizzes</div>
            </div>
            <div className="rounded-xl bg-page p-4">
              <div className="text-2xl font-bold text-ink">
                {achievementsQuery.isPending ? "-" : completedCount}
              </div>
              <div className="text-sm text-muted">Completed</div>
            </div>
          </div>
          <Link
            to="/quiz"
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-arrow-right" />
            View All Quizzes
          </Link>
        </section>
      </div>
    </div>
  );
}
