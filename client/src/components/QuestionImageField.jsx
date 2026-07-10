import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./ui/Toast";
import { useSelectedCourseId } from "../stores/appStore";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // matches server limit

/**
 * Attach-images control for a question stem. Holds an array of image refs
 * ({ fileId, filename, mimeType, size }); multiple images can be attached.
 * Uploads happen immediately on file select. Renders thumbnails with a
 * corner remove button plus a dashed "add" tile.
 */
export default function QuestionImageField({ value, onChange, disabled, courseId: courseIdProp }) {
  const showToast = useToast();
  const selectedCourseId = useSelectedCourseId();
  const courseId = courseIdProp || selectedCourseId;
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const images = Array.isArray(value) ? value : value ? [value] : [];

  const handleFilesSelected = async (event) => {
    const files = Array.from(event.target.files || []);
    // Reset so selecting the same file again re-triggers onChange.
    event.target.value = "";
    if (files.length === 0) return;
    if (!courseId) {
      showToast("Select a course before attaching images.", "warning");
      return;
    }

    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          showToast(`${file.name}: unsupported type. Use PNG, JPEG, GIF, or WebP.`, "warning");
          continue;
        }
        if (file.size > MAX_SIZE_BYTES) {
          showToast(`${file.name}: too large (max 5 MB).`, "warning");
          continue;
        }
        const formData = new FormData();
        formData.append("image", file);
        formData.append("courseId", courseId);
        try {
          const data = await api.post("/api/image/upload", formData);
          uploaded.push(data.image);
        } catch (error) {
          showToast(error.message || `Failed to upload ${file.name}`, "error");
        }
      }
      if (uploaded.length > 0) onChange([...images, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (fileId) => {
    if (fileId) {
      // Best-effort: frees storage when the image was never saved on a
      // question. Saved questions clean up their own images server-side.
      api.delete(`/api/image/${fileId}`).catch(() => {});
    }
    onChange(images.filter((img) => img.fileId !== fileId));
  };

  const handleCaptionChange = (fileId, caption) => {
    onChange(images.map((img) => (img.fileId === fileId ? { ...img, caption } : img)));
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={handleFilesSelected}
      />

      {images.map((img) => (
        <div
          key={img.fileId}
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2"
        >
          <img
            src={`/api/image/${img.fileId}`}
            alt={img.caption || img.alt || ""}
            className="h-16 w-16 shrink-0 rounded border border-gray-200 bg-white object-contain"
          />
          <input
            type="text"
            value={img.caption ?? img.alt ?? ""}
            disabled={disabled}
            placeholder="Caption (shown to students; also used as alt text)"
            onChange={(event) => handleCaptionChange(img.fileId, event.target.value)}
            className="mt-1 min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-primary focus:outline-none disabled:bg-gray-100"
          />
          {!disabled && (
            <button
              type="button"
              title="Remove image"
              onClick={() => handleRemove(img.fileId)}
              className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <i className="fas fa-times" />
            </button>
          )}
        </div>
      ))}

      {!disabled && (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className={uploading ? "fas fa-spinner fa-spin" : "fas fa-image"} />
          {uploading ? "Uploading..." : images.length > 0 ? "Add another image" : "Attach image"}
        </button>
      )}
    </div>
  );
}
