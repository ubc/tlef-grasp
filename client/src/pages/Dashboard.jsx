import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Calendar from "../components/Calendar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { useCourseQuizQuestionFlags } from "../hooks/useQuizQuestionFlags";
import { useCourseMaterials } from "../hooks/useMaterials";
import { useCourseObjectives } from "../hooks/useObjectives";
import { useQuestions } from "../hooks/useQuestions";
import { useCourseQuizzes, useQuizCalendar } from "../hooks/useQuizzes";
import { useAppStore, useSelectedCourseId } from "../stores/appStore";

// `permission` gates a card for co-instructors (null = always shown), matching
// the sidebar/route gating in useCoInstructorAccess.
const QUICK_START_CARDS = [
  { to: "/course-materials", icon: "fa-upload", label: "Upload Materials", permission: "courseMaterials" },
  { to: "/question-generation", icon: "fa-wand-magic-sparkles", label: "Generate Questions", permission: "questionGeneration" },
  { to: "/question-bank?tab=review", icon: "fa-book", label: "Quizzes", permission: "questionBank" },
  { to: "/users", icon: "fa-users", label: "Users", permission: null },
];

function FlaggedQuestionsCard() {
  const navigate = useNavigate();
  const courseId = useSelectedCourseId();
  const { flags } = useCourseQuizQuestionFlags(courseId);
  // This dashboard card is an instructor to-do count: only student reports
  // that have not yet been answered belong here. Question-bank flagStatus is
  // a separate, authoring-time concern.
  const flaggedCount = flags.filter((flag) => flag.status === "pending").length;

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink">Flagged Questions</h3>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/10 text-sm font-bold text-danger">
          {flaggedCount}
        </span>
      </div>
      {flaggedCount > 0 ? (
        <button
          type="button"
          onClick={() => navigate("/question-flags")}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
        >
          <i className="fas fa-eye" />
          View Flagged Questions
        </button>
      ) : (
        <p className="text-sm text-muted">No flagged questions at this time</p>
      )}
    </section>
  );
}

