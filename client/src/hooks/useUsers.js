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

// Search-only picker for adding someone by hand (issue #115): the server
// returns at most a handful of non-member accounts matching an email or name,
// never the whole user base. Disabled below the server's minimum query length.
export const USER_SEARCH_MIN_LENGTH = 3;

export function useSearchUsersNotInCourse(courseId, query) {
  const trimmed = (query || "").trim();
  const enabled = !!courseId && trimmed.length >= USER_SEARCH_MIN_LENGTH;
  const result = useQuery({
    queryKey: queryKeys.userSearch(courseId, trimmed),
    queryFn: () =>
      api.get(
        `/api/users/search/not-in-course/${courseId}?q=${encodeURIComponent(trimmed)}`
      ),
    enabled,
    // Roster changes invalidate this via useInvalidateUserLists; otherwise a
    // repeated search for the same text can reuse the result briefly.
    staleTime: 30 * 1000,
  });

  return { ...result, users: result.data?.users || [], enabled };
}

// Who granted, changed, or revoked access in this course, newest first.
export function useCourseAccessLog(courseId, { enabled = true } = {}) {
  const result = useQuery({
    queryKey: queryKeys.courseAccessLog(courseId),
    queryFn: () => api.get(`/api/users/course/${courseId}/access-log`),
    enabled: !!courseId && enabled,
  });

  return { ...result, events: result.data?.events || [] };
}

function useInvalidateUserLists(courseId) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.courseUsers(courseId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.availableUsers(courseId) });
    queryClient.invalidateQueries({ queryKey: ["user-search", courseId] });
    queryClient.invalidateQueries({ queryKey: queryKeys.courseAccessLog(courseId) });
  };
}

// role: "member" (effective role follows the account's affiliation) or "ta".
export function useAddUserToCourse(courseId, options) {
  const invalidate = useInvalidateUserLists(courseId);
  return useMutation({
    mutationFn: ({ userId, role = "member" }) =>
      api.post(`/api/users/course/${courseId}/add`, { userId, role }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function usePromoteToTa(courseId, options) {
  const invalidate = useInvalidateUserLists(courseId);
  return useMutation({
    mutationFn: (userId) =>
      api.post(`/api/users/course/${courseId}/promote`, { userId }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useDemoteToStudent(courseId, options) {
  const invalidate = useInvalidateUserLists(courseId);
  return useMutation({
    mutationFn: (userId) =>
      api.post(`/api/users/course/${courseId}/demote`, { userId }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useUpdateTaPermissions(courseId, options) {
  const invalidate = useInvalidateUserLists(courseId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, permissions }) =>
      api.put(`/api/users/course/${courseId}/ta-permissions`, { userId, permissions }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      // The affected TA's own nav/guards read this query.
      queryClient.invalidateQueries({ queryKey: queryKeys.courseAccess(courseId) });
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
