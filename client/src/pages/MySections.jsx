import { useMemo, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import { useAcademicPeriods, useInstructorSections } from "../hooks/useUbc";
import {
  useCourse,
  useCourseSections,
  useMyCourseSections,
  useAddSections,
  useRecycleSection,
  useSyncSectionStudents,
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
  // All sections already linked to the course (by any instructor). Used only to
  // infer the academic period the course runs in, so a co-instructor who hasn't
  // linked a section yet doesn't have to re-pick it.
  const { sections: allCourseSections } = useCourseSections(courseId);

  // Add-section form state
  const [period, setPeriod] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [syncStudents, setSyncStudents] = useState(false);
  const [recycleTarget, setRecycleTarget] = useState(null);

  // If sections are already linked, infer the academic period from them — no need
  // to ask. Prefer the viewer's own linked sections, but fall back to any section
  // already linked to the course (e.g. by the owner) so a newly-added co-instructor
  // inherits the course's period instead of being prompted to choose it.
  const periodSource =
    mySections.length > 0 ? mySections[0] : allCourseSections[0] || null;
  const inferredPeriod = periodSource?.academicPeriod || null;
  const inferredPeriodName = periodSource
    ? periodSource.academicPeriodName || prettyPeriod(periodSource)
    : null;
  const effectivePeriod = inferredPeriod || period;

  const { periods } = useAcademicPeriods(course?.campus);
  const { sections: instructorSections, isPending: instructorLoading } =
    useInstructorSections(effectivePeriod);

  const periodName = useMemo(
    () => inferredPeriodName || periods.find((p) => p.key === period)?.title || "",
    [inferredPeriodName, periods, period]
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

  const syncMutation = useSyncSectionStudents(courseId, {
    onSuccess: (data) =>
      showToast(
        `Students synced${data?.syncResult?.added != null ? ` — ${data.syncResult.added} added` : ""}.`,
        "success"
      ),
    onError: (error) =>
      showToast(error.message || "Failed to sync students", "error"),
  });

  const toggleSection = (key) =>
    setSelectedIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const handleAdd = (event) => {
    event.preventDefault();
    if (!effectivePeriod || selectedIds.length === 0) return;
    addMutation.mutate({
      sectionIds: selectedIds,
      academicPeriod: effectivePeriod,
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
      <section className="mb-8 rounded-2xl bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-ink">
            <i className="fas fa-plus mr-2 text-primary" />
            Add sections
          </h2>
        </div>
        <form onSubmit={handleAdd} className="p-6 space-y-5">
          {inferredPeriod ? (
            <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <i className="fas fa-calendar-check text-primary" />
              <p className="text-sm text-ink">
                Showing sections for{" "}
                <span className="font-semibold">{periodName}</span>
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="add-academic-period"
                className="mb-1.5 block text-sm font-semibold text-ink"
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
                className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-50"
              >
                <option value="">Select academic period…</option>
                {periods.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {effectivePeriod && (
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink">
                Select sections to add
              </label>
              {instructorLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-5 text-sm text-muted">
                  <i className="fas fa-spinner fa-spin text-primary" /> Loading sections…
                </div>
              ) : availableSections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-muted">
                  <i className="fas fa-inbox mb-1.5 block text-2xl text-gray-300" />
                  No new sections available for this course in the selected period.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-gray-200">
                  {availableSections.map((s, idx) => {
                    const checked = selectedIds.includes(s.key);
                    return (
                      <label
                        key={s.key}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 ${
                          idx !== 0 ? "border-t border-gray-100" : ""
                        } ${checked ? "bg-blue-50/60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSection(s.key)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="text-sm font-medium text-ink">{s.title}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">Sync students</p>
              <p className="text-xs text-muted">Enrol students from the selected section(s) into this course</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Sync students"
              aria-checked={syncStudents}
              onClick={() => setSyncStudents((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                syncStudents ? "bg-primary" : "bg-gray-200"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  syncStudents ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            {selectedIds.length > 0 && (
              <span className="text-sm text-muted">
                <span className="font-semibold text-ink">{selectedIds.length}</span> section{selectedIds.length !== 1 ? "s" : ""} selected
              </span>
            )}
            <button
              type="submit"
              disabled={!effectivePeriod || selectedIds.length === 0 || addMutation.isPending}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {addMutation.isPending ? (
                <><i className="fas fa-spinner fa-spin" /> Adding…</>
              ) : (
                <><i className="fas fa-plus" /> Add Section{selectedIds.length !== 1 ? "s" : ""}</>
              )}
            </button>
          </div>
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
                  <th className={headClass}>Actions</th>
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
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={syncMutation.isPending && syncMutation.variables?.sectionId === section.sectionId}
                          onClick={() =>
                            syncMutation.mutate({
                              sectionId: section.sectionId,
                              academicPeriod: section.academicPeriod,
                              academicPeriodName: section.academicPeriodName || prettyPeriod(section),
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                        >
                          {syncMutation.isPending && syncMutation.variables?.sectionId === section.sectionId ? (
                            <><i className="fas fa-spinner fa-spin" /> Syncing…</>
                          ) : (
                            <><i className="fas fa-rotate" /> Sync Students</>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRecycleTarget(section)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5"
                        >
                          <i className="fas fa-recycle" /> Recycle
                        </button>
                      </div>
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
