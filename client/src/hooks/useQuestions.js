import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAppStore } from "../stores/appStore";

// All questions for the currently selected course.
export function useQuestions() {
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;

  const query = useQuery({
    queryKey: ["questions", courseId],
    queryFn: () => api.get(`/api/question?courseId=${courseId}`),
    enabled: !!courseId,
  });

  return {
    ...query,
    questions: query.data?.success ? query.data.questions || [] : [],
  };
}
