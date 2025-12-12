// Course Materials Upload Functionality
// Handles file uploads, text input, and URL input for course materials

let contentGenerator = null;
let pdfService = null;

// Initialize upload functionality
document.addEventListener("DOMContentLoaded", async function () {
  console.log("Initializing course materials upload...");

  // Initialize modules
  initializeModules();

  // Initialize upload UI
  initializeUploadUI();

  // Initialize file upload handlers
  initializeFileUpload();

  // Initialize material tiles
  initializeMaterialTiles();
});

function initializeModules() {
  console.log("Initializing upload modules...");
  console.log("ContentGenerator available:", window.ContentGenerator);
  console.log("PDFParsingService available:", window.PDFParsingService);

  // Initialize PDF service
  if (window.PDFParsingService) {
    pdfService = new window.PDFParsingService();
    console.log("PDF service created:", pdfService);
  }

  // Initialize content generator
  if (window.ContentGenerator) {
    contentGenerator = new window.ContentGenerator();
    console.log("Content generator created:", contentGenerator);
  }

  console.log("Upload modules initialized successfully");
}

function initializeUploadUI() {
  const uploadBtn = document.getElementById("upload-materials-btn");
  const uploadSection = document.getElementById("upload-section");

  if (uploadBtn && uploadSection) {
    uploadBtn.addEventListener("click", () => {
      const isVisible = uploadSection.style.display !== "none";
      uploadSection.style.display = isVisible ? "none" : "block";
      uploadBtn.innerHTML = isVisible
        ? '<i class="fas fa-plus"></i><span>Upload Materials</span>'
        : '<i class="fas fa-times"></i><span>Hide Upload</span>';
    });
  }
}

function hideUploadSection() {
  const uploadSection = document.getElementById("upload-section");
  const uploadBtn = document.getElementById("upload-materials-btn");

  if (uploadSection) {
    uploadSection.style.display = "none";
  }

  if (uploadBtn) {
    uploadBtn.innerHTML = '<i class="fas fa-plus"></i><span>Upload Materials</span>';
  }
}

// ===== FILE UPLOAD FUNCTIONS =====

