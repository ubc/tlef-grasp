import { useEffect, useRef, useState } from "react";

const DRAFT_KEY_PREFIX = "grasp-draft-questions";

// Persists generated questions to localStorage (same key as the legacy app)
// so a refresh or disconnect doesn't lose them, and offers a restore prompt
// when an unsaved draft is found on load.
export function useQuestionDraft(courseId) {
  const draftKey = courseId ? `${DRAFT_KEY_PREFIX}-${courseId}` : null;
  const [draftPrompt, setDraftPrompt] = useState(null);
  const draftCheckedRef = useRef(false);

  const saveDraft = (questionGroups) => {
    if (!draftKey || questionGroups.length === 0) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ questionGroups, savedAt: new Date().toISOString() })
      );
    } catch (error) {
      console.warn("Failed to save draft to localStorage:", error);
    }
  };

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
        const totalQuestions = draft.questionGroups.reduce(
          (sum, g) => sum + g.los.reduce((s, lo) => s + lo.questions.length, 0),
          0
        );
        const savedAt = draft.savedAt
          ? new Date(draft.savedAt).toLocaleString()
          : "a previous session";
        setDraftPrompt({ draft, totalQuestions, savedAt });
      }
    } catch {
      // Corrupt draft — ignore
    }
  }, [draftKey]);

  return {
    draftPrompt,
    dismissDraftPrompt: () => setDraftPrompt(null),
    saveDraft,
    clearDraft,
  };
}
