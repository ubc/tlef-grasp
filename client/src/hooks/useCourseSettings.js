import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useCourseSettings(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.courseSettings(courseId),
    queryFn: () => api.get(`/api/courses/${courseId}/settings`),
    enabled: !!courseId && enabled,
  });

  return { ...query, settings: query.data?.settings || null };
}

export function useSettingsDefaults() {
  const query = useQuery({
    queryKey: queryKeys.settingsDefaults,
    queryFn: () => api.get("/api/courses/defaults/settings"),
  });

  return { ...query, defaults: query.data?.defaults || null };
}

export function useEnrollmentCode(courseId) {
  const query = useQuery({
    queryKey: queryKeys.enrollmentCode(courseId),
    queryFn: () => api.get(`/api/courses/${courseId}/enrollment-code`),
    enabled: !!courseId,
  });

  return { ...query, enrollmentCode: query.data?.enrollmentCode || "" };
}

export function useSaveCourseSettings(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.put(`/api/courses/${courseId}/settings`, payload),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.courseSettings(courseId),
      });
      options?.onSuccess?.(...args);
    },
  });
}

export function useRegenerateEnrollmentCode(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post(`/api/courses/${courseId}/regenerate-enrollment-code`, {}),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.enrollmentCode(courseId),
      });
      options?.onSuccess?.(...args);
    },
  });
}
