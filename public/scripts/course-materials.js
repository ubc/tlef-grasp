// Course Materials Page JavaScript

// Constants
const API_ENDPOINTS = {
  materialCourse: '/api/material/course',
  materialUpdate: '/api/material/update',
  materialDelete: '/api/material/delete',
  materialRefetch: '/api/material/refetch',
  ragLlmDeleteDocument: '/api/rag-llm/delete-document',
  ragLlmFetchUrlContent: '/api/rag-llm/fetch-url-content',
};

const STORAGE_KEYS = {
  selectedCourse: 'grasp-selected-course',
};

/**
 * Get the selected course from session storage
 * @returns {Object|null} The selected course object or null
 */
function getSelectedCourse() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.selectedCourse)) || null;
  } catch {
    return null;
  }
}

/**
 * Get the course ID from session storage
 * @returns {string|null} The course ID or null
 */
function getCourseId() {
  const selectedCourse = getSelectedCourse();
  return selectedCourse?.id || null;
}

let materials = [];
let filteredMaterials = [];

// Initialize page when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
  if (window.GRASPNavigation) {
  new window.GRASPNavigation();
  }

  initializeCourseMaterials();
  initializeEditModal();
  initializeEditLinkModal();
  initializeEditPdfModal();
});

function initializeEditModal() {
  const editModal = document.getElementById("edit-text-modal");
  const editModalClose = document.getElementById("edit-text-modal-close");
  const editModalCancel = document.getElementById("edit-text-modal-cancel");
  const editModalSave = document.getElementById("edit-text-modal-save");

  if (editModalClose) {
    editModalClose.addEventListener("click", closeEditModal);
  }
  if (editModalCancel) {
    editModalCancel.addEventListener("click", closeEditModal);
  }
  if (editModalSave) {
    editModalSave.addEventListener("click", saveEditedTextContent);
  }

  // Close on backdrop click
  if (editModal) {
    editModal.addEventListener("click", function(e) {
      if (e.target === editModal) {
        closeEditModal();
      }
    });
  }
}

function initializeEditPdfModal() {
  const editPdfModal = document.getElementById("edit-pdf-modal");
  const editPdfModalClose = document.getElementById("edit-pdf-modal-close");
  const editPdfModalCancel = document.getElementById("edit-pdf-modal-cancel");
  const editPdfModalSave = document.getElementById("edit-pdf-modal-save");

  if (editPdfModalClose) {
    editPdfModalClose.addEventListener("click", closeEditPdfModal);
  }
  if (editPdfModalCancel) {
    editPdfModalCancel.addEventListener("click", closeEditPdfModal);
  }
  if (editPdfModalSave) {
    editPdfModalSave.addEventListener("click", saveEditedPdfContent);
  }

  // Close on backdrop click
  if (editPdfModal) {
    editPdfModal.addEventListener("click", function(e) {
      if (e.target === editPdfModal) {
        closeEditPdfModal();
      }
    });
  }
}

function initializeEditLinkModal() {
  const editLinkModal = document.getElementById("edit-link-modal");
  const editLinkModalClose = document.getElementById("edit-link-modal-close");
  const editLinkModalCancel = document.getElementById("edit-link-modal-cancel");
  const editLinkModalSave = document.getElementById("edit-link-modal-save");

  if (editLinkModalClose) {
    editLinkModalClose.addEventListener("click", closeEditLinkModal);
  }
  if (editLinkModalCancel) {
    editLinkModalCancel.addEventListener("click", closeEditLinkModal);
  }
  if (editLinkModalSave) {
    editLinkModalSave.addEventListener("click", saveEditedLinkContent);
  }

  // Close on backdrop click
  if (editLinkModal) {
    editLinkModal.addEventListener("click", function(e) {
      if (e.target === editLinkModal) {
        closeEditLinkModal();
      }
    });
  }
}

async function initializeCourseMaterials() {
  document.title = 'Course Materials - GRASP';
  await loadCourseMaterials();
  loadMaterials();
  initializeFilters();
}

