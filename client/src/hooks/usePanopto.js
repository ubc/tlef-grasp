import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../lib/api";
import { lmsRequest, parseLmsResponse } from "../lib/lmsApi";
import { queryKeys } from "../lib/queryKeys";

// Each instructor connects their own Panopto account (server: routes/panopto.js)
// and imports a video's captions into Course Materials.

// A 409 with connected:false means this user has no usable Panopto sign-in:
// flip the cached status so every Panopto control offers "Connect Panopto".
function markPanoptoDisconnected(queryClient, error) {
  if (error?.body?.connected !== false) return;
  queryClient.setQueryData(queryKeys.panoptoStatus, (current) => ({
    ...current,
    configured: true,
    connected: false,
  }));
}

export function usePanoptoStatus() {
  const query = useQuery({
    queryKey: queryKeys.panoptoStatus,
    queryFn: async () => {
      const response = await fetch("/api/panopto/status");
      const data = await parseLmsResponse(response);
      // Not configured on this deployment: an expected answer that hides
      // Panopto, not an error.
      if (response.status === 404 && data?.configured === false) {
        return { configured: false, connected: false };
      }
      if (response.status === 401) {
        if (window.location.pathname !== "/") window.location.href = "/";
        throw new ApiError("Not authenticated", 401, data);
      }
      if (!response.ok) {
        throw new ApiError(
          data?.error || `Panopto status failed with status ${response.status}`,
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
    host: query.data?.host || "",
  };
}

export function useDisconnectPanopto(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => lmsRequest("/api/panopto/auth/disconnect", { method: "POST" }),
    ...options,
    onSuccess: (...args) => {
      queryClient.setQueryData(queryKeys.panoptoStatus, (current) => ({
        ...current,
        configured: true,
        connected: false,
      }));
      queryClient.removeQueries({ queryKey: ["panopto", "folders"] });
      queryClient.removeQueries({ queryKey: ["panopto", "folder-sessions"] });
      options?.onSuccess?.(...args);
    },
  });
}

// The Panopto folders this user creates videos in.
export function usePanoptoFolders({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.panoptoFolders,
    queryFn: async () => {
      try {
        return await lmsRequest("/api/panopto/folders");
      } catch (error) {
        markPanoptoDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled,
    retry: false,
  });
  return { ...query, folders: query.data?.folders || [] };
}

const materialsBase = (courseId) =>
  `/api/panopto/courses/${encodeURIComponent(courseId)}/materials`;

// One folder's videos, newest first, each marked when already imported here.
export function usePanoptoFolderSessions(courseId, folderId) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.panoptoFolderSessions(courseId, folderId),
    queryFn: async () => {
      try {
        return await lmsRequest(
          `${materialsBase(courseId)}/folders/${encodeURIComponent(folderId)}/sessions`
        );
      } catch (error) {
        markPanoptoDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!folderId,
    retry: false,
    // Panopto is the source of truth: re-read whenever the picker opens.
    staleTime: 0,
    gcTime: 0,
  });
  return { ...query, sessions: query.data?.sessions || [] };
}

// Import the picked videos one at a time (each is indexed and outlined on the
// server, like an upload). One failing does not stop the others, except when
// the Panopto connection is gone: then every later one would fail the same way.
// Resolves with { imported: [{ id, name }], errors: [{ id, name, message }] };
// onProgress(sessionId, "importing" | "imported" | "failed", message) reports
// each video as it goes.
export function useImportPanoptoSessions(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessions, onProgress }) => {
      const imported = [];
      const errors = [];
      let disconnected = null;

      for (const session of sessions) {
        if (disconnected) {
          errors.push({ id: session.id, name: session.name, message: disconnected });
          onProgress?.(session.id, "failed", disconnected);
          continue;
        }
        onProgress?.(session.id, "importing");
        try {
          await lmsRequest(
            `${materialsBase(courseId)}/sessions/${encodeURIComponent(session.id)}/import`,
            { method: "POST" }
          );
          imported.push({ id: session.id, name: session.name });
          onProgress?.(session.id, "imported");
        } catch (error) {
          // Imported by someone else in the meantime: it is in the course,
          // which is what was asked for.
          if (error.body?.code === "already-imported") {
            imported.push({ id: session.id, name: session.name });
            onProgress?.(session.id, "imported");
            continue;
          }
          const message = error.message || "Import failed";
          if (error.body?.connected === false) {
            markPanoptoDisconnected(queryClient, error);
            disconnected = message;
          }
          errors.push({ id: session.id, name: session.name, message });
          onProgress?.(session.id, "failed", message);
        }
      }
      return { imported, errors };
    },
    ...options,
    onSuccess: (data, variables, ...rest) => {
      if (data.imported.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.materials(courseId) });
      }
      queryClient.invalidateQueries({ queryKey: ["panopto", "folder-sessions", courseId] });
      options?.onSuccess?.(data, variables, ...rest);
    },
  });
}
