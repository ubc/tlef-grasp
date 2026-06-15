export function scoreClasses(score) {
  if (score >= 80) return "bg-green-100 text-green-700";
  if (score >= 60) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

export default function ScoreBadge({ score }) {
  if (score === undefined || score === null) {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
        Not Taken
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreClasses(score)}`}
    >
      {Number(score).toFixed(1)}%
    </span>
  );
}
