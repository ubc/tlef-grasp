import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAppStore } from "../stores/appStore";

const ROLE_RANK = { student: 1, staff: 2, faculty: 3 };

export function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-page">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

// Requires a logged-in user; otherwise sends them to the landing page.
export function RequireAuth() {
  const { user, isLoading, isError } = useCurrentUser();

  if (isLoading) return <FullPageSpinner />;
  if (isError || !user) return <Navigate to="/" replace />;
  return <Outlet />;
}

// Requires a selected course (mirrors the legacy onboarding-check.js).
// Students without a course go to their dashboard's no-course state instead.
export function RequireOnboarded() {
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const { isStudent } = useCurrentUser();
  const location = useLocation();

  if (!selectedCourse) {
    return (
      <Navigate
        to={isStudent ? "/student-dashboard" : "/onboarding"}
        replace
        state={{ from: location }}
      />
    );
  }
  return <Outlet />;
}

// Requires the user's actual role to be at least `min` ("student" | "staff" | "faculty").
// Students landing on instructor pages get bounced to their dashboard (legacy behavior).
export function RequireRole({ min }) {
  const { role, isStudent } = useCurrentUser();

  if ((ROLE_RANK[role] || 0) < ROLE_RANK[min]) {
    return <Navigate to={isStudent ? "/student-dashboard" : "/dashboard"} replace />;
  }
  return <Outlet />;
}
