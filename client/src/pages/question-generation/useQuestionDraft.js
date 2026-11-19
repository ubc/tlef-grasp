import { useEffect, useRef, useState } from "react";
import { countUnsavedQuestions } from "./bankSave";

const DRAFT_KEY_PREFIX = "grasp-draft-questions";

// Keeps unsaved questions in localStorage (same key as the legacy app) and
// offers to restore them on load. The draft is rewritten after every change
// and removed once everything is in the bank.
export function useQuestionDraft(courseId, questionGroups) {
  const draftKey = courseId ? `${DRAFT_KEY_PREFIX}-${courseId}` : null;
  const [draftPrompt, setDraftPrompt] = useState(null);
  const draftCheckedRef = useRef(false);

  const clearDraft = () => {
    if (draftKey) localStorage.removeItem(draftKey);
  };

  useEffect(() => {
    if (draftCheckedRef.current || !draftKey) return;
    draftCheckedRef.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      const draft = raw ? JSON.parse(raw) : null;
      if (draft && Array.isArray(draft.questionGroups) && draft.questionGroups.length > 0) {
        const unsavedQuestions = countUnsavedQuestions(draft.questionGroups);
        if (unsavedQuestions === 0) return;
        const savedAt = draft.savedAt
          ? new Date(draft.savedAt).toLocaleString()
          : "a previous session";
        setDraftPrompt({ draft, unsavedQuestions, savedAt });
      }
    } catch {
      // Corrupt draft — ignore
    }
  }, [draftKey]);

  useEffect(() => {
    // An empty page must not wipe a draft still waiting on the restore prompt.
    if (!draftKey || questionGroups.length === 0) return;
    try {
      if (countUnsavedQuestions(questionGroups) > 0) {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ questionGroups, savedAt: new Date().toISOString() })
        );
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch (error) {
      console.warn("Failed to save draft to localStorage:", error);
    }
  }, [draftKey, questionGroups]);

  return {
    draftPrompt,
    dismissDraftPrompt: () => setDraftPrompt(null),
    clearDraft,
  };
}
