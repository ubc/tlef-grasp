// Records each saved question's database id on the wizard's copy, so Step 2
// knows which questions are in the Question Bank.
//
// localIds[i] is the wizard id of the question sent at position i; idsByIndex[i]
// is the id the server saved it under, or null if that save failed. Matched by
// wizard id rather than position, so a page change mid-save cannot misalign them.
export function attachSavedIds(questionGroups, localIds, idsByIndex) {
  const savedIdByLocalId = new Map();
  (localIds || []).forEach((localId, i) => {
    const savedId = idsByIndex?.[i];
    if (savedId) savedIdByLocalId.set(localId, savedId);
  });
  if (savedIdByLocalId.size === 0) return questionGroups;

  return questionGroups.map((group) => ({
    ...group,
    los: group.los.map((lo) => ({
      ...lo,
      questions: lo.questions.map((q) =>
        savedIdByLocalId.has(q.id) ? { ...q, _id: savedIdByLocalId.get(q.id) } : q
      ),
    })),
  }));
}
