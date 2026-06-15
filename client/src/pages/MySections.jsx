import { useMemo, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import { useAcademicPeriods, useInstructorSections } from "../hooks/useUbc";
import {
  useCourse,
  useMyCourseSections,
  useAddSections,
  useRecycleSection,
} from "../hooks/useSections";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import { LoadingState, EmptyState } from "../components/ui/states";

// Convert a bare academic-period code (e.g. "2025W1") to a readable label.
function prettyPeriod(section) {
  if (section.academicPeriodName) return section.academicPeriodName;
  const code = section.academicPeriod || "";
  if (code.length >= 5) {
    const year = code.substring(0, 4);
    const term = code.substring(4);
    if (term.startsWith("W")) return `${year} Winter${term.substring(1)}`;
    if (term.startsWith("S")) return `${year} Summer${term.substring(1)}`;
  }
  return code || "Unknown";
}

const headClass =
  "border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted";
const cellClass = "border-b border-gray-100 px-4 py-3 text-sm";

export default function MySections() {
  const showToast = useToast();
  const courseId = useSelectedCourseId();

  const { course, isPending: coursePending } = useCourse(courseId);
  const { sections: mySections, isPending: sectionsPending } =
    useMyCourseSections(courseId);

  // Add-section form state
  const [period, setPeriod] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [syncStudents, setSyncStudents] = useState(false);
  const [recycleTarget, setRecycleTarget] = useState(null);

  const { periods } = useAcademicPeriods(course?.campus);
  const { sections: instructorSections, isPending: instructorLoading } =
    useInstructorSections(period);

  const periodName = useMemo(
    () => periods.find((p) => p.key === period)?.title || "",
    [periods, period]
  );

  // Sections selectable to add: same UBC course as this shell, not already added.
  const availableSections = useMemo(() => {
    const existing = new Set(mySections.map((s) => s.sectionId));
    const expected = course?.ubcCourseId;
    return instructorSections.filter((s) => {
      const sectionCourseId = `${s.courseSubject}|${s.courseNumber}`;
      const sameCourse =
        !expected || sectionCourseId === expected || s.ubcCourseId === expected;
      return sameCourse && !existing.has(s.key);
    });
  }, [instructorSections, mySections, course]);

  const addMutation = useAddSections(courseId, {
    onSuccess: (_data, variables) => {
      showToast(
        `Successfully added ${variables.sectionIds.length} section(s).`,
        "success"
      );
      setPeriod("");
      setSelectedIds([]);
      setSyncStudents(false);
    },
    onError: (error) => showToast(error.message || "Failed to add sections", "error"),
  });

  const recycleMutation = useRecycleSection(courseId, {
    onSuccess: () => showToast("Section recycled and removed.", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to recycle section", "error"),
  });

  const toggleSection = (key) =>
    setSelectedIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const handleAdd = (event) => {
    event.preventDefault();
    if (!period || selectedIds.length === 0) return;
    addMutation.mutate({
      sectionIds: selectedIds,
      academicPeriod: period,
      academicPeriodName: periodName,
      syncStudents,
    });
  };

  if (!courseId) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <h1 className="mb-6 text-2xl font-bold text-ink">My Sections</h1>
        <EmptyState
          icon="fa-book"
          title="No course selected"
          message="Select a course from the sidebar to manage its sections."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="mb-2 text-2xl font-bold text-ink">My Sections</h1>
      <p className="mb-6 text-muted">
        Manage the UBC sections linked to{" "}
        <span className="font-semibold text-ink">
          {course?.courseName || "this course"}
        </span>
        .
      </p>

      {/* Add sections */}
      <section className="mb-8 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          <i className="fas fa-plus mr-2 text-primary" />
          Add sections
        </h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label
              htmlFor="add-academic-period"
              className="mb-1 block text-sm font-semibold text-ink"
            >
              Academic period
            </label>
            <select
              id="add-academic-period"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                setSelectedIds([]);
              }}
              disabled={!course}
              className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100"
            >
              <option value="">Select academic period…</option>
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          {period && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-ink">
                Available sections
              </label>
              {instructorLoading ? (
                <p className="text-sm text-muted">
                  <i className="fas fa-spinner fa-spin mr-2" /> Loading sections…
                </p>
              ) : availableSections.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-muted">
                  No new sections available for this course in the selected period.
                </p>
              ) : (
                <div className="max-h-56 max-w-md space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
                  {availableSections.map((s) => (
                    <label
                      key={s.key}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(s.key)}
                        onChange={() => toggleSection(s.key)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm text-ink">{s.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={syncStudents}
              onChange={(event) => setSyncStudents(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Sync students from these section(s)
          </label>

          <button
            type="submit"
            disabled={!period || selectedIds.length === 0 || addMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {addMutation.isPending ? (
              <>
                <i className="fas fa-spinner fa-spin" /> Adding…
              </>
            ) : (
              <>
                <i className="fas fa-plus" /> Add Section(s)
              </>
            )}
          </button>
        </form>
      </section>

      {/* Current sections */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <h2 className="border-b border-gray-100 px-6 py-4 text-lg font-semibold text-ink">
          Linked sections
        </h2>
        {coursePending || sectionsPending ? (
          <LoadingState label="Loading sections..." />
        ) : mySections.length === 0 ? (
          <EmptyState
            icon="fa-layer-group"
            title="No sections linked"
            message="Add a UBC section above to start syncing students into this course."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr>
                  <th className={headClass}>Academic Period</th>
                  <th className={headClass}>Section</th>
                  <th className={`${headClass} w-32`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mySections.map((section) => (
                  <tr key={section.sectionId} className="hover:bg-gray-50">
                    <td className={`${cellClass} font-medium text-ink`}>
                      {prettyPeriod(section)}
                    </td>
                    <td className={cellClass}>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {section.sectionNumber || section.sectionId}
                      </span>
                    </td>
                    <td className={cellClass}>
                      <button
                        type="button"
                        onClick={() => setRecycleTarget(section)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5"
                      >
                        <i className="fas fa-recycle" /> Recycle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={!!recycleTarget}
        onClose={() => setRecycleTarget(null)}
        onConfirm={() => recycleMutation.mutate(recycleTarget.sectionId)}
        title="Recycle Section"
        message="Recycling removes this section's link from the course and its synced students. This cannot be undone. Continue?"
        confirmLabel="Recycle"
        danger
      />
    </div>
  );
}
