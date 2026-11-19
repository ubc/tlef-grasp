import { useEffect, useLayoutEffect, useRef } from "react";

// A textarea that grows with its content, so multi-line text (e.g. a prompt or
// an answer option imported from Canvas) is visible in full and its line
// breaks survive an edit, which an <input> would strip. rows is the minimum
// height. Any other props go to the <textarea>.
//
// Dragging the corner to make it taller sticks: typing grows it past that
// height but never shrinks it back below.
export default function AutoHeightTextarea({ value, rows = 2, ...props }) {
  const ref = useRef(null);
  const fittedHeight = useRef(0);
  const draggedHeight = useRef(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    // Not laid out (inside something hidden): leave rows to set the height.
    if (element.scrollHeight === 0) return;
    // scrollHeight leaves out the borders, which box-sizing: border-box counts.
    const fit = element.scrollHeight + element.offsetHeight - element.clientHeight;
    fittedHeight.current = Math.max(fit, draggedHeight.current);
    element.style.height = `${fittedHeight.current}px`;
  }, [value]);
  // Any height other than the one set above came from the drag handle.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      if (height && height !== fittedHeight.current) draggedHeight.current = height;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <textarea ref={ref} rows={rows} value={value} {...props} />;
}