function initializeFileUpload() {
  const dropArea = document.getElementById("drop-area");
  const fileInput = document.getElementById("file-input");
  const chooseFileBtn = document.getElementById("choose-file-btn");

  console.log("Initializing file upload:", {
    dropArea: !!dropArea,
    fileInput: !!fileInput,
    chooseFileBtn: !!chooseFileBtn,
  });

  if (dropArea) {
    // Drag and drop events
    dropArea.addEventListener("dragover", handleDragOver);
    dropArea.addEventListener("dragleave", handleDragLeave);
    dropArea.addEventListener("drop", handleDrop);

    // Click to choose file
    if (chooseFileBtn) {
      chooseFileBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Choose file button clicked");
        if (fileInput) {
          fileInput.click();
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", handleFileSelect);
    }
  } else {
    console.error("Drop area not found!");
  }
}

function handleDragOver(e) {
  e.preventDefault();
  const dropArea = document.getElementById("drop-area");
  if (dropArea) {
    dropArea.classList.add("drag-over");
  }
}

function handleDragLeave(e) {
  e.preventDefault();
  const dropArea = document.getElementById("drop-area");
  if (dropArea) {
    dropArea.classList.remove("drag-over");
  }
}

function handleDrop(e) {
  e.preventDefault();
  const dropArea = document.getElementById("drop-area");
  if (dropArea) {
    dropArea.classList.remove("drag-over");
  }

  const files = Array.from(e.dataTransfer.files);
  addFiles(files);
}

function handleFileSelect(e) {
  console.log("File select triggered:", e.target.files);
  const files = Array.from(e.target.files);
  console.log("Files selected:", files.length);
  if (files.length > 0) {
    addFiles(files);
  }
}

async function addFiles(files) {
  // Show spinner when starting file upload
  showUploadSpinner();

  try {
    const selectedCourse = getSelectedCourse();

    for (const file of files) {
      const fileObj = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: file.size,
        type: file.type,
        file: file,
      };

      // Extract content from file if possible
      try {
        if (file.type === "text/plain" || file.name.endsWith(".txt")) {
          fileObj.content = await readTextFile(file);
        } else if (
          file.type === "application/pdf" ||
          file.name.endsWith(".pdf")
        ) {
          // Use PDF parsing service
          try {
            if (pdfService) {
              fileObj.content = await pdfService.parsePDFToText(file);
              console.log(
                `PDF content extracted: ${fileObj.content.length} characters`
              );
            } else {
              throw new Error("PDF service not available");
            }
          } catch (error) {
            console.error("PDF parsing failed:", error);
            fileObj.content = `PDF Document: ${file.name
              }\nFile Size: ${formatFileSize(file.size)}\nType: ${file.type
              }\n\nError: ${error.message
              }\n\nNote: PDF content could not be extracted.`;
          }
        } else {
          fileObj.content = `File: ${file.name}\nType: ${file.type
            }\nSize: ${formatFileSize(
              file.size
            )}\n\nThis file type is not directly readable as text content.`;
        }
      } catch (error) {
        console.error("Error reading file content:", error);
        fileObj.content = `File: ${file.name} (content could not be extracted)`;
      }

      // Process file with content generator
      try {
        if (!selectedCourse) {
          console.warn(
            "No course selected, file will be processed without course association"
          );
          showNotification(
            "Please select a course before uploading files for proper organization.",
            "warning"
          );
        }

        if (contentGenerator) {
          const sourceId = selectedCourse.id + "-" + Date.now() + "-" + Math.random();
          const response = await contentGenerator.processFileForRAG(
            file,
            selectedCourse,
            sourceId
          );

          if (response.success) {
            try {
              console.log('Saving material to database...');
              await saveMaterialToDatabase(
                sourceId,
                selectedCourse.id,
                {
                  fileType: fileObj.file.type,
                  fileSize: fileObj.file.size,
                  documentTitle: fileObj.file.name, // For PDFs, use filename as documentTitle
                }
              );

              const stateFileObj = {
                fileSize: fileObj.file.size,
                fileType: fileObj.file.type,
                documentTitle: fileObj.file.name, // For PDFs, use filename as documentTitle
                sourceId: sourceId,
                createdAt: new Date(),
              };

              // Add to materials list
              addMaterialToCourseMaterials(stateFileObj, sourceId);
            } catch (error) {
              console.error("Error saving material to database:", error);
            }
          }

        }
      } catch (error) {
        console.error("Error processing file:", error);
      }
    }

    showNotification(`${files.length} file(s) uploaded successfully`, "success");

    // Hide upload section after successful upload
    hideUploadSection();
  } catch (error) {
    console.error("Error processing files:", error);
    showNotification("Error processing files. Please try again.", "error");
  } finally {
    // Hide spinner when upload is complete
    hideUploadSpinner();
  }
}