async function loadCourseMaterials() {
  try {
    const courseId = getCourseId();
    if (!courseId) {
      showNotification('No course selected', 'error');
      return;
    }

    const response = await fetch(`${API_ENDPOINTS.materialCourse}/${courseId}`);
    const data = await response.json();

    if (data.success && data.materials) {
      materials = data.materials;
      filteredMaterials = [...materials];
    }
  } catch (error) {
    console.error('Error loading course data:', error);
    showNotification('Error loading course data', 'error');
  }
}

function createMaterialCard(material) {
  const card = document.createElement("div");
  card.className = "material-card";

  const typeIcon = getTypeIcon(material.fileType);
  const typeLabel = getTypeLabel(material.fileType);

  // Use documentTitle if available
  const displayTitle = material.documentTitle || "Untitled";
  
  card.innerHTML = `
        <div class="material-header">
            <div class="material-icon ${typeLabel.toLowerCase()}">
                <i class="${typeIcon}"></i>
            </div>
            <div class="material-info">
                <h3 class="material-title">${displayTitle}</h3>
                <p class="material-type">${typeLabel}</p>
                <p class="material-size">Size: ${formatFileSize(material.fileSize)}</p>
                <p class="material-createdAt">Uploaded on ${new Date(material.createdAt).toLocaleDateString()}</p>
            </div>
        </div>`;

  if ( material.sourceId ) {
    let leftButtons = [];
    let deleteButton = '';
    
    // Add edit button for textbooks (text/plain type)
    if (material.fileType && material.fileType.includes("text")) {
      leftButtons.push(`<button class="view-button edit-button" data-source-id="${material.sourceId}">
                Edit
            </button>`);
    }
    
    // Add edit button for PDFs
    if (material.fileType && material.fileType.includes("pdf")) {
      leftButtons.push(`<button class="view-button edit-pdf-button" data-source-id="${material.sourceId}">
                Edit
            </button>`);
    }
    
    // Add edit and refetch buttons for links
    if (material.fileType && material.fileType === 'link') {
      leftButtons.push(`<button class="view-button edit-link-button" data-source-id="${material.sourceId}">
                Edit
            </button>`);
      leftButtons.push(`<button class="view-button refetch-button icon-button" data-source-id="${material.sourceId}" title="Refetch content">
                <i class="fas fa-sync-alt"></i>
            </button>`);
    }
    
    // Add delete button
    deleteButton = `<button class="view-button delete-button" data-source-id="${material.sourceId}">
                Delete
            </button>`;
    
    card.innerHTML += `
        <div class="material-footer">
            <div class="material-footer-left">
                ${leftButtons.join('')}
            </div>
            <div class="material-footer-right">
                ${deleteButton}
            </div>
        </div>
    `;
  }

  // Add click handler for edit button
  const editButton = card.querySelector(".edit-button");
  if (editButton) {
    editButton.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevent card click
      openEditModal(material);
    });
  }

  // Add click handler for edit PDF button
  const editPdfButton = card.querySelector(".edit-pdf-button");
  if (editPdfButton) {
    editPdfButton.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevent card click
      openEditPdfModal(material);
    });
  }

  // Add click handler for edit link button
  const editLinkButton = card.querySelector(".edit-link-button");
  if (editLinkButton) {
    editLinkButton.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevent card click
      openEditLinkModal(material);
    });
  }

  // Add click handler for refetch button
  const refetchButton = card.querySelector(".refetch-button");
  if (refetchButton) {
    refetchButton.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevent card click
      refetchLinkContent(material);
    });
  }

  // Add click handler for delete button
  const deleteButton = card.querySelector(".delete-button");
  if (deleteButton) {
    deleteButton.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevent card click
      showDeleteConfirmation(material.sourceId, material.documentTitle || "Untitled");
    });
  }

  return card;
}

function getTypeIcon(type) {
  if (type.includes("pdf")) return "fas fa-file-pdf";
  if (type.includes("text")) return "fas fa-file-alt";
  if (type.includes("word")) return "fas fa-file-word";
  if (type.includes("link")) return "fas fa-link";
  return "fas fa-file";
}

function getTypeLabel(type) {
  if (type.includes("pdf")) return "PDF";
  if (type.includes("text")) return "TextBook";
  if (type.includes("word")) return "WordDocument";
  if (type.includes("link")) return "Link";
  return "File";
}

