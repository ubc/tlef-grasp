import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sameMonth(a, b) {
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

function eventAction(event, audience) {
  if (audience === "instructor") {
    return { to: `/quizzes?quiz=${encodeURIComponent(event.quizId)}`, label: "Manage schedule" };
  }
  if (event.status === "completed") {
    return { to: `/quiz?quiz=${encodeURIComponent(event.quizId)}`, label: "Retake quiz" };
  }
  if (event.status === "open") {
    return { to: `/quiz?quiz=${encodeURIComponent(event.quizId)}`, label: "Start quiz" };
  }
  return null;
}

function AgendaEvent({ event, audience }) {
  const action = eventAction(event, audience);
  const time = new Date(event.eventAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const kindLabel = event.type === "deadline" ? "Due" : event.type === "availability" ? "Available now" : "Opens";
  const timing = event.type === "availability"
    ? `until ${new Date(event.expireDate).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })}`
    : `at ${time}`;

  return (
    <li className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            event.type === "deadline" ? "bg-warning" : "bg-primary"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{event.quizName}</p>
          <p className="text-xs text-muted">
            {kindLabel} {timing}
            {event.sectionLabel ? ` · ${event.sectionLabel}` : ""}
          </p>
          <p className="mt-1 text-xs font-medium capitalize text-muted">
            {event.status}
            {audience === "instructor" && !event.published ? " · Draft" : ""}
          </p>
          {action && (
            <Link
              to={action.to}
              className="mt-2 inline-flex text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              {action.label}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

// Compact Monday-first month view. Details live in the selected-day agenda so
// event titles remain usable in the dashboard's narrow right-hand column.
export default function Calendar({
  events = [],
  audience = "student",
  month,
  onMonthChange,
  loading = false,
}) {
  const today = useMemo(() => new Date(), []);
  const visibleMonth = month || today;
  const [selectedDate, setSelectedDate] = useState(today);

  const cells = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      const key = dateKey(event.eventAt);
      if (!map.has(key)) map.set(key, []);
      const dayEvents = map.get(key);
      if (dayEvents.some((candidate) => candidate.id === event.id)) continue;

      // Availability is a synthetic "today" entry. When the quiz also opens
      // or closes today, keep the real schedule event instead of rendering a
      // second card for the same quiz. Do this in the browser's timezone so a
      // UTC date boundary cannot reintroduce the duplicate.
      const sameQuiz = (candidate) => candidate.quizId === event.quizId;
      if (
        event.type === "availability" &&
        dayEvents.some((candidate) => sameQuiz(candidate) && candidate.type !== "availability")
      ) {
        continue;
      }
      if (event.type !== "availability") {
        const availabilityIndex = dayEvents.findIndex(
          (candidate) => sameQuiz(candidate) && candidate.type === "availability"
        );
        if (availabilityIndex !== -1) dayEvents.splice(availabilityIndex, 1);
      }
      dayEvents.push(event);
    }
    return map;
  }, [events]);

  const selectedEvents = eventsByDate.get(dateKey(selectedDate)) || [];
  const monthLabel = visibleMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedLabel = selectedDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const moveMonth = (offset) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setSelectedDate(next);
    onMonthChange?.(next);
  };

  const showToday = () => {
    const next = new Date();
    setSelectedDate(next);
    onMonthChange?.(next);
  };

  return (
    <div aria-label="Quiz calendar">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-page hover:text-ink">
          <i className="fas fa-chevron-left" aria-hidden="true" />
        </button>
        <h4 className="font-semibold text-ink" aria-live="polite">{monthLabel}</h4>
        <button type="button" onClick={() => moveMonth(1)} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-page hover:text-ink">
          <i className="fas fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
      <button type="button" onClick={showToday} className="mx-auto mb-3 block rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/5">
        Today
      </button>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm" role="group" aria-label={`${monthLabel} dates`}>
        {cells.map((cell) => {
          const dayEvents = eventsByDate.get(dateKey(cell)) || [];
          const selected = dateKey(cell) === dateKey(selectedDate);
          const current = dateKey(cell) === dateKey(today);
          const label = cell.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          return (
            <button
              key={dateKey(cell)}
              type="button"
              aria-label={`${label}${dayEvents.length ? `, ${dayEvents.length} quiz event${dayEvents.length === 1 ? "" : "s"}` : ""}`}
              aria-pressed={selected}
              onClick={() => setSelectedDate(cell)}
              className={`relative min-h-10 rounded-md py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
                selected
                  ? "bg-primary font-semibold text-white"
                  : current
                    ? "bg-primary/10 font-semibold text-primary"
                    : sameMonth(cell, visibleMonth)
                      ? "text-ink hover:bg-page"
                      : "text-gray-600 hover:bg-page"
              }`}
            >
              <span>{cell.getDate()}</span>
              {dayEvents.length > 0 && (
                <span className="mt-0.5 flex justify-center gap-0.5" aria-hidden="true">
                  {dayEvents.slice(0, 3).map((event) => (
                    <span key={event.id} className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-white" : event.type === "deadline" ? "bg-warning" : "bg-primary"}`} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5 border-t border-gray-100 pt-4" aria-live="polite">
        <h5 className="text-sm font-semibold text-ink">{selectedLabel}</h5>
        {loading ? (
          <p className="mt-2 text-xs text-muted">Loading quiz events…</p>
        ) : selectedEvents.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No quiz events on this day.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {selectedEvents.map((event) => <AgendaEvent key={event.id} event={event} audience={audience} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
