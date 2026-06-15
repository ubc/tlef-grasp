import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useCourseMaterials(courseId) {
  const query = useQuery({
    queryKey: queryKeys.materials(courseId),
    queryFn: () => api.get(`/api/material/course/${courseId}`),
    enabled: !!courseId,
  });

  return { ...query, materials: query.data?.materials || [] };
}

export function useInvalidateMaterials(courseId) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.materials(courseId) });
}

// Upload document files one at a time (matching the legacy flow); resolves
// with { uploaded, errors } so the caller can report per-file failures.
export function useUploadMaterials(courseId, options) {
  const invalidate = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: async (files) => {
      let uploaded = 0;
      const errors = [];
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("courseId", courseId);
          formData.append("sourceId", `${courseId}-${Date.now()}-${Math.random()}`);
          formData.append("documentTitle", file.name);

          const data = await api.post("/api/material/upload", formData);
          if (data.success) {
            uploaded++;
          } else {
            errors.push({ name: file.name, message: "Failed to process file on server" });
          }
        } catch (error) {
          errors.push({ name: file.name, message: error.message });
        }
      }
      return { uploaded, errors };
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

// Add pasted text: first into the RAG knowledge base, then the material record.
export function useAddTextMaterial(course, options) {
  const courseId = course?.id;
  const invalidate = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: async ({ documentTitle, textContent }) => {
      const sourceId = `${courseId}-${Date.now()}-${Math.random()}`;
      await api.post("/api/rag-llm/add-document", {
        content: textContent,
        metadata: {
          source: "",
          type: "text",
          course: course.name,
          courseId,
          sourceId,
          documentTitle,
        },
        courseId,
      });
      return api.post("/api/material/save", {
        sourceId,
        courseId,
        materialData: {
          fileType: "text/plain",
          fileSize: new Blob([textContent]).size,
          fileContent: textContent,
          documentTitle,
        },
      });
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useUpdateMaterial(courseId, options) {
  const invalidate = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: (payload) => api.post("/api/material/update", payload),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

// Re-download a link material's content and re-index it.
export function useRefetchLinkMaterial(courseId, options) {
  const invalidate = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: async (material) => {
      const fetchData = await api.post("/api/material/fetch-url-content", {
        url: material.fileContent,
      });
      if (!fetchData.success || !fetchData.content) {
        throw new Error("No content retrieved from URL");
      }
      const data = await api.post("/api/material/refetch", {
        sourceId: material.sourceId,
        courseId: material.courseId || courseId,
        url: material.fileContent,
        content: fetchData.content,
      });
      if (!data.success) {
        throw new Error(data.error || "Failed to refetch material");
      }
      return data;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

// Remove a material from the RAG index first, then delete the record.
export function useDeleteMaterial(courseId, options) {
  const invalidate = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: async (material) => {
      const ragData = await api.delete(
        `/api/rag-llm/delete-document/${material.sourceId}`
      );
      if (!ragData.success) {
        throw new Error("Failed to delete material from RAG");
      }
      const dbData = await api.delete(`/api/material/delete/${material.sourceId}`);
      if (!dbData.success) {
        throw new Error("Failed to delete material from database");
      }
      return dbData;
    },
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}
