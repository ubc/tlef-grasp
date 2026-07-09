import { useRef, useState } from "react";
import Modal from "../../components/ui/Modal";
import {
  MATERIAL_UPLOAD_TYPES,
  SUPPORTED_DOCUMENT_ACCEPT,
} from "../../lib/materials";

// URL ingestion is disabled for privacy reasons — fetching arbitrary external
// pages could leak course context to third parties. Re-enable by adding a
// { type: "url", ... } method tile and restoring the link-add flow.
const METHOD_TILES = [
  {
    type: "file",
    icon: "fa-cloud-upload-alt",
    label: "Upload File",
    hint: "PDF, DOCX, or PowerPoint",
  },
  {
    type: "text",
    icon: "fa-file-alt",
    label: "Text",
    hint: "Paste content directly",
  },
];

const SUPPORTED_FORMATS = Object.values(MATERIAL_UPLOAD_TYPES);

// Panopto stays hidden until there is an integration to connect this flow to.

// Two-step upload modal: pick a method (file upload or pasted text), then the
// file step exposes the drag-and-drop zone for every supported format.
export default function UploadSection({
  open,
  uploading,
  onClose,
  onFiles,
  onAddContent,
}) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  // "choose" shows the method tiles; "file" shows the drop zone.
  const [step, setStep] = useState("choose");

  const handleFiles = (files) => {
    if (!files || files.length === 0) return;
    onFiles(files, null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload Materials"
      wide
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
        >
          Close
        </button>
      }
    >
      {step === "choose" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {METHOD_TILES.map((tile) => (
            <button
              key={tile.type}
              type="button"
              onClick={() =>
                tile.type === "file" ? setStep("file") : onAddContent(tile.type)
              }
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white p-8 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
            >
              <i className={`fas ${tile.icon} text-3xl text-primary`} />
              <span className="font-medium text-ink">{tile.label}</span>
              <span className="text-sm text-muted">{tile.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {!uploading && (
            <button
              type="button"
              onClick={() => setStep("choose")}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              <i className="fas fa-arrow-left" aria-hidden="true" />
              <span>Back</span>
            </button>
          )}

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
              if (!uploading) handleFiles(event.dataTransfer.files);
            }}
            className={`rounded-lg border-2 border-dashed bg-white p-10 text-center transition-colors ${
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
                  accept={SUPPORTED_DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    handleFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </>
            )}
          </div>

          <div className="flex items-center justify-center gap-6 text-sm text-muted">
            <span>Supported formats:</span>
            {SUPPORTED_FORMATS.map((format) => (
              <span key={format.label} className="inline-flex items-center gap-1.5">
                <i className={`fas ${format.icon} text-primary`} aria-hidden="true" />
                {format.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
