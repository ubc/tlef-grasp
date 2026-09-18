import { useEffect, useState } from "react";

// Trails `value` by `delay` ms so a search box does not fire a request per
// keystroke. The first render returns the initial value immediately.
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
