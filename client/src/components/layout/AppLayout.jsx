import { useEffect, useRef, useState } from "react";
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
  "/my-sections": "My Sections",
  "/users": "Users",
  "/settings": "Settings",
  "/student-dashboard": "Dashboard",
  "/quiz": "My Quizzes",
  "/quiz-summary": "Quiz Summary",
  "/achievements": "Achievements",
};

export default function AppLayout() {
  const { pathname } = useLocation();
  // Below lg the sidebar is an off-canvas drawer toggled from the top bar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const triggerRef = useRef(null);
  // Tracks whether the drawer was open so we only restore focus on a real
  // open->close transition (never on desktop, where it stays closed).
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const title = PAGE_TITLES[pathname];
    document.title = title ? `${title} - GRASP` : "GRASP";
  }, [pathname]);

  // Close the drawer whenever navigation happens
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Drawer keyboard/focus handling: Escape closes it, and closing returns focus
  // to the hamburger trigger it was opened from.
  useEffect(() => {
    if (!sidebarOpen) {
      if (wasOpenRef.current) {
        triggerRef.current?.focus();
        wasOpenRef.current = false;
      }
      return;
    }
    wasOpenRef.current = true;
    const handleKey = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-[900] flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={sidebarOpen}
          data-testid="open-sidebar"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink transition-colors hover:bg-gray-100"
        >
          <i className="fas fa-bars text-lg" />
        </button>
        <div className="flex items-center gap-2 text-lg font-bold text-ink">
          <i className="fas fa-graduation-cap text-primary" />
          <span>GRASP</span>
        </div>
      </header>

      {/* Backdrop for the mobile drawer */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[950] bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          data-testid="sidebar-backdrop"
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-h-screen bg-page lg:ml-[280px]">
        <Outlet />
      </main>
    </div>
  );
}
