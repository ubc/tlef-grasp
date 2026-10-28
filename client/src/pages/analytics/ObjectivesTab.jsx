import { Fragment, useMemo, useState } from "react";
import { useObjectiveAnalytics } from "../../hooks/useAnalytics";
import { EmptyState, LoadingState } from "../../components/ui/states";
import { CorrectBar, LoadError, StatCard } from "./shared";
import { cellClass, comparePValue, headClass, lowDataNote, percent, thresholdRule } from "./format";

// Rows without the figure a sort is by go last.
const byNullable = (pick, direction) => (a, b) => {
  const x = pick(a);
  const y = pick(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return direction * (x - y);
};

const SORTS = {
  course: { label: "Course order", compare: () => 0 },
  weakest: { label: "Lowest correct", compare: comparePValue },
  mastery: { label: "Lowest mastery", compare: byNullable((row) => row.masteryRate, 1) },
  remediation: { label: "Most needing remediation", compare: byNullable((row) => row.needsRemediation, -1) },
};

function MasteryCell({ row }) {
  if (!row.enoughMasteryData) return <span className="text-muted">—</span>;
  return (
    <>
      <CorrectBar pValue={row.masteryRate} />
      <span className="mt-0.5 block text-xs text-muted">
        {row.mastered} of {row.masteryJudged} students
      </span>
    </>
  );
}

function RemediationCell({ row }) {
  if (!row.enoughRemediationData) return <span className="text-muted">—</span>;
  return (
    <span className="tabular-nums">
      {row.needsRemediation} of {row.remediationTracked}
      <span className="block text-xs text-muted">{percent(row.remediationRate)} of students</span>
    </span>
  );
}

function ObjectiveRow({ row, granular = false }) {
  return (
    <tr className={row.enoughData ? "" : "text-muted"}>
      <td className={`${cellClass} ${granular ? "pl-10" : "font-semibold text-ink"}`}>
        {granular && <span className="sr-only">Sub-objective: </span>}
        {row.name}
        {!row.enoughData && (
          <p className="mt-1 text-xs font-normal text-muted">
            {lowDataNote({ responses: row.responses, students: row.studentsAssessed }, "Not assessed yet")}
          </p>
        )}
      </td>
      <td className={cellClass}>
        <CorrectBar pValue={row.pValue} />
      </td>
      <td className={cellClass}>
        <MasteryCell row={row} />
      </td>
      <td className={cellClass}>
        <RemediationCell row={row} />
      </td>
      <td className={`${cellClass} tabular-nums`}>
        {row.responses}
        {row.pending > 0 && (
          <span className="block text-xs text-muted">+{row.pending} pending</span>
        )}
      </td>
      <td className={`${cellClass} tabular-nums`}>{row.studentsAssessed}</td>
    </tr>
  );
}

function RemediationRanking({ rows }) {
  return (
    <section aria-labelledby="remediation-heading" className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 id="remediation-heading" className="text-lg font-semibold text-ink">
        Needs the most remediation
      </h2>
      <p className="mt-1 mb-4 text-xs text-muted">
        Learning objectives with the most students currently flagged for remediation. Not
        affected by the quiz filter.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No objective has students flagged for remediation yet.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.objectiveId} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 w-5 shrink-0 text-right font-semibold text-muted">{index + 1}.</span>
              <span className="min-w-0 flex-1 text-ink">{row.name}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-danger">
                {row.needsRemediation} of {row.remediationTracked} students
              </span>
              <span className="w-28 shrink-0 whitespace-nowrap text-right tabular-nums text-muted">
                {row.enoughMasteryData ? `${percent(row.masteryRate)} mastered` : "mastery —"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function ObjectivesTab({ courseId, quizId, sectionId }) {
  const { analytics, isPending, isError } = useObjectiveAnalytics(courseId, { quizId, sectionId });
  const [sort, setSort] = useState("course");

  const objectives = analytics?.objectives;
  const sorted = useMemo(() => {
    if (!objectives) return [];
    const compare = SORTS[sort].compare;
    return [...objectives]
      .sort(compare)
      .map((row) => ({ ...row, granular: [...row.granular].sort(compare) }));
  }, [objectives, sort]);

  if (isPending) return <LoadingState label="Loading objective analytics..." />;
  if (isError || !analytics) return <LoadError />;

  const { summary, cohortSize, mastery } = analytics;
  if (summary.totalObjectives === 0) {
    return (
      <EmptyState
        icon="fa-bullseye"
        title="No learning objectives yet"
        message="Add learning objectives to the course to see how the class does on each."
      />
    );
  }

  const allRows = objectives.flatMap((row) => [row, ...row.granular]);
  const byId = new Map(allRows.map((row) => [row.objectiveId, row]));
  const weakest = byId.get(summary.weakestObjectiveId);
  const ranking = summary.remediationRanking.map((id) => byId.get(id)).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Students in scope"
          value={cohortSize}
          hint={`${summary.ratedObjectives} of ${summary.totalObjectives} objectives rated`}
        />
        <StatCard
          label="Average correct"
          value={percent(summary.averagePValue)}
          hint="Mean across rated objectives"
        />
        <StatCard
          label="Average mastery rate"
          value={percent(summary.averageMasteryRate)}
          hint={`Mastered: ${percent(mastery.threshold)}+ correct`}
        />
        <StatCard
          label="Weakest objective"
          value={weakest ? percent(weakest.pValue) : "—"}
          hint={weakest ? weakest.name : "Not enough data yet"}
        />
      </div>

      <RemediationRanking rows={ranking} />

      <section aria-labelledby="objectives-heading" className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 id="objectives-heading" className="text-lg font-semibold text-ink">
            Learning objectives
          </h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            Sort by
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
            >
              {Object.entries(SORTS).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-1 px-6 pb-3 text-xs text-muted">
          <p>
            <strong className="font-semibold">Correct</strong> is the share of graded responses on
            the objective that were correct; an objective includes its sub-objectives.{" "}
            <strong className="font-semibold">Mastery</strong> is the share of students with at
            least {mastery.minAnswers} graded answers on it who got {percent(mastery.threshold)} or
            more right. <strong className="font-semibold">Remediation</strong> is how many students
            are currently flagged on it.
          </p>
          <p>
            A figure is shown once it has {thresholdRule(analytics)}.
            {summary.pendingResponses > 0 &&
              ` ${summary.pendingResponses} answers awaiting grading are not counted.`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">
              Class performance on each learning objective and its sub-objectives
            </caption>
            <thead>
              <tr>
                <th scope="col" className={headClass}>Objective</th>
                <th scope="col" className={headClass}>Correct</th>
                <th scope="col" className={headClass}>Mastery</th>
                <th scope="col" className={headClass}>Remediation</th>
                <th scope="col" className={headClass}>Responses</th>
                <th scope="col" className={headClass}>Students</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <Fragment key={row.objectiveId}>
                  <ObjectiveRow row={row} />
                  {row.granular.map((child) => (
                    <ObjectiveRow key={child.objectiveId} row={child} granular />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
