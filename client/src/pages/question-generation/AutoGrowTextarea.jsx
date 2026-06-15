import { useEffect, useRef, useState } from "react";

// Auto-growing textarea used for inline title/granular editing.
export default function AutoGrowTextarea({ value, onCommit, className = "", placeholder }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.target.blur();
        }
      }}
      className={`w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 leading-snug transition-colors focus:border-gray-300 focus:bg-white focus:shadow-inner focus:outline-none ${className}`}
    />
  );
}
