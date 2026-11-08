// Item analysis (discrimination, point-biserial, KR-20) display pieces
// shared by the Questions and Quizzes tabs.

import { formatStat } from "./format";

const BANDS = {
  good: { label: "Good", className: "bg-success/10 text-success" },
  acceptable: { label: "Acceptable", className: "bg-primary/10 text-primary" },
  moderate: { label: "Moderate", className: "bg-primary/10 text-primary" },
  poor: { label: "Poor", className: "bg-warning/10 text-warning" },
  low: { label: "Low", className: "bg-warning/10 text-warning" },
  negative: { label: "Negative", className: "bg-danger/10 text-danger" },
};

const ITEM_FLAGS = {
  miskeyed: {
    label: "Possibly miskeyed",
    className: "bg-danger/10 text-danger",
    hint: "Stronger students missed it more often than weaker ones. Check the answer key and wording.",
  },
  review: {
    label: "Review",
    className: "bg-warning/10 text-warning",
    hint: "Barely separates stronger from weaker students.",
  },
  "too-easy": {
    label: "Too easy to discriminate",
    className: "bg-gray-100 text-muted",
    hint: "Nearly everyone got it right, so it cannot separate students.",
  },
  "too-hard": {
    label: "Too hard to discriminate",
    className: "bg-warning/10 text-warning",
    hint: "Few students got it right, and not mainly the stronger ones.",
  },
  fair: {
    label: "Acceptable",
    className: "bg-primary/10 text-primary",
    hint: "Separates stronger from weaker students, though only moderately.",
  },
  good: {
    label: "Good item",
    className: "bg-success/10 text-success",
    hint: "Stronger students tend to get it right and weaker students tend to miss it.",
  },
};

const pill = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

// A figure with its band. The band is written out, so colour is never the
// only cue. Stacked puts the band under the figure, for narrow columns.
export function StatWithBand({ value, band, stacked = false }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const style = BANDS[band];
  return (
    <span className={stacked ? "inline-flex flex-col items-start gap-1" : "inline-flex items-center gap-1.5"}>
      <span className="tabular-nums">{formatStat(value)}</span>
      {style && <span className={`${pill} ${style.className}`}>{style.label}</span>}
    </span>
  );
}

export function FlagBadge({ flag }) {
  const style = ITEM_FLAGS[flag];
  if (!style) return <span className="text-muted">—</span>;
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${style.className}`}
      title={style.hint}
    >
      {style.label}
    </span>
  );
}

// Marks a figure from a small group: shown, but to be read with care.
export function LowNNote({ students, lowNBelow }) {
  return (
    <span
      className="mt-0.5 block text-xs text-muted"
      title={`Based on ${students} student${students === 1 ? "" : "s"}. With fewer than ${lowNBelow}, treat it as indicative only.`}
    >
      <i className="fas fa-circle-info mr-1" aria-hidden="true" />
      Low N ({students})
    </span>
  );
}

// The verdicts in the order the explainer lists them, best first.
const VERDICT_GUIDE = [
  {
    flag: "good",
    when: "Point-biserial 0.30 or more (or D 0.30 or more)",
    meaning: "Stronger students tend to get it right and weaker students tend to miss it. Keep it.",
  },
  {
    flag: "fair",
    when: "Point-biserial 0.10–0.30 (or D 0.20–0.30)",
    meaning: "It separates students, but only somewhat.",
  },
  {
    flag: "review",
    when: "Poor discrimination, 30–85% correct",
    meaning: "It barely separates stronger from weaker students. Check the wording and options.",
  },
  {
    flag: "too-easy",
    when: "Poor discrimination, over 85% correct",
    meaning:
      "Nearly everyone gets it right, so it cannot separate anyone. Fine for a warm-up or core-knowledge check.",
  },
  {
    flag: "too-hard",
    when: "Poor discrimination, under 30% correct",
    meaning:
      "Few get it right, and not mainly the stronger students. It may be guessed, confusing, or not yet taught.",
  },
  {
    flag: "miskeyed",
    when: "Point-biserial (or D) below −0.10",
    meaning: "Stronger students miss it more often than weaker ones. Check the answer key first.",
  },
];

export function ItemAnalysisExplainer({ limits }) {
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer font-medium text-primary">What do these statistics mean?</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          Each quiz is analysed on its own: students are ranked by their share of correct answers in
          that quiz, leaving out the question being analysed. For a question used in several quizzes,
          the figures are averaged across them, weighted by students.
        </p>
        <p>
          <strong className="text-ink">Discrimination index (D)</strong> is the share of the top 27% of
          students who got the question right, minus the share of the bottom 27%. 0.30 or more is good,
          0.20–0.30 moderate, below 0.20 poor.
        </p>
        <p>
          <strong className="text-ink">Point-biserial (r<sub>pb</sub>)</strong> is the correlation
          between getting the question right and doing well on the rest of the quiz, using every
          student. Above 0.30 is good, 0.10–0.30 moderate, below 0.10 poor. A clearly negative value
          (below −0.10) means stronger students missed the question more often: check its answer key.
        </p>
        <div>
          <p>
            <strong className="text-ink">Item verdict</strong> sums up a question in one label, from its
            point-biserial (or D when there is none) and the share of students who got it right:
          </p>
          <dl className="mt-2 grid gap-x-3 gap-y-1.5 sm:grid-cols-[auto_1fr]">
            {VERDICT_GUIDE.map(({ flag, when, meaning }) => (
              <div key={flag} className="contents">
                <dt className="sm:pt-0.5">
                  <FlagBadge flag={flag} />
                </dt>
                <dd>
                  <span className="text-ink">{when}.</span> {meaning}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p>
          <strong className="text-ink">KR-20</strong> is the quiz&apos;s reliability (for right/wrong
          questions it equals Cronbach&apos;s alpha). 0.80 or more is good, 0.70–0.80 acceptable. The
          standard error of measurement (SEM) says how far a student&apos;s score might be from their
          true score. The item verdict judges one question (does it separate stronger from weaker
          students?); KR-20 judges the whole quiz (do its questions measure the same thing
          consistently?).
        </p>
        {limits && (
          <p>
            Figures appear from {limits.minStudents} students. Below {limits.lowNBelow} they are marked
            &ldquo;Low N&rdquo; and are indicative only.
          </p>
        )}
      </div>
    </details>
  );
}
