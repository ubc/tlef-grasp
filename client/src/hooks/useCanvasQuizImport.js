import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import {
  CANVAS_COMMIT_URL,
  CANVAS_PREVIEW_URL,
  canvasCommitForm,
  canvasPreviewForm,
  commitQuizzesInOrder,
} from "../lib/canvasImport";
import { useInvalidateQuestions } from "./useQuestions";
import { useInvalidateObjectives } from "./useObjectives";

// Importing a Canvas Classic Quizzes export into the question bank (issue #140).
// The zip is sent again with every request: the server keeps nothing between
// the preview and the commits.
export function useCanvasQuizImport(courseId) {
  const queryClient = useQueryClient();
  const invalidateQuestions = useInvalidateQuestions(courseId);
  const invalidateObjectives = useInvalidateObjectives(courseId);

  // Resolves with the PreviewReport plus { permissions }; nothing is written.
  const preview = (file) => api.post(CANVAS_PREVIEW_URL, canvasPreviewForm(file, courseId));

  // One request per Canvas quiz, in queue order. Resolves with
  // { reports, errors }; see commitQuizzesInOrder for onProgress.
  const commitAll = async (file, queue, onProgress) => {
    try {
      return await commitQuizzesInOrder(
        queue,
        (entry) => api.post(CANVAS_COMMIT_URL, canvasCommitForm(file, courseId, entry)),
        onProgress
      );
    } finally {
      // Even a run that failed part-way may have saved questions, objectives
      // (with the "From Canvas" material) and quizzes. (invalidateQuestions
      // covers quizzesWithQuestions.)
      invalidateQuestions();
      invalidateObjectives();
      queryClient.invalidateQueries({ queryKey: queryKeys.quizzes(courseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.materials(courseId) });
    }
  };

  return { preview, commitAll };
}
