import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAppStore } from "../stores/appStore";
import { useToast } from "../components/ui/Toast";
import Modal from "../components/ui/Modal";

function getTypeIcon(type = "") {
  if (type.includes("pdf")) return "fa-file-pdf";
  if (type.includes("text")) return "fa-file-alt";
  if (type.includes("word")) return "fa-file-word";
  if (type.includes("link")) return "fa-link";
  return "fa-file";
}

function getTypeLabel(type = "") {
  if (type.includes("pdf")) return "PDF";
  if (type.includes("text")) return "TextBook";
  if (type.includes("word")) return "WordDocument";
  if (type.includes("link")) return "Link";
  return "File";
}

const TYPE_ICON_CLASSES = {
  PDF: "bg-red-100 text-red-600",
  TextBook: "bg-blue-100 text-blue-600",
  WordDocument: "bg-indigo-100 text-indigo-600",
  Link: "bg-green-100 text-green-600",
  File: "bg-gray-100 text-gray-600",
};

function formatFileSize(bytes) {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function validateDocumentFiles(files, showToast) {
  const validFiles = [];
  let hasInvalid = false;
  for (const file of files) {
    const fileName = file.name.toLowerCase();
    const isPDF = file.type === "application/pdf" || fileName.endsWith(".pdf");
    const isDOC = file.type === "application/msword" || fileName.endsWith(".doc");
    const isDOCX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx");
    if (isPDF || isDOC || isDOCX) {
      validFiles.push(file);
    } else {
      hasInvalid = true;
    }
  }
  if (hasInvalid) {
    showToast(
      "PDF, DOC, and DOCX are the only supported file formats at this time. Additional file formats will be supported soon.",
      "error"
    );
  }
  return validFiles;
}

const modalInputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none";
const modalBtnSecondary =
  "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50";
const modalBtnPrimary =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60";

export default function CourseMaterials() {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;

  const [showUpload, setShowUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const fileInputRef = useRef(null);
  const autoShownRef = useRef(false);

  // Modal state: { kind: 'text-add' | 'text-edit' | 'pdf-edit' | 'link-edit' | 'delete', material? }
  const [modal, setModal] = useState(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [modalBusy, setModalBusy] = useState(false);

  const materialsQuery = useQuery({
    queryKey: ["materials", courseId],
    queryFn: () => api.get(`/api/material/course/${courseId}`),
    enabled: !!courseId,
  });
  const materials = materialsQuery.data?.materials || [];

  const refetchMaterials = () =>
    queryClient.invalidateQueries({ queryKey: ["materials", courseId] });

  // Show the upload section by default when the course has no materials yet
  useEffect(() => {
    if (
      !autoShownRef.current &&
      materialsQuery.isSuccess &&
      materials.length === 0
    ) {
      autoShownRef.current = true;
      setShowUpload(true);
    }
  }, [materialsQuery.isSuccess, materials.length]);

  const filteredMaterials = materials.filter(
    (material) =>
      typeFilter === "all" || (material.fileType || "").includes(typeFilter)
  );

  const openModal = (kind, material = null) => {
    setModal({ kind, material });
    setModalTitle(material?.documentTitle || "");
    setModalContent(
      kind === "text-edit" || kind === "link-edit" ? material?.fileContent || "" : ""
    );
  };
  const closeModal = () => {
    setModal(null);
    setModalTitle("");
    setModalContent("");
    setModalBusy(false);
  };

  /* ----------------------------- File upload ----------------------------- */

  const uploadFiles = async (rawFiles) => {
    const files = validateDocumentFiles(Array.from(rawFiles), showToast);
    if (files.length === 0) return;
    if (!selectedCourse) {
      showToast(
        "Please select a course before uploading files for proper organization.",
        "warning"
      );
      return;
    }

    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        try {
          const sourceId = `${courseId}-${Date.now()}-${Math.random()}`;
          const formData = new FormData();
          formData.append("file", file);
          formData.append("courseId", courseId);
          formData.append("sourceId", sourceId);
          formData.append("documentTitle", file.name);

          const data = await api.post("/api/material/upload", formData);
          if (data.success) {
            uploaded++;
          } else {
            showToast("Failed to process file on server", "error");
          }
        } catch (error) {
          console.error("Error processing file:", error);
          showToast(`Failed to upload ${file.name}: ${error.message}`, "error");
        }
      }
      if (uploaded > 0) {
        showToast(`${uploaded} file(s) uploaded successfully`, "success");
      }
      refetchMaterials();
      setShowUpload(false);
    } finally {
      setUploading(false);
    }
  };

  /* ------------------------------ Text add ------------------------------- */

  const saveTextContent = async () => {
    const textContent = modalContent.trim();
    if (!textContent) {
      showToast("Please enter some content", "error");
      return;
    }
    if (!selectedCourse) {
      showToast("Please select a course first", "error");
      return;
    }

    setModalBusy(true);
    try {
      const sourceId = `${courseId}-${Date.now()}-${Math.random()}`;
      const documentTitle = modalTitle.trim();

      // Add to the RAG knowledge base, then persist the material record
      await api.post("/api/rag-llm/add-document", {
        content: textContent,
        metadata: {
          source: "",
          type: "text",
          course: selectedCourse.name,
          courseId,
          sourceId,
          documentTitle,
        },
        courseId,
      });
      await api.post("/api/material/save", {
        sourceId,
        courseId,
        materialData: {
          fileType: "text/plain",
          fileSize: new Blob([textContent]).size,
          fileContent: textContent,
          documentTitle,
        },
      });

      refetchMaterials();
      closeModal();
      setShowUpload(false);
      showToast("Text content added", "success");
    } catch (error) {
      console.error("Error processing text for RAG:", error);
      showToast("Error adding text content. Please try again.", "error");
    } finally {
      setModalBusy(false);
    }
  };

  /* -------------------------------- Edits -------------------------------- */

  const updateMutation = useMutation({
    mutationFn: (payload) => api.post("/api/material/update", payload),
    onSuccess: (data, variables) => {
      if (!data.success) {
        showToast(data.error || "Failed to update material", "error");
        return;
      }
      refetchMaterials();
      closeModal();
      showToast(variables.successMessage || "Material updated successfully", "success");
    },
    onError: (error) =>
      showToast(error.message || "Error updating material. Please try again.", "error"),
  });

  const saveEdit = () => {
    const material = modal.material;
    const documentTitle = modalTitle.trim();

    if (modal.kind === "text-edit") {
      const textContent = modalContent.trim();
      if (!textContent) {
        showToast("Please enter some content", "error");
        return;
      }
      updateMutation.mutate({
        sourceId: material.sourceId,
        courseId: material.courseId || courseId,
        documentType: "text",
        documentData: { textContent },
        documentTitle,
        successMessage: "Textbook updated successfully",
      });
    } else if (modal.kind === "pdf-edit") {
      updateMutation.mutate({
        sourceId: material.sourceId,
        courseId: material.courseId || courseId,
        documentType: "pdf",
        documentData: {},
        documentTitle,
        successMessage: "PDF updated successfully",
      });
    } else if (modal.kind === "link-edit") {
      const url = modalContent.trim();
      if (!url) {
        showToast("Please enter a URL", "error");
        return;
      }
      showToast("Updating link...", "info");
      updateMutation.mutate({
        sourceId: material.sourceId,
        courseId: material.courseId || courseId,
        documentType: "link",
        documentData: { url },
        documentTitle,
        successMessage: "Link updated successfully",
      });
    }
  };

  /* ------------------------------- Refetch ------------------------------- */

  const refetchLink = async (material) => {
    if (!material.sourceId || !material.fileContent) {
      showToast("Error: Material information not found", "error");
      return;
    }
    try {
      showToast("Refetching URL content...", "info");
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
        showToast(data.error || "Failed to refetch material", "error");
        return;
      }
      refetchMaterials();
      showToast("Link content refetched successfully", "success");
    } catch (error) {
      console.error("Error refetching link content:", error);
      showToast("Error refetching link content. Please try again.", "error");
    }
  };

  /* -------------------------------- Delete ------------------------------- */

  const confirmDelete = async (material) => {
    closeModal();
    try {
      // Remove from RAG first, then the material record itself
      const ragData = await api.delete(
        `/api/rag-llm/delete-document/${material.sourceId}`
      );
      if (!ragData.success) {
        showToast("Failed to delete material from RAG", "error");
        return;
      }
      const dbData = await api.delete(`/api/material/delete/${material.sourceId}`);
      if (!dbData.success) {
        showToast("Failed to delete material from database", "error");
        return;
      }
      refetchMaterials();
      showToast("Material deleted successfully", "success");
    } catch (error) {
      console.error("Error deleting material:", error);
      showToast("Error deleting material. Please try again.", "error");
    }
  };

  /* -------------------------------- Render ------------------------------- */

  return (
    <div className="mx-auto max-w-6xl p-8">
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

      {/* Upload section */}
      {showUpload && (
        <div className="mb-8 space-y-5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              if (!uploading) uploadFiles(event.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed bg-white p-10 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-gray-300"
            } ${uploading ? "pointer-events-none" : ""}`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <i className="fas fa-spinner fa-spin text-3xl text-primary" />
                <p className="text-muted">Uploading and processing files...</p>
              </div>
            ) : (
              <>
                <i className="fas fa-cloud-upload-alt mb-3 text-4xl text-primary" />
                <p className="mb-4 text-muted">Drag and drop or choose file</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
                >
                  Choose file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(event) => {
                    uploadFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { type: "text", icon: "fa-file-alt", label: "Text" },
              { type: "pdf", icon: "fa-file-pdf", label: "PDF" },
              { type: "url", icon: "fa-link", label: "URL" },
              { type: "panopto", icon: "fa-video", label: "Panopto" },
            ].map((tile) => (
              <button
                key={tile.type}
                type="button"
                onClick={() => {
                  if (tile.type === "text") openModal("text-add");
                  else if (tile.type === "pdf") fileInputRef.current?.click();
                  else if (tile.type === "url") showToast("URL upload coming soon!", "info");
                  else showToast("Panopto integration coming soon!", "info");
                }}
                className="flex flex-col items-center gap-2 rounded-2xl bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <i className={`fas ${tile.icon} text-2xl text-primary`} />
                <span className="font-medium text-ink">{tile.label}</span>
              </button>
            ))}
          </div>
        </div>
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
      {materialsQuery.isPending && courseId ? (
        <div className="py-16 text-center text-muted">
          <i className="fas fa-spinner fa-spin mb-3 text-2xl" />
          <p>Loading materials...</p>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <i className="fas fa-search mb-4 text-4xl text-gray-300" />
          <h3 className="text-lg font-semibold text-ink">No materials found</h3>
          <p className="mt-1 text-muted">
            Try adjusting your filters or search terms to find what you're looking for.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredMaterials.map((material) => {
            const typeLabel = getTypeLabel(material.fileType || "");
            const isText = (material.fileType || "").includes("text");
            const isPdf = (material.fileType || "").includes("pdf");
            const isLink = material.fileType === "link";

            return (
              <div
                key={material.sourceId || material._id}
                className="flex flex-col rounded-2xl bg-white p-5 shadow-sm"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TYPE_ICON_CLASSES[typeLabel]}`}
                  >
                    <i className={`fas ${getTypeIcon(material.fileType || "")} text-xl`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-ink" title={material.documentTitle || "Untitled"}>
                      {material.documentTitle || "Untitled"}
                    </h3>
                    <p className="text-sm text-muted">{typeLabel}</p>
                    <p className="text-xs text-muted">
                      Size: {formatFileSize(material.fileSize)}
                    </p>
                    <p className="text-xs text-muted">
                      Uploaded on {new Date(material.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {material.sourceId && (
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
                    <div className="flex gap-2">
                      {(isText || isPdf || isLink) && (
                        <button
                          type="button"
                          onClick={() =>
                            openModal(
                              isText ? "text-edit" : isPdf ? "pdf-edit" : "link-edit",
                              material
                            )
                          }
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
                        >
                          Edit
                        </button>
                      )}
                      {isLink && (
                        <button
                          type="button"
                          title="Refetch content"
                          onClick={() => refetchLink(material)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-ink transition-colors hover:bg-gray-50"
                        >
                          <i className="fas fa-sync-alt" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openModal("delete", material)}
                      className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Text add/edit modal */}
      <Modal
        open={modal?.kind === "text-add" || modal?.kind === "text-edit"}
        onClose={closeModal}
        title={modal?.kind === "text-add" ? "Add Text Content" : "Edit Textbook"}
        wide
        footer={
          <>
            <button type="button" onClick={closeModal} className={modalBtnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              disabled={modalBusy || updateMutation.isPending}
              onClick={modal?.kind === "text-add" ? saveTextContent : saveEdit}
              className={modalBtnPrimary}
            >
              {modalBusy || updateMutation.isPending ? "Saving..." : "Save"}
            </button>
          </>
        }
      >
        <label className="mb-1 block text-sm font-semibold text-ink">
          Document Title:
        </label>
        <input
          type="text"
          value={modalTitle}
          onChange={(event) => setModalTitle(event.target.value)}
          placeholder="Enter document title..."
          className={modalInputClass}
        />
        <label className="mt-4 mb-1 block text-sm font-semibold text-ink">
          {modal?.kind === "text-add"
            ? "Paste your text content:"
            : "Edit your text content:"}
        </label>
        <textarea
          rows={modal?.kind === "text-add" ? 10 : 15}
          value={modalContent}
          onChange={(event) => setModalContent(event.target.value)}
          placeholder="Paste your text content here..."
          className={modalInputClass}
        />
      </Modal>

      {/* PDF edit modal */}
      <Modal
        open={modal?.kind === "pdf-edit"}
        onClose={closeModal}
        title="Edit PDF"
        footer={
          <>
            <button type="button" onClick={closeModal} className={modalBtnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              disabled={updateMutation.isPending}
              onClick={saveEdit}
              className={modalBtnPrimary}
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </button>
          </>
        }
      >
        <label className="mb-1 block text-sm font-semibold text-ink">
          Document Title:
        </label>
        <input
          type="text"
          value={modalTitle}
          onChange={(event) => setModalTitle(event.target.value)}
          placeholder="Enter document title..."
          className={modalInputClass}
        />
      </Modal>

      {/* Link edit modal */}
      <Modal
        open={modal?.kind === "link-edit"}
        onClose={closeModal}
        title="Edit Link"
        footer={
          <>
            <button type="button" onClick={closeModal} className={modalBtnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              disabled={updateMutation.isPending}
              onClick={saveEdit}
              className={modalBtnPrimary}
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </button>
          </>
        }
      >
        <label className="mb-1 block text-sm font-semibold text-ink">
          Document Title:
        </label>
        <input
          type="text"
          value={modalTitle}
          onChange={(event) => setModalTitle(event.target.value)}
          placeholder="Enter document title..."
          className={modalInputClass}
        />
        <label className="mt-4 mb-1 block text-sm font-semibold text-ink">URL:</label>
        <input
          type="url"
          value={modalContent}
          onChange={(event) => setModalContent(event.target.value)}
          placeholder="https://example.com"
          className={modalInputClass}
        />
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={modal?.kind === "delete"}
        onClose={closeModal}
        title="Delete Material"
        footer={
          <>
            <button type="button" onClick={closeModal} className={modalBtnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => confirmDelete(modal.material)}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85"
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-ink">
          Are you sure you want to delete this material? This action cannot be undone.
        </p>
        <p className="mt-2 font-semibold text-ink">
          {modal?.material?.documentTitle || "Untitled"}
        </p>
      </Modal>
    </div>
  );
}
