import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { getObjectId } from "../lib/utils";
import { useInvalidateObjectives } from "./useObjectives";
import {
  bucketImportedObjectives,
  creatableKeys,
  neededKeys,
  planObjectiveCreations,
  flattenGranulars,
  metaObjectivesOf,
} from "../lib/questionImport";

// Holds the objectives an imported file carried and which of them to create in
// this course. Used by both import screens.
export function useImportedObjectives(courseId, flatGranulars, detailedObjectives) {
  const [fileObjectives, setFileObjectives] = useState([]);
  const [checkedKeys, setCheckedKeys] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const invalidateObjectives = useInvalidateObjectives(courseId);

  // Parents in their own right: a childless one is invisible in flatGranulars.
  const metaObjectives = useMemo(
    () => metaObjectivesOf(detailedObjectives),
    [detailedObjectives]
  );

  const groups = useMemo(
    () => bucketImportedObjectives(fileObjectives, flatGranulars, metaObjectives),
    [fileObjectives, flatGranulars, metaObjectives]
  );

  // Loads a parsed file's objectives, pre-checking the creatable ones the file's
  // own questions need. The rest are listed unchecked for the user to opt into.
  const load = (objectives, questions) => {
    setFileObjectives(objectives || []);
    const loaded = bucketImportedObjectives(objectives || [], flatGranulars, metaObjectives);
    setCheckedKeys(new Set(neededKeys(loaded, questions, flatGranulars)));
  };

  const toggle = (key) =>
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = (on) => setCheckedKeys(on ? new Set(creatableKeys(groups)) : new Set());

  const fetchObjectives = async () => {
    const data = await api.get(`/api/objective/detailed?courseId=${courseId}`);
    const objectives = (data.objectives || []).map((objective) => ({
      id: getObjectId(objective),
      name: objective.name,
      granular: objective.granularObjectives || [],
    }));
    return { granulars: flattenGranulars(objectives), metas: metaObjectivesOf(objectives) };
  };

  // Persists the checked objectives and returns the course's granulars as they now
  // stand, for the caller to re-match its rows against within the same submit.
  // Throws on the first failed write, carrying the server's own message.
  const createChecked = async () => {
    if (checkedKeys.size === 0) return flatGranulars;

    setCreating(true);
    try {
      // Plan against the course as it stands now: an earlier attempt may have
      // created some of these before failing, and re-POSTing one would duplicate it.
      const current = await fetchObjectives();
      const { creates, appends } = planObjectiveCreations(
        bucketImportedObjectives(fileObjectives, current.granulars, current.metas),
        checkedKeys
      );
      if (creates.length === 0 && appends.length === 0) return current.granulars;

      for (const objective of creates) {
        const result = await api.post("/api/objective", { ...objective, courseId });
        if (!result.success) throw new Error(result.error || `Could not create ${objective.name}`);
      }
      for (const objective of appends) {
        const result = await api.post(`/api/objective/${objective.objectiveId}/granular`, {
          granularObjectives: objective.granularObjectives,
        });
        if (!result.success) {
          throw new Error(result.error || `Could not update ${objective.metaName}`);
        }
      }
      return (await fetchObjectives()).granulars;
    } finally {
      // Whatever landed before a failure still has to reach the cache.
      invalidateObjectives();
      setCreating(false);
    }
  };

  return { groups, checkedKeys, creating, load, toggle, toggleAll, createChecked };
}
