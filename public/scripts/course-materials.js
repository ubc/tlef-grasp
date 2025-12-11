// Course Materials Page JavaScript

let materials = [];
let filteredMaterials = [];

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize course materials
  initializeCourseMaterials();

  // Initialize edit modal event listeners
  initializeEditModal();
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

async function initializeCourseMaterials() {
  console.log("Initializing Course Materials page...");
  console.log("Course materials script is running!");

  // Set page title
  document.title = "Course Materials - GRASP";

  // Load course data first
  await loadCourseMaterials();

  // Load materials
  loadMaterials();

  // Initialize filters
  initializeFilters();
}

async function loadCourseMaterials() {
  try {
    const courseId = JSON.parse(sessionStorage.getItem("grasp-selected-course")).id;
    const response = await fetch(`/api/material/course/${courseId}`);
    const data = await response.json();

    if (data.success && data.materials) {
      materials = data.materials;

      filteredMaterials = [...materials];
    } else {
      console.log("No courses found or invalid response");
    }

  } catch (error) {
    console.error("Error loading course data:", error);
    showNotification("Error loading course data", "error");
  }
}

function createMaterialCard(material) {
  const card = document.createElement("div");
  card.className = "material-card";

  const typeIcon = getTypeIcon(material.fileType);
  const typeLabel = getTypeLabel(material.fileType);

  card.innerHTML = `
        <div class="material-header">
            <div class="material-icon ${typeLabel.toLowerCase()}">
                <i class="${typeIcon}"></i>
            </div>
            <div class="material-info">
                <h3 class="material-title">${material.fileName}</h3>
                <p class="material-type">${typeLabel}</p>
                <p class="material-size">Size: ${formatFileSize(material.fileSize)}</p>
                <p class="material-createdAt">Uploaded on ${new Date(material.createdAt).toLocaleDateString()}</p>
            </div>
        </div>`;

  if ( material.sourceId ) {
    const buttons = [];
    
    // Add edit button for textbooks (text/plain type)
    if (material.fileType && material.fileType.includes("text")) {
      buttons.push(`<button class="view-button edit-button" data-source-id="${material.sourceId}" data-material-name="${material.fileName}">
                Edit
            </button>`);
    }
    
    // Add refetch button for links
    if (material.fileType && material.fileType === 'link') {
      buttons.push(`<button class="view-button refetch-button" data-source-id="${material.sourceId}" data-material-name="${material.fileName}">
                Refetch
            </button>`);
    }
    
    // Add delete button
    buttons.push(`<button class="view-button delete-button" data-source-id="${material.sourceId}" data-material-name="${material.fileName}">
                Delete
            </button>`);
    
    card.innerHTML += `
        <div class="material-footer">
            ${buttons.join('')}
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
      showDeleteConfirmation(material.sourceId, material.fileName);
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
  const materialNameEl = document.getElementById("delete-material-name");
  const confirmBtn = document.getElementById("delete-modal-confirm");
  const cancelBtn = document.getElementById("delete-modal-cancel");
  const closeBtn = document.getElementById("delete-modal-close");

  // Set material name
  materialNameEl.textContent = materialName;

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
  const modal = document.getElementById("edit-text-modal");
  const textContent = document.getElementById("edit-text-content");
  const materialNameEl = document.getElementById("edit-material-name");
  
  if (!modal || !textContent) {
    console.error("Edit modal elements not found");
    return;
  }

  // Set material name
  if (materialNameEl) {
    materialNameEl.textContent = material.fileName || "Textbook";
  }

  // Load existing content
  textContent.value = material.fileContent || "";

  // Store material data for save
  textContent.dataset.sourceId = material.sourceId;
  textContent.dataset.courseId = material.courseId;

  // Show modal
  modal.classList.add("modal--active");
  textContent.focus();
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
  }
}

async function saveEditedTextContent() {
  const textContentEl = document.getElementById("edit-text-content");
  if (!textContentEl) return;

  const textContent = textContentEl.value.trim();
  if (!textContent) {
    showNotification("Please enter some content", "error");
    return;
  }

  const sourceId = textContentEl.dataset.sourceId;
  let courseId = textContentEl.dataset.courseId;

  if (!sourceId) {
    showNotification("Error: Material source ID not found", "error");
    return;
  }

  // Fallback: get courseId from selected course if not in material
  if (!courseId) {
    try {
      const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course"));
      if (selectedCourse && selectedCourse.id) {
        courseId = selectedCourse.id;
      }
    } catch (e) {
      console.error("Error getting selected course:", e);
    }
  }

  if (!courseId) {
    showNotification("Error: Course ID not found", "error");
    return;
  }

  try {
    // Call API to update material (delete old, save new)
    const response = await fetch("/api/material/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: sourceId,
        courseId: courseId,
        textContent: textContent,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      showNotification(data.error || "Failed to update material", "error");
      return;
    }

    // Reload materials from server to ensure consistency
    await loadCourseMaterials();
    
    // Reapply filters to refresh the display
    applyFilters();

    closeEditModal();
    showNotification("Textbook updated successfully", "success");
  } catch (error) {
    console.error("Error updating textbook:", error);
    showNotification("Error updating textbook. Please try again.", "error");
  }
}

async function refetchLinkContent(material) {
  if (!material.sourceId || !material.fileName) {
    showNotification("Error: Material information not found", "error");
    return;
  }

  const url = material.fileName; // URL is stored in fileName for links
  const sourceId = material.sourceId;
  let courseId = material.courseId;

  // Fallback: get courseId from selected course if not in material
  if (!courseId) {
    try {
      const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course"));
      if (selectedCourse && selectedCourse.id) {
        courseId = selectedCourse.id;
      }
    } catch (e) {
      console.error("Error getting selected course:", e);
    }
  }

  if (!courseId) {
    showNotification("Error: Course ID not found", "error");
    return;
  }

  try {
    // Show loading notification
    showNotification("Refetching URL content...", "info");

    // Step 1: Fetch new content from URL
    const fetchResponse = await fetch("/api/rag-llm/fetch-url-content", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: url }),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to fetch URL content");
    }

    const fetchData = await fetchResponse.json();
    if (!fetchData.success || !fetchData.content) {
      throw new Error("No content retrieved from URL");
    }

    const newContent = fetchData.content;

    // Step 2: Call API to refetch material (delete old, save new)
    const response = await fetch("/api/material/refetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: sourceId,
        courseId: courseId,
        url: url,
        content: newContent,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      showNotification(data.error || "Failed to refetch material", "error");
      return;
    }

    // Reload materials from server to ensure consistency
    await loadCourseMaterials();
    
    // Reapply filters to refresh the display
    applyFilters();

    showNotification("Link content refetched successfully", "success");
  } catch (error) {
    console.error("Error refetching link content:", error);
    showNotification("Error refetching link content. Please try again.", "error");
  }
}

async function confirmDelete(sourceId) {
  // Delete material from RAG.
  let response = await fetch(`/api/rag-llm/delete-document/${sourceId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
  });

  let data = await response.json();

  if (!data.success) {
    showNotification("Failed to delete material from RAG", "error");
    return;
  }
  
  // Delete material from database.
  response = await fetch(`/api/material/delete/${sourceId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
  });

  data = await response.json();

  if (!data.success) {
    showNotification("Failed to delete material from database", "error");
    return;
  }

  // Remove material from arrays
  materials = materials.filter((material) => material.sourceId !== sourceId);
  filteredMaterials = filteredMaterials.filter((material) => material.sourceId !== sourceId);

  // Reload materials.
  loadMaterials();

  showNotification("Material deleted successfully", "success");
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

  if (filteredMaterials.length === 0) {
    materialsGrid.style.display = "none";
    noResults.style.display = "flex";
    return;
  }

  materialsGrid.style.display = "grid";
  noResults.style.display = "none";

  materialsGrid.innerHTML = "";
console.log("Loading materials:", filteredMaterials);
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
