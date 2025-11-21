// Course Materials Page JavaScript

let materials = [];
let filteredMaterials = [];
let materialsState = null;
let currentView = "grid";
let selectedObjectives = [];
let currentMaterialId = null;

// Sample materials data (will be replaced with API calls)
const sampleMaterials = [
  {
    id: "1",
    title: "Introduction to Algorithms",
    course: "CS101",
    week: 1,
    type: "pdf",
    description: "Fundamental concepts of algorithms and data structures",
    objectives: ["LO 1.1", "LO 1.2"],
    fileSize: 2.5,
    uploadedAt: new Date().toISOString(),
    relatedQuestions: 15,
  },
  {
    id: "2",
    title: "Data Structures Overview",
    course: "CS101",
    week: 2,
    type: "video",
    description: "Video lecture covering arrays, linked lists, and trees",
    objectives: ["LO 2.1", "LO 2.2"],
    fileSize: 45.2,
    uploadedAt: new Date().toISOString(),
    relatedQuestions: 8,
  },
];

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize state persistence
  materialsState = new StatePersistence("courseMaterials", {
    selectedCourse: "all",
    filters: { week: "all", objective: "all", type: "all", search: "" },
    viewMode: "grid",
  });

  // Restore state
  restoreState();

  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize course materials
  initializeCourseMaterials();
});

function restoreState() {
  if (materialsState) {
    const savedCourse = materialsState.getState("selectedCourse");
    const savedFilters = materialsState.getState("filters");
    const savedView = materialsState.getState("viewMode");

    if (savedCourse) {
      const courseFilter = document.getElementById("courseFilter");
      if (courseFilter) courseFilter.value = savedCourse;
    }

    if (savedFilters) {
      const weekFilter = document.getElementById("weekFilter");
      const objectiveFilter = document.getElementById("objectiveFilter");
      const typeFilter = document.getElementById("typeFilter");
      const searchInput = document.getElementById("searchInput");

      if (weekFilter && savedFilters.week) weekFilter.value = savedFilters.week;
      if (objectiveFilter && savedFilters.objective)
        objectiveFilter.value = savedFilters.objective;
      if (typeFilter && savedFilters.type) typeFilter.value = savedFilters.type;
      if (searchInput && savedFilters.search) {
        searchInput.value = savedFilters.search;
        if (savedFilters.search) {
          document.getElementById("clearSearch").style.display = "block";
        }
      }
    }

    if (savedView) {
      currentView = savedView;
      switchView(savedView);
    }
  }
}

function initializeCourseMaterials() {
  console.log("Initializing Course Materials page...");

  // Set page title
  document.title = "Course Materials - GRASP";

  // Load materials from localStorage or API
  loadMaterialsFromStorage();

  // Load course data
  loadCourseData();

  // Initialize UI components
  initializeFilters();
  initializeSearch();
  initializeUploadModal();
  initializeViewModal();
  initializeViewToggle();
  initializeObjectivesInput();

  // Load and display materials
  applyFilters();
  updateStats();
}

async function loadCourseData() {
  try {
    const response = await fetch("/api/courses");
    const data = await response.json();

    if (data.success && data.courses) {
      updateCourseFilter(data.courses);
      updateMaterialCourseDropdown(data.courses);
    }

    // Load objectives from materials
    updateObjectivesFilter();
  } catch (error) {
    console.error("Error loading course data:", error);
    showNotification("Error loading course data", "error");
  }
}

function loadMaterialsFromStorage() {
  const savedMaterials = localStorage.getItem("courseMaterials_data");
  if (savedMaterials) {
    try {
      materials = JSON.parse(savedMaterials);
    } catch (e) {
      console.error("Error parsing saved materials:", e);
      materials = [...sampleMaterials];
    }
  } else {
    materials = [...sampleMaterials];
  }
}

function saveMaterialsToStorage() {
  localStorage.setItem("courseMaterials_data", JSON.stringify(materials));
}

function updateCourseFilter(courses) {
  const courseFilter = document.getElementById("courseFilter");
  if (!courseFilter) return;

  courseFilter.innerHTML = '<option value="all">All Courses</option>';

  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.code;
    option.textContent = `${course.code} - ${course.name || course.fullName}`;
    courseFilter.appendChild(option);
  });
}

