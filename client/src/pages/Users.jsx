import { useMemo, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import {
  useCourseUsers,
  useAvailableUsers,
  useAddUserToCourse,
  useRemoveUserFromCourse,
} from "../hooks/useUsers";
import { getUserRole } from "../lib/utils";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import { LoadingRow } from "../components/ui/states";

function RoleBadge({ role }) {
  const config = {
    faculty: { icon: "fa-graduation-cap", label: "Faculty", classes: "bg-purple-100 text-purple-700" },
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

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [removeTarget, setRemoveTarget] = useState(null);

  const { users: courseUsers, isPending: courseUsersPending } =
    useCourseUsers(courseId);
  const { users: availableUsers, isPending: availableUsersPending } =
    useAvailableUsers(courseId, { enabled: isFaculty });

  const addMutation = useAddUserToCourse(courseId, {
    onSuccess: () => showToast("User added to course successfully", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to add user to course", "error"),
  });

  const removeMutation = useRemoveUserFromCourse(courseId, {
    onSuccess: () => showToast("User removed from course successfully", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to remove user from course", "error"),
  });

  const filteredUsers = useMemo(() => {
    let filtered = availableUsers;
    if (roleFilter !== "all") {
      filtered = filtered.filter((user) => getUserRole(user) === roleFilter);
    }
    const term = searchTerm.toLowerCase().trim();
    if (term) {
      filtered = filtered.filter((user) => {
        const name = (user.displayName || "").toLowerCase();
        const email = (user.email || "").toLowerCase();
        return name.includes(term) || email.includes(term);
      });
    }
    return filtered;
  }, [availableUsers, roleFilter, searchTerm]);

  const currentUserId = String(currentUser?._id || currentUser?.id || "");

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-ink">Course Users</h1>

      {/* Users in course */}
      <section className="mb-8 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          <i className="fas fa-users mr-2 text-primary" />
          Users in Course
        </h2>

        {courseUsersPending ? (
          <LoadingRow label="Loading users..." />
        ) : courseUsers.length === 0 ? (
          <EmptyState icon="fa-users" message="No users found in this course." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClass}>Name</th>
                  <th className={tableHeadClass}>Email</th>
                  <th className={tableHeadClass}>Role</th>
                  <th className={`${tableHeadClass} w-32`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {courseUsers.map((user) => {
                  const userId = String(
                    user.userId || user._id || user.user?._id || ""
                  );
                  const displayName =
                    user.displayName || user.user?.displayName || "Unknown User";
                  const email = user.email || user.user?.email || "";
                  const role = getUserRole({
                    ...user,
                    affiliation: user.affiliation || user.user?.affiliation,
                  });
                  const isCurrentUser = userId === currentUserId;

                  return (
                    <tr key={userId} className="hover:bg-gray-50">
                      <td className={tableCellClass}>
                        <UserNameCell name={displayName} isCurrentUser={isCurrentUser} />
                      </td>
                      <td className={`${tableCellClass} text-muted`}>{email}</td>
                      <td className={tableCellClass}>
                        <RoleBadge role={role} />
                      </td>
                      <td className={tableCellClass}>
                        {isFaculty && !isCurrentUser ? (
                          <button
                            type="button"
                            title="Remove from course"
                            onClick={() => setRemoveTarget({ userId, displayName })}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-danger/85"
                          >
                            <i className="fas fa-user-minus" /> Remove
                          </button>
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
        )}
      </section>

      {/* Available users — faculty only */}
      {isFaculty && (
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">
            <i className="fas fa-user-plus mr-2 text-primary" />
            Available Users
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            Users who can be added to this course
          </p>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="relative min-w-64 flex-1">
              <i className="fas fa-search absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name or email..."
                className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="role-filter" className="text-sm font-medium text-muted">
                Filter by Role:
              </label>
              <select
                id="role-filter"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="all">All Roles</option>
                <option value="faculty">Faculty</option>
                <option value="staff">Staff</option>
                <option value="student">Student</option>
              </select>
            </div>
            <div className="text-sm text-muted">
              <span className="font-semibold text-ink">{filteredUsers.length}</span>{" "}
              users found
            </div>
          </div>

          {availableUsersPending ? (
            <LoadingRow label="Loading available users..." />
          ) : filteredUsers.length === 0 ? (
            <EmptyState icon="fa-user-check" message="No users available to add." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClass}>Name</th>
                    <th className={tableHeadClass}>Email</th>
                    <th className={tableHeadClass}>Role</th>
                    <th className={`${tableHeadClass} w-32`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const userId = String(user._id || "");
                    return (
                      <tr key={userId} className="hover:bg-gray-50">
                        <td className={tableCellClass}>
                          <UserNameCell name={user.displayName || "Unknown User"} />
                        </td>
                        <td className={`${tableCellClass} text-muted`}>
                          {user.email || ""}
                        </td>
                        <td className={tableCellClass}>
                          <RoleBadge role={getUserRole(user)} />
                        </td>
                        <td className={tableCellClass}>
                          <button
                            type="button"
                            title="Add to course"
                            disabled={addMutation.isPending}
                            onClick={() => addMutation.mutate(userId)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
                          >
                            <i className="fas fa-user-plus" /> Add
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

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
