import Modal from "../../components/ui/Modal";

const FORMATS = [
  { format: "qti", icon: "fa-file-archive", label: "Canvas (QTI)", note: "ZIP format for LMS" },
  { format: "h5p", icon: "fa-cubes", label: "H5P", note: "Interactive quiz" },
  { format: "csv", icon: "fa-file-csv", label: "CSV", note: "Excel / Sheets" },
  { format: "json", icon: "fa-file-code", label: "JSON", note: "Raw Data" },
];

export default function ExportQuizModal({ quiz, onClose, onExport }) {
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
    </Modal>
  );
}