function updateMaterialCourseDropdown(courses) {
  const materialCourse = document.getElementById("materialCourse");
  if (!materialCourse) return;

  materialCourse.innerHTML = '<option value="">Select a course</option>';

  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.code;
    option.textContent = `${course.code} - ${course.name || course.fullName}`;
    materialCourse.appendChild(option);
  });
}

function updateObjectivesFilter() {
  const objectiveFilter = document.getElementById("objectiveFilter");
  if (!objectiveFilter) return;

  // Collect all unique objectives from materials
  const allObjectives = new Set();
  materials.forEach((material) => {
    if (material.objectives && Array.isArray(material.objectives)) {
      material.objectives.forEach((obj) => allObjectives.add(obj));
    }
  });

  // Clear existing options except "All Objectives"
  objectiveFilter.innerHTML = '<option value="all">All Objectives</option>';

  // Add unique objectives
  Array.from(allObjectives)
    .sort()
    .forEach((obj) => {
      const option = document.createElement("option");
      option.value = obj;
      option.textContent = obj;
      objectiveFilter.appendChild(option);
    });
}

function loadMaterials() {
  const materialsGrid = document.getElementById("materialsGrid");
  const noResults = document.getElementById("noResults");

  if (filteredMaterials.length === 0) {
    materialsGrid.style.display = "none";
    noResults.style.display = "flex";
    return;
  }

  materialsGrid.style.display = currentView === "grid" ? "grid" : "block";
  noResults.style.display = "none";

  materialsGrid.innerHTML = "";
  materialsGrid.className = `materials-grid ${currentView}-view`;

  filteredMaterials.forEach((material) => {
    const materialCard = createMaterialCard(material);
    materialsGrid.appendChild(materialCard);
  });
}

function createMaterialCard(material) {
  const card = document.createElement("div");
  card.className = "material-card";
  card.dataset.materialId = material.id;

  const typeIcon = getTypeIcon(material.type);
  const typeLabel = getTypeLabel(material.type);
  const uploadedDate = new Date(material.uploadedAt).toLocaleDateString();
  const fileSize = material.fileSize
    ? `${material.fileSize} MB`
    : "Size unknown";

  card.innerHTML = `
        <div class="material-header">
            <div class="material-icon ${material.type}">
                <i class="${typeIcon}"></i>
            </div>
            <div class="material-info">
                <h3 class="material-title">${material.title}</h3>
                <p class="material-type">${typeLabel}</p>
                <p class="material-meta">
                    <span><i class="fas fa-book"></i> ${material.course}</span>
                    ${material.week ? `<span><i class="fas fa-calendar"></i> Week ${material.week}</span>` : ""}
                    <span><i class="fas fa-clock"></i> ${uploadedDate}</span>
                </p>
            </div>
        </div>
        
        ${material.description ? `<div class="material-description">${material.description}</div>` : ""}
        
        ${material.objectives && material.objectives.length > 0
      ? `<div class="material-objectives">
            ${material.objectives
              .map(
                (obj) =>
                  `<span class="objective-tag" data-objective="${obj}">${obj}</span>`
              )
              .join("")}
            </div>`
      : ""}
        
        <div class="material-footer">
            <div class="material-stats">
                <span class="file-size"><i class="fas fa-file"></i> ${fileSize}</span>
                ${material.relatedQuestions
      ? `<span class="related-questions"><i class="fas fa-question-circle"></i> ${material.relatedQuestions} questions</span>`
      : ""}
            </div>
            <div class="material-actions">
                <button class="action-icon-button" onclick="viewMaterial('${material.id}')" title="View">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="action-icon-button" onclick="editMaterial('${material.id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="action-icon-button danger" onclick="deleteMaterial('${material.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
            </button>
            </div>
        </div>
    `;

  // Add click handler for objective tags
  const objectiveTags = card.querySelectorAll(".objective-tag");
  objectiveTags.forEach((tag) => {
    tag.addEventListener("click", function (e) {
      e.stopPropagation();
      filterByObjective(tag.dataset.objective);
    });
  });

  // Add click handler for card (opens view modal)
  card.addEventListener("click", function (e) {
    if (!e.target.closest("button")) {
    viewMaterial(material.id);
    }
  });

  return card;
}

function getTypeIcon(type) {
  const icons = {
    pdf: "fas fa-file-pdf",
    video: "fas fa-video",
    textbook: "fas fa-book",
    link: "fas fa-external-link-alt",
    document: "fas fa-file-word",
    presentation: "fas fa-file-powerpoint",
  };
  return icons[type] || "fas fa-file";
}

