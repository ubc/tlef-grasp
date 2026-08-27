import { BLOOM_LEVELS } from "../lib/constants";
import { BLOOM_BADGE_COLORS, BLOOM_LEVEL_GUIDE } from "../lib/bloom";

// Students never see a question's Bloom label while taking a quiz (StudentQuiz
// gates that panel behind isPrivileged), so the dashboard is the one place the
// framework behind their quizzes gets explained. Collapsed by default like the
// other dashboard guides, but the one-line summary stays visible so the gist
// never depends on opening it — or on hovering, which touch devices and
// keyboard users cannot do.
export default function BloomTaxonomyGuide() {
  return (
    <details className="rounded-2xl bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-6 py-5 font-semibold text-ink marker:hidden">
        <span className="flex items-center justify-between gap-4">
          <span><i className="fas fa-brain mr-2 text-primary" aria-hidden="true" />What is Bloom's Taxonomy?</span>
          <i className="fas fa-chevron-down text-sm text-muted" aria-hidden="true" />
        </span>
        <span className="mt-1 block text-sm font-normal leading-relaxed text-muted">
          Six levels of thinking, from recalling a fact to designing something new.
        </span>
      </summary>
      <div className="border-t border-gray-100 px-6 py-5 text-sm leading-relaxed text-gray-600">
        <p className="mb-5">
          Your instructor tags every quiz question with one of these six levels. They build on
          each other, so a quiz can check whether you can <em>use</em> an idea rather than only
          repeat it. Knowing which level a question aims at tells you how to study for it.
        </p>
        <ol className="space-y-4">
          {BLOOM_LEVELS.map((level, index) => (
            <li key={level} className="flex gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden="true">{index + 1}</span>
              <div>
                <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${BLOOM_BADGE_COLORS[level]}`}>{level}</span>
                <p className="mt-1.5 text-ink">{BLOOM_LEVEL_GUIDE[level].summary}</p>
                <p className="mt-0.5">For example: {BLOOM_LEVEL_GUIDE[level].example}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-5 rounded-lg bg-primary/5 p-4">
          <h4 className="font-semibold text-ink">How to use this</h4>
          <p>
            When you miss a question, ask what it was really testing. A missed Remember or
            Understand question usually means going back over the material; a missed Apply,
            Analyze, or Evaluate question usually means practising with the ideas — working
            problems, comparing cases, explaining your reasoning out loud — rather than rereading.
          </p>
        </div>
      </div>
    </details>
  );
}
