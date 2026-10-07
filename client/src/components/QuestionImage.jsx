import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { questionImageSrc } from "../lib/questionImages";

// The instructor caption doubles as alt text (`alt` kept for legacy refs).
const captionOf = (image) => image.caption || image.alt || "";

/**
 * Full-screen zoom of one question image (close via click, the ✕ button, or
 * Escape). `showCaption` is false for option images, whose caption is alt
 * text only (issue #146).
 */
export function ImageZoomOverlay({ image, showCaption = true, onClose }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const caption = captionOf(image);

  return createPortal(
    <div
      className="fixed inset-0 z-[1600] flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition-colors hover:bg-white/20"
      >
        <i className="fas fa-times" />
      </button>
      <img
        src={questionImageSrc(image)}
        alt={caption}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] max-w-[92vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
      {showCaption && caption && (
        <p
          onClick={(event) => event.stopPropagation()}
          className="max-w-[92vw] text-center text-sm text-white/90"
        >
          {caption}
        </p>
      )}
    </div>,
    document.body
  );
}

/**
 * Display-only renderer for an instructor-attached question image
 * ({ fileId, caption }). Rendered as a dedicated <img> alongside RichText —
 * never embedded in the text itself (RichText escapes HTML).
 *
 * Clicking the image opens a full-screen zoom overlay. An option image passes
 * `showCaption={false}`: its caption is alt text only, since a visible one
 * could name the answer (issue #146).
 */
export default function QuestionImage({ image, className = "", showCaption = true }) {
  const [zoomed, setZoomed] = useState(false);

  if (!image?.fileId) return null;

  const caption = captionOf(image);

  return (
    <>
      <figure className={`my-2 ${className}`}>
        <img
          src={questionImageSrc(image)}
          alt={caption}
          loading="lazy"
          onClick={() => setZoomed(true)}
          title="Click to zoom"
          className="max-h-64 max-w-full cursor-zoom-in rounded-lg border border-gray-200 object-contain transition-opacity hover:opacity-90"
        />
        {showCaption && caption && (
          <figcaption className="mt-1 text-xs text-muted">{caption}</figcaption>
        )}
      </figure>

      {zoomed && (
        <ImageZoomOverlay
          image={image}
          showCaption={showCaption}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}
