import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useCourseObjectives, useInvalidateObjectives } from "../../hooks/useObjectives";
import { useCourseMaterials } from "../../hooks/useMaterials";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import AIGenerateModal from "./AIGenerateModal";
import ObjectiveGroupCard from "./ObjectiveGroupCard";
import { totalQuestions, defaultTypeForLevel } from "../../lib/questionTypes";
import { appendObjectiveGroups, withQuestionTypes } from "./objectiveGroups";
import { runPool } from "../../lib/async-pool";
import { MAX_QUESTIONS_PER_OBJECTIVE } from "../../lib/constants";

// How many objectives the "Add Existing" list loads at a time. Each one costs
// two cheap GETs, so this only exists to keep a select-all over a large course
// from opening a hundred connections at once.
const OBJECTIVE_FETCH_CONCURRENCY = 4;

/* ------------------------------ Main step 1 ------------------------------ */

export default function ObjectivesStep({
  course,
  objectiveGroups,
  setObjectiveGroups,
  showValidation,
}) {
  const showToast = useToast();
  const invalidateObjectives = useInvalidateObjectives(course?.id);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Checked-but-not-yet-added objectives, keyed by stringified _id. Discarded
  // whenever the dropdown closes, so reopening it always starts clean.
  const [selectedObjectiveIds, setSelectedObjectiveIds] = useState(() => new Set());
  const [addingObjectives, setAddingObjectives] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [granularizeTarget, setGranularizeTarget] = useState(null);
  const [granularCount, setGranularCount] = useState(3);
  const [useDefaults, setUseDefaults] = useState(true);
  const dropdownRef = useRef(null);

  const { objectives: dbObjectives } = useCourseObjectives(course?.id);
  const { materials: courseMaterials } = useCourseMaterials(course?.id);

  // Closing always discards the pending search and selection, so reopening the
  // list starts clean rather than resurrecting checkboxes from a session the
  // instructor walked away from.
  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setSearch("");
    setSelectedObjectiveIds(new Set());
  }, []);

  useEffect(() => {
    const handleClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [closeDropdown]);

  const toggleObjectiveSelection = (objectiveId) => {
    const key = String(objectiveId);
    setSelectedObjectiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addedObjectiveIds = new Set(
    objectiveGroups.filter((g) => g.objectiveId).map((g) => String(g.objectiveId))
  );

  const updateGroup = (groupId, updater) => {
    setObjectiveGroups((prev) =>
      prev.map((group) => (group.id === groupId ? updater(group) : group))
    );
  };

  // Persist a group's full objective record (name, materials, granular list).
  // Granulars removed from this page are only detached, never deleted: the
  // server treats any granular missing from this payload as a deletion, so
  // detached items must keep riding along in every save (#41).
  const saveObjectiveToDatabase = async (group) => {
    if (!group?.objectiveId || !course?.id) return;
    const granularObjectives = [...group.items, ...(group.detachedItems || [])].map(
      (item) => {
        // No questionCount: questionTypes carries the total, and a second copy
        // of the same number could only ever disagree with it.
        const granularObj = {
          text: item.text,
          bloomTaxonomies: item.bloom || [],
          questionTypes: item.questionTypes || [],
        };
        if (item.granularId) granularObj.id = item.granularId;
        return granularObj;
      }
    );

    try {
      const data = await api.put(`/api/objective/${group.objectiveId}`, {
        name: group.title,
        courseId: course.id,
        granularObjectives,
      });
      if (data.success && data.granularObjectives) {
        // Backfill database ids for newly created granular objectives
        setObjectiveGroups((prev) =>
          prev.map((g) => {
            if (g.id !== group.id) return g;
            const items = g.items.map((item) => {
              if (item.granularId) return item;
              const match = data.granularObjectives.find(
                (db) => db.name === item.text
              );
              return match ? { ...item, granularId: String(match._id) } : item;
            });
            return { ...g, items };
          })
        );
      }
      invalidateObjectives();
    } catch (error) {
      console.error("Error saving objective to database:", error);
    }
  };

  // Load everything a group needs for one objective. The two reads are
  // independent, so they overlap; the pool below is what bounds how many
  // objectives are in flight at once.
  const fetchObjectiveDetail = async (objective) => {
    const [granularData, materialsData] = await Promise.all([
      api.get(
        `/api/objective/${objective._id}/granular?courseId=${encodeURIComponent(course.id)}`
      ),
      api.get(`/api/objective/${objective._id}/materials`),
    ]);

    return {
      objectiveId: objective._id,
      title: objective.name,
      materialIds: materialsData.success
        ? materialsData.materials.map((m) => m.sourceId || m._id)
        : [],
      granulars: granularData.success ? granularData.objectives : [],
    };
  };

  // Add every checked objective in one go. Each one is an independent pair of
  // reads, so they run through a small pool rather than all at once — checking
  // twenty objectives should not fire forty simultaneous requests at the
  // server. runPool reports in input order, so the groups land in the order
  // they appear in the list regardless of which request finished first.
  //
  // One objective failing to load must not cost the instructor the rest of the
  // selection: the ones that loaded are added, the ones that did not are named
  // in a toast and stay checked so retrying is a single click.
  const handleAddSelected = async () => {
    const chosen = dbObjectives.filter(
      (objective) =>
        selectedObjectiveIds.has(String(objective._id)) &&
        !addedObjectiveIds.has(String(objective._id))
    );
    if (chosen.length === 0) return;

    setAddingObjectives(true);
    try {
      const settled = await runPool(
        chosen.map((objective) => () => fetchObjectiveDetail(objective)),
        { concurrency: OBJECTIVE_FETCH_CONCURRENCY }
      );

      const additions = [];
      const failed = [];
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          additions.push(result.value);
          return;
        }
        console.error(
          `Error fetching granular objectives for "${chosen[index].name}":`,
          result.reason
        );
        failed.push(chosen[index]);
      });

      if (additions.length > 0) {
        setObjectiveGroups((prev) => appendObjectiveGroups(prev, additions));
      }

      if (failed.length === 0) {
        closeDropdown();
        return;
      }

      const names = failed.map((objective) => objective.name).join(", ");
      showToast(
        `Failed to load ${failed.length} learning objective${failed.length === 1 ? "" : "s"}: ${names}`,
        "error"
      );
      setSelectedObjectiveIds(new Set(failed.map((objective) => String(objective._id))));
    } finally {
      setAddingObjectives(false);
    }
  };

  const handleAISaved = (savedGroups) => {
    setObjectiveGroups((prev) =>
      appendObjectiveGroups(
        prev,
        savedGroups.map(({ objective, granulars, materialIds }) => ({
          objectiveId: objective._id,
          title: objective.name,
          materialIds,
          granulars,
        }))
      )
    );
    invalidateObjectives();
  };

  // Selects a Bloom level by giving it a question type to generate. A level
  // with no types would immediately read as unselected, so adding the chip and
  // seeding its default type are the same action. Clicking an already-selected
  // chip opens its breakdown panel instead of deselecting; deselecting happens
  // by zeroing the level's types there.
  const toggleBloomChip = (group, item, level) => {
    if (item.mode !== "manual") return;
    updateGroup(group.id, (g) => {
      const items = g.items.map((i) => {
        if (i.id !== item.id || i.bloom.includes(level)) return i;
        if (totalQuestions(i.questionTypes) >= MAX_QUESTIONS_PER_OBJECTIVE) return i;
        return withQuestionTypes(i, [
          ...(i.questionTypes || []),
          { bloomLevel: level, questionType: defaultTypeForLevel(level), count: 1 },
        ]);
      });
      const updated = { ...g, items };
      if (g.objectiveId) saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  // Adjust the count for one (bloomLevel, questionType) pair. Dropping a pair
  // to zero removes it, and when that was the level's last type the level
  // deselects — which is the only way to deselect one. Zeroing every level
  // leaves the objective with no Bloom levels, which validateStep1 already
  // blocks, so there is no state where an objective silently generates
  // something other than what the panel shows.
  const changeTypeCount = (group, item, bloomLevel, questionType, delta) => {
    updateGroup(group.id, (g) => {
      const items = g.items.map((i) => {
        if (i.id !== item.id) return i;
        const existing = i.questionTypes || [];
        const idx = existing.findIndex(
          (qt) => qt.bloomLevel === bloomLevel && qt.questionType === questionType
        );
        if (delta > 0 && totalQuestions(existing) >= MAX_QUESTIONS_PER_OBJECTIVE) return i;

        let next;
        if (idx === -1) {
          if (delta <= 0) return i;
          next = [...existing, { bloomLevel, questionType, count: 1 }];
        } else {
          const newCount = existing[idx].count + delta;
          if (newCount <= 0) {
            next = existing.filter((_, j) => j !== idx);
          } else {
            next = existing.map((qt, j) => (j === idx ? { ...qt, count: newCount } : qt));
          }
        }
        return withQuestionTypes(i, next);
      });
      const updated = { ...g, items };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const commitItemText = (group, item, newText) => {
    const trimmed = newText.trim();
    if (!trimmed || item.text.trim() === trimmed) return;
    updateGroup(group.id, (g) => {
      const updated = {
        ...g,
        items: g.items.map((i) => (i.id === item.id ? { ...i, text: trimmed } : i)),
      };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const commitGroupTitle = (group, newTitle) => {
    const trimmed = newTitle.trim();
    if (!trimmed || group.title.trim() === trimmed) return;
    updateGroup(group.id, (g) => {
      const updated = { ...g, title: trimmed };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  // Remove a granular from this page only. Saved granulars move to
  // detachedItems so they survive future saves in the database (#41);
  // never-saved ones (no granularId) are simply dropped.
  const deleteItem = (group, item) => {
    updateGroup(group.id, (g) => {
      const updated = {
        ...g,
        items: g.items.filter((i) => i.id !== item.id),
        detachedItems: item.granularId
          ? [...(g.detachedItems || []), item]
          : g.detachedItems || [],
      };
      saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const addNewGranular = (group) => {
    updateGroup(group.id, (g) => ({
      ...g,
      items: [
        ...g.items,
        // Starts with no Bloom levels, so no question types and a total of
        // zero. Picking a chip seeds its type and the total follows.
        {
          id: Date.now() + g.items.length + 1,
          granularId: null,
          text: "",
          bloom: [],
          questionTypes: [],
          count: 0,
          mode: "manual",
          level: 1,
          selected: false,
        },
      ],
    }));
  };

  const confirmGranularization = () => {
    const group = objectiveGroups.find((g) => g.id === granularizeTarget);
    if (!group) return;
    const selectedItems = group.items.filter((item) => item.selected);
    if (selectedItems.length === 0) return;

    const templates = (parent) => [
      {
        title: `Identify key terms and quantities related to ${parent.text}.`,
        bloom: useDefaults ? ["Remember", "Understand"] : [],
      },
      {
        title: `Explain the underlying principle(s) behind ${parent.text} with one example.`,
        bloom: useDefaults ? ["Understand", "Analyze"] : [],
      },
      {
        title: `Apply ${parent.text} to solve a simple problem or predict an outcome.`,
        bloom: useDefaults ? ["Apply"] : [],
      },
    ];

    updateGroup(group.id, (g) => {
      const newItems = [];
      selectedItems.forEach((parent) => {
        templates(parent)
          .slice(0, granularCount)
          .forEach((template, i) => {
            // Templates arrive with Bloom levels already chosen, so seed a
            // type for each — otherwise they would render as unselected.
            newItems.push(
              withQuestionTypes(
                {
                  id: parseFloat(`${parent.id}.${i + 1}`),
                  text: template.title,
                  mode: "manual",
                  level: 2,
                  parentId: parent.id,
                  selected: false,
                },
                (template.bloom || []).map((level) => ({
                  bloomLevel: level,
                  questionType: defaultTypeForLevel(level),
                  count: 1,
                }))
              )
            );
          });
      });
      return {
        ...g,
        items: [...g.items.map((i) => ({ ...i, selected: false })), ...newItems],
      };
    });
    setGranularizeTarget(null);
  };

  const filteredDbObjectives = dbObjectives.filter((objective) =>
    (objective.name || "").toLowerCase().includes(search.toLowerCase())
  );
  // Rows the instructor can still act on: already-added objectives render, but
  // as a disabled "already added" row, so they are neither selectable nor part
  // of what "select all" means.
  const selectableObjectives = filteredDbObjectives.filter(
    (objective) => !addedObjectiveIds.has(String(objective._id))
  );
  const allSelectableChecked =
    selectableObjectives.length > 0 &&
    selectableObjectives.every((objective) =>
      selectedObjectiveIds.has(String(objective._id))
    );
  // Only counts what a click on "Add" would actually add: a selection can
  // outlive the search that made it, and an objective added since it was
  // checked is skipped rather than duplicated.
  const selectedCount = dbObjectives.filter(
    (objective) =>
      selectedObjectiveIds.has(String(objective._id)) &&
      !addedObjectiveIds.has(String(objective._id))
  ).length;

  // Applies to the rows currently listed, leaving selections hidden by the
  // search filter alone — narrowing the search then clearing should not
  // silently drop objectives the instructor already picked.
  const toggleSelectAll = () => {
    setSelectedObjectiveIds((prev) => {
      const next = new Set(prev);
      selectableObjectives.forEach((objective) => {
        const key = String(objective._id);
        if (allSelectableChecked) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-ink">
        Review learning objectives for every page
      </h1>
      <p className="mb-5 text-muted">
        Organize meta learning objectives and refine granular learning objectives.
      </p>

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setAiModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className="fas fa-magic" /> Create Learning Objectives
        </button>
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => (dropdownOpen ? closeDropdown() : setDropdownOpen(true))}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-plus" /> Add Existing Learning Objectives
          </button>
          {dropdownOpen && (
            <div className="absolute z-20 mt-1 w-96 rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="border-b border-gray-100 p-2">
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search objectives..."
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              {selectableObjectives.length > 0 && (
                <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    disabled={addingObjectives}
                    className="font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {/* Both actions are scoped to the rows currently listed,
                        so both name that count — with a search active,
                        "Deselect all" must not read as clearing the whole
                        selection when it only clears the matches. */}
                    {allSelectableChecked
                      ? `Deselect all ${selectableObjectives.length}`
                      : `Select all ${selectableObjectives.length}`}
                  </button>
                  <span className="text-muted">{selectedCount} selected</span>
                </div>
              )}
              <ul className="max-h-60 overflow-y-auto py-1">
                {filteredDbObjectives.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">
                    No learning objectives found. Create one to get started.
                  </li>
                ) : (
                  filteredDbObjectives.map((objective) => {
                    const key = String(objective._id);
                    const added = addedObjectiveIds.has(key);
                    return (
                      <li key={objective._id}>
                        <label
                          className={`flex items-start gap-2.5 px-3 py-2 text-sm transition-colors ${
                            added
                              ? "cursor-not-allowed opacity-40"
                              : "cursor-pointer hover:bg-primary/5"
                          }`}
                        >
                          <input
                            type="checkbox"
                            // An added objective reads as checked because it is
                            // on the page — the disabled state and the suffix
                            // say why it cannot be unchecked here.
                            checked={added || selectedObjectiveIds.has(key)}
                            disabled={added || addingObjectives}
                            onChange={() => toggleObjectiveSelection(key)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                          />
                          <span className="min-w-0 flex-1 text-ink">
                            {objective.name}
                            {added && (
                              <span className="ml-1.5 text-xs italic text-muted">
                                (already added)
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 p-2">
                <button
                  type="button"
                  onClick={closeDropdown}
                  disabled={addingObjectives}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddSelected}
                  disabled={selectedCount === 0 || addingObjectives}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
                >
                  {addingObjectives ? (
                    <>
                      <i className="fas fa-spinner fa-spin" /> Adding...
                    </>
                  ) : (
                    // Counted once something is checked, so the button says
                    // exactly what confirming will do; bare "Add objectives"
                    // while it is disabled beats "Add 0 objectives".
                    selectedCount === 0 ? (
                      "Add objectives"
                    ) : (
                      `Add ${selectedCount} objective${selectedCount === 1 ? "" : "s"}`
                    )
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Objective groups */}
      {objectiveGroups.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <i className="fas fa-lightbulb mb-4 text-4xl text-gray-300" />
          <h3 className="text-lg font-semibold text-ink">No learning objectives yet</h3>
          <p className="mt-1 text-muted">
            Start by adding your first learning objective to organize your course
            content.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {objectiveGroups.map((group) => (
            <ObjectiveGroupCard
              key={group.id}
              group={group}
              courseMaterials={courseMaterials}
              showValidation={showValidation}
              onUpdateGroup={(updater) => updateGroup(group.id, updater)}
              onCommitTitle={(value) => commitGroupTitle(group, value)}
              onCommitItemText={(item, value) => commitItemText(group, item, value)}
              onToggleBloom={(item, level) => toggleBloomChip(group, item, level)}
              onChangeTypeCount={(item, bloomLevel, questionType, delta) =>
                changeTypeCount(group, item, bloomLevel, questionType, delta)
              }
              onDeleteItem={(item) => deleteItem(group, item)}
              onAddGranular={() => addNewGranular(group)}
              onRequestDelete={() => setDeleteTarget(group.id)}
              onRequestGranularize={() => {
                setGranularCount(3);
                setUseDefaults(true);
                setGranularizeTarget(group.id);
              }}
            />
          ))}
        </div>
      )}

      {/* AI generate modal */}
      {aiModalOpen && (
        <AIGenerateModal
          course={course}
          onClose={() => setAiModalOpen(false)}
          onSaved={handleAISaved}
        />
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Remove Learning Objective?"
        footer={null}
      >
        <p className="mb-5 text-ink">
          This will remove the learning objective from the current page. It will not be
          deleted from the database.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setObjectiveGroups((prev) => prev.filter((g) => g.id !== deleteTarget));
              setDeleteTarget(null);
            }}
            className="rounded-lg bg-danger px-4 py-2.5 font-medium text-white transition-colors hover:bg-danger/85"
          >
            <i className="fas fa-trash-alt mr-2" /> Remove from current view
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="text-sm text-muted underline"
          >
            Cancel
          </button>
        </div>
      </Modal>

      {/* Granularization modal */}
      <Modal
        open={granularizeTarget !== null}
        onClose={() => setGranularizeTarget(null)}
        title="Make more granular"
        footer={
          <>
            <button
              type="button"
              onClick={() => setGranularizeTarget(null)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmGranularization}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Confirm
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="mb-2 block font-semibold text-ink">
              How many per selected LO?
            </label>
            <div className="flex gap-4">
              {[2, 3].map((count) => (
                <label key={count} className="flex items-center gap-2 text-ink">
                  <input
                    type="radio"
                    name="granular-count"
                    checked={granularCount === count}
                    onChange={() => setGranularCount(count)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{count}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block font-semibold text-ink">
              Bloom assignment:
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={useDefaults}
                  onChange={() => setUseDefaults(true)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  Use defaults (Identify=Remember/Understand, Explain=Understand/Analyze,
                  Apply=Apply)
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={!useDefaults}
                  onChange={() => setUseDefaults(false)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>I'll choose later (creates with no chips selected)</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
