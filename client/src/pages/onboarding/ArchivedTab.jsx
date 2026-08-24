import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useArchivedCourses } from "../../hooks/useCourses";
import { UnarchiveCourseButton } from "../../components/course/CourseArchiveActions";
import { StepIcon } from "./shared";

// The owner's way back into a soft-deleted course. Archived courses are gone
// from /api/courses/my and from the sidebar switcher, so this tab is the only
// route to them — hence both actions live here: open it read-only, or restore
// it outright.
export default function ArchivedTab() {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const { courses, isPending } = useArchivedCourses();

  const openCourse = (course) => {
    setSelectedCourse({ id: course.id, name: course.name });
    navigate("/dashboard");
  };

  const formatDate = (value) =>
    value
      ? new Date(value).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <div className="text-center">
      <StepIcon icon="fa-box-archive" />
      <h2 className="text-2xl font-bold text-ink">Archived Courses</h2>
      <p className="mt-1 mb-8 text-muted">
        Archived courses are read-only and hidden from students and
        co-instructors. Nothing has been deleted — restore one at any time.
      </p>

      {isPending ? (
        <div className="flex items-center justify-center gap-3 py-8 text-muted">
          <i className="fas fa-spinner fa-spin text-xl" />
          <span>Loading archived courses...</span>
        </div>
      ) : courses.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-10 text-muted">
          <i className="fas fa-box-open mb-3 block text-3xl text-gray-300" />
          You have no archived courses.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {courses.map((course) => (
            <div
              key={course.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-gray-100 bg-white p-5 text-left"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-200">
                <i className="fas fa-box-archive text-xl text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-ink">
                  {course.name}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  {course.courseCode && (
                    <span>
                      <i className="fas fa-hashtag mr-1" />
                      {course.courseCode}
                    </span>
                  )}
                  {formatDate(course.archivedAt) && (
                    <span>
                      <i className="fas fa-calendar mr-1" />
                      Archived {formatDate(course.archivedAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openCourse(course)}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  <i className="fas fa-eye" />
                  <span>View</span>
                </button>
                <UnarchiveCourseButton
                  course={course}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_15px_rgba(79,172,254,0.3)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
