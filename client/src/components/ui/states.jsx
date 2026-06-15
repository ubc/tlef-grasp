// Loading / empty placeholders shared across pages.

export function LoadingState({ label = "Loading...", className = "" }) {
  return (
    <div className={`py-16 text-center text-muted ${className}`}>
      <i className="fas fa-spinner fa-spin mb-3 text-2xl" />
      <p>{label}</p>
    </div>
  );
}

export function LoadingRow({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-muted">
      <i className="fas fa-spinner fa-spin text-xl" />
      <span>{label}</span>
    </div>
  );
}

// White card with a large icon, used when a list has nothing to show.
export function EmptyState({ icon = "fa-inbox", title, message, children }) {
  return (
    <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
      <i className={`fas ${icon} mb-4 text-4xl text-gray-300`} />
      {title && <h3 className="text-lg font-semibold text-ink">{title}</h3>}
      {message && <p className="mt-1 text-muted">{message}</p>}
      {children}
    </div>
  );
}
