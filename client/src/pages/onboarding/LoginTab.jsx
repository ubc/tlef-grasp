import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useReorderCourses, useSetCourseNickname } from "../../hooks/useCourses";
import { periodLabel } from "../../lib/academicPeriod";
import { StepIcon, continueBtnClass } from "./shared";

const MAX_NICKNAME_LENGTH = 60;

// Inline nickname editor, shown only to a course's owner. The nickname is
// course-wide (co-instructors, TAs and students all see it), which is why this
// is gated on ownership rather than on any write permission in the course.
function NicknameEditor({ course, onClose }) {
  const [value, setValue] = useState(course.nickname || "");
  const setNickname = useSetCourseNickname({ onSuccess: onClose });

  const submit = (event) => {
    event.preventDefault();
    setNickname.mutate({ courseId: course._id, nickname: value });
  };

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="text"
        autoFocus
        value={value}
        maxLength={MAX_NICKNAME_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Tuesday cohort"
        aria-label={`Nickname for ${course.courseName}`}
        className="min-w-0 flex-1 rounded-lg border-2 border-gray-200 px-3 py-1.5 text-sm focus:border-[#4facfe] focus:outline-none"
      />
      <button
        type="submit"
        disabled={setNickname.isPending}
        className="rounded-lg bg-[#4facfe] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {setNickname.isPending ? "Saving..." : "Save"}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border-2 border-gray-200 px-3 py-1.5 text-sm font-semibold text-muted"
      >
        Cancel
      </button>
      {setNickname.isError && (
        <p className="w-full text-sm text-red-600">
          {setNickname.error?.message || "Could not save the nickname."}
        </p>
      )}
    </form>
  );
}

export default function LoginTab({
  courses,
  isLoading,
  isStudent,
  onSwitchToSetup,
  canCreate,
}) {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const { user } = useCurrentUser();
  const reorder = useReorderCourses();
  const [editingId, setEditingId] = useState(null);

  // Local copy of the order so an arrow moves the card immediately instead of
  // waiting on the round trip. The server list arrives already sorted, so this
  // only ever gets ahead of it, never disagrees with it.
  const [order, setOrder] = useState([]);

  // Adopt the server's order whenever the *set* of courses changes (first load,
  // a course created, joined, or archived). A refetch that returns the same
  // courses leaves the local order alone, so a pending reorder is not undone by
  // the invalidation it triggered.
  useEffect(() => {
    setOrder((previous) => {
      const ids = courses.map((c) => c._id);
      const sameSet =
        previous.length === ids.length && previous.every((id) => ids.includes(id));
      return sameSet ? previous : ids;
    });
  }, [courses]);

  const orderedCourses = useMemo(() => {
    const byId = new Map(courses.map((c) => [c._id, c]));
    // Anything the order array has not caught up with yet (a course that
    // arrived in the same render) still gets shown, appended at the end.
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const seen = new Set(ordered.map((c) => c._id));
    return [...ordered, ...courses.filter((c) => !seen.has(c._id))];
  }, [courses, order]);

  const accessCourse = (course) => {
    setSelectedCourse({ id: course._id, name: course.courseName });
    navigate(isStudent ? "/student-dashboard" : "/dashboard");
  };

  // Swap with the neighbour and persist the whole resulting list. Sending
  // absolute positions rather than a "move up" delta keeps repeated clicks
  // idempotent even if an earlier request is still in flight.
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= orderedCourses.length) return;

    const ids = orderedCourses.map((c) => c._id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setOrder(ids);
    reorder.mutate(ids);
  };

  const isOwner = (course) =>
    !!user &&
    !!course.owner &&
    (String(course.owner) === String(user._id) || user.isAppAdministrator);

  return (
    <div className="text-center">
      <StepIcon icon="fa-sign-in-alt" />
      <h2 className="text-2xl font-bold text-ink">Welcome Back</h2>
      <p className="mt-1 mb-8 text-muted">Select your course to access your dashboard</p>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 py-8 text-muted">
          <i className="fas fa-spinner fa-spin text-xl" />
          <span>Loading your courses...</span>
        </div>
      ) : orderedCourses.length > 0 ? (
        <>
          {orderedCourses.length > 1 && (
            <p className="mb-3 text-left text-sm text-muted">
              Use the arrows to set the order your courses appear in, here and in
              the sidebar switcher.
            </p>
          )}
          {reorder.isError && (
            <p className="mb-3 text-left text-sm text-red-600">
              Could not save the new order. It will revert next time this page
              loads.
            </p>
          )}
          <div className="flex flex-col gap-4">
            {orderedCourses.map((course, index) => {
              const period = periodLabel(course);
              return (
                <div
                  key={course._id}
                  className="flex items-center gap-4 rounded-2xl border-2 border-gray-100 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[#4facfe]/40 hover:shadow-lg"
                >
                  {orderedCourses.length > 1 && (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${course.courseName} up`}
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:border-[#4facfe] hover:text-[#4facfe] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-gray-200 disabled:hover:text-muted"
                      >
                        <i className="fas fa-chevron-up text-xs" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === orderedCourses.length - 1}
                        aria-label={`Move ${course.courseName} down`}
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:border-[#4facfe] hover:text-[#4facfe] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-gray-200 disabled:hover:text-muted"
                      >
                        <i className="fas fa-chevron-down text-xs" />
                      </button>
                    </div>
                  )}

                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe]">
                    <i className="fas fa-graduation-cap text-xl text-white" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold text-ink">
                      {course.courseName}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                      {course.courseCode && (
                        <span>
                          <i className="fas fa-hashtag mr-1" />
                          {course.courseCode}
                        </span>
                      )}
                      <span>
                        <i className="fas fa-calendar mr-1" />
                        {period || "No sections yet"}
                      </span>
                      {course.nickname && (
                        <span className="rounded-full bg-[#4facfe]/10 px-2 py-0.5 font-medium text-[#2b7fc4]">
                          {course.nickname}
                        </span>
                      )}
                      {isOwner(course) && editingId !== course._id && (
                        <button
                          type="button"
                          onClick={() => setEditingId(course._id)}
                          aria-label={`${course.nickname ? "Edit" : "Add"} nickname for ${course.courseName}`}
                          className="inline-flex items-center gap-1 text-[#4facfe] hover:underline"
                        >
                          <i className="fas fa-pen text-xs" />
                          {course.nickname ? "Edit nickname" : "Add nickname"}
                        </button>
                      )}
                    </div>
                    {editingId === course._id && (
                      <NicknameEditor
                        course={course}
                        onClose={() => setEditingId(null)}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => accessCourse(course)}
                    aria-label={`Access ${course.courseName}`}
                    className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe] px-5 py-2.5 font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_15px_rgba(79,172,254,0.3)]"
                    title="Access Dashboard"
                  >
                    <i className="fas fa-arrow-right" />
                    <span>Access</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="py-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <i className="fas fa-graduation-cap text-2xl text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-ink">
            {isStudent ? "No Course Found" : "No Courses Found"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {isStudent
              ? "You haven't been added to any course yet. Ask your instructor to add you to a course."
              : canCreate
                ? 'You don\'t have any courses set up yet. Please use the "New Course Setup" tab to create your first course.'
                : "You don't have any courses set up yet. Please contact a faculty member to add you to a course."}
          </p>
          {canCreate && (
            <button
              type="button"
              onClick={onSwitchToSetup}
              className={`${continueBtnClass} mt-6 inline-flex items-center gap-2`}
            >
              <i className="fas fa-plus" />
              Create New Course
            </button>
          )}
        </div>
      )}
    </div>
  );
}
