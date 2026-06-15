import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import {
  useCampuses,
  useAcademicPeriods,
  useInstructorSections,
  useCreateUbcCourse,
} from "../../hooks/useUbc";
import Modal from "../../components/ui/Modal";
import {
  StepIcon,
  ErrorMessage,
  useTransientError,
  inputClass,
  continueBtnClass,
} from "./shared";

// Instructor course setup via the UBC course API:
// Campus -> Academic Period -> the instructor's CWL-attached sections.
export default function SetupWizard() {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const [error, showError] = useTransientError();

  const [campus, setCampus] = useState("");
  const [academicPeriod, setAcademicPeriod] = useState("");
  const [selectedSectionIds, setSelectedSectionIds] = useState([]);
  const [syncStudents, setSyncStudents] = useState(false);
  const [complete, setComplete] = useState(false);
  // Pending payload + conflict info when a matching shell already exists (409)
  const [existingShell, setExistingShell] = useState(null);

  const { campuses, isPending: campusesLoading } = useCampuses();
  const { periods, isPending: periodsLoading } = useAcademicPeriods(campus);
  const { sections, isPending: sectionsLoading } =
    useInstructorSections(academicPeriod);

  const academicPeriodName = useMemo(
    () => periods.find((p) => p.key === academicPeriod)?.title || "",
    [periods, academicPeriod]
  );

  const createMutation = useCreateUbcCourse();

  const canCreate =
    !!campus && !!academicPeriod && selectedSectionIds.length > 0;

  const handleCampusChange = (value) => {
    setCampus(value);
    setAcademicPeriod("");
    setSelectedSectionIds([]);
  };

  const handlePeriodChange = (value) => {
    setAcademicPeriod(value);
    setSelectedSectionIds([]);
  };

  const toggleSection = (key) => {
    setSelectedSectionIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const submit = (force) => {
    createMutation.mutate(
      {
        campus,
        academicPeriod,
        academicPeriodName,
        sectionIds: selectedSectionIds,
        syncStudents,
        force,
      },
      {
        onSuccess: (data) => {
          setExistingShell(null);
          setSelectedCourse({ id: data.course._id, name: data.course.courseName });
          setComplete(true);
        },
        onError: (err) => {
          // 409: a course shell already exists for this section/course
          if (err.status === 409 && err.body?.error === "existing_shell") {
            setExistingShell(err.body.existing || {});
            return;
          }
          showError(err.message || "Failed to create course.");
        },
      }
    );
  };

  if (complete) {
    return (
      <div className="text-center">
        <div className="mb-5">
          <i className="fas fa-check-circle text-7xl text-success" />
        </div>
        <h2 className="text-2xl font-bold text-ink">Welcome to GRASP!</h2>
        <p className="mx-auto mt-2 mb-8 max-w-md text-muted">
          Your course has been set up from your UBC section(s). You can now start
          uploading materials and generating questions.
        </p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className={continueBtnClass}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <StepIcon icon="fa-graduation-cap" />
      <h2 className="text-2xl font-bold text-ink">Set up your course</h2>
      <p className="mt-1 mb-8 text-muted">
        Create a GRASP course from your UBC course sections.
      </p>

      <ErrorMessage message={error} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canCreate) {
            showError("Select a campus, academic period, and at least one section.");
            return;
          }
          submit(false);
        }}
        className="mx-auto max-w-md space-y-5 text-left"
      >
        {/* Campus */}
        <div>
          <label htmlFor="setup-campus" className="mb-2 block font-semibold text-ink">
            Campus
          </label>
          <select
            id="setup-campus"
            value={campus}
            onChange={(event) => handleCampusChange(event.target.value)}
            className={inputClass}
          >
            <option value="">
              {campusesLoading ? "Loading campuses…" : "Select campus…"}
            </option>
            {campuses.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Academic period */}
        <div>
          <label
            htmlFor="setup-academic-period"
            className="mb-2 block font-semibold text-ink"
          >
            Academic period
          </label>
          <select
            id="setup-academic-period"
            value={academicPeriod}
            onChange={(event) => handlePeriodChange(event.target.value)}
            disabled={!campus}
            className={`${inputClass} disabled:cursor-not-allowed disabled:bg-gray-100`}
          >
            <option value="">
              {!campus
                ? "Select campus first"
                : periodsLoading
                  ? "Loading…"
                  : "Select academic period…"}
            </option>
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {/* Sections */}
        <div>
          <label className="mb-2 block font-semibold text-ink">
            Your sections
          </label>
          {!academicPeriod ? (
            <p className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-3 text-sm text-muted">
              Select an academic period to see your sections.
            </p>
          ) : sectionsLoading ? (
            <p className="px-1 py-2 text-sm text-muted">
              <i className="fas fa-spinner fa-spin mr-2" /> Loading sections…
            </p>
          ) : sections.length === 0 ? (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
              No sections found for your CWL in this period. If you believe this is
              wrong, contact lt.hub@ubc.ca.
            </p>
          ) : (
            <>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border-2 border-gray-200 p-3">
                {sections.map((s) => (
                  <label
                    key={s.key}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSectionIds.includes(s.key)}
                      onChange={() => toggleSection(s.key)}
                      className="h-4 w-4 accent-[#4facfe]"
                    />
                    <span className="text-sm text-ink">{s.title}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Select one or more sections. All selected sections must belong to the
                same course.
              </p>
            </>
          )}
        </div>

        {/* Sync students */}
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={syncStudents}
            onChange={(event) => setSyncStudents(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#4facfe]"
          />
          <span className="text-sm text-ink">
            Sync students from the selected section(s) now
            <span className="block text-xs text-muted">
              You can also sync later from the Users page.
            </span>
          </span>
        </label>

        <div className="pt-2 text-center">
          <button
            type="submit"
            disabled={!canCreate || createMutation.isPending}
            className={continueBtnClass}
          >
            {createMutation.isPending ? (
              <>
                <i className="fas fa-spinner fa-spin mr-2" /> Creating…
              </>
            ) : (
              "Create Course"
            )}
          </button>
        </div>
      </form>

      {/* Existing-shell conflict */}
      <Modal
        open={!!existingShell}
        onClose={() => setExistingShell(null)}
        title="A course shell already exists"
        footer={
          <>
            <button
              type="button"
              onClick={() => setExistingShell(null)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => submit(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {createMutation.isPending ? "Creating…" : "Create anyway"}
            </button>
          </>
        }
      >
        <p className="text-ink">
          A course shell named{" "}
          <strong>{existingShell?.courseName || "this course"}</strong> already exists
          for the selected section(s). You can ask one of its instructors to add you,
          or create a separate shell anyway.
        </p>
        {existingShell?.instructors?.length > 0 && (
          <div className="mt-3">
            <div className="text-sm font-semibold text-ink">Current instructors</div>
            <ul className="mt-1 list-disc pl-5 text-sm text-muted">
              {existingShell.instructors.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