function getTypeLabel(type) {
  const labels = {
    pdf: "PDF Document",
    video: "Video",
    textbook: "Textbook",
    link: "External Link",
    document: "Document",
    presentation: "Presentation",
  };
  return labels[type] || "File";
}

function initializeFilters() {
  const courseFilter = document.getElementById("courseFilter");
  const weekFilter = document.getElementById("weekFilter");
  const objectiveFilter = document.getElementById("objectiveFilter");
  const typeFilter = document.getElementById("typeFilter");

  if (courseFilter) courseFilter.addEventListener("change", applyFilters);
  if (weekFilter) weekFilter.addEventListener("change", applyFilters);
  if (objectiveFilter) objectiveFilter.addEventListener("change", applyFilters);
  if (typeFilter) typeFilter.addEventListener("change", applyFilters);
}

function initializeSearch() {
  const searchInput = document.getElementById("searchInput");
  const clearSearch = document.getElementById("clearSearch");

  if (searchInput) {
  searchInput.addEventListener("input", function () {
      if (this.value.length > 0) {
        clearSearch.style.display = "block";
      } else {
        clearSearch.style.display = "none";
      }
    applyFilters();
  });
  }

  if (clearSearch) {
    clearSearch.addEventListener("click", function () {
      searchInput.value = "";
      this.style.display = "none";
      applyFilters();
    });
  }
}

function initializeViewToggle() {
  const viewToggles = document.querySelectorAll(".view-toggle");
  viewToggles.forEach((toggle) => {
    toggle.addEventListener("click", function () {
      const view = this.dataset.view;
      switchView(view);
    });
  });
}

function switchView(view) {
  currentView = view;
  const materialsGrid = document.getElementById("materialsGrid");
  const viewToggles = document.querySelectorAll(".view-toggle");

  if (materialsGrid) {
    materialsGrid.className = `materials-grid ${view}-view`;
    materialsGrid.dataset.view = view;
  }

  viewToggles.forEach((toggle) => {
    if (toggle.dataset.view === view) {
      toggle.classList.add("active");
    } else {
      toggle.classList.remove("active");
    }
  });

  if (materialsState) {
    materialsState.updateState({ viewMode: view });
  }

  loadMaterials();
}

function applyFilters() {
  const courseFilter = document.getElementById("courseFilter")?.value || "all";
  const weekFilter = document.getElementById("weekFilter")?.value || "all";
  const objectiveFilter =
    document.getElementById("objectiveFilter")?.value || "all";
  const typeFilter = document.getElementById("typeFilter")?.value || "all";
  const searchTerm =
    document.getElementById("searchInput")?.value.toLowerCase() || "";

  // Save filter state
  if (materialsState) {
    materialsState.updateState({
      selectedCourse: courseFilter,
      filters: {
        week: weekFilter,
        objective: objectiveFilter,
        type: typeFilter,
        search: searchTerm,
      },
    });
  }

  filteredMaterials = materials.filter((material) => {
    // Course filter
    if (courseFilter !== "all" && material.course !== courseFilter) {
      return false;
    }

    // Week filter
    if (weekFilter !== "all" && material.week?.toString() !== weekFilter) {
      return false;
    }

    // Objective filter
    if (
      objectiveFilter !== "all" &&
      (!material.objectives || !material.objectives.includes(objectiveFilter))
    ) {
      return false;
    }

    // Type filter
    if (typeFilter !== "all" && material.type !== typeFilter) {
      return false;
    }

    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const matchesTitle = material.title?.toLowerCase().includes(searchLower);
      const matchesDescription = material.description
        ?.toLowerCase()
        .includes(searchLower);
      const matchesCourse = material.course?.toLowerCase().includes(searchLower);

      if (!matchesTitle && !matchesDescription && !matchesCourse) {
      return false;
      }
    }

    return true;
  });

  loadMaterials();
  updateStats();
}

function filterByObjective(objective) {
  const objectiveFilter = document.getElementById("objectiveFilter");
  if (objectiveFilter) {
  objectiveFilter.value = objective;
  applyFilters();
  }
}