function initializeFilters() {
  const typeFilter = document.getElementById("typeFilter");
  typeFilter.addEventListener("change", applyFilters);
}

function applyFilters() {
  const typeFilter = document.getElementById("typeFilter").value;

  filteredMaterials = materials.filter((material) => {
    // Type filter
    if (typeFilter !== "all" && ! material.fileType.includes(typeFilter)) {
      return false;
    }

    return true;
  });

  loadMaterials();
}

// Show delete confirmation modal
function showDeleteConfirmation(sourceId, materialName) {
  const modal = document.getElementById("delete-confirmation-modal");
  const confirmBtn = document.getElementById("delete-modal-confirm");
  const cancelBtn = document.getElementById("delete-modal-cancel");
  const closeBtn = document.getElementById("delete-modal-close");

  // Show modal
  modal.classList.add("modal--active");

  // Remove existing event listeners by cloning and replacing
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  const newCloseBtn = closeBtn.cloneNode(true);
  closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

  // Add event listeners
  newConfirmBtn.addEventListener("click", () => {
    closeDeleteModal();
    confirmDelete(sourceId);
  });

  newCancelBtn.addEventListener("click", closeDeleteModal);
  newCloseBtn.addEventListener("click", closeDeleteModal);

  // Close on backdrop click
  modal.addEventListener("click", function(e) {
    if (e.target === modal) {
      closeDeleteModal();
    }
  });
}

function closeDeleteModal() {
  const modal = document.getElementById("delete-confirmation-modal");
  modal.classList.remove("modal--active");
}

// Show edit modal for textbook
function openEditModal(material) {
  const modal = document.getElementById('edit-text-modal');
  const textContent = document.getElementById('edit-text-content');
  const documentTitleEl = document.getElementById('edit-document-title');
  
  if (!modal || !textContent) return;

  if (documentTitleEl) {
    documentTitleEl.value = material.documentTitle || '';
  }

  textContent.value = material.fileContent || '';
  textContent.dataset.sourceId = material.sourceId;
  textContent.dataset.courseId = material.courseId;

  modal.classList.add('modal--active');
  (documentTitleEl || textContent).focus();
}

function closeEditModal() {
  const modal = document.getElementById("edit-text-modal");
  if (modal) {
    modal.classList.remove("modal--active");
    const textContent = document.getElementById("edit-text-content");
    if (textContent) {
      textContent.value = "";
      delete textContent.dataset.sourceId;
      delete textContent.dataset.courseId;
    }
    const documentTitleEl = document.getElementById("edit-document-title");
    if (documentTitleEl) {
      documentTitleEl.value = "";
    }
  }
}

async function saveEditedTextContent() {
  const textContentEl = document.getElementById('edit-text-content');
  if (!textContentEl) return;

  const textContent = textContentEl.value.trim();
  if (!textContent) {
    showNotification('Please enter some content', 'error');
    return;
  }

  const documentTitleEl = document.getElementById('edit-document-title');
  const documentTitle = documentTitleEl ? documentTitleEl.value.trim() : '';

  const sourceId = textContentEl.dataset.sourceId;
  const courseId = textContentEl.dataset.courseId || getCourseId();

  if (!sourceId) {
    showNotification('Error: Material source ID not found', 'error');
    return;
  }

  if (!courseId) {
    showNotification('Error: Course ID not found', 'error');
    return;
  }

  try {
    const response = await fetch(API_ENDPOINTS.materialUpdate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        courseId,
        documentType: 'text',
        documentData: { textContent },
        documentTitle,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      showNotification(data.error || 'Failed to update material', 'error');
      return;
    }

    await loadCourseMaterials();
    applyFilters();
    closeEditModal();
    showNotification('Textbook updated successfully', 'success');
  } catch (error) {
    console.error('Error updating textbook:', error);
    showNotification('Error updating textbook. Please try again.', 'error');
  }
}

// Show edit modal for PDF
function openEditPdfModal(material) {
  const modal = document.getElementById('edit-pdf-modal');
  const documentTitleEl = document.getElementById('edit-pdf-document-title');
  
  if (!modal || !documentTitleEl) return;

  documentTitleEl.value = material.documentTitle || '';
  documentTitleEl.dataset.sourceId = material.sourceId;
  documentTitleEl.dataset.courseId = material.courseId;

  modal.classList.add('modal--active');
  documentTitleEl.focus();
}

