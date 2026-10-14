import { useEffect, useId, useRef, useState } from "react";
import Modal from "../../components/ui/Modal";
import { useGradeExportOverview } from "../../hooks/useQuizzes";
import { downloadGradeCsv } from "../../lib/exports";
import { formatDateTime } from "../../lib/format";

// Download one section's grades as a CSV for Canvas's gradebook import (#126).
// Instructors and admins only; the API refuses anyone else.

function statusLabel(quiz) {
  if (quiz.status === "closed") return `Closed ${formatDateTime(quiz.expireDate)}`;
  if (quiz.status === "open") return `Open until ${formatDateTime(quiz.expireDate)}`;
  return `Opens ${formatDateTime(quiz.releaseDate)}`;
}

function AllQuizzesCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="flex cursor-pointer items-center gap-2 border-b border-gray-100 pb-2 text-sm font-semibold text-ink">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-primary"
      />
      All quizzes
    </label>
  );
}

export default function GradeExportModal({ open, courseId, sections, initialSectionId, onClose }) {
  const sectionSelectId = useId();
  const listId = useId();
  const [sectionId, setSectionId] = useState(initialSectionId || "");
  const [selected, setSelected] = useState(() => new Set());
  const [questionsCorrect, setQuestionsCorrect] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const { data, quizzes, studentCount, isPending, isError } = useGradeExportOverview(
    courseId,
    sectionId,
    { enabled: open }
  );

  // Every quiz starts ticked whenever the section's list (re)loads. Keyed on
  // the response, not on `quizzes`, which is a fresh [] while loading.
  useEffect(() => {
    setSelected(new Set((data?.quizzes || []).map((quiz) => quiz.id)));
  }, [data]);

  const allSelected = quizzes.length > 0 && selected.size === quizzes.length;
  const awaitingReview = quizzes
    .filter((quiz) => selected.has(quiz.id))
    .reduce((sum, quiz) => sum + (quiz.gradesAwaitingReview || 0), 0);

  const toggle = (quizId) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(quizId)) next.delete(quizId);
      else next.add(quizId);
      return next;
    });
  };

  const handleDownload = async () => {
    setError("");
    setDownloading(true);
    try {
      await downloadGradeCsv({
        courseId,
        sectionId,
        // In the dialog's (release) order, which is also the column order.
        quizIds: quizzes.filter((quiz) => selected.has(quiz.id)).map((quiz) => quiz.id),
        questionsCorrect,
      });
    } catch (err) {
      setError(err.message || "Export failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download grades (CSV)"
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={selected.size === 0 || downloading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i
              className={`fas ${downloading ? "fa-circle-notch fa-spin" : "fa-file-csv"} mr-1.5`}
              aria-hidden="true"
            />
            Download CSV
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        One row per student, one column per quiz with the student's score (%), and a GRASP
        average. A quiz a student missed counts as 0 once it closes. Open and upcoming quizzes
        stay blank until the student takes them, and blanks don't count towards the average.
      </p>

      {sections.length > 1 && (
        <div className="mb-4">
          <label htmlFor={sectionSelectId} className="mb-1 block text-sm font-semibold text-ink">
            Section
          </label>
          <select
            id={sectionSelectId}
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            {sections.map((section) => (
              <option key={section.sectionId} value={section.sectionId}>
                {section.sectionNumber || section.sectionId}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">
          Quizzes{!isPending && !isError ? ` (${studentCount} student${studentCount === 1 ? "" : "s"})` : ""}
        </legend>
        {isPending ? (
          <p className="py-4 text-sm text-muted">
            <i className="fas fa-circle-notch fa-spin mr-1.5" aria-hidden="true" />
            Loading quizzes...
          </p>
        ) : isError ? (
          <p role="alert" className="py-4 text-sm text-danger">
            Couldn't load this section's quizzes.
          </p>
        ) : quizzes.length === 0 ? (
          <p className="py-4 text-sm text-muted">
            No published quizzes are scheduled for this section yet.
          </p>
        ) : (
          <div className="space-y-2 rounded-lg border border-gray-200 p-3">
            <AllQuizzesCheckbox
              checked={allSelected}
              indeterminate={selected.size > 0 && !allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(quizzes.map((quiz) => quiz.id)))
              }
            />
            {quizzes.map((quiz) => {
              // The quiz name labels the box; its state describes it.
              const boxId = `${listId}-${quiz.id}`;
              return (
                <div key={quiz.id} className="flex items-start gap-2 text-sm">
                  <input
                    id={boxId}
                    type="checkbox"
                    checked={selected.has(quiz.id)}
                    onChange={() => toggle(quiz.id)}
                    aria-describedby={`${boxId}-status`}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <div>
                    <label htmlFor={boxId} className="cursor-pointer font-medium text-ink">
                      {quiz.name}
                    </label>
                    <span id={`${boxId}-status`} className="block text-xs text-muted">
                      {statusLabel(quiz)}
                      {quiz.gradesAwaitingReview > 0 &&
                        ` · ${quiz.gradesAwaitingReview} disputed AI grade${
                          quiz.gradesAwaitingReview === 1 ? "" : "s"
                        }`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </fieldset>

      <div className="mt-4 flex items-start gap-2 text-sm">
        <input
          id={`${listId}-questions-correct`}
          type="checkbox"
          checked={questionsCorrect}
          onChange={(event) => setQuestionsCorrect(event.target.checked)}
          aria-describedby={`${listId}-questions-correct-note`}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <div>
          <label htmlFor={`${listId}-questions-correct`} className="cursor-pointer font-medium text-ink">
            Include questions correct
          </label>
          <span id={`${listId}-questions-correct-note`} className="block text-xs text-muted">
            Adds a column after each quiz, such as "4 of 5". Leave this off for a file you'll
            upload to Canvas: Canvas can add these as extra gradebook columns.
          </span>
        </div>
      </div>

      {awaitingReview > 0 && (
        <p role="status" className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <i className="fas fa-triangle-exclamation mr-1.5" aria-hidden="true" />
          {awaitingReview === 1
            ? "1 AI grade in the chosen quizzes is still disputed."
            : `${awaitingReview} AI grades in the chosen quizzes are still disputed.`}{" "}
          The file uses the current grades; settle them on Quiz Scores first if you want them final.
        </p>
      )}

      <p className="mt-4 text-sm text-muted">
        To add the grades in Canvas, open Grades, choose Import, and upload this file. Canvas adds
        the GRASP columns the first time; later uploads update them.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