function InstructorGuide() {
  return (
    <details className="rounded-2xl bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-6 py-5 font-semibold text-ink marker:hidden">
        <span className="flex items-center justify-between gap-4">
          <span><i className="fas fa-circle-question mr-2 text-primary" aria-hidden="true" />How GRASP works</span>
          <i className="fas fa-chevron-down text-sm text-muted" aria-hidden="true" />
        </span>
      </summary>
      <div className="border-t border-gray-100 px-6 py-5 text-sm leading-relaxed text-gray-600">
        <p className="mb-5">Use this guide whenever you need a refresher on the course-building workflow.</p>
        <div className="space-y-5">
          <div><h4 className="font-semibold text-ink">1. <Link to="/course-materials">Upload course materials</Link></h4><p>Add PDFs, documents, slides, text, or links. GRASP processes them for question generation; you can also paste text directly.</p></div>
          <div><h4 className="font-semibold text-ink">2. <Link to="/question-generation">Create objectives and questions</Link></h4><p>Create objectives manually, use existing ones, or generate them from relevant material. Then choose objectives and Bloom’s levels, generate questions, review them, and save them to a quiz.</p></div>
          <div><h4 className="font-semibold text-ink">3. <Link to="/question-bank">Review the question bank</Link></h4><p>Edit questions, approve or return drafts, filter by objective or quiz, and flag items that need attention. Review progress is also available by quiz.</p></div>
          <div><h4 className="font-semibold text-ink">4. <Link to="/users">Add course users</Link></h4><p>Add students and staff before students need access to quizzes.</p></div>
          <div><h4 className="font-semibold text-ink">5. <Link to="/quizzes">Publish quizzes</Link></h4><p>Approve the questions you want students to see, then publish and schedule the quiz for the appropriate section.</p></div>
          <div className="rounded-lg bg-primary/5 p-4"><h4 className="font-semibold text-ink">Pro tips</h4><p>Use granular objectives for targeted questions, review AI output before publishing, and use flags to keep follow-up work visible.</p></div>
        </div>
      </div>
    </details>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { can } = useCoInstructorAccess();
  const currentRole = useAppStore((state) => state.currentRole);
  const courseId = useSelectedCourseId();
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const { materials, isPending: materialsPending } = useCourseMaterials(courseId);
  const { objectives, isPending: objectivesPending } = useCourseObjectives(courseId);
  const { questions, isPending: questionsPending } = useQuestions(courseId);
  const { quizzes, isPending: quizzesPending } = useCourseQuizzes(courseId);
  const calendarQuery = useQuizCalendar(courseId, calendarMonth);
  const quickStartCards = QUICK_START_CARDS.filter(
    (card) => !card.permission || can(card.permission)
  );

  // Faculty/staff viewing in student mode get the student dashboard (legacy behavior)
  useEffect(() => {
    if (currentRole === "student") {
      navigate("/student-dashboard", { replace: true });
    }
  }, [currentRole, navigate]);

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const progressLoading = materialsPending || objectivesPending || questionsPending || quizzesPending;
  const courseSteps = [
    { title: "Upload", description: "Add notes, slides, files, or links.", to: "/course-materials", icon: "fa-upload", complete: materials.length > 0 },
    { title: "Create objectives", description: "Generate them from relevant material or add your own.", to: "/question-generation", icon: "fa-bullseye", complete: objectives.length > 0 },
    { title: "Generate questions", description: "Choose objectives and review the AI draft.", to: "/question-generation", icon: "fa-wand-magic-sparkles", complete: questions.length > 0 },
    { title: "Review", description: "Edit and approve questions in your bank.", to: "/question-bank", icon: "fa-clipboard-check", complete: questions.length > 0 && questions.every((question) => String(question.status || "").toLowerCase() === "approved") },
    { title: "Publish", description: "Share an approved quiz with students.", to: "/quizzes", icon: "fa-paper-plane", complete: quizzes.some((quiz) => quiz.published) },
  ];
  const completedSteps = courseSteps.filter((step) => step.complete).length;
  const nextStep = courseSteps.find((step) => !step.complete);
  const pathHeading = progressLoading ? "Course progress" : completedSteps === courseSteps.length ? "Your course is ready" : completedSteps > 0 ? "Continue building your course" : "Build your first quiz";

  return (
    <div className="grid grid-cols-1 gap-6 p-4 md:gap-8 md:p-8 xl:grid-cols-[1fr_320px]">
      {/* Left column */}
      <div className="min-w-0 space-y-8">
        <section>
          <h2 className="text-2xl font-bold text-ink">
            Hello, {user?.displayName || "Instructor"}
          </h2>
          <p className="text-muted">{dateLabel}</p>
        </section>

        <section>
          <h3 className="mb-4 text-lg font-semibold text-ink">Quick Start</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {quickStartCards.map((card) => (
              <Link
                key={card.label}
                to={card.to}
                className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
              >
                <i className={`fas ${card.icon} text-2xl text-primary`} />
                <span className="font-medium text-ink">{card.label}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="course-path-heading" className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="course-path-heading" className="text-lg font-semibold text-ink">{pathHeading}</h3>
              <p className="mt-1 text-sm text-muted">{progressLoading ? "Checking this course’s progress…" : `${completedSteps} of ${courseSteps.length} steps completed for this course.`}</p>
            </div>
            {nextStep ? (
              <Link to={nextStep.to} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark">Continue: {nextStep.title}</Link>
            ) : (
              <Link to="/quizzes" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark">Manage quizzes</Link>
            )}
          </div>
          <ol className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {courseSteps.map((step, index) => (
              <li key={step.title} className={`rounded-xl border p-4 ${step.complete ? "border-success/30 bg-success/5" : "border-gray-200"}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${step.complete ? "bg-success text-white" : "bg-primary/10 text-primary"}`}>{step.complete ? <i className="fas fa-check" aria-hidden="true" /> : index + 1}</span>
                <i className={`fas ${step.icon} mt-4 block text-lg text-primary`} aria-hidden="true" />
                <Link to={step.to} className="mt-2 block font-semibold text-ink underline-offset-2 hover:text-primary hover:underline">{step.title}</Link>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
                <p className={`mt-3 text-xs font-semibold ${step.complete ? "text-success" : "text-muted"}`}>{step.complete ? "Completed" : "Not started"}</p>
              </li>
            ))}
          </ol>
          <p className="mt-5 rounded-lg bg-primary/5 px-4 py-3 text-sm text-ink"><strong>Tip:</strong> AI only generates objectives from course-related content. If you already know your learning objectives, add them yourself and GRASP will preserve them.</p>
        </section>
        <InstructorGuide />
      </div>

      {/* Right column */}
      <div className="space-y-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-ink">Calendar</h3>
          <Calendar
            events={calendarQuery.events}
            audience="instructor"
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            loading={calendarQuery.isPending}
          />
          {calendarQuery.unscheduledQuizzes.length > 0 && (
            <div className="mt-4 rounded-lg bg-warning/10 p-3 text-xs text-ink">
              <p className="font-semibold text-warning">
                {calendarQuery.unscheduledQuizzes.length} published {calendarQuery.unscheduledQuizzes.length === 1 ? "quiz has" : "quizzes have"} no schedule for your sections
              </p>
              <Link to="/quizzes" className="mt-1 inline-flex font-semibold text-primary underline-offset-2 hover:underline">
                Schedule quizzes
              </Link>
            </div>
          )}
        </section>
        <FlaggedQuestionsCard />
      </div>
    </div>
  );
}
