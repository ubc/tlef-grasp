// Components shared by the Analytics tabs.

import { percent } from "./format";

export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// Share-correct bar. The number is always printed beside it, so the bar is
// decoration and the figure stays readable without colour.
export function CorrectBar({ pValue }) {
  if (pValue === null) return <span className="text-muted">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(pValue * 100)}%` }} />
      </div>
      <span className="tabular-nums">{percent(pValue)}</span>
    </div>
  );
}

export function LoadError() {
  return (
    <div role="alert" className="rounded-2xl bg-white py-16 text-center shadow-sm">
      <i className="fas fa-triangle-exclamation mb-4 text-4xl text-gray-300" />
      <h2 className="text-lg font-semibold text-ink">Could not load analytics</h2>
      <p className="mt-1 text-muted">Please try again in a moment.</p>
    </div>
  );
}
