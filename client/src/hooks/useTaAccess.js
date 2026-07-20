import { useCourseAccess } from "./useCourseAccess";
import { TA_PERMISSIONS } from "../lib/permissions";

// Resolves which TA capabilities the current user holds in the selected
// course. Mirrors the server's utils/ta-permissions.js: only promoted TAs are
// restricted — faculty and genuine staff always pass — and a missing map or
// key means "allowed", so nothing is hidden until an instructor restricts it.
// While the access lookup is still loading we allow everything to avoid nav
// flicker; the API is the real enforcement layer.
export function useTaAccess() {
  const { role, taPermissions, isLoading } = useCourseAccess();
  const isTa = role === "ta";

  const canTa = (key) => {
    if (!isTa || isLoading) return true;
    // TAs never get course settings; it is where their permissions live.
    if (key === "settings") return false;
    return taPermissions?.[key] !== false;
  };

  // Where to send a TA who lands on a page they can't see.
  const firstAllowedPath = () => {
    const allowed = TA_PERMISSIONS.find((perm) => perm.path && canTa(perm.key));
    return allowed ? allowed.path : "/student-dashboard";
  };

  return { isTa, isLoading, canTa, firstAllowedPath };
}