function updateStats() {
  const totalMaterials = materials.length;
  const thisWeek = getCurrentWeek();
  const thisWeekMaterials = materials.filter(
    (m) => m.week?.toString() === thisWeek.toString()
  ).length;

  const totalSize = materials.reduce((sum, m) => sum + (m.fileSize || 0), 0);

  const totalMaterialsEl = document.getElementById("totalMaterials");
  const thisWeekMaterialsEl = document.getElementById("thisWeekMaterials");
  const storageUsedEl = document.getElementById("storageUsed");

  if (totalMaterialsEl) totalMaterialsEl.textContent = totalMaterials;
  if (thisWeekMaterialsEl) thisWeekMaterialsEl.textContent = thisWeekMaterials;
  if (storageUsedEl)
    storageUsedEl.textContent = `${totalSize.toFixed(1)} MB`;
}

function getCurrentWeek() {
  // Simple week calculation (can be enhanced)
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
  return Math.ceil(days / 7);
}

// Upload Modal Functions
function initializeUploadModal() {
  const uploadButton = document.getElementById("uploadButton");
  const uploadButtonEmpty = document.getElementById("uploadButtonEmpty");
  const closeUploadModal = document.getElementById("closeUploadModal");
  const cancelUpload = document.getElementById("cancelUpload");
  const uploadForm = document.getElementById("uploadForm");
  const materialType = document.getElementById("materialType");
  const fileUploadArea = document.getElementById("fileUploadArea");
  const materialFile = document.getElementById("materialFile");

  if (uploadButton) {
    uploadButton.addEventListener("click", openUploadModal);
  }

  if (uploadButtonEmpty) {
    uploadButtonEmpty.addEventListener("click", openUploadModal);
  }

  if (closeUploadModal) {
    closeUploadModal.addEventListener("click", closeUploadModalFunc);
  }

  if (cancelUpload) {
    cancelUpload.addEventListener("click", closeUploadModalFunc);
  }

  if (uploadForm) {
    uploadForm.addEventListener("submit", handleUploadSubmit);
  }

  if (materialType) {
    materialType.addEventListener("change", function () {
      toggleUploadInputs(this.value);
    });
  }

  if (fileUploadArea) {
    fileUploadArea.addEventListener("click", () => materialFile?.click());
    fileUploadArea.addEventListener("dragover", handleDragOver);
    fileUploadArea.addEventListener("drop", handleDrop);
    fileUploadArea.addEventListener("dragleave", handleDragLeave);
  }

  if (materialFile) {
    materialFile.addEventListener("change", handleFileSelect);
  }
}

function openUploadModal() {
  const modal = document.getElementById("uploadModal");
  if (modal) {
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
}

function closeUploadModalFunc() {
  const modal = document.getElementById("uploadModal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "";
    resetUploadForm();
  }
}

function resetUploadForm() {
  const form = document.getElementById("uploadForm");
  if (form) form.reset();

  selectedObjectives = [];
  const objectivesTags = document.getElementById("objectivesTags");
  if (objectivesTags) objectivesTags.innerHTML = "";

  const filePreview = document.getElementById("filePreview");
  if (filePreview) {
    filePreview.style.display = "none";
    filePreview.querySelector(".file-name").textContent = "";
  }

  toggleUploadInputs("pdf");
}

function toggleUploadInputs(type) {
  const fileUploadGroup = document.getElementById("fileUploadGroup");
  const urlInputGroup = document.getElementById("urlInputGroup");

  if (type === "link") {
    if (fileUploadGroup) fileUploadGroup.style.display = "none";
    if (urlInputGroup) urlInputGroup.style.display = "block";
  } else {
    if (fileUploadGroup) fileUploadGroup.style.display = "block";
    if (urlInputGroup) urlInputGroup.style.display = "none";
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add("drag-over");
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
}

function handleFile(file) {
  const filePreview = document.getElementById("filePreview");
  const fileName = filePreview?.querySelector(".file-name");

  if (filePreview && fileName) {
    fileName.textContent = file.name;
    filePreview.style.display = "block";
  }

  // Store file for upload
  const materialFile = document.getElementById("materialFile");
  if (materialFile) {
    // File is already in the input
  }
}

function removeFile() {
  const materialFile = document.getElementById("materialFile");
  const filePreview = document.getElementById("filePreview");

  if (materialFile) materialFile.value = "";
  if (filePreview) filePreview.style.display = "none";
}

function initializeObjectivesInput() {
  const objectivesInput = document.getElementById("materialObjectives");
  if (!objectivesInput) return;

  objectivesInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = this.value.trim();
      if (value && !selectedObjectives.includes(value)) {
        selectedObjectives.push(value);
        updateObjectivesTags();
        this.value = "";
      }
    }
  });
}

