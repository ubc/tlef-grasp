import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

// UBC API lookups backing the onboarding course-setup flow:
// Campus -> Academic Period -> the instructor's CWL-attached sections.

export function useCampuses({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.ubcCampuses,
    queryFn: () => api.get("/api/ubc/campuses"),
    enabled,
    staleTime: 60 * 60 * 1000, // campuses rarely change
  });
  return { ...query, campuses: query.data?.data || [] };
}

export function useAcademicPeriods(campus) {
  const query = useQuery({
    queryKey: queryKeys.ubcAcademicPeriods(campus),
    queryFn: () =>
      api.get(`/api/ubc/academic-periods?campus=${encodeURIComponent(campus)}`),
    enabled: !!campus,
    staleTime: 60 * 60 * 1000,
  });
  return { ...query, periods: query.data?.data || [] };
}

// The instructor's sections for an academic period (keyed off their session PUID).
export function useInstructorSections(academicPeriod) {
  const query = useQuery({
    queryKey: queryKeys.ubcInstructorSections(academicPeriod),
    queryFn: () =>
      api.get(
        `/api/ubc/instructor-sections?academicPeriod=${encodeURIComponent(academicPeriod)}`
      ),
    enabled: !!academicPeriod,
  });
  return { ...query, sections: query.data?.data || [] };
}

// Create a course shell from selected UBC sections. On a name/section clash the
// API replies 409 with { error: "existing_shell", existing: {...} }; api.js
// surfaces that as ApiError with .status === 409 and .body, which the caller
// inspects to offer "create anyway" (force: true).
export function useCreateUbcCourse(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/api/courses/new", payload),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["my-courses"] });
      options?.onSuccess?.(...args);
    },
  });
}
