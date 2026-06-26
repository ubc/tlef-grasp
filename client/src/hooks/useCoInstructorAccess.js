import { useSelectedCourseId } from "../stores/appStore";
import { useCurrentUser } from "./useCurrentUser";
import { useCourse } from "./useSections";
import { useCourseSettings } from "./useCourseSettings";

// Resolves what the current user may access in the selected course.
//
// The course owner and app administrators always have full access. Any other
// instructor is subject to the owner's co-instructor permissions (stored in
// course settings). A permission is allowed unless explicitly set to false, so
// the default is full access. While the course/settings are still loading we
// allow everything, so the owner never sees their own nav flicker away.
export function useCoInstructorAccess() {
  const courseId = useSelectedCourseId();
  const { user, isFaculty } = useCurrentUser();

  // Only instructors are subject to (or need) these lookups. Skip the queries
  // for students, who also render the sidebar.
  const enabled = !!isFaculty;
  const { course, isPending: coursePending } = useCourse(courseId, { enabled });
  const { settings, isPending: settingsPending } = useCourseSettings(courseId, {
    enabled,
  });

  const userId = String(user?._id || user?.id || "");
  const isOwner = !!(course && userId && String(course.owner) === userId);
  const fullAccess = isOwner || !!user?.isAppAdministrator;

  const isLoading = enabled && courseId && (coursePending || settingsPending);
  const permissions = settings?.coInstructorPermissions || {};

  // Allow unless we positively know this restricted co-instructor lacks the
  // permission. Anything not explicitly false is enabled.
  const can = (key) => {
    if (fullAccess || isLoading) return true;
    return permissions[key] !== false;
  };

  return { isOwner, fullAccess, isLoading, can };
}
