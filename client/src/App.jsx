import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireOnboarded, RequireRole } from "./components/guards";
import AppLayout from "./components/layout/AppLayout";

import Landing from "./pages/Landing";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import CourseMaterials from "./pages/CourseMaterials";
import QuestionGeneration from "./pages/QuestionGeneration";
import QuestionBank from "./pages/QuestionBank";
import QuestionReview from "./pages/QuestionReview";
import Quizzes from "./pages/Quizzes";
import QuizScores from "./pages/QuizScores";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import StudentDashboard from "./pages/StudentDashboard";
import StudentQuiz from "./pages/StudentQuiz";
import QuizSummary from "./pages/QuizSummary";
import Achievements from "./pages/Achievements";

export default function App() {
  return (
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
  );
}