function closeEditPdfModal() {
  const modal = document.getElementById("edit-pdf-modal");
  if (modal) {
    modal.classList.remove("modal--active");
    const documentTitleEl = document.getElementById("edit-pdf-document-title");
    if (documentTitleEl) {
      documentTitleEl.value = "";
      delete documentTitleEl.dataset.sourceId;
      delete documentTitleEl.dataset.courseId;
    }
  }
}

async function saveEditedPdfContent() {
  const documentTitleEl = document.getElementById('edit-pdf-document-title');
  if (!documentTitleEl) return;

  const documentTitle = documentTitleEl.value.trim();
  const sourceId = documentTitleEl.dataset.sourceId;
  const courseId = documentTitleEl.dataset.courseId || getCourseId();

  if (!sourceId) {
    showNotification('Error: Material source ID not found', 'error');
    return;
  }

  if (!courseId) {
    showNotification('Error: Course ID not found', 'error');
    return;
  }

  try {
    const response = await fetch(API_ENDPOINTS.materialUpdate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        courseId,
        documentType: 'pdf',
        documentData: {},
        documentTitle,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      showNotification(data.error || 'Failed to update PDF', 'error');
      return;
    }

    await loadCourseMaterials();
    applyFilters();
    closeEditPdfModal();
    showNotification('PDF updated successfully', 'success');
  } catch (error) {
    console.error('Error updating PDF:', error);
    showNotification('Error updating PDF. Please try again.', 'error');
  }
}

// Show edit modal for link
function openEditLinkModal(material) {
  const modal = document.getElementById('edit-link-modal');
  const urlInput = document.getElementById('edit-link-url');
  const documentTitleEl = document.getElementById('edit-link-document-title');
  
  if (!modal || !urlInput) return;

  if (documentTitleEl) {
    documentTitleEl.value = material.documentTitle || '';
  }

  urlInput.value = material.fileContent || '';
  urlInput.dataset.sourceId = material.sourceId;
  urlInput.dataset.courseId = material.courseId;

  modal.classList.add('modal--active');
  (documentTitleEl || urlInput).focus();
}

function closeEditLinkModal() {
  const modal = document.getElementById("edit-link-modal");
  if (modal) {
    modal.classList.remove("modal--active");
    const urlInput = document.getElementById("edit-link-url");
    if (urlInput) {
      urlInput.value = "";
      delete urlInput.dataset.sourceId;
      delete urlInput.dataset.courseId;
    }
    const documentTitleEl = document.getElementById("edit-link-document-title");
    if (documentTitleEl) {
      documentTitleEl.value = "";
    }
  }
}

async function saveEditedLinkContent() {
  const urlInput = document.getElementById('edit-link-url');
  if (!urlInput) return;

  const url = urlInput.value.trim();
  if (!url) {
    showNotification('Please enter a URL', 'error');
    return;
  }

  const documentTitleEl = document.getElementById('edit-link-document-title');
  const documentTitle = documentTitleEl ? documentTitleEl.value.trim() : '';

  const sourceId = urlInput.dataset.sourceId;
  const courseId = urlInput.dataset.courseId || getCourseId();

  if (!sourceId) {
    showNotification('Error: Material source ID not found', 'error');
    return;
  }

  if (!courseId) {
    showNotification('Error: Course ID not found', 'error');
    return;
  }

  try {
    showNotification('Updating link...', 'info');

    const response = await fetch(API_ENDPOINTS.materialUpdate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        courseId,
        documentType: 'link',
        documentData: { url },
        documentTitle,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      showNotification(data.error || 'Failed to update link', 'error');
      return;
    }

    await loadCourseMaterials();
    applyFilters();
    closeEditLinkModal();
    showNotification('Link updated successfully', 'success');
  } catch (error) {
    console.error('Error updating link:', error);
    showNotification('Error updating link. Please try again.', 'error');
  }
}

