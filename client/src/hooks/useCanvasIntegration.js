import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

async function parseResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? response.json().catch(() => null)
    : response.text().catch(() => null);
}

async function canvasRequest(path, options = {}) {
  const response = await fetch(path, options);
  const data = await parseResponse(response);

  if (!response.ok) {
    if (response.status === 401 && data?.authenticated === false) {
      if (window.location.pathname !== "/") window.location.href = "/";
    }
    const message =
      (data && (data.error || data.message)) ||
      `Canvas request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }
  return data;
}

function markCanvasDisconnected(queryClient, error) {
  if (error?.body?.connected !== false) return;
  queryClient.setQueryData(queryKeys.canvasStatus, (current) => ({
    ...current,
    configured: true,
    connected: false,
  }));
}

export function useCanvasStatus() {
  const query = useQuery({
    queryKey: queryKeys.canvasStatus,
    queryFn: async () => {
      const response = await fetch("/api/lms/canvas/status");
      const data = await parseResponse(response);

      // A missing deployment configuration is an expected feature-probe
      // result, not an application error.
      if (response.status === 404 && data?.configured === false) {
        return { configured: false, connected: false };
      }
      // Canvas's requireAuth middleware uses 401 to mean the GRASP session is
      // valid but this user has no usable Canvas token.
      if (response.status === 401 && data?.connected === false) {
        return { configured: true, connected: false };
      }
      if (response.status === 401) {
        if (window.location.pathname !== "/") window.location.href = "/";
        throw new ApiError("Not authenticated", 401, data);
      }
      if (!response.ok) {
        throw new ApiError(
          data?.error || `Canvas status failed with status ${response.status}`,
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
    canvasDomain: query.data?.canvasDomain || "",
  };
}

const sectionPath = (courseId, sectionId) =>
  `/api/lms/canvas/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}`;

export function useAvailableCanvasCourses(
  courseId,
  sectionId,
  { enabled = true } = {}
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canvasAvailableCourses(courseId, sectionId),
    queryFn: async () => {
      try {
        return await canvasRequest(
          `${sectionPath(courseId, sectionId)}/available-courses`
        );
      } catch (error) {
        markCanvasDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!sectionId && enabled,
    retry: false,
  });
  return { ...query, courses: query.data?.courses || [] };
}

export function useCanvasSections(
  courseId,
  sectionId,
  canvasCourseId,
  { enabled = true } = {}
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canvasSections(courseId, sectionId, canvasCourseId),
    queryFn: async () => {
      try {
        return await canvasRequest(
          `${sectionPath(courseId, sectionId)}/canvas-courses/${encodeURIComponent(canvasCourseId)}/sections`
        );
      } catch (error) {
        markCanvasDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!sectionId && !!canvasCourseId && enabled,
    retry: false,
  });
  return { ...query, sections: query.data?.sections || [] };
}

export function useLinkCanvasSection(courseId, sectionId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ canvasCourseId, canvasSectionId }) =>
      canvasRequest(`${sectionPath(courseId, sectionId)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasCourseId, canvasSectionId }),
      }),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myCourseSections(courseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.courseSections(courseId) });
      options?.onSuccess?.(...args);
    },
    onError: (error, ...args) => {
      markCanvasDisconnected(queryClient, error);
      options?.onError?.(error, ...args);
    },
  });
}

export function useUnlinkLmsSection(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sectionId) =>
      canvasRequest(`${sectionPath(courseId, sectionId)}/link`, {
        method: "DELETE",
      }),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myCourseSections(courseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.courseSections(courseId) });
      options?.onSuccess?.(...args);
    },
  });
}

export function useDisconnectCanvas(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      canvasRequest("/api/lms/canvas/auth/logout", { method: "POST" }),
    ...options,
    onSuccess: (...args) => {
      queryClient.setQueryData(queryKeys.canvasStatus, (current) => ({
        ...current,
        configured: true,
        connected: false,
      }));
      queryClient.removeQueries({ queryKey: ["canvas", "available-courses"] });
      options?.onSuccess?.(...args);
    },
  });
}
