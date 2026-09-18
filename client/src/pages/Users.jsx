import { useEffect, useMemo, useState } from "react";
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
import AddPeoplePanel from "./users/AddPeoplePanel";
import AccessHistory from "./users/AccessHistory";
import RoleBadge from "./users/RoleBadge";
import { useMyCourseSections } from "../hooks/useSections";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { getUserRole } from "../lib/utils";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import { LoadingRow } from "../components/ui/states";
import {
  describeMembershipSource,
  filterAndSortCourseUsers,
  getUserNames,
  UNKNOWN_USER_NAME,
} from "./users/userListUtils";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function UserNameCell({ legalName, displayName, isCurrentUser, note }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
        <i className="fas fa-user text-sm text-muted" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{legalName}</span>
          {isCurrentUser && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              <i className="fas fa-user-circle" /> You
            </span>
          )}
        </div>
        {displayName && (
          <span className="block text-xs text-muted">Display name: {displayName}</span>
        )}
        {note && (
          <span className="block text-xs text-muted">
            <i className="fas fa-user-check mr-1 text-amber-600" aria-hidden="true" />
            {note}
          </span>
        )}
      </div>
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

function getCourseRole(user) {
  return (
    user.courseRole ||
    getUserRole({
      ...user,
      affiliation: user.affiliation || user.user?.affiliation,
    })
  );
}

