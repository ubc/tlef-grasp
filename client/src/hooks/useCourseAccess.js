import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useSelectedCourseId } from "../stores/appStore";
import { useCurrentUser } from "./useCurrentUser";

// Resolve the current user's effective role in the selected course. A promoted
// TA has a global staff affiliation so shared API middleware can recognize
// them, but that affiliation must only unlock instructor UI in their TA course.
export function useCourseAccess() {
  const courseId = useSelectedCourseId();
  const { user, isFaculty, isStaff } = useCurrentUser();
  const needsCourseLookup = !!user && !!courseId && isStaff && !isFaculty;

  const query = useQuery({
    queryKey: queryKeys.courseAccess(courseId),
    queryFn: () => api.get(`/api/users/course/${courseId}/access`),
    enabled: needsCourseLookup,
    retry: false,
  });

  const hasStaffAccess = isFaculty || query.data?.hasStaffAccess === true;
  const role = isFaculty
    ? "faculty"
    : hasStaffAccess
      ? query.data?.role || "staff"
      : "student";

  return {
    ...query,
    hasStaffAccess,
    role,
    // Per-TA capability map resolved by the server (all-true for non-TAs).
    taPermissions: query.data?.taPermissions || null,
    isLoading: needsCourseLookup && query.isPending,
  };
}
