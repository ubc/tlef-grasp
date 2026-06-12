import { useMemo } from "react";

// Monday-first monthly calendar with today highlighted (6 rows x 7 days).
export default function Calendar() {
  const today = new Date();
  const month = today.getMonth();
  const year = today.getFullYear();
  const date = today.getDate();

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;

    const result = [];
    for (let i = startOffset - 1; i >= 0; i--) {
      result.push({ day: daysInPrevMonth - i, otherMonth: true });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      result.push({ day, current: day === date });
    }
    let nextDay = 1;
    while (result.length < 42) {
      result.push({ day: nextDay++, otherMonth: true });
    }
    return result;
  }, [year, month, date]);

  const monthLabel = today.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-3 text-center">
        <h4 className="font-semibold text-ink">{monthLabel}</h4>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {cells.map((cell, index) => (
          <span
            key={index}
            className={`rounded-md py-1.5 ${
              cell.current
                ? "bg-primary font-semibold text-white"
                : cell.otherMonth
                  ? "text-gray-300"
                  : "text-ink"
            }`}
          >
            {cell.day}
          </span>
        ))}
      </div>
    </div>
  );
}
