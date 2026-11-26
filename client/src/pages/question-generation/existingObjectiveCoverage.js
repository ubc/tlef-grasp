/**
 * Which of the selected materials already have saved learning objectives.
 *
 * "Use existing" is only a complete answer when every selected material is
 * covered: a material with no objectives yet still needs generating, so the
 * Generate dialog offers it only when `fullyCovered`.
 *
 * @param {Array<{ materialIds: string[] }>} objectives the course's objectives
 * @param {string[]} selectedMaterialIds the selected materials' source ids
 * @returns {{ existing: Array, uncoveredMaterialIds: string[], fullyCovered: boolean }}
 *   `existing` holds the objectives linked to any selected material;
 *   `uncoveredMaterialIds` the selected materials none of them is linked to.
 */
export function existingObjectiveCoverage(objectives, selectedMaterialIds) {
  const selected = new Set(selectedMaterialIds.map(String));
  const covered = new Set();
  const existing = objectives.filter((objective) => {
    const linked = objective.materialIds.map(String).filter((id) => selected.has(id));
    linked.forEach((id) => covered.add(id));
    return linked.length > 0;
  });
  const uncoveredMaterialIds = selectedMaterialIds.filter((id) => !covered.has(String(id)));
  return {
    existing,
    uncoveredMaterialIds,
    fullyCovered: selectedMaterialIds.length > 0 && uncoveredMaterialIds.length === 0,
  };
}