export default function Users() {
  const showToast = useToast();
  const { user: currentUser, isFaculty } = useCurrentUser();
  const courseId = useSelectedCourseId();
  // Only the course owner (or an app administrator) may remove instructors.
  const { fullAccess } = useCoInstructorAccess();

  const [sectionFilter, setSectionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useState(1);
  const [removeTarget, setRemoveTarget] = useState(null);
  // { userId, displayName, action: 'promote' | 'demote', baseRole }
  // baseRole: what a TA reverts to on demotion ('student' | 'staff').
  const [roleChangeTarget, setRoleChangeTarget] = useState(null);
  // { userId, displayName, taPermissions } — the TA whose permissions are open
  const [permissionsTarget, setPermissionsTarget] = useState(null);

  const { users: courseUsers, isPending: courseUsersPending } = useCourseUsers(courseId);
  // Only the sections this instructor owns — students are scoped to these.
  const { sections: courseSections } = useMyCourseSections(courseId);

  // Section id -> readable label, for badges and the filter dropdown.
  const sectionName = (sectionId) => {
    const match = courseSections.find((s) => s.sectionId === sectionId);
    return match ? match.sectionNumber || sectionId : sectionId;
  };

  const visibleCourseUsers = useMemo(
    () =>
      filterAndSortCourseUsers(courseUsers, {
        sectionFilter,
        search,
        getRole: getCourseRole,
      }),
    [courseUsers, search, sectionFilter]
  );

  const totalPages = Math.max(1, Math.ceil(visibleCourseUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = visibleCourseUsers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

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
    onSuccess: (data) =>
      showToast(
        data?.message || "TA demoted to student. The change applies on their next login.",
        "success"
      ),
    onError: (error) => showToast(error.message || "Failed to demote TA", "error"),
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

      {/* Manual access grants (issue #115): instructors only */}
      {isFaculty && <AddPeoplePanel courseId={courseId} />}

      {/* Users in course */}
      <section className="mb-8 rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">
            <i className="fas fa-users mr-2 text-primary" />
            Users in Course
          </h2>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <div className="relative min-w-64 max-w-sm flex-1">
              <label htmlFor="user-search" className="sr-only">
                Search users by legal or display name
              </label>
              <i
                className="fas fa-search absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                id="user-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search by legal or display name..."
                className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            {courseSections.length > 0 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="section-filter"
                  className="text-sm font-medium text-muted"
                >
                  Section:
                </label>
                <select
                  id="section-filter"
                  value={sectionFilter}
                  onChange={(event) => {
                    setSectionFilter(event.target.value);
                    setPage(1);
                  }}
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
        </div>

        {courseUsersPending ? (
          <LoadingRow label="Loading users..." />
        ) : courseUsers.length === 0 ? (
          <EmptyState icon="fa-users" message="No users found in this course." />
        ) : visibleCourseUsers.length === 0 ? (
          <EmptyState icon="fa-search" message="No users match your filters." />
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
                    const { legalName, distinctDisplayName } = getUserNames(user);
                    const targetName =
                      legalName === UNKNOWN_USER_NAME && distinctDisplayName
                        ? distinctDisplayName
                        : legalName;
                    // Prefer the course-scoped role resolved by the server
                    // (distinguishes TAs); fall back to global affiliations.
                    const role = getCourseRole(user);
                    const isCurrentUser = userId === currentUserId;
                    const canRemove =
                      isFaculty && !isCurrentUser && (role !== "faculty" || fullAccess);
                    // Anyone but an instructor can hold the TA role: students,
                    // and staff whose Workday affiliation is not a reliable
                    // signal of TA work.
                    const canChangeCourseRole =
                      isFaculty &&
                      !isCurrentUser &&
                      (role === "student" || role === "staff" || role === "ta");
                    const showActions = canChangeCourseRole || canRemove;
                    const baseRole = user.baseRole || "student";
                    const demoteLabel =
                      baseRole === "staff" ? "Remove TA Role" : "Demote to Student";
                    const provenance = describeMembershipSource(user);

                    return (
                      <tr key={userId} className="hover:bg-gray-50">
                        <td className={tableCellClass}>
                          <UserNameCell
                            legalName={legalName}
                            displayName={distinctDisplayName}
                            isCurrentUser={isCurrentUser}
                            note={provenance}
                          />
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
                              {canChangeCourseRole && role !== "ta" && (
                                <button
                                  type="button"
                                  title="Promote to TA"
                                  disabled={roleChangePending}
                                  onClick={() =>
                                    setRoleChangeTarget({
                                      userId,
                                      displayName: targetName,
                                      action: "promote",
                                      baseRole: role,
                                    })
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
                                      displayName: targetName,
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
                                  title={demoteLabel}
                                  disabled={roleChangePending}
                                  onClick={() =>
                                    setRoleChangeTarget({
                                      userId,
                                      displayName: targetName,
                                      action: "demote",
                                      baseRole,
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600/85 disabled:opacity-50"
                                >
                                  <i className="fas fa-arrow-down" /> {demoteLabel}
                                </button>
                              )}
                              {canRemove && (
                                <button
                                  type="button"
                                  title="Remove from course"
                                  onClick={() =>
                                    setRemoveTarget({ userId, displayName: targetName })
                                  }
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
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <div className="flex flex-wrap items-center gap-4">
                <span>
                  Showing {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, visibleCourseUsers.length)} of{" "}
                  {visibleCourseUsers.length} users
                </span>
                <div className="flex items-center gap-2">
                  <label htmlFor="page-size" className="font-medium">
                    Users per page:
                  </label>
                  <select
                    id="page-size"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {totalPages > 1 && (
                <nav
                  className="flex items-center gap-1"
                  aria-label="User list pagination"
                >
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    className="rounded-lg border border-gray-200 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <i className="fas fa-chevron-left" aria-hidden="true" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      aria-label={`Page ${n}`}
                      aria-current={n === currentPage ? "page" : undefined}
                      className={`rounded-lg border px-3 py-1.5 transition-colors ${
                        n === currentPage
                          ? "border-primary bg-primary text-white"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Next page"
                    className="rounded-lg border border-gray-200 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <i className="fas fa-chevron-right" aria-hidden="true" />
                  </button>
                </nav>
              )}
            </div>
          </>
        )}
      </section>

      {isFaculty && <AccessHistory courseId={courseId} />}

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
            : roleChangeTarget?.baseRole === "staff"
              ? "Remove TA Role"
              : "Demote to Student"
        }
        message={
          roleChangeTarget?.action === "promote"
            ? roleChangeTarget?.baseRole === "staff"
              ? `Make ${roleChangeTarget?.displayName || "this user"} a TA for this course? They keep their staff role and can be limited with TA permissions; the change applies on their next login.`
              : `Promote ${roleChangeTarget?.displayName || "this user"} to TA for this course? They keep their student role and gain TA access on their next login.`
            : roleChangeTarget?.baseRole === "staff"
              ? `Remove the TA role from ${roleChangeTarget?.displayName || "this user"}? They remain course staff; the change applies on their next login.`
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