async function saveMaterialToDatabase(sourceId, courseId, materialData) {
  try {
    if (!courseId) {
      console.warn("No course selected, skipping database save");
      return;
    }

    const response = await fetch("/api/material/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: sourceId,
        courseId: courseId,
        materialData: materialData,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      console.log("Material saved to database:", data);
    } else {
      console.error("Failed to save material:", data.error);
      showNotification("Failed to save material to database", "error");
    }
  } catch (error) {
    console.error("Error saving material to database:", error);
    // Don't show error notification for every failure to avoid spam
    // The material is still added to the UI, just not persisted
  }
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

// Upload spinner control functions
function showUploadSpinner() {
  const spinner = document.getElementById("upload-spinner");
  const dropArea = document.getElementById("drop-area");
  const chooseFileBtn = document.getElementById("choose-file-btn");

  if (spinner) {
    spinner.style.display = "flex";
    // Disable the choose file button while uploading
    if (chooseFileBtn) {
      chooseFileBtn.disabled = true;
      chooseFileBtn.style.opacity = "0.5";
    }
    // Disable drag and drop
    if (dropArea) {
      dropArea.style.pointerEvents = "none";
    }
  }
}

function hideUploadSpinner() {
  const spinner = document.getElementById("upload-spinner");
  const dropArea = document.getElementById("drop-area");
  const chooseFileBtn = document.getElementById("choose-file-btn");

  if (spinner) {
    spinner.style.display = "none";
    // Re-enable the choose file button
    if (chooseFileBtn) {
      chooseFileBtn.disabled = false;
      chooseFileBtn.style.opacity = "1";
    }
    // Re-enable drag and drop
    if (dropArea) {
      dropArea.style.pointerEvents = "auto";
    }
  }
}

function getFileIcon(type) {
  if (type.includes("pdf")) return "fas fa-file-pdf";
  if (type.includes("text")) return "fas fa-file-alt";
  if (type.includes("word")) return "fas fa-file-word";
  return "fas fa-file";
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ===== MATERIAL TILES FUNCTIONS =====

function initializeMaterialTiles() {
  const tiles = document.querySelectorAll(".material-tile");

  tiles.forEach((tile) => {
    tile.addEventListener("click", () => {
      const type = tile.dataset.type;
      handleMaterialTileClick(type);
    });
  });

  // Modal event listeners
  initializeModals();
}

function handleMaterialTileClick(type) {
  switch (type) {
    case "text":
      openTextModal();
      break;
    case "pdf":
      // PDF is handled by file upload
      const fileInput = document.getElementById("file-input");
      if (fileInput) {
        fileInput.click();
      }
      break;
    case "url":
      openUrlModal();
      break;
    case "panopto":
      showNotification("Panopto integration coming soon!", "info");
      break;
  }
}

function initializeModals() {
  // Text modal
  const textModal = document.getElementById("text-modal");
  const textModalClose = document.getElementById("text-modal-close");
  const textModalCancel = document.getElementById("text-modal-cancel");
  const textModalSave = document.getElementById("text-modal-save");

  if (textModalClose) {
    textModalClose.addEventListener("click", closeTextModal);
  }
  if (textModalCancel) {
    textModalCancel.addEventListener("click", closeTextModal);
  }
  if (textModalSave) {
    textModalSave.addEventListener("click", saveTextContent);
  }

  // URL modal
  const urlModal = document.getElementById("url-modal");
  const urlModalClose = document.getElementById("url-modal-close");
  const urlModalCancel = document.getElementById("url-modal-cancel");
  const urlModalSave = document.getElementById("url-modal-save");

  if (urlModalClose) {
    urlModalClose.addEventListener("click", closeUrlModal);
  }
  if (urlModalCancel) {
    urlModalCancel.addEventListener("click", closeUrlModal);
  }
  if (urlModalSave) {
    urlModalSave.addEventListener("click", saveUrlContent);
  }
}

function openTextModal() {
  const modal = document.getElementById("text-modal");
  if (modal) {
    modal.classList.add("modal--active");
    const textContent = document.getElementById("text-content");
    if (textContent) {
      textContent.focus();
    }
  }
}

function closeTextModal() {
  const modal = document.getElementById("text-modal");
  if (modal) {
    modal.classList.remove("modal--active");
    const textContent = document.getElementById("text-content");
    if (textContent) {
      textContent.value = "";
    }
    const textDocumentTitle = document.getElementById("text-document-title");
    if (textDocumentTitle) {
      textDocumentTitle.value = "";
    }
  }
}

async function saveTextContent() {
  const textContentEl = document.getElementById("text-content");
  if (!textContentEl) return;

  const textContent = textContentEl.value.trim();
  const documentTitleEl = document.getElementById("text-document-title");
  const documentTitle = documentTitleEl ? documentTitleEl.value.trim() : "";

  if (textContent) {
    const selectedCourse = getSelectedCourse();
    const textFile = {
      id: Date.now() + Math.random(),
      name: documentTitle || "",
      size: new Blob([textContent]).size,
      type: "text/plain",
      content: textContent,
    };

    // Add text content to content generator
    if (contentGenerator) {
      const sourceId = selectedCourse.id + "-" + Date.now() + "-" + Math.random();

      try {
        await contentGenerator.processTextForRAG(
          textContent,
          selectedCourse.name,
          sourceId,
          documentTitle
        );

        await saveMaterialToDatabase(
          sourceId,
          selectedCourse.id,
          {
            fileType: textFile.type,
            fileSize: textFile.size,
            fileContent: textContent,
            documentTitle: documentTitle,
          });
  
        const stateFileObj = {
          fileSize: textFile.size,
          fileType: textFile.type,
          fileContent: textContent,
          documentTitle: documentTitle,
          sourceId: sourceId,
          createdAt: new Date(),
        };
  
        // Add to materials list
        addMaterialToCourseMaterials(stateFileObj, sourceId);
  
        closeTextModal();
        showNotification("Text content added", "success");
  
        // Hide upload section after successful upload
        hideUploadSection();
      } catch (error) {
        console.error("Error processing text for RAG:", error);
      }
    }
  }
}

function openUrlModal() {
  const modal = document.getElementById("url-modal");
  if (modal) {
    modal.classList.add("modal--active");
    const urlInput = document.getElementById("url-input");
    if (urlInput) {
      urlInput.focus();
    }
  }
}

function closeUrlModal() {
  const modal = document.getElementById("url-modal");
  if (modal) {
    modal.classList.remove("modal--active");
    const urlInput = document.getElementById("url-input");
    if (urlInput) {
      urlInput.value = "";
    }
    const urlDocumentTitle = document.getElementById("url-document-title");
    if (urlDocumentTitle) {
      urlDocumentTitle.value = "";
    }
  }
}

async function saveUrlContent() {
  const urlInput = document.getElementById("url-input");

  if (!urlInput) {
    showNotification("Please enter a URL", "error");
    return;
  }

  const url = urlInput.value.trim();
  if (!url) {
    showNotification("Please enter a URL", "error");
    return;
  }

  const documentTitleEl = document.getElementById("url-document-title");
  const documentTitle = documentTitleEl ? documentTitleEl.value.trim() : "";

  const selectedCourse = getSelectedCourse();
  const sourceId = selectedCourse.id + "-" + Date.now() + "-" + Math.random();

  // Add URL to content generator
  if (contentGenerator) {
    try {
      const content = await contentGenerator.processUrlForRAG(url, selectedCourse.name, sourceId, documentTitle);

      await saveMaterialToDatabase(
        sourceId,
        selectedCourse.id,
        {
          fileType: 'link',
          fileSize: new Blob([content]).size,
          fileContent: url, // For links, save URL to fileContent
          documentTitle: documentTitle,
        });
  
      const stateUrlObj = {
        fileSize: new Blob([content]).size,
        fileType: 'link',
        fileContent: url, // For links, save URL to fileContent
        documentTitle: documentTitle,
        sourceId: sourceId,
        createdAt: new Date(),
      };
  
      // Add to materials list
      addMaterialToCourseMaterials(stateUrlObj, sourceId);
  
      closeUrlModal();
      showNotification("URL Content added!", "success");
  
      // Hide upload section after successful upload
      hideUploadSection();
    } catch (error) {
      console.error("Error processing URL for RAG:", error);
    }
  }
}

// Helper function to get selected course
function getSelectedCourse() {
  return JSON.parse(sessionStorage.getItem("grasp-selected-course"));
}

// Helper function to add material to course materials list
function addMaterialToCourseMaterials(fileObj, sourceId) {
  if (window.CourseMaterials && window.CourseMaterials.addMaterial) {
    const selectedCourse = getSelectedCourse();

    const material = {
      fileSize: fileObj.fileSize,
      fileType: fileObj.fileType,
      fileContent: fileObj.fileContent || null,
      documentTitle: fileObj.documentTitle || null,
      sourceId: sourceId,
      courseId: selectedCourse ? selectedCourse.id : null,
      createdAt: fileObj.createdAt || new Date(),
    };

    window.CourseMaterials.addMaterial(material);
  }
}

// Helper function for notifications (reuse from course-materials.js if available)
function showNotification(message, type = "info") {
  if (window.CourseMaterials && window.CourseMaterials.showNotification) {
    window.CourseMaterials.showNotification(message, type);
  } else {
    // Fallback notification
    console.log(`[${type.toUpperCase()}] ${message}`);
    alert(message);
  }
}

