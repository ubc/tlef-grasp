import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import Calendar from "../components/Calendar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useQuestions } from "../hooks/useQuestions";
import { useAppStore } from "../stores/appStore";

const QUICK_START_CARDS = [
  { to: "/course-materials", icon: "fa-upload", label: "Upload Materials" },
  { to: "/question-generation", icon: "fa-wand-magic-sparkles", label: "Generate Questions" },
  { to: "/question-bank?tab=review", icon: "fa-book", label: "Quizzes" },
  { to: "/users", icon: "fa-users", label: "Users" },
];

function FlaggedQuestionsCard() {
  const navigate = useNavigate();
  const { questions } = useQuestions();
  const flaggedCount = questions.filter((q) => q.flagStatus === true).length;

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
          onClick={() => navigate("/question-bank?tab=overview&flagged=true")}
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

function StepTip({ icon = "fa-lightbulb", children, className = "" }) {
  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded-lg bg-primary/5 px-4 py-3 text-sm text-ink ${className}`}
    >
      <i className={`fas ${icon} mt-0.5 text-primary`} />
      <span>{children}</span>
    </div>
  );
}

function InstructionStep({ number, title, badge, children, info = false }) {
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
        <h4 className="mb-2 text-base font-semibold text-ink">
          {title}
          {badge && (
            <span className="ml-2 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
              {badge}
            </span>
          )}
        </h4>
        <div className="space-y-2 text-sm leading-relaxed text-gray-600 [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:text-ink">
          {children}
        </div>
      </div>
    </div>
  );
}

function FeatureItem({ icon, children }) {
  return (
    <li className="flex items-start gap-2">
      <i className={`fas ${icon} mt-1 w-4 text-center text-primary`} />
      <span>{children}</span>
    </li>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const currentRole = useAppStore((state) => state.currentRole);

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

  return (
    <div className="grid grid-cols-1 gap-8 p-8 xl:grid-cols-[1fr_320px]">
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
            {QUICK_START_CARDS.map((card) => (
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

        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">
            Getting Started with GRASP
          </h3>
          <p className="mb-5 text-sm text-muted">
            Follow this step-by-step guide to create AI-powered questions from your
            course materials and manage them effectively.
          </p>

          <div className="space-y-4">
            <InstructionStep
              number="1"
              title={<Link to="/course-materials">Upload Your Course Materials</Link>}
            >
              <p>
                Start by uploading your course documents (PDFs, lecture notes,
                presentations, text files) through the <strong>Upload</strong> quick
                start card or <Link to="/course-materials">Course Materials page</Link>.
                These documents will be processed and stored for question generation.
              </p>
              <StepTip>
                Supported formats: PDF, DOC, DOCX, TXT. You can also paste text
                directly or add URLs.
              </StepTip>
            </InstructionStep>

            <InstructionStep
              number="2"
              title={<Link to="/question-generation">Question Generation</Link>}
            >
              <p>
                Navigate to the{" "}
                <Link to="/question-generation">Question Generation page</Link> to
                create learning objectives and generate questions from your uploaded
                materials. This workflow consists of several sub-steps:
              </p>

              <div className="mt-3 space-y-4 border-l-2 border-primary/20 pl-4">
                <div>
                  <h5 className="font-semibold text-ink">2.1 Create Learning Objectives</h5>
                  <p>Add learning objectives (LOs) to your course. You can add them in three ways:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      <strong>Add existing objectives:</strong> Select from previously
                      created learning objectives
                    </li>
                    <li>
                      <strong>Create manually:</strong> Create a new learning objective
                      and select the relevant course materials to attach to it
                    </li>
                    <li>
                      <strong>Generate with AI:</strong> Use AI to automatically generate
                      learning objectives from your course materials (you'll need to
                      select which materials to use)
                    </li>
                  </ul>
                  <StepTip icon="fa-info-circle" className="mb-4">
                    When creating new learning objectives (manually or with AI), you
                    must select and attach the relevant course materials. The AI will
                    only use content from attached documents when generating questions,
                    ensuring questions are relevant and accurate.
                  </StepTip>
                  <p>
                    Each objective can have multiple <strong>granular objectives</strong>{" "}
                    that break down the main objective into smaller, specific learning
                    goals.
                  </p>
                </div>

                <div>
                  <h5 className="font-semibold text-ink">2.2 Generate Questions with AI</h5>
                  <p>
                    Click <strong>Continue</strong> to proceed to Step 2, then click{" "}
                    <strong>Generate Questions</strong> to create multiple-choice
                    questions automatically. The AI analyzes the attached documents and
                    generates questions aligned with your learning objectives and
                    selected Bloom's levels.
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>Review and edit generated questions before saving</li>
                    <li>
                      Use <strong>Regenerate All</strong> to regenerate all questions at
                      once
                    </li>
                    <li>Edit question text and options</li>
                    <li>Flag questions that need attention</li>
                  </ul>
                </div>

                <div>
                  <h5 className="font-semibold text-ink">2.3 Save Quiz to Question Bank</h5>
                  <p>
                    Click <strong>Continue</strong> to proceed to Step 3:{" "}
                    <strong>Save Quiz to Question Bank</strong>. On this step, you can
                    either:
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      <strong>Select an existing quiz:</strong> Choose from your existing
                      quizzes from the dropdown
                    </li>
                    <li>
                      <strong>Create a new quiz:</strong> Switch to the "Create New
                      Quiz" tab, enter a quiz name and optional description
                    </li>
                  </ul>
                  <p>
                    Once you've selected or created a quiz, click{" "}
                    <strong>Save to Quiz</strong> to save all your generated questions. A
                    success message will appear with a button to navigate to your{" "}
                    <Link to="/question-bank">Question Bank</Link>.
                  </p>
                </div>
              </div>
            </InstructionStep>

            <InstructionStep
              number="3"
              title={<Link to="/question-bank">Question Bank: Your Central Hub</Link>}
            >
              <p>
                The <Link to="/question-bank">Question Bank</Link> is where you manage
                all your questions and quizzes. It has two main tabs:
              </p>

              <h5 className="mt-3 font-semibold text-ink">
                <i className="fas fa-list mr-1 text-primary" /> Questions Tab
              </h5>
              <p>View and manage all questions across all quizzes:</p>
              <ul className="mt-1 space-y-1.5">
                <FeatureItem icon="fa-eye">
                  <strong>View/Edit:</strong> Click the button that appears on hover to
                  open a detailed modal where you can edit question title, stem,
                  options, and correct answer
                </FeatureItem>
                <FeatureItem icon="fa-check-circle">
                  <strong>Approve/Unapprove:</strong> Change question status to control
                  which questions are ready for use
                </FeatureItem>
                <FeatureItem icon="fa-filter">
                  <strong>Filter:</strong> Narrow down questions by Quiz, Learning
                  Objective, Bloom Level, Status (Approved/Draft), or Flagged status
                </FeatureItem>
                <FeatureItem icon="fa-search">
                  <strong>Search:</strong> Find questions by keywords in titles or
                  content
                </FeatureItem>
                <FeatureItem icon="fa-sort">
                  <strong>Sort:</strong> Organize questions by title, learning
                  objective, Bloom level, or status
                </FeatureItem>
                <FeatureItem icon="fa-check-square">
                  <strong>Bulk Actions:</strong> Select multiple questions to flag or
                  delete them at once
                </FeatureItem>
                <FeatureItem icon="fa-flag">
                  <strong>Flag Questions:</strong> Mark questions that need review or
                  attention
                </FeatureItem>
                <FeatureItem icon="fa-toggle-on">
                  <strong>Publish/Unpublish Quizzes:</strong> Toggle quiz visibility for
                  students
                </FeatureItem>
              </ul>

              <h5 className="mt-4 font-semibold text-ink">
                <i className="fas fa-clipboard-check mr-1 text-primary" />{" "}
                <Link to="/question-bank?tab=review">Review Tab</Link>
              </h5>
              <p>Review questions organized by quiz:</p>
              <ul className="mt-1 space-y-1.5">
                <FeatureItem icon="fa-chart-pie">
                  See review progress percentage for each quiz
                </FeatureItem>
                <FeatureItem icon="fa-list-ul">
                  View all questions within each quiz
                </FeatureItem>
                <FeatureItem icon="fa-check-double">
                  Approve or flag questions directly from quiz view
                </FeatureItem>
                <FeatureItem icon="fa-arrow-right">
                  Click <strong>Review</strong> button to jump to Questions tab with
                  that quiz filtered and status set to Draft
                </FeatureItem>
              </ul>
            </InstructionStep>

            <InstructionStep
              number="4"
              title={<Link to="/users">Manage Course Users</Link>}
              badge="Instructor Only"
            >
              <p>
                Add students and staff to your course so they can access quizzes.
                Navigate to the <Link to="/users">Users page</Link> to manage who has
                access to your course.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  <strong>View enrolled users:</strong> See all students and staff
                  currently in your course
                </li>
                <li>
                  <strong>Add users:</strong> Search and filter available users by role
                  (Faculty, Staff, Student) and add them to your course
                </li>
                <li>
                  <strong>Remove users:</strong> Remove users who no longer need access
                  to the course
                </li>
              </ul>
              <StepTip icon="fa-info-circle">
                Students can only access quizzes from courses they've been added to.
                Make sure to add your students before expecting them to take quizzes.
              </StepTip>
            </InstructionStep>

            <InstructionStep
              number="5"
              title="Publish Quizzes for Students"
              badge="Instructor Only"
            >
              <p>
                Before students can see and take quizzes, you need to publish them. In
                the <Link to="/question-bank">Question Bank</Link>:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  <strong>Review questions:</strong> Approve all questions you want
                  students to see
                </li>
                <li>
                  <strong>Publish quiz:</strong> Toggle the publish status to make the
                  quiz visible to students
                </li>
                <li>
                  <strong>Student experience:</strong> Students will see published
                  quizzes with approved questions only
                </li>
              </ul>
              <StepTip icon="fa-trophy">
                When students complete quizzes, they earn achievements! They get a
                "Quiz Completed" badge on first completion, and a "Perfect Score" badge
                for getting 100%.
              </StepTip>
              <StepTip icon="fa-random">
                Questions and answer options are randomized for each student attempt to
                ensure fair assessment.
              </StepTip>
            </InstructionStep>

            <InstructionStep number={<i className="fas fa-star" />} title="Pro Tips" info>
              <ul className="space-y-1.5">
                <FeatureItem icon="fa-lightbulb">
                  Use granular objectives to create more specific, targeted questions
                </FeatureItem>
                <FeatureItem icon="fa-sync">
                  Regenerate questions if the initial results don't meet your needs
                </FeatureItem>
                <FeatureItem icon="fa-tags">
                  Use Bloom's Taxonomy levels strategically to create questions at
                  different cognitive levels
                </FeatureItem>
                <FeatureItem icon="fa-bookmark">
                  Flag questions during generation to review them later in the Question
                  Bank
                </FeatureItem>
                <FeatureItem icon="fa-layer-group">
                  Organize questions into multiple quizzes for different topics or
                  assessments
                </FeatureItem>
                <FeatureItem icon="fa-check-double">
                  Approve questions only after thorough review to maintain quality
                </FeatureItem>
                <FeatureItem icon="fa-random">
                  Questions and answer options are automatically randomized for each
                  student attempt
                </FeatureItem>
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
        <FlaggedQuestionsCard />
      </div>
    </div>
  );
}
