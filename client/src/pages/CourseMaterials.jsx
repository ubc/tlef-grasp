import { useEffect, useRef, useState } from "react";
import { useSelectedCourse } from "../stores/appStore";
import {
  useCourseMaterials,
  useUploadMaterials,
  useAddTextMaterial,
  useUpdateMaterial,
  useRefetchLinkMaterial,
  useDeleteMaterial,
} from "../hooks/useMaterials";
import { filterSupportedDocuments } from "../lib/materials";
import { useToast } from "../components/ui/Toast";
import { LoadingState, EmptyState } from "../components/ui/states";
import UploadSection from "./course-materials/UploadSection";
import MaterialCard from "./course-materials/MaterialCard";
import {
  MaterialFormModal,
  DeleteMaterialModal,
} from "./course-materials/MaterialModals";

// Maps the modal kind to the /api/material/update payload it produces.
const EDIT_CONFIG = {
  "text-edit": {
    documentType: "text",
    successMessage: "Textbook updated successfully",
    buildData: (content) => ({ textContent: content }),
    validate: (content) => (content ? null : "Please enter some content"),
  },
  "pdf-edit": {
    documentType: "pdf",
    successMessage: "PDF updated successfully",
    buildData: () => ({}),
    validate: () => null,
  },
  "link-edit": {
    documentType: "link",
    successMessage: "Link updated successfully",
    buildData: (content) => ({ url: content }),
    validate: (content) => (content ? null : "Please enter a URL"),
  },
};

export default function CourseMaterials() {
  const showToast = useToast();
  const selectedCourse = useSelectedCourse();
  const courseId = selectedCourse?.id;

  const [showUpload, setShowUpload] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  // { kind: 'text-add' | 'text-edit' | 'pdf-edit' | 'link-edit' | 'delete', material? }
  const [modal, setModal] = useState(null);
  const autoShownRef = useRef(false);

  const { materials, isPending, isSuccess } = useCourseMaterials(courseId);

  // Show the upload section by default when the course has no materials yet
  useEffect(() => {
    if (!autoShownRef.current && isSuccess && materials.length === 0) {
      autoShownRef.current = true;
      setShowUpload(true);
    }
  }, [isSuccess, materials.length]);

  const filteredMaterials = materials.filter(
    (material) =>
      typeFilter === "all" || (material.fileType || "").includes(typeFilter)
  );

  /* ------------------------------ Mutations ------------------------------ */

  const uploadMutation = useUploadMaterials(courseId, {
    onSuccess: ({ uploaded, errors }) => {
      errors.forEach((error) =>
        showToast(`Failed to upload ${error.name}: ${error.message}`, "error")
      );
      if (uploaded > 0) {
        showToast(`${uploaded} file(s) uploaded successfully`, "success");
      }
      setShowUpload(false);
    },
  });

  const addTextMutation = useAddTextMaterial(selectedCourse, {
    onSuccess: () => {
      setModal(null);
      setShowUpload(false);
      showToast("Text content added", "success");
    },
    onError: () => showToast("Error adding text content. Please try again.", "error"),
  });

  const updateMutation = useUpdateMaterial(courseId, {
    onSuccess: (data, variables) => {
      if (!data.success) {
        showToast(data.error || "Failed to update material", "error");
        return;
      }
      setModal(null);
      showToast(EDIT_CONFIG[variables.kind]?.successMessage || "Material updated", "success");
    },
    onError: (error) =>
      showToast(error.message || "Error updating material. Please try again.", "error"),
  });

  const refetchMutation = useRefetchLinkMaterial(courseId, {
    onMutate: () => showToast("Refetching URL content...", "info"),
    onSuccess: () => showToast("Link content refetched successfully", "success"),
    onError: () =>
      showToast("Error refetching link content. Please try again.", "error"),
  });

  const deleteMutation = useDeleteMaterial(courseId, {
    onSuccess: () => showToast("Material deleted successfully", "success"),
    onError: () => showToast("Error deleting material. Please try again.", "error"),
  });

  /* ------------------------------- Handlers ------------------------------ */

  const handleFiles = (rawFiles) => {
    const { validFiles, hasInvalid } = filterSupportedDocuments(Array.from(rawFiles));
    if (hasInvalid) {
      showToast(
        "PDF, DOC, and DOCX are the only supported file formats at this time. Additional file formats will be supported soon.",
        "error"
      );
    }
    if (validFiles.length === 0) return;
    if (!selectedCourse) {
      showToast(
        "Please select a course before uploading files for proper organization.",
        "warning"
      );
      return;
    }
    uploadMutation.mutate(validFiles);
  };

  const handleModalSubmit = ({ title, content }) => {
    if (modal.kind === "text-add") {
      if (!content) {
        showToast("Please enter some content", "error");
        return;
      }
      if (!selectedCourse) {
        showToast("Please select a course first", "error");
        return;
      }
      addTextMutation.mutate({ documentTitle: title, textContent: content });
      return;
    }

    const config = EDIT_CONFIG[modal.kind];
    const validationError = config.validate(content);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    if (modal.kind === "link-edit") showToast("Updating link...", "info");
    updateMutation.mutate({
      kind: modal.kind,
      sourceId: modal.material.sourceId,
      courseId: modal.material.courseId || courseId,
      documentType: config.documentType,
      documentData: config.buildData(content),
      documentTitle: title,
    });
  };

  const handleRefetch = (material) => {
    if (!material.sourceId || !material.fileContent) {
      showToast("Error: Material information not found", "error");
      return;
    }
    refetchMutation.mutate(material);
  };

  /* -------------------------------- Render ------------------------------- */

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Course Materials</h1>
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
        >
          <i className={`fas ${showUpload ? "fa-times" : "fa-plus"}`} />
          <span>{showUpload ? "Hide Upload" : "Upload Materials"}</span>
        </button>
      </div>

      {showUpload && (
        <UploadSection
          uploading={uploadMutation.isPending}
          onFiles={handleFiles}
          onAddText={() => setModal({ kind: "text-add" })}
        />
      )}

      {/* Filter */}
      <div className="mb-6">
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="all">All Types</option>
          <option value="pdf">PDF</option>
          <option value="text">Textbook</option>
          <option value="link">Link</option>
        </select>
      </div>

      {/* Materials grid */}
      {isPending && courseId ? (
        <LoadingState label="Loading materials..." />
      ) : filteredMaterials.length === 0 ? (
        <EmptyState
          icon="fa-search"
          title="No materials found"
          message="Try adjusting your filters or search terms to find what you're looking for."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredMaterials.map((material) => (
            <MaterialCard
              key={material.sourceId || material._id}
              material={material}
              onEdit={(kind, m) => setModal({ kind, material: m })}
              onRefetch={handleRefetch}
              onDelete={(m) => setModal({ kind: "delete", material: m })}
            />
          ))}
        </div>
      )}

      {modal && modal.kind !== "delete" && (
        <MaterialFormModal
          kind={modal.kind}
          material={modal.material}
          busy={addTextMutation.isPending || updateMutation.isPending}
          onClose={() => setModal(null)}
          onSubmit={handleModalSubmit}
        />
      )}

      {modal?.kind === "delete" && (
        <DeleteMaterialModal
          material={modal.material}
          onClose={() => setModal(null)}
          onConfirm={() => {
            setModal(null);
            deleteMutation.mutate(modal.material);
          }}
        />
      )}
    </div>
  );
}
