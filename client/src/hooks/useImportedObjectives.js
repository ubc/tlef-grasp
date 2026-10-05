import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { getObjectId } from "../lib/utils";
import { useInvalidateObjectives } from "./useObjectives";
import {
  bucketImportedObjectives,
  creatableKeys,
  planObjectiveCreations,
  flattenGranulars,
} from "../lib/questionImport";

// Holds the objectives an imported file carried and which of them to create in
// this course. Used by both import screens.
export function useImportedObjectives(courseId, flatGranulars) {
  const [fileObjectives, setFileObjectives] = useState([]);
  const [checkedKeys, setCheckedKeys] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const invalidateObjectives = useInvalidateObjectives(courseId);

  const groups = useMemo(
    () => bucketImportedObjectives(fileObjectives, flatGranulars),
    [fileObjectives, flatGranulars]
  );

  // Loads a parsed file's objectives, checking every creatable one by default.
  const load = (objectives) => {
    setFileObjectives(objectives || []);
    setCheckedKeys(
      new Set(creatableKeys(bucketImportedObjectives(objectives || [], flatGranulars)))
    );
  };

  const toggle = (key) =>
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = (on) => setCheckedKeys(on ? new Set(creatableKeys(groups)) : new Set());

  const fetchGranulars = async () => {
    const data = await api.get(`/api/objective/detailed?courseId=${courseId}`);
    return flattenGranulars(
      (data.objectives || []).map((objective) => ({
        id: getObjectId(objective),
        name: objective.name,
        granular: objective.granularObjectives || [],
      }))
    );
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
      const current = await fetchGranulars();
      const { creates, appends } = planObjectiveCreations(
        bucketImportedObjectives(fileObjectives, current),
        checkedKeys
      );
      if (creates.length === 0 && appends.length === 0) return current;

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
      return await fetchGranulars();
    } finally {
      // Whatever landed before a failure still has to reach the cache.
      invalidateObjectives();
      setCreating(false);
    }
  };

  return { groups, checkedKeys, creating, load, toggle, toggleAll, createChecked };
}
