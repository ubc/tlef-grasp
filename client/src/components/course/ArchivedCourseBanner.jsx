import { useIsArchivedCourse } from "../../hooks/useCourses";
import { UnarchiveCourseButton } from "./CourseArchiveActions";

// Shown across every page while an archived course is selected. Only the course
// owner can get here at all — the course is gone from everyone else's list and
// the server refuses their requests — so the banner explains the read-only
// state rather than the loss of access, and offers the way back out.
export default function ArchivedCourseBanner() {
  const { isArchived, course } = useIsArchivedCourse();

  if (!isArchived) return null;

  const archivedOn = course?.archivedAt
    ? new Date(course.archivedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-warning/30 bg-warning/10 px-6 py-3"
    >
      <i className="fas fa-box-archive text-lg text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-warning">
          This course is archived and read-only
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {archivedOn ? `Archived on ${archivedOn}. ` : ""}
          Students and co-instructors have no access. You can still read
          everything and export it — unarchive the course to make changes again.
        </p>
      </div>
      <UnarchiveCourseButton course={course} />
    </div>
  );
}
