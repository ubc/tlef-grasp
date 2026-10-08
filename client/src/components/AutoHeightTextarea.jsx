import { useLayoutEffect, useRef } from "react";

// A textarea that grows with its content, so multi-line text (e.g. a prompt or
// an answer option imported from Canvas) is visible in full and its line
// breaks survive an edit, which an <input> would strip. rows is the minimum
// height. Any other props go to the <textarea>.
export default function AutoHeightTextarea({ value, rows = 2, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    // Not laid out (inside something hidden): leave rows to set the height.
    if (element.scrollHeight === 0) return;
    // scrollHeight leaves out the borders, which box-sizing: border-box counts.
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={rows} value={value} {...props} />;
}