async function refetchLinkContent(material) {
  if (!material.sourceId || !material.fileContent) {
    showNotification('Error: Material information not found', 'error');
    return;
  }

  const url = material.fileContent;
  const sourceId = material.sourceId;
  const courseId = material.courseId || getCourseId();

  if (!courseId) {
    showNotification('Error: Course ID not found', 'error');
    return;
  }

  try {
    showNotification('Refetching URL content...', 'info');

    // Step 1: Fetch new content from URL
    const fetchResponse = await fetch(API_ENDPOINTS.ragLlmFetchUrlContent, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch URL content');
    }

    const fetchData = await fetchResponse.json();
    if (!fetchData.success || !fetchData.content) {
      throw new Error('No content retrieved from URL');
    }

    // Step 2: Call API to refetch material
    const response = await fetch(API_ENDPOINTS.materialRefetch, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId,
        courseId,
        url,
        content: fetchData.content,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      showNotification(data.error || 'Failed to refetch material', 'error');
      return;
    }

    await loadCourseMaterials();
    applyFilters();
    showNotification('Link content refetched successfully', 'success');
  } catch (error) {
    console.error('Error refetching link content:', error);
    showNotification('Error refetching link content. Please try again.', 'error');
  }
}

async function confirmDelete(sourceId) {
  try {
    // Delete material from RAG
    let response = await fetch(`${API_ENDPOINTS.ragLlmDeleteDocument}/${sourceId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
  });

  let data = await response.json();

  if (!data.success) {
      showNotification('Failed to delete material from RAG', 'error');
    return;
  }
  
    // Delete material from database
    response = await fetch(`${API_ENDPOINTS.materialDelete}/${sourceId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
  });

  data = await response.json();

  if (!data.success) {
      showNotification('Failed to delete material from database', 'error');
    return;
  }

  // Remove material from arrays
  materials = materials.filter((material) => material.sourceId !== sourceId);
  filteredMaterials = filteredMaterials.filter((material) => material.sourceId !== sourceId);

  loadMaterials();
    showNotification('Material deleted successfully', 'success');
  } catch (error) {
    console.error('Error deleting material:', error);
    showNotification('Error deleting material. Please try again.', 'error');
  }
}

// Keep deleteMaterial for backward compatibility (now shows confirmation)
async function deleteMaterial(sourceId) {
  const material = materials.find((m) => m.sourceId === sourceId);
  if (material) {
    showDeleteConfirmation(sourceId, material.fileName);
  }
}

function clearFilters() {
  document.getElementById("typeFilter").value = "all";

  filteredMaterials = [...materials];
  loadMaterials();
}

function showNotification(message, type = "info") {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Style the notification
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 4px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    opacity: 0;
    transform: translateX(100%);
    transition: all 0.3s ease;
  `;

  // Set background color based on type
  if (type === "error") {
    notification.style.backgroundColor = "#e74c3c";
  } else if (type === "success") {
    notification.style.backgroundColor = "#27ae60";
  } else {
    notification.style.backgroundColor = "#3498db";
  }

  // Add to page
  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateX(0)";
  }, 100);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateX(100%)";
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// Function to add materials (called when files are uploaded)
function addMaterial(material) {
  materials.push(material);
  filteredMaterials = [...materials];
  loadMaterials();
}

function loadMaterials() {
  const materialsGrid = document.getElementById("materialsGrid");
  const noResults = document.getElementById("noResults");
  const filtersSection = document.querySelector(".filters-section");

  if (filteredMaterials.length === 0) {
    materialsGrid.style.display = "none";
    noResults.style.display = "flex";
    // Hide type filter when no materials found
    if (filtersSection) {
      filtersSection.style.display = "none";
    }
    return;
  }

  materialsGrid.style.display = "grid";
  noResults.style.display = "none";
  // Show type filter when materials are found
  if (filtersSection) {
    filtersSection.style.display = "block";
  }

  materialsGrid.innerHTML = '';
  filteredMaterials.forEach((material) => {
    const materialCard = createMaterialCard(material);
    materialsGrid.appendChild(materialCard);
  });
}

// Export functions for potential use by other scripts
window.CourseMaterials = {
  deleteMaterial,
  clearFilters,
  applyFilters,
  addMaterial,
  showNotification,
};
