import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useCourseObjectives, useInvalidateObjectives } from "../../hooks/useObjectives";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import AIGenerateModal from "./AIGenerateModal";
import ObjectiveGroupCard from "./ObjectiveGroupCard";

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
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [granularizeTarget, setGranularizeTarget] = useState(null);
  const [granularCount, setGranularCount] = useState(3);
  const [useDefaults, setUseDefaults] = useState(true);
  const dropdownRef = useRef(null);

  const { objectives: dbObjectives } = useCourseObjectives(course?.id);

  useEffect(() => {
    const handleClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
        const granularObj = {
          text: item.text,
          bloomTaxonomies: item.bloom || [],
          questionCount: item.count,
        };
        if (item.granularId) granularObj.id = item.granularId;
        return granularObj;
      }
    );

    try {
      const data = await api.put(`/api/objective/${group.objectiveId}`, {
        name: group.title,
        courseId: course.id,
        materialIds: group.materialIds || [],
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

  const handleObjectiveSelection = async (objectiveId, objectiveName) => {
    const normalizedId = String(objectiveId);
    const existing = objectiveGroups.find(
      (group) => group.objectiveId && String(group.objectiveId) === normalizedId
    );
    if (existing) {
      updateGroup(existing.id, (group) => ({ ...group, isOpen: true }));
      return;
    }

    try {
      const [granularData, materialsData] = await Promise.all([
        api.get(
          `/api/objective/${objectiveId}/granular?courseId=${encodeURIComponent(course.id)}`
        ),
        api.get(`/api/objective/${objectiveId}/materials`),
      ]);

      const granularObjectives = granularData.success ? granularData.objectives : [];
      const materialIds = materialsData.success
        ? materialsData.materials.map((m) => m.sourceId || m._id)
        : [];

      const newGroupNumber = objectiveGroups.length + 1;
      const newGroup = {
        id: Date.now() + Math.random(),
        objectiveId,
        title: objectiveName,
        isOpen: true,
        materialIds,
        items: granularObjectives.map((granular, index) => ({
          id: parseFloat(`${newGroupNumber}.${index + 1}`),
          granularId: granular._id ? String(granular._id) : null,
          text: granular.name,
          bloom:
            granular.bloomTaxonomies && granular.bloomTaxonomies.length > 0
              ? granular.bloomTaxonomies
              : [],
          minQuestions: 2,
          count:
            granular.questionCount ||
            Math.max(2, granular.bloomTaxonomies?.length || 0),
          mode: "manual",
          level: 1,
          selected: false,
        })),
      };
      setObjectiveGroups((prev) => [...prev, newGroup]);
    } catch (error) {
      console.error("Error fetching granular objectives:", error);
      showToast("Failed to load granular objectives", "error");
    }
  };

  const handleAISaved = (savedGroups) => {
    setObjectiveGroups((prev) => {
      const next = [...prev];
      savedGroups.forEach(({ objective, granulars, materialIds }) => {
        const newGroupNumber = next.length + 1;
        next.push({
          id: Date.now() + Math.random(),
          objectiveId: objective._id,
          title: objective.name,
          isOpen: true,
          materialIds,
          items: (granulars || []).map((granular, gIdx) => ({
            id: parseFloat(`${newGroupNumber}.${gIdx + 1}`),
            granularId: String(granular._id),
            text: granular.name,
            bloom: granular.bloomTaxonomies || [],
            minQuestions: 2,
            count: 2,
            mode: "manual",
            level: 1,
            selected: false,
          })),
        });
      });
      return next;
    });
    invalidateObjectives();
  };

  const toggleBloomChip = (group, item, level) => {
    if (item.mode !== "manual") return;
    updateGroup(group.id, (g) => {
      const items = g.items.map((i) => {
        if (i.id !== item.id) return i;
        const bloom = i.bloom.includes(level)
          ? i.bloom.filter((b) => b !== level)
          : [...i.bloom, level];
        return { ...i, bloom, count: Math.max(i.count, bloom.length) };
      });
      const updated = { ...g, items };
      if (g.objectiveId) saveObjectiveToDatabase(updated);
      return updated;
    });
  };

  const changeCount = (group, item, delta) => {
    const minAllowed = Math.max(2, item.bloom?.length || 0);
    const next = item.count + delta;
    if (delta > 0 && item.count >= 9) return;
    if (delta < 0 && item.count <= minAllowed) return;
    updateGroup(group.id, (g) => {
      const updated = {
        ...g,
        items: g.items.map((i) => (i.id === item.id ? { ...i, count: next } : i)),
      };
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
        {
          id: Date.now() + g.items.length + 1,
          granularId: null,
          text: "",
          bloom: [],
          minQuestions: 2,
          count: 2,
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
            newItems.push({
              id: parseFloat(`${parent.id}.${i + 1}`),
              text: template.title,
              bloom: template.bloom,
              minQuestions: 1,
              count: 1,
              mode: "manual",
              level: 2,
              parentId: parent.id,
              selected: false,
            });
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
            onClick={() => setDropdownOpen((v) => !v)}
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
              <ul className="max-h-60 overflow-y-auto py-1">
                {filteredDbObjectives.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">
                    No learning objectives found. Create one to get started.
                  </li>
                ) : (
                  filteredDbObjectives.map((objective) => {
                    const disabled = addedObjectiveIds.has(String(objective._id));
                    return (
                      <li key={objective._id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={async () => {
                            setDropdownOpen(false);
                            await handleObjectiveSelection(
                              objective._id,
                              objective.name
                            );
                          }}
                          className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {objective.name}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
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
              showValidation={showValidation}
              onUpdateGroup={(updater) => updateGroup(group.id, updater)}
              onCommitTitle={(value) => commitGroupTitle(group, value)}
              onCommitItemText={(item, value) => commitItemText(group, item, value)}
              onToggleBloom={(item, level) => toggleBloomChip(group, item, level)}
              onChangeCount={(item, delta) => changeCount(group, item, delta)}
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
