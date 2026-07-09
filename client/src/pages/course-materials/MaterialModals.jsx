import { useId, useState } from "react";
import Modal from "../../components/ui/Modal";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none";
const btnSecondary =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50";
const btnPrimary =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60";

const MODAL_TITLES = {
  "text-add": "Add Text Content",
  "link-add": "Add URL",
  "text-edit": "Edit Textbook",
  "pdf-edit": "Edit PDF",
  "link-edit": "Edit Link",
  "file-edit": "Edit Material",
};

// Add/edit form for text, link and uploaded-file materials. Mount it only while open —
// the form state initializes from the material being edited.
export function MaterialFormModal({ kind, material, busy, onClose, onSubmit }) {
  const [title, setTitle] = useState(material?.documentTitle || "");
  const [content, setContent] = useState(
    kind === "text-edit" || kind === "link-edit" ? material?.fileContent || "" : ""
  );

  const isText = kind === "text-add" || kind === "text-edit";
  const isLink = kind === "link-add" || kind === "link-edit";
  const titleFieldId = useId();
  const contentFieldId = useId();

  return (
    <Modal
      open
      onClose={onClose}
      title={MODAL_TITLES[kind]}
      wide={isText}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSubmit({ title: title.trim(), content: content.trim() })}
            className={btnPrimary}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      <label htmlFor={titleFieldId} className="mb-1 block text-sm font-semibold text-ink">
        Document Title:
      </label>
      <input
        id={titleFieldId}
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Enter document title..."
        className={inputClass}
      />

      {isText && (
        <>
          <label htmlFor={contentFieldId} className="mt-4 mb-1 block text-sm font-semibold text-ink">
            {kind === "text-add"
              ? "Paste your text content:"
              : "Edit your text content:"}
          </label>
          <textarea
            id={contentFieldId}
            rows={kind === "text-add" ? 10 : 15}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste your text content here..."
            className={inputClass}
          />
        </>
      )}

      {isLink && (
        <>
          <label htmlFor={contentFieldId} className="mt-4 mb-1 block text-sm font-semibold text-ink">URL:</label>
          <input
            id={contentFieldId}
            type="url"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="https://example.com"
            className={inputClass}
          />
        </>
      )}
    </Modal>
  );
}

export function DeleteMaterialModal({ material, onClose, onConfirm }) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Material"
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85"
          >
            Delete
          </button>
        </>
      }
    >
      <p className="text-ink">
        Are you sure you want to delete this material? This action cannot be undone.
      </p>
      <p className="mt-2 font-semibold text-ink">
        {material?.documentTitle || "Untitled"}
      </p>
    </Modal>
  );
}
