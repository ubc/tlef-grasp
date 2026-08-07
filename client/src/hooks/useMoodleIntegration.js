import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../lib/api";
import { lmsRequest, parseLmsResponse } from "../lib/lmsApi";
import { queryKeys } from "../lib/queryKeys";

function markMoodleDisconnected(queryClient, error) {
  if (error?.body?.connected !== false) return;
  queryClient.setQueryData(queryKeys.moodleStatus, (current) => ({
    ...current,
    configured: true,
    connected: false,
  }));
}

export function useMoodleStatus() {
  const query = useQuery({
    queryKey: queryKeys.moodleStatus,
    queryFn: async () => {
      const response = await fetch("/api/lms/moodle/status");
      const data = await parseLmsResponse(response);

      if (response.status === 404 && data?.configured === false) {
        return { configured: false, connected: false };
      }
      if (response.status === 401 && data?.connected === false) {
        return { configured: true, connected: false };
      }
      if (response.status === 401) {
        if (window.location.pathname !== "/") window.location.href = "/";
        throw new ApiError("Not authenticated", 401, data);
      }
      if (!response.ok) {
        throw new ApiError(
          data?.error || `Moodle status failed with status ${response.status}`,
          response.status,
          data
        );
      }
      return data;
    },
    retry: false,
  });

  return {
    ...query,
    configured: query.data?.configured === true,
    connected: query.data?.connected === true,
    moodleDomain: query.data?.moodleDomain || "",
  };
}

const sectionPath = (courseId, sectionId) =>
  `/api/lms/moodle/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}`;

export function useConnectMoodle(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token) =>
      lmsRequest("/api/lms/moodle/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    ...options,
    onSuccess: (data, ...args) => {
      queryClient.setQueryData(queryKeys.moodleStatus, (current) => ({
        ...current,
        configured: true,
        connected: true,
      }));
      options?.onSuccess?.(data, ...args);
    },
  });
}

export function useDisconnectMoodle(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      lmsRequest("/api/lms/moodle/auth/disconnect", { method: "POST" }),
    ...options,
    onSuccess: (...args) => {
      queryClient.setQueryData(queryKeys.moodleStatus, (current) => ({
        ...current,
        configured: true,
        connected: false,
      }));
      queryClient.removeQueries({ queryKey: ["moodle", "available-courses"] });
      queryClient.removeQueries({ queryKey: ["moodle", "groups"] });
      options?.onSuccess?.(...args);
    },
  });
}

export function useAvailableMoodleCourses(
  courseId,
  sectionId,
  { enabled = true } = {}
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.moodleAvailableCourses(courseId, sectionId),
    queryFn: async () => {
      try {
        return await lmsRequest(
          `${sectionPath(courseId, sectionId)}/available-courses`
        );
      } catch (error) {
        markMoodleDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!sectionId && enabled,
    retry: false,
  });
  return { ...query, courses: query.data?.courses || [] };
}

export function useMoodleGroups(
  courseId,
  sectionId,
  moodleCourseId,
  { enabled = true } = {}
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.moodleGroups(courseId, sectionId, moodleCourseId),
    queryFn: async () => {
      try {
        return await lmsRequest(
          `${sectionPath(courseId, sectionId)}/moodle-courses/${encodeURIComponent(moodleCourseId)}/groups`
        );
      } catch (error) {
        markMoodleDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!sectionId && !!moodleCourseId && enabled,
    retry: false,
  });
  return { ...query, groups: query.data?.groups || [] };
}

export function useLinkMoodleSection(courseId, sectionId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ moodleCourseId, moodleGroupId }) =>
      lmsRequest(`${sectionPath(courseId, sectionId)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moodleCourseId, moodleGroupId }),
      }),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myCourseSections(courseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.courseSections(courseId) });
      options?.onSuccess?.(...args);
    },
    onError: (error, ...args) => {
      markMoodleDisconnected(queryClient, error);
      options?.onError?.(error, ...args);
    },
  });
}
