import { useEffect, useRef, useState } from "react";

// Onboarding uses its own blue-gradient visual language, distinct from the app shell.
export const inputClass =
  "w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base text-ink transition-colors placeholder:text-gray-400 focus:border-[#4facfe] focus:outline-none";

export const continueBtnClass =
  "min-w-[140px] rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe] px-6 py-3.5 text-center text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(79,172,254,0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60";

export const backBtnClass =
  "min-w-[140px] rounded-xl border-2 border-gray-200 bg-white px-6 py-3.5 text-base font-semibold text-muted transition-all hover:border-gray-300 hover:text-ink";

export function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function StepIcon({ icon }) {
  return (
    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe]">
      <i className={`fas ${icon} text-3xl text-white`} />
    </div>
  );
}

// Error banner that clears itself after 5 seconds.
export function useTransientError() {
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);

  const showError = (message) => {
    setError(message);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setError(null), 5000);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return [error, showError];
}
