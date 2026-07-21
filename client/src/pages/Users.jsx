import { useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import {
  useCourseUsers,
  useRemoveUserFromCourse,
  usePromoteToTa,
  useDemoteToStudent,
  useUpdateTaPermissions,
} from "../hooks/useUsers";
import TaPermissionsModal from "./users/TaPermissionsModal";
import { useMyCourseSections } from "../hooks/useSections";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { getUserRole } from "../lib/utils";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import { LoadingRow } from "../components/ui/states";

function RoleBadge({ role }) {
  const config = {
    faculty: { icon: "fa-graduation-cap", label: "Faculty", classes: "bg-purple-100 text-purple-700" },
    ta: { icon: "fa-chalkboard-teacher", label: "TA", classes: "bg-amber-100 text-amber-700" },
    staff: { icon: "fa-user-tie", label: "Staff", classes: "bg-blue-100 text-blue-700" },
    student: { icon: "fa-user-graduate", label: "Student", classes: "bg-green-100 text-green-700" },
  }[role];
  if (!config) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${config.classes}`}
    >
      <i className={`fas ${config.icon}`} /> {config.label}
    </span>
  );
}

function UserNameCell({ name, isCurrentUser }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
        <i className="fas fa-user text-sm text-muted" />
      </div>
      <span className="font-medium text-ink">{name}</span>
      {isCurrentUser && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
          <i className="fas fa-user-circle" /> You
        </span>
      )}
    </div>
  );
}

function EmptyState({ icon, message }) {
  return (
    <div className="py-10 text-center text-muted">
      <i className={`fas ${icon} mb-3 text-3xl text-gray-300`} />
      <p>{message}</p>
    </div>
  );
}

const tableHeadClass =
  "border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted";
const tableCellClass = "border-b border-gray-100 px-4 py-3 text-sm";

export default function Users() {
  const showToast = useToast();
  const { user: currentUser, isFaculty } = useCurrentUser();
  const courseId = useSelectedCourseId();
  // Only the course owner (or an app administrator) may remove instructors.
  const { fullAccess } = useCoInstructorAccess();

  const PAGE_SIZE = 10;
  const [sectionFilter, setSectionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [removeTarget, setRemoveTarget] = useState(null);
  // { userId, displayName, action: 'promote' | 'demote' }
  const [roleChangeTarget, setRoleChangeTarget] = useState(null);
  // { userId, displayName, taPermissions } — the TA whose permissions are open
  const [permissionsTarget, setPermissionsTarget] = useState(null);

  const { users: courseUsers, isPending: courseUsersPending } =
    useCourseUsers(courseId);
  // Only the sections this instructor owns — students are scoped to these.
  const { sections: courseSections } = useMyCourseSections(courseId);

  // Section id -> readable label, for badges and the filter dropdown.
  const sectionName = (sectionId) => {
    const match = courseSections.find((s) => s.sectionId === sectionId);
    return match ? match.sectionNumber || sectionId : sectionId;
  };

  const visibleCourseUsers =
    sectionFilter === "all"
      ? courseUsers
      : courseUsers.filter(
          (user) => Array.isArray(user.sections) && user.sections.includes(sectionFilter)
        );

  const totalPages = Math.ceil(visibleCourseUsers.length / PAGE_SIZE);
  const pagedUsers = visibleCourseUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const removeMutation = useRemoveUserFromCourse(courseId, {
    onSuccess: () => showToast("User removed from course successfully", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to remove user from course", "error"),
  });

  const promoteMutation = usePromoteToTa(courseId, {
    onSuccess: () =>
      showToast(
        "User promoted to TA. The change applies on their next login.",
        "success"
      ),
    onError: (error) =>
      showToast(error.message || "Failed to promote user to TA", "error"),
  });

  const demoteMutation = useDemoteToStudent(courseId, {
    onSuccess: () =>
      showToast(
        "TA demoted to student. The change applies on their next login.",
        "success"
      ),
    onError: (error) =>
      showToast(error.message || "Failed to demote TA", "error"),
  });

  const permissionsMutation = useUpdateTaPermissions(courseId, {
    onSuccess: () => {
      setPermissionsTarget(null);
      showToast("TA permissions updated", "success");
    },
    onError: (error) =>
      showToast(error.message || "Failed to update TA permissions", "error"),
  });

  const roleChangePending = promoteMutation.isPending || demoteMutation.isPending;

  const currentUserId = String(currentUser?._id || currentUser?.id || "");

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-ink">Course Users</h1>

      {/* Users in course */}
      <section className="mb-8 rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">
            <i className="fas fa-users mr-2 text-primary" />
            Users in Course
          </h2>
          {courseSections.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="section-filter" className="text-sm font-medium text-muted">
                Section:
              </label>
              <select
                id="section-filter"
                value={sectionFilter}
                onChange={(event) => { setSectionFilter(event.target.value); setPage(1); }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="all">All Sections</option>
                {courseSections.map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {section.sectionNumber || section.sectionId}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {courseUsersPending ? (
          <LoadingRow label="Loading users..." />
        ) : courseUsers.length === 0 ? (
          <EmptyState icon="fa-users" message="No users found in this course." />
        ) : visibleCourseUsers.length === 0 ? (
          <EmptyState icon="fa-filter" message="No users in the selected section." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr>
                    <th className={tableHeadClass}>Name</th>
                    <th className={tableHeadClass}>Role</th>
                    {courseSections.length > 0 && (
                      <th className={tableHeadClass}>Sections</th>
                    )}
                    <th className={`${tableHeadClass} w-64`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((user) => {
                    const userId = String(
                      user.userId || user._id || user.user?._id || ""
                    );
                    // Instructor roster: identify people by their authoritative
                    // legal name, not the editable display name.
                    const displayName =
                      user.legalName || user.user?.legalName || "Unknown User";
                    // Prefer the course-scoped role resolved by the server
                    // (distinguishes TAs); fall back to global affiliations.
                    const role =
                      user.courseRole ||
                      getUserRole({
                        ...user,
                        affiliation: user.affiliation || user.user?.affiliation,
                      });
                    const isCurrentUser = userId === currentUserId;
                    const canRemove =
                      isFaculty &&
                      !isCurrentUser &&
                      (role !== "faculty" || fullAccess);
                    const canChangeCourseRole =
                      isFaculty &&
                      !isCurrentUser &&
                      (role === "student" || role === "ta");
                    const showActions = canChangeCourseRole || canRemove;

                    return (
                      <tr key={userId} className="hover:bg-gray-50">
                        <td className={tableCellClass}>
                          <UserNameCell name={displayName} isCurrentUser={isCurrentUser} />
                        </td>
                        <td className={tableCellClass}>
                          <RoleBadge role={role} />
                        </td>
                        {courseSections.length > 0 && (
                          <td className={tableCellClass}>
                            {Array.isArray(user.sections) && user.sections.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {user.sections.map((sectionId) => (
                                  <span
                                    key={sectionId}
                                    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                                  >
                                    <i className="fas fa-book" /> {sectionName(sectionId)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                        )}
                        <td className={tableCellClass}>
                          {showActions ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {canChangeCourseRole && role === "student" && (
                                <button
                                  type="button"
                                  title="Promote to TA"
                                  disabled={roleChangePending}
                                  onClick={() =>
                                    setRoleChangeTarget({ userId, displayName, action: "promote" })
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/85 disabled:opacity-50"
                                >
                                  <i className="fas fa-arrow-up" /> Promote to TA
                                </button>
                              )}
                              {canChangeCourseRole && role === "ta" && (
                                <button
                                  type="button"
                                  title="Edit TA permissions"
                                  onClick={() =>
                                    setPermissionsTarget({
                                      userId,
                                      displayName,
                                      taPermissions: user.taPermissions,
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-600/85"
                                >
                                  <i className="fas fa-key" /> Permissions
                                </button>
                              )}
                              {canChangeCourseRole && role === "ta" && (
                                <button
                                  type="button"
                                  title="Demote to Student"
                                  disabled={roleChangePending}
                                  onClick={() =>
                                    setRoleChangeTarget({ userId, displayName, action: "demote" })
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600/85 disabled:opacity-50"
                                >
                                  <i className="fas fa-arrow-down" /> Demote to Student
                                </button>
                              )}
                              {canRemove && (
                                <button
                                  type="button"
                                  title="Remove from course"
                                  onClick={() => setRemoveTarget({ userId, displayName })}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-danger/85"
                                >
                                  <i className="fas fa-user-minus" /> Remove
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-muted">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibleCourseUsers.length)} of {visibleCourseUsers.length} users
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 1}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <i className="fas fa-chevron-left" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      className={`rounded-lg border px-3 py-1.5 transition-colors ${
                        n === page
                          ? "border-primary bg-primary text-white"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page === totalPages}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <i className="fas fa-chevron-right" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <ConfirmModal
        open={!!roleChangeTarget}
        onClose={() => setRoleChangeTarget(null)}
        onConfirm={() => {
          const { userId, action } = roleChangeTarget;
          (action === "promote" ? promoteMutation : demoteMutation).mutate(userId);
        }}
        title={
          roleChangeTarget?.action === "promote"
            ? "Promote to TA"
            : "Demote to Student"
        }
        message={
          roleChangeTarget?.action === "promote"
            ? `Promote ${roleChangeTarget?.displayName || "this user"} to TA for this course? They keep their student role and gain TA access on their next login.`
            : `Demote ${roleChangeTarget?.displayName || "this user"} back to student? Their TA access for this course is removed on their next login.`
        }
        confirmLabel="Confirm"
      />

      <TaPermissionsModal
        open={!!permissionsTarget}
        ta={permissionsTarget}
        onClose={() => setPermissionsTarget(null)}
        saving={permissionsMutation.isPending}
        onSave={(permissions) =>
          permissionsMutation.mutate({ userId: permissionsTarget.userId, permissions })
        }
      />

      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeMutation.mutate(removeTarget.userId)}
        title="Remove User from Course"
        message={`Are you sure you want to remove ${removeTarget?.displayName || "this user"} from this course?`}
        confirmLabel="Confirm"
      />
    </div>
  );
}
