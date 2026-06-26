import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

// A single course shell (needed for its campus + ubcCourseId on the My Sections page).
export function useCourse(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.course(courseId),
    queryFn: () => api.get(`/api/courses/${courseId}`),
    enabled: !!courseId && enabled,
  });
  return { ...query, course: query.data?.success ? query.data.course : null };
}

// All sections belonging to a course shell (used by the Users section filter).
export function useCourseSections(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.courseSections(courseId),
    queryFn: () => api.get(`/api/courses/${courseId}/sections`),
    enabled: !!courseId && enabled,
  });
  return { ...query, sections: query.data?.sections || [] };
}

// Sections of a course the current viewer may see: course owner and app
// administrators get all sections; other instructors get only their own.
export function useVisibleCourseSections(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.visibleCourseSections(courseId),
    queryFn: () => api.get(`/api/courses/${courseId}/visible-sections`),
    enabled: !!courseId && enabled,
  });
  return { ...query, sections: query.data?.sections || [] };
}

// Sections of a course that the current instructor owns/manages (My Sections page).
export function useMyCourseSections(courseId) {
  const query = useQuery({
    queryKey: queryKeys.myCourseSections(courseId),
    queryFn: () => api.get(`/api/courses/${courseId}/my-sections`),
    enabled: !!courseId,
  });
  return { ...query, sections: query.data?.sections || [] };
}

function useInvalidateSections(courseId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.myCourseSections(courseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.courseSections(courseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.courseUsers(courseId) });
  };
}

export function useAddSections(courseId, options) {
  const invalidate = useInvalidateSections(courseId);
  return useMutation({
    mutationFn: (payload) => api.post(`/api/courses/${courseId}/sections`, payload),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useRecycleSection(courseId, options) {
  const invalidate = useInvalidateSections(courseId);
  return useMutation({
    mutationFn: (sectionId) =>
      api.post(`/api/courses/${courseId}/sections/${sectionId}/recycle`, {}),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useSyncSectionStudents(courseId, options) {
  const invalidate = useInvalidateSections(courseId);
  return useMutation({
    mutationFn: ({ sectionId, academicPeriod, academicPeriodName }) =>
      api.post(`/api/courses/${courseId}/sections`, {
        sectionIds: [sectionId],
        academicPeriod,
        academicPeriodName,
        syncStudents: true,
      }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}
