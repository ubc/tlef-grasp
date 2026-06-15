import { useRef, useState } from "react";
import { useToast } from "../../components/ui/Toast";

const QUICK_TILES = [
  { type: "text", icon: "fa-file-alt", label: "Text" },
  { type: "pdf", icon: "fa-file-pdf", label: "PDF" },
  { type: "url", icon: "fa-link", label: "URL" },
  { type: "panopto", icon: "fa-video", label: "Panopto" },
];

// Drag-and-drop zone plus the quick-add tiles (Text/PDF/URL/Panopto).
export default function UploadSection({ uploading, onFiles, onAddText }) {
  const showToast = useToast();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleTile = (type) => {
    if (type === "text") onAddText();
    else if (type === "pdf") fileInputRef.current?.click();
    else if (type === "url") showToast("URL upload coming soon!", "info");
    else showToast("Panopto integration coming soon!", "info");
  };

  return (
    <div className="mb-8 space-y-5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (!uploading) onFiles(event.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed bg-white p-10 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-gray-300"
        } ${uploading ? "pointer-events-none" : ""}`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <i className="fas fa-spinner fa-spin text-3xl text-primary" />
            <p className="text-muted">Uploading and processing files...</p>
          </div>
        ) : (
          <>
            <i className="fas fa-cloud-upload-alt mb-3 text-4xl text-primary" />
            <p className="mb-4 text-muted">Drag and drop or choose file</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Choose file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {QUICK_TILES.map((tile) => (
          <button
            key={tile.type}
            type="button"
            onClick={() => handleTile(tile.type)}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <i className={`fas ${tile.icon} text-2xl text-primary`} />
            <span className="font-medium text-ink">{tile.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
