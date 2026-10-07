import { useRef, useState } from "react";
import { api } from "../lib/api";
import { discardImageFile } from "../lib/questionImages";
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
 *
 * `single` holds at most one image, as an answer option does (issue #146):
 * the add button becomes "Replace image" once one is attached.
 */
export default function QuestionImageField({
  value,
  onChange,
  disabled,
  courseId: courseIdProp,
  single = false,
  captionPlaceholder = "Caption (shown to students; also used as alt text)",
  label = "",
}) {
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
      if (uploaded.length > 0) {
        if (single) {
          // Free the replaced file; the server keeps it while a saved
          // question still uses it.
          images.forEach((img) => discardImageFile(img.fileId));
          onChange(uploaded.slice(-1));
        } else {
          onChange([...images, ...uploaded]);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (fileId) => {
    discardImageFile(fileId);
    onChange(images.filter((img) => img.fileId !== fileId));
  };

  const addLabel =
    images.length === 0 ? "Attach image" : single ? "Replace image" : "Add another image";
  // "Option B image alt text" etc., so each option's controls are told apart.
  const namePrefix = label ? `${label} ` : "";
  // A single image is replaced from its own row, keeping an option compact.
  const replaceInRow = single && images.length > 0;
  const pickButton = (className, text) => (
    <button
      type="button"
      disabled={uploading}
      aria-label={label && !uploading ? `${addLabel} for ${label}` : undefined}
      onClick={() => inputRef.current?.click()}
      className={className}
    >
      <i className={uploading ? "fas fa-spinner fa-spin" : "fas fa-image"} />
      {uploading ? "Uploading..." : text}
    </button>
  );

  const handleCaptionChange = (fileId, caption) => {
    onChange(images.map((img) => (img.fileId === fileId ? { ...img, caption } : img)));
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple={!single}
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
            placeholder={captionPlaceholder}
            aria-label={`${namePrefix}image ${single ? "alt text" : "caption"}`}
            onChange={(event) => handleCaptionChange(img.fileId, event.target.value)}
            className="mt-1 min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-primary focus:outline-none disabled:bg-gray-100"
          />
          {!disabled &&
            replaceInRow &&
            pickButton(
              "mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50",
              "Replace"
            )}
          {!disabled && (
            <button
              type="button"
              title="Remove image"
              aria-label={label ? `Remove the image from ${label}` : undefined}
              onClick={() => handleRemove(img.fileId)}
              className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <i className="fas fa-times" />
            </button>
          )}
        </div>
      ))}

      {!disabled &&
        !replaceInRow &&
        pickButton(
          "inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50",
          addLabel
        )}
    </div>
  );
}