function updateObjectivesTags() {
  const objectivesTags = document.getElementById("objectivesTags");
  if (!objectivesTags) return;

  objectivesTags.innerHTML = selectedObjectives
    .map(
      (obj) => `
        <span class="objective-tag-input">
            ${obj}
            <button type="button" onclick="removeObjective('${obj}')">
                <i class="fas fa-times"></i>
            </button>
        </span>
    `
    )
    .join("");
}

function removeObjective(objective) {
  selectedObjectives = selectedObjectives.filter((obj) => obj !== objective);
  updateObjectivesTags();
}

async function handleUploadSubmit(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const materialType = formData.get("type");
  const title = formData.get("title");
  const course = formData.get("course");
  const week = formData.get("week");
  const description = formData.get("description");
  const file = formData.get("file");
  const url = formData.get("url");

  // Validation
  if (!title || !course || !materialType) {
    showNotification("Please fill in all required fields", "error");
    return;
  }

  if (materialType === "link" && !url) {
    showNotification("Please provide a URL for link materials", "error");
    return;
  }

  if (materialType !== "link" && !file) {
    showNotification("Please upload a file", "error");
    return;
  }

  // Show loading state
  const submitButton = e.target.querySelector(".submit-button");
  const originalText = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

  try {
    // Create material object
    const newMaterial = {
      id: Date.now().toString(),
      title: title,
      course: course,
      week: week ? parseInt(week) : null,
      type: materialType,
      description: description || "",
      objectives: [...selectedObjectives],
      fileSize: file ? (file.size / (1024 * 1024)).toFixed(2) : 0,
      uploadedAt: new Date().toISOString(),
      relatedQuestions: 0,
      url: url || null,
    };

    // In a real app, upload to server here
    // For now, add to local array
    materials.push(newMaterial);
    saveMaterialsToStorage();

    // Update objectives filter
    updateObjectivesFilter();

    // Close modal and refresh
    closeUploadModalFunc();
    applyFilters();
    updateStats();

    showNotification("Material uploaded successfully!", "success");
  } catch (error) {
    console.error("Error uploading material:", error);
    showNotification("Failed to upload material. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalText;
  }
}

// View Modal Functions
function initializeViewModal() {
  const closeViewModal = document.getElementById("closeViewModal");
  const editMaterialBtn = document.getElementById("editMaterialBtn");
  const deleteMaterialBtn = document.getElementById("deleteMaterialBtn");

  if (closeViewModal) {
    closeViewModal.addEventListener("click", closeViewModalFunc);
  }

  if (editMaterialBtn) {
    editMaterialBtn.addEventListener("click", () => {
      if (currentMaterialId) {
        editMaterial(currentMaterialId);
      }
    });
  }

  if (deleteMaterialBtn) {
    deleteMaterialBtn.addEventListener("click", () => {
      if (currentMaterialId) {
        deleteMaterial(currentMaterialId);
      }
    });
  }

  // Close on overlay click
  const viewModal = document.getElementById("viewModal");
  if (viewModal) {
    viewModal.addEventListener("click", (e) => {
      if (e.target === viewModal) {
        closeViewModalFunc();
      }
    });
  }
}

function viewMaterial(materialId) {
  const material = materials.find((m) => m.id === materialId);
  if (!material) {
    showNotification("Material not found", "error");
    return;
  }

  currentMaterialId = materialId;
  const modal = document.getElementById("viewModal");
  const modalTitle = document.getElementById("viewMaterialTitle");
  const modalBody = document.getElementById("viewModalBody");

  if (modalTitle) modalTitle.textContent = material.title;

  if (modalBody) {
    const typeIcon = getTypeIcon(material.type);
    const typeLabel = getTypeLabel(material.type);
    const uploadedDate = new Date(material.uploadedAt).toLocaleDateString();
    const fileSize = material.fileSize
      ? `${material.fileSize} MB`
      : "Size unknown";

    modalBody.innerHTML = `
            <div class="material-view-header">
                <div class="material-icon-large ${material.type}">
                    <i class="${typeIcon}"></i>
                </div>
                <div class="material-view-info">
                    <h3>${material.title}</h3>
                    <p class="material-type-badge">${typeLabel}</p>
                </div>
            </div>

            <div class="material-view-details">
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-book"></i> Course:</span>
                    <span class="detail-value">${material.course}</span>
                </div>
                ${material.week
      ? `<div class="detail-row">
                    <span class="detail-label"><i class="fas fa-calendar"></i> Week:</span>
                    <span class="detail-value">Week ${material.week}</span>
                </div>`
      : ""}
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-clock"></i> Uploaded:</span>
                    <span class="detail-value">${uploadedDate}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-file"></i> Size:</span>
                    <span class="detail-value">${fileSize}</span>
                </div>
                ${material.url
      ? `<div class="detail-row">
                    <span class="detail-label"><i class="fas fa-link"></i> URL:</span>
                    <span class="detail-value"><a href="${material.url}" target="_blank">${material.url}</a></span>
                </div>`
      : ""}
            </div>

            ${material.description
      ? `<div class="material-view-description">
                <h4>Description</h4>
                <p>${material.description}</p>
            </div>`
      : ""}

            ${material.objectives && material.objectives.length > 0
      ? `<div class="material-view-objectives">
                <h4>Learning Objectives</h4>
                <div class="objectives-list">
                    ${material.objectives
        .map((obj) => `<span class="objective-badge">${obj}</span>`)
        .join("")}
                </div>
            </div>`
      : ""}

            <div class="material-view-actions">
                <button class="view-action-button primary" onclick="openMaterial('${material.id}')">
                    <i class="fas fa-external-link-alt"></i>
                    <span>Open Material</span>
                </button>
                ${material.relatedQuestions
      ? `<button class="view-action-button" onclick="viewRelatedQuestions('${material.id}')">
                    <i class="fas fa-question-circle"></i>
                    <span>View ${material.relatedQuestions} Related Questions</span>
                </button>`
      : ""}
            </div>
        `;
  }

  if (modal) {
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
}

function closeViewModalFunc() {
  const modal = document.getElementById("viewModal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = "";
    currentMaterialId = null;
  }
}

function openMaterial(materialId) {
  const material = materials.find((m) => m.id === materialId);
  if (!material) return;

  if (material.type === "link" && material.url) {
    window.open(material.url, "_blank");
  } else {
    // In a real app, open the file viewer
    showNotification("Opening material...", "info");
    // window.location.href = `/materials/view/${materialId}`;
  }
}

function viewRelatedQuestions(materialId) {
  // Navigate to question bank filtered by this material
  window.location.href = `/question-bank.html?material=${materialId}`;
}

function editMaterial(materialId) {
  const material = materials.find((m) => m.id === materialId);
  if (!material) {
    showNotification("Material not found", "error");
    return;
  }

  // Populate upload form with material data
  document.getElementById("materialTitle").value = material.title;
  document.getElementById("materialCourse").value = material.course;
  document.getElementById("materialWeek").value = material.week || "";
  document.getElementById("materialType").value = material.type;
  document.getElementById("materialDescription").value = material.description || "";
  if (material.url) document.getElementById("materialUrl").value = material.url;

  selectedObjectives = [...(material.objectives || [])];
  updateObjectivesTags();

  toggleUploadInputs(material.type);

  // Store material ID for update
  currentMaterialId = materialId;

  // Close view modal and open upload modal
  closeViewModalFunc();
  openUploadModal();

  // Change submit button text
  const submitButton = document.querySelector(".submit-button");
  if (submitButton) {
    submitButton.innerHTML = '<i class="fas fa-save"></i> <span>Save Changes</span>';
  }
}

function deleteMaterial(materialId) {
  if (!confirm("Are you sure you want to delete this material? This action cannot be undone.")) {
    return;
  }

  const index = materials.findIndex((m) => m.id === materialId);
  if (index === -1) {
    showNotification("Material not found", "error");
    return;
  }

  materials.splice(index, 1);
  saveMaterialsToStorage();

  closeViewModalFunc();
  applyFilters();
  updateStats();
  updateObjectivesFilter();

  showNotification("Material deleted successfully", "success");
}

// Notification function
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === "success" ? "check-circle" : type === "error" ? "exclamation-circle" : "info-circle"}"></i>
            <span>${message}</span>
        </div>
    `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("show");
  }, 100);

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

// Export functions for global access
window.viewMaterial = viewMaterial;
window.editMaterial = editMaterial;
window.deleteMaterial = deleteMaterial;
window.removeFile = removeFile;
window.removeObjective = removeObjective;
window.openMaterial = openMaterial;
window.viewRelatedQuestions = viewRelatedQuestions;
