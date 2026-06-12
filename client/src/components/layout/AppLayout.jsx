import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";

const PAGE_TITLES = {
  "/dashboard": "Dashboard",
  "/course-materials": "Course Materials",
  "/question-generation": "Question Generation",
  "/question-bank": "Question Bank",
  "/question-review": "Question Review",
  "/quizzes": "Quizzes",
  "/quiz-scores": "Quiz Scores",
  "/users": "Users",
  "/settings": "Settings",
  "/student-dashboard": "Dashboard",
  "/quiz": "My Quizzes",
  "/quiz-summary": "Quiz Summary",
  "/achievements": "Achievements",
};

export default function AppLayout() {
  const { pathname } = useLocation();

  useEffect(() => {
    const title = PAGE_TITLES[pathname];
    document.title = title ? `${title} - GRASP` : "GRASP";
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="min-h-screen bg-page ml-[280px] max-md:ml-0">
        <Outlet />
      </main>
    </div>
  );
}
