import { useEffect } from "react";
import { Link } from "react-router-dom";
import Calendar from "../components/Calendar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useStudentCourses } from "../hooks/useCourses";
import { useCourseQuizzes } from "../hooks/useQuizzes";
import { useMyAchievements } from "../hooks/useAchievements";
import { useAppStore } from "../stores/appStore";

function StepTip({ icon = "fa-lightbulb", children }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg bg-primary/5 px-4 py-3 text-sm text-ink">
      <i className={`fas ${icon} mt-0.5 text-primary`} />
      <span>{children}</span>
    </div>
  );
}

function InstructionStep({ number, title, children, info = false }) {
  return (
    <div
      className={`flex gap-4 rounded-xl border p-5 ${
        info ? "border-primary/30 bg-primary/5" : "border-gray-100 bg-white"
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white">
        {number}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="mb-2 text-base font-semibold text-ink">{title}</h4>
        <div className="space-y-2 text-sm leading-relaxed text-gray-600 [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:text-ink">
          {children}
        </div>
      </div>
    </div>
  );
}

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
          manually or provide you with an enrollment code.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted">
          <i className="fas fa-envelope" />
          <span>Reach out to your instructor for assistance</span>
        </div>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useCurrentUser();
  const { selectedCourse, setSelectedCourse } = useAppStore();

  // Always verify course access from the API so removed students lose access
  // immediately (mirrors legacy checkCourseAccess on this page).
  const coursesQuery = useStudentCourses();
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

  const quizzesQuery = useCourseQuizzes(hasCourse ? courseId : null);
  const achievementsQuery = useMyAchievements(courseId, {
    enabled: !!courseId && hasCourse,
  });

  const now = new Date();
  const quizCount = quizzesQuery.quizzes.filter((quiz) => {
    if (quiz.published !== true) return false;
    if (quiz.releaseDate && new Date(quiz.releaseDate) > now) return false;
    if (quiz.expireDate && new Date(quiz.expireDate) < now) return false;
    return true;
  }).length;

  const completedCount = achievementsQuery.achievements.filter(
    (achievement) => achievement.type === "quiz_completed"
  ).length;

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

        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">
            Getting Started with GRASP
          </h3>
          <p className="mb-5 text-sm text-muted">
            Welcome to GRASP! Here's how to get the most out of your learning
            experience.
          </p>

          <div className="space-y-4">
            <InstructionStep number="1" title={<Link to="/quiz">Take Practice Quizzes</Link>}>
              <p>
                Access quizzes created by your instructor to test your understanding of
                course materials. Each quiz contains multiple-choice questions designed
                to reinforce key concepts.
              </p>
              <StepTip>
                Take quizzes multiple times to improve your understanding and track
                your progress!
              </StepTip>
            </InstructionStep>

            <InstructionStep number="2" title={<Link to="/quiz">Review Your Answers</Link>}>
              <p>
                After completing a quiz, review your answers to understand what you got
                right and where you can improve. The system provides immediate feedback
                on your responses.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>See which questions you answered correctly</li>
                <li>Review explanations for each question</li>
                <li>Identify areas that need more study</li>
              </ul>
            </InstructionStep>

            <InstructionStep
              number="3"
              title={<Link to="/achievements">Track Your Progress</Link>}
            >
              <p>
                Monitor your learning journey through the achievements system. Earn
                badges and see your improvement over time as you complete more quizzes.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>View your quiz completion history</li>
                <li>Track your scores across different topics</li>
                <li>Earn achievements for milestones</li>
              </ul>
            </InstructionStep>

            <InstructionStep
              number={<i className="fas fa-star" />}
              title="Tips for Success"
              info
            >
              <ul className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <i className="fas fa-clock mt-1 w-4 text-center text-primary" />
                  <span>
                    <strong>Practice regularly:</strong> Consistent practice helps
                    reinforce learning
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fas fa-redo mt-1 w-4 text-center text-primary" />
                  <span>
                    <strong>Retake quizzes:</strong> Don't be afraid to retry quizzes to
                    improve your score
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fas fa-book mt-1 w-4 text-center text-primary" />
                  <span>
                    <strong>Review materials:</strong> If you struggle with questions,
                    review the related course content
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fas fa-comments mt-1 w-4 text-center text-primary" />
                  <span>
                    <strong>Ask questions:</strong> Reach out to your instructor if you
                    need clarification
                  </span>
                </li>
              </ul>
            </InstructionStep>
          </div>
        </section>
      </div>

      {/* Right column */}
      <div className="space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-ink">Calendar</h3>
          <Calendar />
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
