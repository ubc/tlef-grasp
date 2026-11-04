// Step 2 questions whose learning objective was deleted (for example in another
// tab) need a new one before they are saved. `granulars` is the course's
// current granular objectives, as flattenGranulars() returns them.

export function questionsWithDeletedObjective(pageQuestions, granulars) {
  const existing = new Set(granulars.map((granular) => granular.id));
  return pageQuestions.filter(
    (question) => !existing.has(String(question.granularObjectiveId || ""))
  );
}

// Gives each picked question (picks: question id -> granular id) its new
// objective. Step 2 groups questions by meta objective, so a question whose
// new objective has another meta moves to that group, added at the end if the
// page has none yet. Groups left empty are dropped.
export function applyObjectivePicks(questionGroups, picks, granulars) {
  const granularById = new Map(granulars.map((granular) => [granular.id, granular]));
  const moving = [];

  const groups = questionGroups
    .map((group) => ({
      ...group,
      los: group.los
        .map((lo) => ({
          ...lo,
          questions: lo.questions.flatMap((question) => {
            const granular = granularById.get(picks.get(question.id));
            if (!granular) return [question];
            const updated = {
              ...question,
              granularObjectiveId: granular.id,
              learningObjectiveId: granular.metaId,
              loCode: granular.name,
              metaCode: granular.metaName,
            };
            if (granular.metaName === group.title) return [updated];
            moving.push({ lo, question: updated });
            return [];
          }),
        }))
        .filter((lo) => lo.questions.length > 0),
    }))
    .filter((group) => group.los.length > 0);

  moving.forEach(({ lo, question }) => {
    let index = groups.findIndex((group) => group.title === question.metaCode);
    if (index === -1) {
      const nextId = Math.max(0, ...groups.map((group) => Number(group.id) || 0)) + 1;
      groups.push({ id: nextId, title: question.metaCode, isOpen: true, los: [] });
      index = groups.length - 1;
    }
    const target = groups[index];
    target.los = [
      ...target.los,
      {
        ...lo,
        id: `${lo.id}-${question.id}`,
        code: `LO ${index + 1}.${target.los.length + 1}`,
        questions: [question],
      },
    ];
  });

  return groups;
}
