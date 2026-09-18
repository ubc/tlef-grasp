import { useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  useAddUserToCourse,
  useSearchUsersNotInCourse,
  USER_SEARCH_MIN_LENGTH,
} from "../../hooks/useUsers";
import { useToast } from "../../components/ui/Toast";
import { ConfirmModal } from "../../components/ui/Modal";
import { LoadingRow } from "../../components/ui/states";
import RoleBadge from "./RoleBadge";
import { getUserNames, personLabel, ROLE_LABELS, UNKNOWN_USER_NAME } from "./userListUtils";

// Instructor-only panel for granting course access by hand (issue #115):
// anyone who has signed in to GRASP can be found by email or name and added
// as a plain member or straight in as a TA. The search is deliberately not a
// browsable list — the server returns a handful of matches for a typed query
// and nothing otherwise.
export default function AddPeoplePanel({ courseId }) {
  const showToast = useToast();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const { users, isFetching, isError, error, enabled } = useSearchUsersNotInCourse(
    courseId,
    debouncedQuery
  );
  // { userId, name, role: "member" | "ta", roleLabel }
  const [pendingAdd, setPendingAdd] = useState(null);

  const addMutation = useAddUserToCourse(courseId, {
    onSuccess: (data) =>
      showToast(data?.message || "User added to course successfully", "success"),
    onError: (mutationError) =>
      showToast(mutationError.message || "Failed to add user to course", "error"),
  });

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < USER_SEARCH_MIN_LENGTH;
  const showResults = enabled && debouncedQuery.trim() === trimmed;

  const nameOf = (user) => {
    const { legalName, distinctDisplayName } = getUserNames(user);
    return legalName === UNKNOWN_USER_NAME && distinctDisplayName
      ? distinctDisplayName
      : legalName === UNKNOWN_USER_NAME
        ? personLabel(user)
        : legalName;
  };

  const confirmAdd = (user, role) =>
    setPendingAdd({
      userId: String(user._id),
      name: nameOf(user),
      role,
      roleLabel: role === "ta" ? "TA" : ROLE_LABELS[user.role] || "member",
    });

  return (
    <section
      className="mb-8 rounded-2xl bg-white p-6 shadow-sm"
      aria-labelledby="add-people-heading"
    >
      <h2 id="add-people-heading" className="mb-2 text-lg font-semibold text-ink">
        <i className="fas fa-user-plus mr-2 text-primary" />
        Add People
      </h2>
      <p className="mb-4 text-sm text-muted">
        Anyone who has signed in to GRASP with their CWL can be added here — for
        example a TA the academic API does not list for this course. Search by email
        or name, then add them as a course member or straight in as a TA. Each
        addition is recorded with your name and the date, and can be revoked from the
        roster below. Instructors join with the course invite code instead.
      </p>

      <div className="relative max-w-lg">
        <label htmlFor="add-people-search" className="sr-only">
          Search accounts by email or name
        </label>
        <i
          className="fas fa-search absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          id="add-people-search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by email or name..."
          className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9 text-sm focus:border-primary focus:outline-none"
        />
      </div>

      <div className="mt-4" aria-live="polite">
        {tooShort && (
          <p className="text-sm text-muted">
            Type at least {USER_SEARCH_MIN_LENGTH} characters to search.
          </p>
        )}

        {showResults && isFetching && <LoadingRow label="Searching..." />}

        {showResults && !isFetching && isError && (
          <p className="text-sm text-danger">
            {error?.message || "Search failed. Please try again."}
          </p>
        )}

        {showResults && !isFetching && !isError && users.length === 0 && (
          <p className="text-sm text-muted">
            No accounts match “{debouncedQuery.trim()}”. They may need to sign in to
            GRASP once first, or they may already be in this course.
          </p>
        )}

        {showResults && !isFetching && !isError && users.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {users.map((user) => {
              const name = nameOf(user);
              const memberLabel = ROLE_LABELS[user.role] || "Member";
              return (
                <li
                  key={String(user._id)}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{name}</span>
                      <RoleBadge role={user.role} />
                      {user.courseCount === 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-muted">
                          <i className="fas fa-door-open" /> Not in any course yet
                        </span>
                      )}
                    </div>
                    {user.email && (
                      <span className="block text-xs text-muted">{user.email}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={addMutation.isPending}
                      onClick={() => confirmAdd(user, "member")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                    >
                      <i className="fas fa-user-plus" /> Add as {memberLabel}
                    </button>
                    <button
                      type="button"
                      disabled={addMutation.isPending}
                      onClick={() => confirmAdd(user, "ta")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/85 disabled:opacity-50"
                    >
                      <i className="fas fa-chalkboard-teacher" /> Add as TA
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmModal
        open={!!pendingAdd}
        onClose={() => setPendingAdd(null)}
        onConfirm={() =>
          addMutation.mutate({ userId: pendingAdd.userId, role: pendingAdd.role })
        }
        title={pendingAdd?.role === "ta" ? "Add as TA" : "Add to Course"}
        message={
          pendingAdd?.role === "ta"
            ? `Add ${pendingAdd?.name || "this user"} to this course as a TA? They gain TA access on their next login. This is recorded under your name and can be revoked from the roster.`
            : `Add ${pendingAdd?.name || "this user"} to this course as a ${pendingAdd?.roleLabel || "member"}? This is recorded under your name and can be revoked from the roster.`
        }
        confirmLabel={pendingAdd?.role === "ta" ? "Add as TA" : "Add"}
      />
    </section>
  );
}
