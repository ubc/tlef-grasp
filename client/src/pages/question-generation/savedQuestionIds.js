// Merges saveQuestionsToBank's `saved` map (wizard id -> { _id, bankSnapshot })
// into the page's questions. Matched by wizard id, not position.
export function attachSavedIds(questionGroups, saved) {
  if (!saved || saved.size === 0) return questionGroups;

  return questionGroups.map((group) => ({
    ...group,
    los: group.los.map((lo) => ({
      ...lo,
      questions: lo.questions.map((q) =>
        saved.has(q.id) ? { ...q, ...saved.get(q.id) } : q
      ),
    })),
  }));
}
