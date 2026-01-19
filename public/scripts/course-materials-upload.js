// Course Materials Upload Functionality
// Handles file uploads, text input, and URL input for course materials

// Constants
const UPLOAD_API_ENDPOINTS = {
  materialSave: '/api/material/save',
};

const UPLOAD_STORAGE_KEYS = {
  selectedCourse: 'grasp-selected-course',
};

/**
 * Get the selected course from session storage
 * @returns {Object|null} The selected course object or null
 */
function getSelectedCourse() {
  try {
    return JSON.parse(sessionStorage.getItem(UPLOAD_STORAGE_KEYS.selectedCourse)) || null;
  } catch {
    return null;
  }
}

let contentGenerator = null;

// Initialize upload functionality
document.addEventListener('DOMContentLoaded', async function () {
  initializeModules();
  initializeUploadUI();
  initializeFileUpload();
  initializeMaterialTiles();
});

function initializeModules() {
  if (window.ContentGenerator) {
    contentGenerator = new window.ContentGenerator();
  }
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
  const dropArea = document.getElementById('drop-area');
  const fileInput = document.getElementById('file-input');
  const chooseFileBtn = document.getElementById('choose-file-btn');

  if (dropArea) {
    dropArea.addEventListener('dragover', handleDragOver);
    dropArea.addEventListener('dragleave', handleDragLeave);
    dropArea.addEventListener('drop', handleDrop);

    if (chooseFileBtn) {
      chooseFileBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (fileInput) {
          fileInput.click();
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', handleFileSelect);
    }
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
  const validFiles = validateDocumentFiles(files);
  if (validFiles.length > 0) {
    addFiles(validFiles);
  }
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  const fileInput = e.target;
  
  const validFiles = validateDocumentFiles(files);
  if (validFiles.length > 0) {
    addFiles(validFiles);
  }
  
  // Reset input to allow selecting the same file again
  fileInput.value = '';
}

/**
 * Validates that all files are PDF, DOC, or DOCX
 * @param {File[]} files - Array of files to validate
 * @returns {File[]} - Array of valid files
 */
function validateDocumentFiles(files) {
  const invalidFiles = [];
  const validFiles = [];

  for (const file of files) {
    const fileName = file.name.toLowerCase();
    const isPDF = file.type === "application/pdf" || fileName.endsWith(".pdf");
    const isDOC = file.type === "application/msword" || fileName.endsWith(".doc");
    const isDOCX = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx");
    
    if (isPDF || isDOC || isDOCX) {
      validFiles.push(file);
    } else {
      invalidFiles.push(file.name);
    }
  }

  // Show error message if there are invalid files
  if (invalidFiles.length > 0) {
    showNotification("PDF, DOC, and DOCX are the only supported file formats at this time. Additional file formats will be supported soon.", "error");
  }

  return validFiles;
}

async function addFiles(files) {
  const validFiles = validateDocumentFiles(files);
  if (validFiles.length === 0) {
    return;
  }

  showUploadSpinner();

  try {
    const selectedCourse = getSelectedCourse();

    for (const file of validFiles) {
      try {
        if (!selectedCourse) {
          showNotification(
            'Please select a course before uploading files for proper organization.',
            'warning'
          );
          continue;
        }

        if (contentGenerator) {
          const sourceId = selectedCourse.id + '-' + Date.now() + '-' + Math.random();
          const response = await contentGenerator.processFileForRAG(
            file,
            selectedCourse,
            sourceId
          );

          if (response.success) {
            try {
              await saveMaterialToDatabase(
                sourceId,
                selectedCourse.id,
                {
                  fileType: file.type,
                  fileSize: file.size,
                  documentTitle: file.name,
                }
              );

              const stateFileObj = {
                fileSize: file.size,
                fileType: file.type,
                documentTitle: file.name,
                sourceId: sourceId,
                createdAt: new Date(),
              };

              addMaterialToCourseMaterials(stateFileObj, sourceId);
            } catch (error) {
              console.error('Error saving material to database:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error processing file:', error);
      }
    }

    if (validFiles.length > 0) {
      showNotification(`${validFiles.length} file(s) uploaded successfully`, 'success');
    }

    hideUploadSection();
  } catch (error) {
    console.error('Error processing files:', error);
    showNotification('Error processing files. Please try again.', 'error');
  } finally {
    hideUploadSpinner();
  }
}

async function saveMaterialToDatabase(sourceId, courseId, materialData) {
  if (!courseId) return;

  try {
    const response = await fetch(UPLOAD_API_ENDPOINTS.materialSave, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        courseId,
        materialData,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      showNotification('Failed to save material to database', 'error');
    }
  } catch (error) {
    console.error('Error saving material to database:', error);
  }
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
      // openUrlModal();
      showNotification("URL upload coming soon!", "info");
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
  const textContentEl = document.getElementById('text-content');
  if (!textContentEl) return;

  const textContent = textContentEl.value.trim();
  const documentTitleEl = document.getElementById('text-document-title');
  const documentTitle = documentTitleEl ? documentTitleEl.value.trim() : '';

  if (textContent) {
    const selectedCourse = getSelectedCourse();
    const textFile = {
      id: Date.now() + Math.random(),
      name: documentTitle || '',
      size: new Blob([textContent]).size,
      type: 'text/plain',
      content: textContent,
    };

    if (contentGenerator && selectedCourse) {
      const sourceId = selectedCourse.id + '-' + Date.now() + '-' + Math.random();

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
  
        addMaterialToCourseMaterials(stateFileObj, sourceId);
        closeTextModal();
        showNotification('Text content added', 'success');
        hideUploadSection();
      } catch (error) {
        console.error('Error processing text for RAG:', error);
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
  const urlInput = document.getElementById('url-input');

  if (!urlInput) {
    showNotification('Please enter a URL', 'error');
    return;
  }

  const url = urlInput.value.trim();
  if (!url) {
    showNotification('Please enter a URL', 'error');
    return;
  }

  const documentTitleEl = document.getElementById('url-document-title');
  const documentTitle = documentTitleEl ? documentTitleEl.value.trim() : '';

  const selectedCourse = getSelectedCourse();
  if (!selectedCourse) {
    showNotification('Please select a course first', 'error');
    return;
  }

  const sourceId = selectedCourse.id + '-' + Date.now() + '-' + Math.random();

  if (contentGenerator) {
    try {
      const content = await contentGenerator.processUrlForRAG(url, selectedCourse.name, sourceId, documentTitle);

      await saveMaterialToDatabase(
        sourceId,
        selectedCourse.id,
        {
          fileType: 'link',
          fileSize: new Blob([content]).size,
          fileContent: url,
          documentTitle: documentTitle,
        });
  
      const stateUrlObj = {
        fileSize: new Blob([content]).size,
        fileType: 'link',
        fileContent: url,
        documentTitle: documentTitle,
        sourceId: sourceId,
        createdAt: new Date(),
      };
  
      addMaterialToCourseMaterials(stateUrlObj, sourceId);
      closeUrlModal();
      showNotification('URL Content added!', 'success');
      hideUploadSection();
    } catch (error) {
      console.error('Error processing URL for RAG:', error);
    }
  }
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
function showNotification(message, type = 'info') {
  if (window.CourseMaterials && window.CourseMaterials.showNotification) {
    window.CourseMaterials.showNotification(message, type);
  } else {
    // Fallback notification
    alert(message);
  }
}

