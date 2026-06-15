import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useCourseUsers(courseId) {
  const query = useQuery({
    queryKey: queryKeys.courseUsers(courseId),
    queryFn: () => api.get(`/api/users/course/${courseId}`),
    enabled: !!courseId,
  });

  return { ...query, users: query.data?.users || [] };
}

export function useAvailableUsers(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.availableUsers(courseId),
    queryFn: () => api.get(`/api/users/all/not-in-course/${courseId}`),
    enabled: !!courseId && enabled,
  });

  return { ...query, users: query.data?.users || [] };
}

function useInvalidateUserLists(courseId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.courseUsers(courseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.availableUsers(courseId) });
  };
}

export function useAddUserToCourse(courseId, options) {
  const invalidate = useInvalidateUserLists(courseId);
  return useMutation({
    mutationFn: (userId) => api.post(`/api/users/course/${courseId}/add`, { userId }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useRemoveUserFromCourse(courseId, options) {
  const invalidate = useInvalidateUserLists(courseId);
  return useMutation({
    mutationFn: (userId) =>
      api.delete(`/api/users/course/${courseId}/remove/${userId}`),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}
