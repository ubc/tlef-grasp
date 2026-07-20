import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useCourseAccess } from "../hooks/useCourseAccess";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { useTaAccess } from "../hooks/useTaAccess";
import { useAppStore } from "../stores/appStore";

const ROLE_RANK = { student: 1, ta: 2, staff: 2, faculty: 3 };

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
  const { isStudent } = useCurrentUser();
  const { role, isLoading } = useCourseAccess();

  if (isLoading) return <FullPageSpinner />;

  if ((ROLE_RANK[role] || 0) < ROLE_RANK[min]) {
    return <Navigate to={isStudent || role === "student" ? "/student-dashboard" : "/dashboard"} replace />;
  }
  return <Outlet />;
}

// Requires the co-instructor to have the given permission for the selected
// course. The owner and app admins always pass. A restricted co-instructor who
// reaches a gated URL directly is bounced to their dashboard.
export function RequirePermission({ permission }) {
  const { can, isLoading } = useCoInstructorAccess();

  if (isLoading) return <FullPageSpinner />;
  if (!can(permission)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

// Requires the TA to hold the given capability for the selected course.
// Faculty and genuine staff always pass. A restricted TA who reaches a gated
// URL directly is bounced to their first still-allowed instructor page (or
// their student dashboard when nothing is left).
export function RequireTaPermission({ permission }) {
  const { canTa, firstAllowedPath, isLoading } = useTaAccess();

  if (isLoading) return <FullPageSpinner />;
  if (!canTa(permission)) return <Navigate to={firstAllowedPath()} replace />;
  return <Outlet />;
}
