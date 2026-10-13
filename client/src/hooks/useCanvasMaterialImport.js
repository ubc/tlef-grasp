import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lmsRequest } from "../lib/lmsApi";
import { queryKeys } from "../lib/queryKeys";
import { markCanvasDisconnected } from "./useCanvasIntegration";

// Importing Canvas course files into Course Materials (issue #141).

const importBase = (courseId) =>
  `/api/lms/canvas/courses/${encodeURIComponent(courseId)}/materials/canvas-courses`;

// The Canvas courses this instructor's own linked sections point to.
export function useCanvasImportCourses(courseId, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canvasMaterialCourses(courseId),
    queryFn: async () => {
      try {
        return await lmsRequest(importBase(courseId));
      } catch (error) {
        markCanvasDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && enabled,
    retry: false,
  });
  return { ...query, courses: query.data?.courses || [] };
}

// One Canvas course's importable files, newest first.
export function useCanvasCourseFiles(courseId, canvasCourseId, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canvasMaterialFiles(courseId, canvasCourseId),
    queryFn: async () => {
      try {
        return await lmsRequest(
          `${importBase(courseId)}/${encodeURIComponent(canvasCourseId)}/files`
        );
      } catch (error) {
        markCanvasDisconnected(queryClient, error);
        throw error;
      }
    },
    enabled: !!courseId && !!canvasCourseId && enabled,
    retry: false,
    // Canvas is the source of truth and files change there: always re-read
    // when the picker opens.
    staleTime: 0,
    gcTime: 0,
  });
  return {
    ...query,
    files: query.data?.files || [],
    maxFileBytes: query.data?.maxFileBytes || 0,
  };
}

// Import the picked files one at a time (each is parsed and indexed on the
// server, like an upload). One file failing does not stop the others, except
// when Canvas refuses the token: then every later file would fail the same way.
// Resolves with { imported: [{ id, name }], errors: [{ id, name, message }] };
// onProgress(fileId, "importing" | "imported" | "failed", message) reports each
// file as it goes.
export function useImportCanvasFiles(courseId, options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ canvasCourseId, files, onProgress }) => {
      const imported = [];
      const errors = [];
      let disconnected = null;

      for (const file of files) {
        if (disconnected) {
          errors.push({ id: file.id, name: file.name, message: disconnected });
          onProgress?.(file.id, "failed", disconnected);
          continue;
        }
        onProgress?.(file.id, "importing");
        try {
          await lmsRequest(
            `${importBase(courseId)}/${encodeURIComponent(canvasCourseId)}/files/${encodeURIComponent(file.id)}/import`,
            { method: "POST" }
          );
          imported.push({ id: file.id, name: file.name });
          onProgress?.(file.id, "imported");
        } catch (error) {
          // Someone else imported it in the meantime: it is in the course, which
          // is what was asked for.
          if (error.body?.code === "already-imported") {
            imported.push({ id: file.id, name: file.name });
            onProgress?.(file.id, "imported");
            continue;
          }
          const message = error.message || "Import failed";
          if (error.body?.connected === false) {
            markCanvasDisconnected(queryClient, error);
            disconnected = message;
          }
          errors.push({ id: file.id, name: file.name, message });
          onProgress?.(file.id, "failed", message);
        }
      }
      return { imported, errors };
    },
    ...options,
    onSuccess: (data, variables, ...rest) => {
      if (data.imported.length > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.materials(courseId) });
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.canvasMaterialFiles(courseId, variables.canvasCourseId),
      });
      options?.onSuccess?.(data, variables, ...rest);
    },
  });
}
