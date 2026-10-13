import Modal from "../../components/ui/Modal";

const FORMATS = [
  { format: "qti", icon: "fa-file-archive", label: "Canvas (QTI)", note: "ZIP format for LMS" },
  { format: "h5p", icon: "fa-cubes", label: "H5P", note: "Interactive quiz" },
  { format: "csv", icon: "fa-file-csv", label: "CSV", note: "Excel / Sheets" },
  { format: "json", icon: "fa-file-code", label: "JSON", note: "Raw Data" },
];

// Which questions the last export left out and why: after a download, or
// instead of one when nothing could be exported.
function LeftOutNotice({ notice }) {
  const { leftOut } = notice;
  const unlisted = leftOut.count - leftOut.questions.length;
  const heading = notice.downloaded
    ? `Downloaded. ${leftOut.count === 1 ? "1 question isn't" : `${leftOut.count} questions aren't`} in the file:`
    : notice.message;
  return (
    <div role="status" className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p className="font-semibold">
        <i className="fas fa-triangle-exclamation mr-1.5" aria-hidden="true" />
        {heading}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {leftOut.questions.map((question, i) => (
          <li key={i}>
            <span className="font-medium">{question.title}</span>: {question.reason}
          </li>
        ))}
      </ul>
      {unlisted > 0 && <p className="mt-2">…and {unlisted} more.</p>}
    </div>
  );
}

export default function ExportQuizModal({ quiz, notice, onClose, onExport }) {
  return (
    <Modal open={!!quiz} onClose={onClose} title="Export Quiz" wide>
      <h3 className="mb-2 text-xl font-semibold text-ink">{quiz?.name}</h3>
      <p className="mb-5 flex items-center gap-2 text-sm text-muted">
        <i className="fas fa-info-circle" />
        Select a format to download your quiz questions.
      </p>
      <p className="mb-3 text-sm font-semibold text-ink">Select Format</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FORMATS.map((option) => (
          <button
            key={option.format}
            type="button"
            onClick={() => onExport(option.format)}
            className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 p-5 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
          >
            <i className={`fas ${option.icon} mb-1 text-2xl text-primary`} />
            <span className="font-semibold text-ink">{option.label}</span>
            <small className="text-muted">{option.note}</small>
          </button>
        ))}
      </div>
      {notice && <LeftOutNotice notice={notice} />}
    </Modal>
  );
}
