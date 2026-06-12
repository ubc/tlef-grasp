import { useState } from "react";

const DELIVERY_FORMAT_INFO = {
  "all-approved": (
    <>
      <strong>Default.</strong> Delivers every approved question in the quiz, in the
      order they were added. Students see the same set every time — no personalization,
      no spaced repetition.
    </>
  ),
  "spaced-3phase": (
    <>
      Three-phase spaced repetition tailored to each student: (1) one new question per
      granular learning objective, (2) remediation items the student failed in their
      previous quiz, (3) spaced review of previously-mastered objectives.
    </>
  ),
};

export default function DeliveryFormatToggle({ value, onChange }) {
  const [hovered, setHovered] = useState(null);

  return (
    <div className="relative">
      {hovered && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-lg bg-ink p-3 text-xs leading-relaxed text-white shadow-lg">
          {DELIVERY_FORMAT_INFO[hovered]}
        </div>
      )}
      <div className="inline-flex overflow-hidden rounded-lg border border-gray-300">
        {[
          { id: "all-approved", label: "Standard" },
          { id: "spaced-3phase", label: "Adaptive" },
        ].map((format) => (
          <button
            key={format.id}
            type="button"
            onMouseEnter={() => setHovered(format.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(format.id)}
            onBlur={() => setHovered(null)}
            onClick={() => onChange(format.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
              value === format.id
                ? "bg-primary text-white"
                : "bg-white text-muted hover:bg-gray-50"
            }`}
          >
            <span>{format.label}</span>
            <i className="fas fa-info-circle text-xs opacity-70" />
          </button>
        ))}
      </div>
    </div>
  );
}
