import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireOnboarded, RequireRole } from "./components/guards";
import AppLayout from "./components/layout/AppLayout";
import Landing from "./pages/Landing";

// Every page beyond the landing screen is lazy-loaded so each route ships as
// its own chunk (KaTeX/SMILES only load with the pages that render questions).
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CourseMaterials = lazy(() => import("./pages/CourseMaterials"));
const QuestionGeneration = lazy(() => import("./pages/QuestionGeneration"));
const QuestionBank = lazy(() => import("./pages/QuestionBank"));
const QuestionReview = lazy(() => import("./pages/QuestionReview"));
const Quizzes = lazy(() => import("./pages/Quizzes"));
const QuizScores = lazy(() => import("./pages/QuizScores"));
const MySections = lazy(() => import("./pages/MySections"));
const Users = lazy(() => import("./pages/Users"));
const Settings = lazy(() => import("./pages/Settings"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentQuiz = lazy(() => import("./pages/StudentQuiz"));
const QuizSummary = lazy(() => import("./pages/QuizSummary"));
const Achievements = lazy(() => import("./pages/Achievements"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center p-24 text-muted">
      <i className="fas fa-spinner fa-spin mr-3 text-2xl text-primary" />
      Loading...
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Student dashboard works without a course (shows a no-course state) */}
          <Route element={<AppLayout />}>
            <Route path="/student-dashboard" element={<StudentDashboard />} />
          </Route>

          <Route element={<RequireOnboarded />}>
            <Route element={<AppLayout />}>
              {/* Instructor pages (staff and faculty) */}
              <Route element={<RequireRole min="staff" />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/course-materials" element={<CourseMaterials />} />
                <Route path="/question-generation" element={<QuestionGeneration />} />
                <Route path="/question-bank" element={<QuestionBank />} />
                <Route path="/question-review" element={<QuestionReview />} />
                <Route path="/quizzes" element={<Quizzes />} />
                <Route path="/quiz-scores" element={<QuizScores />} />
                <Route path="/my-sections" element={<MySections />} />
                <Route path="/settings" element={<Settings />} />
              </Route>

              {/* Faculty-only pages */}
              <Route element={<RequireRole min="faculty" />}>
                <Route path="/users" element={<Users />} />
              </Route>

              {/* Student pages (all authenticated users) */}
              <Route path="/quiz" element={<StudentQuiz />} />
              <Route path="/quiz-summary" element={<QuizSummary />} />
              <Route path="/achievements" element={<Achievements />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
