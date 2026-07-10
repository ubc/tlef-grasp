import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Display-only renderer for an instructor-attached question image
 * ({ fileId, alt }). Rendered as a dedicated <img> alongside RichText —
 * never embedded in the text itself (RichText escapes HTML).
 *
 * Clicking the image opens a full-screen zoom overlay (close via click,
 * the ✕ button, or Escape).
 */
export default function QuestionImage({ image, className = "" }) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const handleKey = (event) => {
      if (event.key === "Escape") setZoomed(false);
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [zoomed]);

  if (!image?.fileId) return null;

  const src = `/api/image/${image.fileId}`;
  // The instructor caption doubles as alt text (`alt` kept for legacy refs).
  const caption = image.caption || image.alt || "";

  return (
    <>
      <figure className={`my-2 ${className}`}>
        <img
          src={src}
          alt={caption}
          loading="lazy"
          onClick={() => setZoomed(true)}
          title="Click to zoom"
          className="max-h-64 max-w-full cursor-zoom-in rounded-lg border border-gray-200 object-contain transition-opacity hover:opacity-90"
        />
        {caption && (
          <figcaption className="mt-1 text-xs text-muted">{caption}</figcaption>
        )}
      </figure>

      {zoomed &&
        createPortal(
          <div
            className="fixed inset-0 z-[1600] flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
            onClick={() => setZoomed(false)}
          >
            <button
              type="button"
              onClick={() => setZoomed(false)}
              aria-label="Close"
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition-colors hover:bg-white/20"
            >
              <i className="fas fa-times" />
            </button>
            <img
              src={src}
              alt={caption}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[85vh] max-w-[92vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
            />
            {caption && (
              <p
                onClick={(event) => event.stopPropagation()}
                className="max-w-[92vw] text-center text-sm text-white/90"
              >
                {caption}
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
