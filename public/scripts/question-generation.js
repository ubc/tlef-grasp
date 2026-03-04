// Question Generation JavaScript
// State management and functionality for the 5-step question generation process

// Constants
const API_ENDPOINTS = {
  material: '/api/material',
  materialCourse: '/api/material/course',
  objective: '/api/objective',
  question: '/api/question',
  questionSave: '/api/question/save',
  quiz: '/api/quiz',
  quizCourse: '/api/quiz/course',
  ragLlmGenerateLO: '/api/rag-llm/generate-learning-objectives',
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
 * Get the course ID from state or session storage
 * @returns {string|null} The course ID or null
 */
function getCourseId() {
  if (state.course?.id) return state.course.id;
  const selectedCourse = getSelectedCourse();
  return selectedCourse?.id || null;
}

let questionGenerator = null;
let contentGenerator = null;
let currentEditGroupId = null; // Used for identifying which group to delete

// Main state object
const selectedCourseData = getSelectedCourse();
const state = {
  step: 1, // Step 1 is now Create Objectives (was step 3)
  course: selectedCourseData || '',
  selectedCourse: selectedCourseData?.courseName || '', // Course name for display
  objectiveGroups: [], // Step 1: Create Objectives
  // Step 2: Question Generation
  questionGroups: [], // Meta LO groups with granular LOs and questions
  selectedQuestions: new Set(), // Set of selected question IDs
  filters: {
    glo: "all",
    bloom: "all",
    status: "all",
    q: "", // search query
  },
};

// Step titles for dynamic updates
const STEPTITLES = {
  1: "Create Objectives",
  2: "Generate Questions",
  3: "Save Quiz to Question Bank",
};

// Bloom's taxonomy levels
const BLOOMLEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

// Initialize the application
document.addEventListener('DOMContentLoaded', async function () {
  // Initialize GRASP navigation first to create sidebar
  if (window.GRASPNavigation) {
    new window.GRASPNavigation();
  }

  initializeNavigation();
  initializeEventListeners();
  initializeModules();
  await loadCourseData();
  await checkCourseMaterials();
  updateUI();
});

// ===== MODULE INITIALIZATION =====

async function loadCourseData() {
  try {
    if (!state.selectedCourse) {
      showNoCourseSelectedMessage();
    }
  } catch {
    showNoCourseSelectedMessage();
  }
}

function showNoCourseSelectedMessage() {
  const stepContent = document.getElementById("step-content");
  const noMaterialsMessage = document.getElementById("no-materials-message");
  if (stepContent) stepContent.style.display = "none";
  if (noMaterialsMessage) {
    noMaterialsMessage.style.display = "block";
    // Update message for no course selected
    const messageDiv = noMaterialsMessage.querySelector("h2");
    if (messageDiv) {
      messageDiv.textContent = "No Course Selected";
    }
    const messageP = noMaterialsMessage.querySelector("p");
    if (messageP) {
      messageP.textContent = "Please select a course first to generate questions.";
    }
  }
}


async function checkCourseMaterials() {
  const stepContent = document.getElementById('step-content');
  const noMaterialsMessage = document.getElementById('no-materials-message');

  const showContent = (hasContent) => {
    if (stepContent) stepContent.style.display = hasContent ? 'block' : 'none';
    if (noMaterialsMessage) noMaterialsMessage.style.display = hasContent ? 'none' : 'block';
  };

  try {
    const selectedCourse = getSelectedCourse();
    if (!selectedCourse?.id) {
      showNoCourseSelectedMessage();
      return;
    }

    const response = await fetch(`${API_ENDPOINTS.materialCourse}/${selectedCourse.id}`);
    const data = await response.json();

    const hasContent = data.success && data.materials && data.materials.length > 0;
    showContent(hasContent);
  } catch (error) {
    console.error('Error checking course materials:', error);
    showContent(false);
  }
}

function initializeModules() {
  try {
    if (window.ContentGenerator) {
      contentGenerator = new window.ContentGenerator();
    }

    if (window.QuestionGenerator && contentGenerator) {
      questionGenerator = new window.QuestionGenerator(contentGenerator);
    }
  } catch (error) {
    console.error('Error initializing modules:', error);
    showToast('Failed to initialize required modules. Please refresh the page.', 'error');
  }
}

// ===== Generate Questions FUNCTIONS =====


// ===== NAVIGATION FUNCTIONS =====

function initializeNavigation() {
  if (window.GRASPNavigation) {
    new window.GRASPNavigation();
  }
}

function initializeEventListeners() {
  // Navigation buttons
  const backBtn = document.getElementById("back-btn");
  const continueBtn = document.getElementById("continue-btn");
  const refreshNoMaterialsBtn = document.getElementById("refresh-no-materials-btn");

  if (refreshNoMaterialsBtn) {
    refreshNoMaterialsBtn.addEventListener("click", () => window.location.reload());
  }

  if (backBtn) {
    backBtn.addEventListener("click", goToPreviousStep);
  }

  if (continueBtn) {
    continueBtn.addEventListener("click", goToNextStep);
  }

  // Step 1: Objectives
  initializeObjectives();

  // Step 3: Quiz selection/creation
  initializeQuizSelection();
}

function goToNextStep() {

  if (state.step === 3) {
    // Final step - save questions to quiz
    handleSaveToQuiz();
    return;
  }

  if (state.step < 3) {
    const currentStep = state.step;
    const nextStep = currentStep + 1;

    // Validate current step before proceeding
    if (validateCurrentStep()) {
      state.step = nextStep;
      updateUI();
      handleStepTransition(currentStep, nextStep);
    }
  }
}

function goToPreviousStep() {
  if (state.step > 1) {
    state.step = state.step - 1;
    updateUI();
  }
}

function validateCurrentStep() {
  switch (state.step) {
    case 1:
      // Validation: Each learning objective must have at least 5 questions total
      // and each granular objective with manual mode must have a Bloom level selected
      if (state.objectiveGroups.length === 0) {
        showToast("Please add at least one learning objective", "error");
        return false;
      }

      const validationErrors = [];

      state.objectiveGroups.forEach((group, groupIndex) => {
        // Check if group has granular objectives
        if (group.items.length === 0) {
          validationErrors.push(
            `Learning objective "${group.title}" has no granular objectives`
          );
          return;
        }

        // Check total questions >= 5 for each group
        const totalQuestions = group.items.reduce(
          (sum, item) => sum + item.count,
          0
        );
        if (totalQuestions < 5) {
          validationErrors.push(
            `Learning objective "${group.title}" must have at least 5 questions (currently has ${totalQuestions})`
          );
        }

        // Check Bloom levels for manual mode granular objectives
        // Note: Bloom validation messages are shown inline, not as toast
        group.items.forEach((item, itemIndex) => {
          if (item.mode === "manual" && item.bloom.length === 0) {
            // Bloom validation is shown inline, but we still track it for overall validation
            validationErrors.push(
              `Granular objective in "${group.title}" must have a Bloom level selected`
            );
          }
        });
      });

      if (validationErrors.length > 0) {
        // Filter out Bloom validation errors (shown inline)
        const nonBloomErrors = validationErrors.filter(
          (error) => !error.includes("Bloom level selected")
        );

        // Show first non-Bloom error as toast, log all errors
        if (nonBloomErrors.length > 0) {
          showToast(nonBloomErrors[0], "error");
        }

        // Re-render to show/hide inline Bloom validation messages
        renderObjectiveGroups();
        return false;
      }

      // Re-render to hide any validation messages if validation passes
      renderObjectiveGroups();
      return true;
    case 2:
      // Step 2 validation - check if we have question groups with questions
      return state.questionGroups.length > 0 &&
        state.questionGroups.some((group) =>
          group.los.some((lo) => lo.questions.length > 0)
        );
    default:
      return true;
  }
}

function handleStepTransition(fromStep, toStep) {
  switch (toStep) {
    case 2:
      step2();
      break;
    case 3:
      initializeQuizSelection();
      loadQuizzesForCourse();
      break;
  }
}

// ===== UI UPDATE FUNCTIONS =====

function updateUI() {
  updateStepper();
  updatePageTitle();
  updateStepContent();
  updateNavigationButtons();
}

function updateStepper() {
  const steps = document.querySelectorAll(".stepper__step");

  steps.forEach((step, index) => {
    const stepNumber = index + 1;
    step.classList.remove("stepper__step--active", "stepper__step--done");

    if (stepNumber === state.step) {
      step.classList.add("stepper__step--active");
    } else if (stepNumber < state.step) {
      step.classList.add("stepper__step--done");
    }
  });
}

function updatePageTitle() {
  // Update the main page title based on the current step
  const title = document.querySelector(".content-header__title");
  if (title) {
    title.textContent = STEPTITLES[state.step];
  }

  // Also update the quiz save title in Step 3 if it exists
  const quizSaveTitle = document.querySelector(".quiz-save-title");
  if (quizSaveTitle && state.step === 3) {
    quizSaveTitle.textContent = STEPTITLES[state.step];
  }
}


function updateStepContent() {
  const panels = document.querySelectorAll(".step-panel");

  panels.forEach((panel) => {
    panel.classList.remove("step-panel--active");
    if (parseInt(panel.dataset.step) === state.step) {
      panel.classList.add("step-panel--active");
    }
  });
}

function updateNavigationButtons() {
  // Don't update buttons if questions are currently being generated
  if (isGeneratingQuestions()) {
    return;
  }

  const backBtn = document.getElementById("back-btn");
  const continueBtn = document.getElementById("continue-btn");

  if (backBtn) {
    backBtn.disabled = state.step === 1;
    backBtn.textContent = "Back";
    backBtn.className = "btn btn--secondary";
  }

  if (continueBtn) {
    if (state.step === 3) {
      continueBtn.textContent = "Save to Quiz";
      continueBtn.className = "btn btn--primary";
      continueBtn.disabled = false;
    } else if (state.step === 1) {
      // Step 1: Disable if no learning objectives
      continueBtn.disabled = state.objectiveGroups.length === 0;
      continueBtn.textContent = "Continue";
      continueBtn.className = continueBtn.disabled ? "btn btn--primary btn--disabled" : "btn btn--primary";
    } else {
      continueBtn.disabled = false;
      continueBtn.textContent = "Continue";
      continueBtn.className = "btn btn--primary";
    }
  }
}

// Initialize Step 3 state
function initializeObjectives() {
  // Don't auto-generate objectives - user should add them from database
  // Learning objectives are now managed through the database

  // Initialize add objectives button
  const addObjectivesBtn = document.getElementById("add-objectives-btn");
  if (addObjectivesBtn) {
    addObjectivesBtn.addEventListener("click", toggleAddObjectivesDropdown);
  }

  // Initialize dropdown buttons (AI and Custom)
  const generateAiBtn = document.getElementById("generate-ai-btn");
  if (generateAiBtn) {
    generateAiBtn.addEventListener("click", (e) => {
      window.showAIGenerateObjectiveModal(e);
    });
  }



  // Initialize dropdown functionality
  initializeAddObjectivesDropdown();

  // Initialize modals
  initializeModals();

  // Render initial state
  renderObjectiveGroups();
}

async function initializeAddObjectivesDropdown() {
  try {
    const dropdown = document.getElementById("add-objectives-dropdown");
    const searchInput = document.getElementById("objective-search");
    const dropdownOptions = document.getElementById("dropdown-options");

    if (!dropdown || !dropdownOptions) {
      return;
    }

    // Fetch learning objectives from API
    try {
      const courseId = getCourseId();
      const response = await fetch(`${API_ENDPOINTS.objective}?courseId=${encodeURIComponent(courseId)}`);
      const data = await response.json();

      if (data.success && data.objectives) {
        // Populate dropdown with objectives from database
        if (data.objectives.length > 0) {
          // Get list of already added objective IDs
          const addedObjectiveIds = new Set(
            state.objectiveGroups
              .filter(group => group.objectiveId)
              .map(group => group.objectiveId.toString())
          );

          dropdownOptions.innerHTML = data.objectives.map(
            (objective) => {
              const isDisabled = addedObjectiveIds.has(objective._id.toString());
              const disabledClass = isDisabled ? "dropdown-option--disabled" : "";
              return `<div class="dropdown-option ${disabledClass}" data-objective-id="${objective._id}" data-objective-name="${objective.name}">${objective.name}</div>`;
            }
          ).join("");
        } else {
          dropdownOptions.innerHTML = '<div class="dropdown-option dropdown-option--empty">No learning objectives found. Create one to get started.</div>';
        }
      } else {
        // Fallback to empty state
        dropdownOptions.innerHTML = '<div class="dropdown-option dropdown-option--empty">No learning objectives found. Create one to get started.</div>';
      }
    } catch (error) {
      console.error("Error fetching learning objectives:", error);
      dropdownOptions.innerHTML = '<div class="dropdown-option dropdown-option--empty">Error loading objectives. Please try again.</div>';
    }

    // Search functionality - remove old listener first
    if (searchInput) {
      // Clone to remove old listeners
      const newSearchInput = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearchInput, searchInput);

      const updatedSearchInput = document.getElementById("objective-search");
      if (updatedSearchInput) {
        updatedSearchInput.addEventListener("input", (e) => {
          const searchTerm = e.target.value.toLowerCase();
          const updatedDropdownOptions = document.getElementById("dropdown-options");
          if (!updatedDropdownOptions) return;

          const options = updatedDropdownOptions.querySelectorAll(".dropdown-option");

          options.forEach((option) => {
            if (option.classList.contains("dropdown-option--empty")) {
              return; // Don't hide empty state messages
            }
            const text = option.textContent.toLowerCase();
            if (text.includes(searchTerm)) {
              option.classList.remove("dropdown-option--hidden");
            } else {
              option.classList.add("dropdown-option--hidden");
            }
          });
        });
      }
    }

    // Option selection - use event delegation with a flag to prevent duplicate handlers
    // Remove any existing handler by cloning the element
    const currentDropdownOptions = document.getElementById("dropdown-options");
    if (currentDropdownOptions) {
      const newDropdownOptions = currentDropdownOptions.cloneNode(true);
      currentDropdownOptions.parentNode.replaceChild(newDropdownOptions, currentDropdownOptions);

      // Update reference for search functionality
      const updatedDropdownOptions = document.getElementById("dropdown-options");

      // Add fresh event listener with a guard to prevent double-firing
      let isHandling = false;
      updatedDropdownOptions.addEventListener("click", async (e) => {
        if (isHandling) return; // Prevent duplicate calls
        if (e.target.classList.contains("dropdown-option") &&
          !e.target.classList.contains("dropdown-option--empty") &&
          !e.target.classList.contains("dropdown-option--di abled")) {
          isHandling = true;
          const objectiveId = e.target.dataset.objectiveId;
          const objectiveName = e.target.dataset.objectiveName;
          await handleObjectiveSelection(objectiveId, objectiveName);
          hideAddObjectivesDropdown();
          // Update dropdown to reflect the newly added objective
          updateDropdownDisabledState();
          isHandling = false;
        }
      });
    }

    // Close dropdown when clicking outside
    // Use a named function so we can remove it if needed
    // Store reference to avoid adding multiple listeners
    if (!window._dropdownClickHandler) {
      window._dropdownClickHandler = (e) => {
        // Don't close if clicking on the AI generate button (handled by inline onclick)
        if (e.target.closest("#generate-ai-btn")) {
          return;
        }

        const dropdown = document.getElementById("add-objectives-dropdown");
        if (
          dropdown &&
          !dropdown.contains(e.target) &&
          !e.target.closest("#add-objectives-btn")
        ) {
          hideAddObjectivesDropdown();
        }
      };
      document.addEventListener("click", window._dropdownClickHandler);
    }
  } catch (error) {
    console.error("Error in initializeAddObjectivesDropdown:", error);
  }
}

function updateDropdownDisabledState() {
  const dropdownOptions = document.getElementById("dropdown-options");
  if (!dropdownOptions) return;

  // Get list of already added objective IDs
  const addedObjectiveIds = new Set(
    state.objectiveGroups
      .filter(group => group.objectiveId)
      .map(group => group.objectiveId.toString())
  );

  // Update each option's disabled state
  const options = dropdownOptions.querySelectorAll(".dropdown-option");
  options.forEach((option) => {
    if (option.classList.contains("dropdown-option--empty")) {
      return; // Skip empty state messages
    }

    const objectiveId = option.dataset.objectiveId;
    if (objectiveId) {
      const isDisabled = addedObjectiveIds.has(objectiveId.toString());
      if (isDisabled) {
        option.classList.add("dropdown-option--disabled");
      } else {
        option.classList.remove("dropdown-option--disabled");
      }
    }
  });
}

function toggleAddObjectivesDropdown() {
  const dropdown = document.getElementById("add-objectives-dropdown");
  const addBtn = document.getElementById("add-objectives-btn");

  if (dropdown.style.display === "none" || !dropdown.style.display) {
    showAddObjectivesDropdown();
  } else {
    hideAddObjectivesDropdown();
  }
}

function showAddObjectivesDropdown() {
  const dropdown = document.getElementById("add-objectives-dropdown");
  const addBtn = document.getElementById("add-objectives-btn");

  // Update disabled state before showing
  updateDropdownDisabledState();

  if (dropdown && addBtn) {
    // Ensure button has relative positioning (should be in CSS, but set as fallback)
    if (getComputedStyle(addBtn).position === 'static') {
      addBtn.style.position = "relative";
    }

    dropdown.style.display = "block";

    // Focus search input
    const searchInput = document.getElementById("objective-search");
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 100);
    }
  }
}

function hideAddObjectivesDropdown() {
  const dropdown = document.getElementById("add-objectives-dropdown");
  if (dropdown) {
    dropdown.style.display = "none";
  }
}

// Global function for inline onclick handler


// Global function for AI generation modal
window.showAIGenerateObjectiveModal = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  hideAddObjectivesDropdown();
  setTimeout(() => {
    showAIGenerateObjectiveModalInternal();
  }, 100);
  return false;
};



// AI Generation Modal Functions
let generatedObjectives = [];


async function showCustomObjectiveModal(mode = "edit", editData = null) {
  const modal = document.getElementById("custom-objective-modal");
  const modalTitle = document.getElementById("custom-modal-title");
  const modalSaveButton = document.getElementById("custom-modal-save");
  const modeInput = document.getElementById("custom-modal-mode");
  const objectiveIdInput = document.getElementById("custom-modal-objective-id");

  if (!modal) return;

  // Set mode
  if (modeInput) {
    modeInput.value = mode;
  }
  if (objectiveIdInput) {
    objectiveIdInput.value = editData?.objectiveId || "";
  }

  // Update modal title and button text
  if (modalTitle) {
    modalTitle.textContent = "Learning Objective Settings";
  }
  if (modalSaveButton) {
    modalSaveButton.textContent = "Save Changes";
  }

  // Load materials with pre-selection
  if (editData?.objectiveId) {
    await loadMaterialsForModal(editData.objectiveId);
  } else {
    loadMaterialsForModal();
  }

  modal.style.display = "flex";
}

async function loadMaterialsForModal(objectiveId = null) {
  const loadingDiv = document.getElementById("materials-loading");
  const materialsList = document.getElementById("materials-list");
  const materialsEmpty = document.getElementById("materials-empty");

  // Show loading
  if (loadingDiv) loadingDiv.style.display = "block";
  if (materialsList) materialsList.style.display = "none";
  if (materialsEmpty) materialsEmpty.style.display = "none";

  try {
    const selectedCourse = getSelectedCourse();
    if (!selectedCourse?.id) {
      if (loadingDiv) loadingDiv.style.display = 'none';
      if (materialsEmpty) materialsEmpty.style.display = 'block';
      return;
    }

    // Load materials and optionally get attached materials for edit mode
    const [materialsResponse, objectiveMaterialsResponse] = await Promise.all([
      fetch(`${API_ENDPOINTS.materialCourse}/${selectedCourse.id}`),
      objectiveId ? fetch(`${API_ENDPOINTS.objective}/${objectiveId}/materials`) : Promise.resolve(null)
    ]);

    const materialsData = await materialsResponse.json();

    // Get attached material IDs if in edit mode
    const attachedMaterialIds = new Set();
    if (objectiveId && objectiveMaterialsResponse) {
      const objectiveMaterialsData = await objectiveMaterialsResponse.json();
      if (objectiveMaterialsData.success && objectiveMaterialsData.materials) {
        objectiveMaterialsData.materials.forEach(m => {
          if (m.sourceId) attachedMaterialIds.add(m.sourceId);
        });
      }
    }

    if (loadingDiv) loadingDiv.style.display = "none";

    if (materialsData.success && materialsData.materials && materialsData.materials.length > 0) {
      displayMaterialsInModal(materialsData.materials, attachedMaterialIds);
      if (materialsList) materialsList.style.display = "block";
    } else {
      if (materialsEmpty) materialsEmpty.style.display = "block";
    }
  } catch (error) {
    console.error("Error loading materials:", error);
    if (loadingDiv) loadingDiv.style.display = "none";
    if (materialsEmpty) materialsEmpty.style.display = "block";
  }
}

function displayMaterialsInModal(materials, attachedMaterialIds = new Set()) {
  const materialsList = document.getElementById("materials-list");
  if (!materialsList) return;

  materialsList.innerHTML = "";

  materials.forEach((material) => {
    const isAttached = attachedMaterialIds.has(material.sourceId);

    const materialItem = document.createElement("div");
    materialItem.className = "material-selection-item";
    materialItem.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; background: white;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = material.sourceId;
    checkbox.id = `material-${material.sourceId}`;
    checkbox.className = "material-checkbox";
    checkbox.checked = isAttached;

    const label = document.createElement("label");
    label.htmlFor = `material-${material.sourceId}`;
    label.style.cssText = "flex: 1; cursor: pointer; display: flex; flex-direction: column; gap: 4px;";

    // File name
    const fileName = document.createElement("div");
    fileName.style.cssText = "font-weight: 600; color: #2c3e50; font-size: 14px;";
    fileName.textContent = material.documentTitle || "Untitled";

    // File details
    const details = document.createElement("div");
    details.style.cssText = "display: flex; gap: 16px; font-size: 12px; color: #7f8c8d;";

    // File type
    const fileType = document.createElement("span");
    fileType.textContent = `Type: ${getMaterialTypeLabel(material.fileType)}`;

    // File size
    const fileSize = document.createElement("span");
    fileSize.textContent = `Size: ${formatFileSize(material.fileSize || 0)}`;

    // Uploaded date
    const uploadedDate = document.createElement("span");
    uploadedDate.textContent = `Uploaded: ${new Date(material.createdAt).toLocaleDateString()}`;

    details.appendChild(fileType);
    details.appendChild(fileSize);
    details.appendChild(uploadedDate);

    label.appendChild(fileName);
    label.appendChild(details);

    materialItem.appendChild(checkbox);
    materialItem.appendChild(label);

    materialsList.appendChild(materialItem);
  });
}

async function handleCustomObjectiveSubmission() {
  const modal = document.getElementById("custom-objective-modal");
  const saveButton = document.getElementById("custom-modal-save");
  const objectiveIdInput = document.getElementById("custom-modal-objective-id");
  const objectiveId = objectiveIdInput ? objectiveIdInput.value : null;

  if (!objectiveId) {
    showToast("Invalid objective ID", "error");
    return;
  }

  // Collect selected materials
  const materialCheckboxes = document.querySelectorAll(".material-checkbox:checked");
  const selectedMaterials = Array.from(materialCheckboxes).map(cb => cb.value);

  if (selectedMaterials.length === 0) {
    showToast("Please attach at least one course material", "warning");
    return;
  }

  // Disable button
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML = "Saving...";
  }

  try {
    const courseId = getCourseId();
    const group = state.objectiveGroups.find((g) => g.objectiveId === objectiveId);
    
    const requestBody = {
      name: group.title,
      granularObjectives: group.items.map(i => ({
        id: i.granularId,
        text: i.text,
        bloomTaxonomies: i.bloom || []
      })),
      materialIds: selectedMaterials,
      courseId: courseId,
    };

    const response = await fetch(`${API_ENDPOINTS.objective}/${objectiveId}`, {
      method: "PUT",
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to update learning objective");
    }

    showToast("Learning objective settings updated", "success");
    hideModal(modal);
  } catch (error) {
    console.error("Error updating learning objective:", error);
    showToast(error.message || "Failed to update learning objective", "error");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = "Save Changes";
    }
  }
}

function showAIGenerateObjectiveModalInternal() {
  const modal = document.getElementById("ai-generate-objective-modal");
  if (!modal) {
    console.error("AI generate modal element not found");
    return;
  }



  // Reset state
  generatedObjectives = [];
  const generateBtn = document.getElementById("ai-generate-btn");
  const regenerateBtn = document.getElementById("ai-regenerate-btn");
  const saveBtn = document.getElementById("ai-save-btn");
  const statusDiv = document.getElementById("ai-generation-status");
  const generatedContainer = document.getElementById("ai-generated-objectives-container");
  const generatedList = document.getElementById("ai-generated-objectives-list");

  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.style.display = "inline-block";
  }
  if (regenerateBtn) {
    regenerateBtn.style.display = "none";
  }
  if (saveBtn) {
    saveBtn.style.display = "none";
  }
  if (statusDiv) {
    statusDiv.style.display = "none";
  }
  if (generatedContainer) {
    generatedContainer.style.display = "none";
  }
  if (generatedList) {
    generatedList.innerHTML = "";
  }

  // Reset custom objectives list and bulk paste
  const customObjectivesList = document.getElementById("ai-custom-objectives-list");
  if (customObjectivesList) {
    customObjectivesList.innerHTML = "";
  }
  
  const bulkPasteContainer = document.getElementById("ai-bulk-paste-container");
  if (bulkPasteContainer) {
    bulkPasteContainer.style.display = "none";
  }
  
  const bulkPasteInput = document.getElementById("ai-bulk-paste-input");
  if (bulkPasteInput) {
    bulkPasteInput.value = "";
  }

  // Set up event listeners for the new buttons (if not already set)
  setupAICustomObjectiveEventListeners();

  // Show modal first (like custom modal does)
  modal.style.display = "flex";

  // Load materials after showing modal (non-blocking, like custom modal)
  loadAIMaterialsForModal();
}

/**
 * Sets up event listeners for custom objective UI controls
 */
function setupAICustomObjectiveEventListeners() {
  const addBtn = document.getElementById("ai-add-objective-row-btn");
  const bulkBtn = document.getElementById("ai-bulk-add-btn");
  const applyBulkBtn = document.getElementById("ai-apply-bulk-btn");
  const cancelBulkBtn = document.getElementById("ai-cancel-bulk-btn");

  if (addBtn && !addBtn.dataset.listenerSet) {
    addBtn.addEventListener("click", () => addCustomObjectiveRow());
    addBtn.dataset.listenerSet = "true";
  }

  if (bulkBtn && !bulkBtn.dataset.listenerSet) {
    bulkBtn.addEventListener("click", () => {
      const container = document.getElementById("ai-bulk-paste-container");
      if (container) container.style.display = "block";
    });
    bulkBtn.dataset.listenerSet = "true";
  }

  if (applyBulkBtn && !applyBulkBtn.dataset.listenerSet) {
    applyBulkBtn.addEventListener("click", applyBulkPaste);
    applyBulkBtn.dataset.listenerSet = "true";
  }

  if (cancelBulkBtn && !cancelBulkBtn.dataset.listenerSet) {
    cancelBulkBtn.addEventListener("click", () => {
      const container = document.getElementById("ai-bulk-paste-container");
      if (container) container.style.display = "none";
    });
    cancelBulkBtn.dataset.listenerSet = "true";
  }
}

/**
 * Adds a new editable row to the custom objectives list
 */
function addCustomObjectiveRow(text = "") {
  const list = document.getElementById("ai-custom-objectives-list");
  if (!list) return;

  const row = document.createElement("div");
  row.className = "ai-custom-objective-row";
  row.style.cssText = "display: flex; gap: 8px; align-items: center;";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-input ai-custom-objective-input";
  input.value = text;
  input.placeholder = "Enter a learning objective...";
  input.style.cssText = "flex: 1; padding: 8px 12px; font-size: 14px;";
  
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--icon";
  deleteBtn.innerHTML = '<i class="fas fa-trash-alt" style="color: #ef4444;"></i>';
  deleteBtn.style.cssText = "padding: 8px; border: none; background: transparent; cursor: pointer;";
  deleteBtn.title = "Remove objective";
  deleteBtn.addEventListener("click", () => {
    row.remove();
  });

  row.appendChild(input);
  row.appendChild(deleteBtn);
  list.appendChild(row);
  
  // Focus the new input
  input.focus();
}

/**
 * Applies objectives from the bulk paste textarea
 */
function applyBulkPaste() {
  const bulkInput = document.getElementById("ai-bulk-paste-input");
  if (!bulkInput || !bulkInput.value.trim()) {
    const container = document.getElementById("ai-bulk-paste-container");
    if (container) container.style.display = "none";
    return;
  }

  const lines = bulkInput.value
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  lines.forEach(line => addCustomObjectiveRow(line));

  // Clear and hide
  bulkInput.value = "";
  const container = document.getElementById("ai-bulk-paste-container");
  if (container) container.style.display = "none";
}

async function loadAIMaterialsForModal() {
  const loadingDiv = document.getElementById("ai-materials-loading");
  const materialsList = document.getElementById("ai-materials-list");
  const materialsEmpty = document.getElementById("ai-materials-empty");
  const generateBtn = document.getElementById("ai-generate-btn");

  // Show loading
  if (loadingDiv) loadingDiv.style.display = "block";
  if (materialsList) materialsList.style.display = "none";
  if (materialsEmpty) materialsEmpty.style.display = "none";

  try {
    const selectedCourse = getSelectedCourse();
    if (!selectedCourse?.id) {
      if (loadingDiv) loadingDiv.style.display = 'none';
      if (materialsEmpty) materialsEmpty.style.display = 'block';
      return;
    }

    const response = await fetch(`${API_ENDPOINTS.materialCourse}/${selectedCourse.id}`);
    const data = await response.json();

    if (loadingDiv) loadingDiv.style.display = 'none';

    if (data.success && data.materials && data.materials.length > 0) {
      displayAIMaterialsInModal(data.materials);
      if (materialsList) materialsList.style.display = 'block';
      if (generateBtn) generateBtn.disabled = false;
    } else {
      if (materialsEmpty) materialsEmpty.style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading materials:', error);
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (materialsEmpty) materialsEmpty.style.display = 'block';
  }
}

function displayAIMaterialsInModal(materials) {
  const materialsList = document.getElementById("ai-materials-list");
  if (!materialsList) return;

  materialsList.innerHTML = "";

  materials.forEach((material) => {
    const materialItem = document.createElement("div");
    materialItem.className = "material-selection-item";
    materialItem.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; background: white; cursor: pointer;";
    materialItem.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      updateAIGenerateButtonState();
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = material.sourceId;
    checkbox.id = `ai-material-${material.sourceId}`;
    checkbox.className = "ai-material-checkbox";
    checkbox.addEventListener("change", updateAIGenerateButtonState);

    const label = document.createElement("label");
    label.htmlFor = `ai-material-${material.sourceId}`;
    label.style.cssText = "flex: 1; cursor: pointer; display: flex; flex-direction: column; gap: 4px;";

    // File name
    const fileName = document.createElement("div");
    fileName.style.cssText = "font-weight: 600; color: #2c3e50; font-size: 14px;";
    fileName.textContent = material.documentTitle || "Untitled";

    // File details
    const details = document.createElement("div");
    details.style.cssText = "display: flex; gap: 16px; font-size: 12px; color: #7f8c8d;";

    // File type
    const fileType = document.createElement("span");
    fileType.textContent = `Type: ${getMaterialTypeLabel(material.fileType)}`;

    // File size
    const fileSize = document.createElement("span");
    fileSize.textContent = `Size: ${formatFileSize(material.fileSize || 0)}`;

    // Uploaded date
    const uploadedDate = document.createElement("span");
    uploadedDate.textContent = `Uploaded: ${new Date(material.createdAt).toLocaleDateString()}`;

    details.appendChild(fileType);
    details.appendChild(fileSize);
    details.appendChild(uploadedDate);

    label.appendChild(fileName);
    label.appendChild(details);

    materialItem.appendChild(checkbox);
    materialItem.appendChild(label);

    materialsList.appendChild(materialItem);
  });
}

function updateAIGenerateButtonState() {
  const generateBtn = document.getElementById("ai-generate-btn");
  const checkboxes = document.querySelectorAll(".ai-material-checkbox:checked");
  if (generateBtn) {
    generateBtn.disabled = checkboxes.length === 0;
  }
}

async function handleAIGenerateObjectives() {
  const generateBtn = document.getElementById("ai-generate-btn");
  const saveBtn = document.getElementById("ai-save-btn");
  const statusDiv = document.getElementById("ai-generation-status");
  const generatedContainer = document.getElementById("ai-generated-objectives-container");
  const generatedList = document.getElementById("ai-generated-objectives-list");

  // Get selected materials
  const materialCheckboxes = document.querySelectorAll(".ai-material-checkbox:checked");
  const selectedMaterials = Array.from(materialCheckboxes).map(cb => cb.value);

  if (selectedMaterials.length === 0) {
    showToast("Please select at least one material", "warning");
    return;
  }

  // Get custom objectives if provided
  const objectiveInputs = document.querySelectorAll(".ai-custom-objective-input");
  let userObjectives = [];
  objectiveInputs.forEach(input => {
    if (input.value.trim()) {
      userObjectives.push(input.value.trim());
    }
  });

  // Get course info
  const selectedCourse = getSelectedCourse();
  if (!selectedCourse?.id) {
    showToast('No course selected', 'error');
    return;
  }

  // Show loading state
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
  }
  const regenerateBtn = document.getElementById('ai-regenerate-btn');
  if (regenerateBtn) {
    regenerateBtn.disabled = true;
    regenerateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Regenerating...';
  }

  // Disable cancel and close buttons during generation
  const cancelBtn = document.getElementById("ai-generate-modal-cancel");
  const closeBtn = document.getElementById("ai-generate-modal-close");
  if (cancelBtn) {
    cancelBtn.disabled = true;
  }
  if (closeBtn) {
    closeBtn.disabled = true;
  }

  if (statusDiv) statusDiv.style.display = "block";
  if (generatedContainer) generatedContainer.style.display = "none";
  if (saveBtn) saveBtn.style.display = "none";

  try {
    const response = await fetch(API_ENDPOINTS.ragLlmGenerateLO, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        courseId: selectedCourse.id,
        courseName: selectedCourse.name,
        materialIds: selectedMaterials,
        userObjectives: userObjectives
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to generate learning objectives');
    }

    if (data.success && data.objectives && data.objectives.length > 0) {
      generatedObjectives = data.objectives;
      displayGeneratedObjectives(data.objectives);
      if (statusDiv) statusDiv.style.display = 'none';
      if (generatedContainer) generatedContainer.style.display = 'block';
      if (generateBtn) generateBtn.style.display = 'none';
      const regenerateBtn = document.getElementById('ai-regenerate-btn');
      if (regenerateBtn) regenerateBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.style.display = 'inline-block';
      showToast(`Generated ${data.objectives.length} learning objective(s)`, 'success');
    } else {
      throw new Error('No objectives generated');
    }
  } catch (error) {
    console.error('Error generating learning objectives:', error);
    showToast(error.message || 'Failed to generate learning objectives', 'error');
    if (statusDiv) statusDiv.style.display = "none";
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate';
    }
    const regenerateBtn = document.getElementById("ai-regenerate-btn");
    if (regenerateBtn) {
      regenerateBtn.disabled = false;
      regenerateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Regenerate';
    }

    // Re-enable cancel and close buttons after generation completes
    const cancelBtn = document.getElementById("ai-generate-modal-cancel");
    const closeBtn = document.getElementById("ai-generate-modal-close");
    if (cancelBtn) {
      cancelBtn.disabled = false;
    }
    if (closeBtn) {
      closeBtn.disabled = false;
    }
  }
}

function displayGeneratedObjectives(objectives) {
  const generatedList = document.getElementById("ai-generated-objectives-list");
  if (!generatedList) return;

  generatedList.innerHTML = "";

  objectives.forEach((objective, index) => {
    const objectiveCard = document.createElement("div");
    objectiveCard.className = "ai-objective-card";
    objectiveCard.style.cssText = "margin-bottom: 16px; padding: 16px; border: 2px solid #e5e7eb; border-radius: 8px; background: #ffffff; display: flex; gap: 12px; transition: border-color 0.2s;";
    objectiveCard.dataset.objectiveIndex = index;

    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "ai-objective-checkbox";
    checkbox.id = `ai-objective-${index}`;
    checkbox.checked = true; // Default to selected
    checkbox.style.cssText = "margin-top: 4px; cursor: pointer; width: 18px; height: 18px; flex-shrink: 0;";
    checkbox.addEventListener("change", () => {
      updateAISaveButtonState();
      // Update card border color based on selection
      if (checkbox.checked) {
        objectiveCard.style.borderColor = "#3b82f6";
        objectiveCard.style.backgroundColor = "#ffffff";
      } else {
        objectiveCard.style.borderColor = "#e5e7eb";
        objectiveCard.style.backgroundColor = "#f9fafb";
      }
    });

    // Content wrapper
    const contentWrapper = document.createElement("div");
    contentWrapper.style.cssText = "flex: 1;";

    // Main objective
    const mainObjective = document.createElement("div");
    mainObjective.style.cssText = "font-weight: 600; font-size: 16px; color: #1f2937; margin-bottom: 12px; cursor: pointer;";
    mainObjective.textContent = `${index + 1}. ${objective.name}`;
    mainObjective.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    });

    // Granular objectives
    const granularList = document.createElement("ul");
    granularList.style.cssText = "list-style: none; padding-left: 0; margin: 0;";

    objective.granularObjectives.forEach((granular, gIndex) => {
      const granularText = typeof granular === 'string' ? granular : granular.text;
      const granularItem = document.createElement("li");
      granularItem.style.cssText = "padding: 8px 0 8px 24px; color: #4b5563; font-size: 14px; position: relative;";
      granularItem.innerHTML = `<span style="position: absolute; left: 0; color: #9ca3af;">•</span> ${granularText}`;
      granularList.appendChild(granularItem);
    });

    contentWrapper.appendChild(mainObjective);
    contentWrapper.appendChild(granularList);

    objectiveCard.appendChild(checkbox);
    objectiveCard.appendChild(contentWrapper);
    generatedList.appendChild(objectiveCard);

    // Set initial border color
    objectiveCard.style.borderColor = "#3b82f6";
  });

  // Update save button state
  updateAISaveButtonState();
}

function updateAISaveButtonState() {
  const saveBtn = document.getElementById("ai-save-btn");
  const checkboxes = document.querySelectorAll(".ai-objective-checkbox:checked");
  if (saveBtn) {
    const count = checkboxes.length;
    saveBtn.disabled = count === 0;
    if (count > 0) {
      saveBtn.innerHTML = `<i class="fas fa-save"></i> Save Selected (${count})`;
    } else {
      saveBtn.innerHTML = `<i class="fas fa-save"></i> Save Selected`;
    }
  }
}

async function handleAISaveObjectives() {
  const saveBtn = document.getElementById("ai-save-btn");
  const modal = document.getElementById("ai-generate-objective-modal");

  // Get selected objectives
  const objectiveCheckboxes = document.querySelectorAll(".ai-objective-checkbox:checked");
  const selectedIndices = Array.from(objectiveCheckboxes).map(cb => {
    const card = cb.closest(".ai-objective-card");
    return card ? parseInt(card.dataset.objectiveIndex) : -1;
  }).filter(idx => idx >= 0);

  if (selectedIndices.length === 0) {
    showToast("Please select at least one objective to save", "warning");
    return;
  }

  if (!generatedObjectives || generatedObjectives.length === 0) {
    showToast("No objectives to save", "warning");
    return;
  }

  // Get selected materials
  const materialCheckboxes = document.querySelectorAll('.ai-material-checkbox:checked');
  const selectedMaterials = Array.from(materialCheckboxes).map(cb => cb.value);

  // Get course info
  const selectedCourse = getSelectedCourse();
  if (!selectedCourse?.id) {
    showToast('No course selected', 'error');
    return;
  }

  // Disable button
  const originalButtonText = saveBtn ? saveBtn.innerHTML : 'Save Selected';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }

  try {
    // Save only selected objectives
    const savedObjectives = [];
    for (const index of selectedIndices) {
      const objective = generatedObjectives[index];
      if (!objective) continue;
      const requestBody = {
        name: objective.name,
        granularObjectives: objective.granularObjectives.map(go => typeof go === 'string' ? { text: go } : { text: go.text, bloomTaxonomies: go.bloomTaxonomies }),
        materialIds: selectedMaterials,
        courseId: selectedCourse.id,
      };

      const response = await fetch(API_ENDPOINTS.objective, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to save objective: ${objective.name}`);
      }

      if (data.success && data.objective) {
        savedObjectives.push({
          parent: data.objective,
          granular: data.granularObjectives || [],
        });
      }
    }

    // Add objectives to the page
    for (const saved of savedObjectives) {
      const objectiveId = saved.parent._id || saved.parent.id;
      const objectiveName = saved.parent.name;

      // Create new learning objective group
      const newGroupId = Date.now() + Math.random();
      const newGroupNumber = state.objectiveGroups.length + 1;

      const newGroup = {
        id: newGroupId,
        objectiveId: objectiveId.toString(),
        metaId: `db-${objectiveId}`,
        title: objectiveName,
        isOpen: true,
        selected: false,
        items: saved.granular.map((granular, index) => ({
          id: parseFloat(`${newGroupNumber}.${index + 1}`),
          granularId: granular._id ? granular._id.toString() : null,
          text: granular.name,
          bloom: granular.bloomTaxonomies && granular.bloomTaxonomies.length > 0 ? granular.bloomTaxonomies : [],
          minQuestions: 2,
          count: 2,
          mode: "manual",
          level: 1,
          selected: false,
        })),
      };



      state.objectiveGroups.push(newGroup);
    }

    // Renumber all groups
    renumberObjectiveGroups();
    renderObjectiveGroups();

    // Update dropdown to disable the newly added objectives
    updateDropdownDisabledState();

    showToast(`Successfully saved ${savedObjectives.length} learning objective(s)`, "success");

    // Close modal
    if (modal) {
      hideModal(modal);
    }
  } catch (error) {
    console.error("Error saving objectives:", error);
    showToast(error.message || "Failed to save learning objectives", "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalButtonText;
    }
  }
}

function hideModal(modal) {
  if (modal) {
    modal.style.display = "none";


    // Reset AI generation modal if it's the AI modal
    if (modal.id === "ai-generate-objective-modal") {
      generatedObjectives = [];
      const generateBtn = document.getElementById("ai-generate-btn");
      const regenerateBtn = document.getElementById("ai-regenerate-btn");
      const saveBtn = document.getElementById("ai-save-btn");
      const statusDiv = document.getElementById("ai-generation-status");
      const generatedContainer = document.getElementById("ai-generated-objectives-container");
      const generatedList = document.getElementById("ai-generated-objectives-list");

      if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.style.display = "inline-block";
        generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate';
      }
      if (regenerateBtn) regenerateBtn.style.display = "none";
      if (saveBtn) saveBtn.style.display = "none";
      if (statusDiv) statusDiv.style.display = "none";
      if (generatedContainer) generatedContainer.style.display = "none";
      if (generatedList) generatedList.innerHTML = "";

      // Re-enable cancel and close buttons when modal is reset
      const cancelBtn = document.getElementById("ai-generate-modal-cancel");
      const closeBtn = document.getElementById("ai-generate-modal-close");
      if (cancelBtn) {
        cancelBtn.disabled = false;
      }
      if (closeBtn) {
        closeBtn.disabled = false;
      }

      const aiMaterialCheckboxes = document.querySelectorAll(".ai-material-checkbox");
      aiMaterialCheckboxes.forEach(cb => cb.checked = false);

      const objectivesCountInput = document.getElementById("ai-objectives-count");
      if (objectivesCountInput) {
        objectivesCountInput.value = "5";
      }
    }
  }
}

function getMaterialTypeLabel(fileType) {
  if (!fileType) return "Unknown";
  if (fileType.includes("pdf")) return "PDF";
  if (fileType.includes("text")) return "Text";
  if (fileType.includes("word")) return "Word";
  if (fileType === "link") return "Link";
  return fileType;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}


async function handleObjectiveSelection(objectiveId, objectiveName) {
  // Normalize objectiveId to string for comparison
  const normalizedObjectiveId = objectiveId ? objectiveId.toString() : null;

  // Check if this objective already exists (compare as strings)
  const existingGroup = state.objectiveGroups.find(
    (group) => group.objectiveId && group.objectiveId.toString() === normalizedObjectiveId
  );

  if (existingGroup) {
    // Group exists - expand it, scroll into view, and focus header
    existingGroup.isOpen = true;
    renderObjectiveGroups();

    // Scroll into view and focus
    setTimeout(() => {
      const groupElement = document.querySelector(
        `[data-group-id="${existingGroup.id}"]`
      );
      if (groupElement) {
        groupElement.scrollIntoView({ behavior: "smooth", block: "center" });
        const headerElement = groupElement.querySelector(
          ".objective-group__title"
        );
        if (headerElement) {
          headerElement.focus();
        }
      }
    }, 100);

    announceToScreenReader(`Objective revealed: ${objectiveName}`);
  } else {
    // Fetch granular objectives from API
    try {
      const courseId = getCourseId();
      const response = await fetch(`${API_ENDPOINTS.objective}/${objectiveId}/granular?courseId=${encodeURIComponent(courseId)}`);
      const data = await response.json();

      let granularObjectives = [];
      if (data.success && data.objectives) {
        granularObjectives = data.objectives;
      }

      // Create new learning objective group
      const newGroupId = Date.now() + Math.random();
      const newGroupNumber = state.objectiveGroups.length + 1;

      const newGroup = {
        id: newGroupId,
        objectiveId: objectiveId,
        metaId: `db-${objectiveId}`,
        title: objectiveName,
        isOpen: true,
        selected: false,
        items: granularObjectives.map((granular, index) => ({
          id: parseFloat(`${newGroupNumber}.${index + 1}`),
          granularId: granular._id ? granular._id.toString() : null,
          text: granular.name,
          bloom: granular.bloomTaxonomies && granular.bloomTaxonomies.length > 0 ? granular.bloomTaxonomies : [],
          minQuestions: 2,
          count: 2,
          mode: "manual",
          level: 1,
          selected: false,
        })),
      };



      // Append to the end of the groups array
      state.objectiveGroups.push(newGroup);

      // Renumber all groups
      renumberObjectiveGroups();

      renderObjectiveGroups();

      // Update dropdown to disable the newly added objective
      updateDropdownDisabledState();

      // Scroll into view and focus the first granular row
      setTimeout(() => {
        const groupElement = document.querySelector(
          `[data-group-id="${newGroupId}"]`
        );
        if (groupElement) {
          groupElement.scrollIntoView({ behavior: "smooth", block: "center" });

          // Focus the first granular objective row
          const firstItemElement = groupElement.querySelector(
            ".objective-item__text"
          );
          if (firstItemElement) {
            firstItemElement.focus();
          }
        }
      }, 100);

      // Announce with count of granular objectives
      const granularCount = newGroup.items.length;
      announceToScreenReader(
        `Added ${objectiveName} with ${granularCount} granular objective${granularCount !== 1 ? 's' : ''}.`
      );
    } catch (error) {
      console.error("Error fetching granular objectives:", error);
      showToast("Failed to load granular objectives", "error");
    }
  }
}

function renumberObjectiveGroups() {
  // Title prefixing has been removed, so this function is intentionally empty.
  // Group numbers are implied by their array index when rendering.
}

// ===== DELETE OBJECTIVE GROUP FUNCTION =====

async function deleteObjectiveGroup(groupId, action = null) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  if (!action) {
    // Stage 1: Ask the user what they want to do
    currentEditGroupId = groupId;
    const deleteModal = document.getElementById("delete-confirmation-modal");
    
    if (group.objectiveId) {
      if (deleteModal) deleteModal.style.display = "flex";
    } else {
        // If it's a completely new unsaved draft group, just strip it from view.
        deleteObjectiveGroup(groupId, 'view-only'); 
    }
    return;
  }

  // Stage 2: Actually perform the deletion based on user choice
  if (action === 'db-complete' && group.objectiveId) {
    const deletingToast = showToast("Deleting objective from database...", "info");
    try {
      const response = await fetch(`${API_ENDPOINTS.objective}/${group.objectiveId}`, {
         method: 'DELETE',
      });
      
      let data;
      try {
        const responseText = await response.text();
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error('Invalid response from server');
      }
      
      if (!response.ok || !data.success) {
         throw new Error(data.error || "Failed to delete learning objective from database");
      }
      
      if (deletingToast) deletingToast.remove();
      showToast("Objective fully deleted from database", "success");
      
      // Update dropdown options to permanently remove it
      try {
         await initializeAddObjectivesDropdown();
      } catch(err) {
         console.error('Failed to update dropdown post-deletion', err);
      }
      
    } catch (error) {
       console.error("Error full-deleting group:", error);
       if (deletingToast) deletingToast.remove();
       showToast(error.message || "Failed to delete objective from database", "error");
       return; // Abort UI removal if DB delete fails
    }
  }

  // Remove the group from UI state
  state.objectiveGroups = state.objectiveGroups.filter(
    (g) => g.id !== groupId
  );

  // Renumber remaining groups
  renumberObjectiveGroups();

  // Update UI
  renderObjectiveGroups();

  if (action === 'view-only') {
     // Update dropdown to re-enable deleted objective so it can be added back
     updateDropdownDisabledState();
     announceToScreenReader(`Removed ${group.title} from view.`);
  } else {
      announceToScreenReader(`Deleted ${group.title} completely.`);
  }
  
  currentEditGroupId = null;
}

async function deleteGranularObjective(groupId, itemId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const itemIndex = group.items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) return;
  
  const item = group.items[itemIndex];

  // Remove the item from the group array
  group.items.splice(itemIndex, 1);

  // If this objective is linked to the backend, save the change
  if (group.objectiveId) {
    const savingToast = showToast("Deleting granular objective...", "info");
    try {
      const courseId = getCourseId();

      const requestBody = {
        name: group.title, // Group title is already cleaned from prefix
        courseId: courseId,
        materialIds: group.materialIds || [],
        granularObjectives: group.items.map(i => ({
          id: i.granularId,
          text: i.text,
          bloomTaxonomies: i.bloom || []
        }))
      };

      const response = await fetch(`${API_ENDPOINTS.objective}/${group.objectiveId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error("Failed to delete from database");
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to delete from database");
      }

      if (savingToast) savingToast.remove();
      showToast("Granular objective deleted successfully", "success");
    } catch (err) {
      console.error("Error deleting granular objective:", err);
      if (savingToast) savingToast.remove();
      showToast(err.message || "Failed to delete objective. Reverting.", "error");
      
      // Revert the deletion in UI state
      group.items.splice(itemIndex, 0, item);
      renderObjectiveGroups();
      return;
    }
  }

  // Update UI and announce
  renderObjectiveGroups();
  announceToScreenReader(`Deleted granular objective: ${item.text}`);
}

// ===== GRANULAR SELECTION FUNCTIONS =====

function toggleGranularSelection(groupId, itemId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const item = group.items.find((i) => i.id === itemId);
  if (!item) return;

  item.selected = !item.selected;

  // Update granular toolbar visibility and counts
  updateGranularToolbar(groupId);

  // Update only the checkbox state without re-rendering everything
  const checkbox = document.querySelector(
    `[data-item-id="${item.id}"] .objective-item__checkbox`
  );
  if (checkbox) {
    checkbox.checked = item.selected;
  }
}

function selectAllGranularInGroup(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const selectAllCheckbox = document.querySelector(
    `#granular-toolbar-${groupId} .select-all-granular-checkbox`
  );
  const isChecked = selectAllCheckbox ? selectAllCheckbox.checked : false;

  group.items.forEach((item) => {
    item.selected = isChecked;
  });

  updateGranularToolbar(groupId);

  // Update only the checkbox states without re-rendering everything
  group.items.forEach((item) => {
    const checkbox = document.querySelector(
      `[data-item-id="${item.id}"] .objective-item__checkbox`
    );
    if (checkbox) {
      checkbox.checked = item.selected;
    }
  });
}

function updateGranularToolbar(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const toolbar = document.getElementById(`granular-toolbar-${groupId}`);
  const selectionCount = document.querySelector(
    `#granular-toolbar-${groupId} .granular-selection-count`
  );
  const selectAllCheckbox = document.querySelector(
    `#granular-toolbar-${groupId} .select-all-granular-checkbox`
  );

  if (toolbar && selectionCount && selectAllCheckbox) {
    const selectedCount = group.items.filter((item) => item.selected).length;
    const allSelected =
      group.items.length > 0 && group.items.every((item) => item.selected);

    // Show/hide toolbar based on selection
    toolbar.style.display = selectedCount > 0 ? "flex" : "none";

    // Update selection count
    selectionCount.textContent = `${selectedCount} selected`;

    // Update select all checkbox
    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = selectedCount > 0 && !allSelected;

  }
}

function deleteSelectedGranular(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const selectedItems = group.items.filter((item) => item.selected);
  if (selectedItems.length === 0) return;

  // Remove selected items
  group.items = group.items.filter((item) => !item.selected);

  // Update UI
  updateGranularToolbar(groupId);

  // Re-render is needed here since we're actually removing items
  renderObjectiveGroups();

  // Announce deletion
  announceToScreenReader(
    `Deleted ${selectedItems.length} granular objectives.`
  );
}

// ===== GRANULARIZATION FUNCTIONS =====

function showGranularizationModal(groupId) {
  const modal = document.getElementById('granularization-modal');
  if (modal) {
    modal.style.display = 'flex';
    modal.dataset.groupId = groupId;
    const closeBtn = document.getElementById('granularization-modal-close');
    if (closeBtn) closeBtn.focus();
  }
}

function hideGranularizationModal() {
  const modal = document.getElementById("granularization-modal");
  if (modal) {
    modal.style.display = "none";
    delete modal.dataset.groupId;
  }
}

function confirmGranularization() {
  const modal = document.getElementById('granularization-modal');
  const groupId = parseInt(modal.dataset.groupId);

  if (!groupId || isNaN(groupId)) return;

  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const selectedItems = group.items.filter((item) => item.selected);
  if (selectedItems.length === 0) return;

  // Get modal options
  const countPerItem = parseInt(
    document.querySelector('input[name="granular-count"]:checked').value
  );
  const useDefaults = document.getElementById('use-defaults').checked;

  // Create sub-LOs for each selected item
  let totalSubLOs = 0;

  selectedItems.forEach((item) => {
    const subLOs = createSubLOs(item, countPerItem, useDefaults);
    group.items.push(...subLOs);
    totalSubLOs += subLOs.length;
  });

  // Clear selection
  group.items.forEach((item) => (item.selected = false));

  // Hide modal
  hideGranularizationModal();

  // Update UI
  updateGranularToolbar(groupId);
  renderObjectiveGroups();

  // Focus first new sub-LO
  setTimeout(() => {
    const firstSubLO = document.querySelector(
      `[data-parent-id="${selectedItems[0].id}"]`
    );
    if (firstSubLO) {
      firstSubLO.scrollIntoView({ behavior: "smooth", block: "center" });
      const textElement = firstSubLO.querySelector(".objective-item__text");
      if (textElement) textElement.focus();
    }
  }, 100);

  // Announce creation
  announceToScreenReader(
    `Created ${countPerItem} sub-objectives per selected objective.`
  );
}

function createSubLOs(parentItem, count, useDefaults) {
  const templates = [
    {
      title: `Identify key terms and quantities related to ${parentItem.text}.`,
      bloomChips: useDefaults ? ["Remember", "Understand"] : [],
    },
    {
      title: `Explain the underlying principle(s) behind ${parentItem.text} with one example.`,
      bloomChips: useDefaults ? ["Understand", "Analyze"] : [],
    },
    {
      title: `Apply ${parentItem.text} to solve a simple problem or predict an outcome.`,
      bloomChips: useDefaults ? ["Apply"] : [],
    },
  ];

  const subLOs = [];
  for (let i = 0; i < count; i++) {
    const template = templates[i];
    const subLO = {
      id: parseFloat(`${parentItem.id}.${i + 1}`),
      text: template.title,
      bloom: template.bloomChips,
      minQuestions: 1,
      count: 1,
      mode: "manual",
      level: 2, // Sub-LO level
      parentId: parentItem.id,
      selected: false,
    };
    subLOs.push(subLO);
  }

  return subLOs;
}

// ===== REFRESH META OBJECTIVES FUNCTIONS =====

// Regenerate all objectives from content
function regenerateAllObjectivesFromContent() {
  const confirmMessage =
    "Regenerate all learning objectives from uploaded content? This will replace all current objectives.";

  if (confirm(confirmMessage)) {
    // Clear existing objectives
    state.objectiveGroups = [];

    // Generate new objectives from content
    generateLearningObjectivesFromContent();

    // Update UI
    renderObjectiveGroups();

    // Announce regeneration
    announceToScreenReader(
      `Regenerated ${state.objectiveGroups.length} learning objective groups from uploaded content.`
    );
  }
}

function renderObjectiveGroups() {
  const groupsContainer = document.getElementById("objectives-groups");
  const emptyState = document.getElementById("objectives-empty-state");
  if (!groupsContainer) return;

  groupsContainer.innerHTML = "";

  if (state.objectiveGroups.length === 0) {
    // Show empty state
    if (emptyState) {
      emptyState.style.display = "block";
    }
    // Disable continue button when no objectives
    updateNavigationButtons();
  } else {
    // Hide empty state and render groups
    if (emptyState) {
      emptyState.style.display = "none";
    }

    state.objectiveGroups.forEach((group) => {
      const groupElement = createObjectiveGroup(group);
      groupsContainer.appendChild(groupElement);
    });
    // Enable continue button when objectives are added
    updateNavigationButtons();

    // Trigger auto-resize for all textareas so they fit content perfectly on load
    setTimeout(autoResizeTextareas, 0);
  }

}

function autoResizeTextareas() {
  const textareas = document.querySelectorAll('.objective-group__title-input, .granular-objective-input');
  textareas.forEach(textarea => {
    // Reset height to auto first to get true scrollHeight (especially when expanding/collapsing)
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });
}

function createObjectiveGroup(group) {
  const groupElement = document.createElement("div");
  groupElement.className = `objective-group ${group.isOpen ? "objective-group--expanded" : "objective-group--collapsed"
    }`;
  groupElement.setAttribute("data-group-id", group.id);

  const currentName = group.title;

  const itemCount = group.items.length;
  const totalCount = group.items.reduce((sum, item) => sum + item.count, 0);
  const isWarning = totalCount < 5;

  const emptyState =
    itemCount === 0
      ? `
        <div class="objective-group__empty">
            <p>No granular objectives yet</p>
        </div>
    `
      : '';

  groupElement.innerHTML = `
        <div class="objective-group__header">
            <div class="objective-group__header-left" style="flex: 1; display: flex; align-items: center; min-width: 0;">
                <button type="button" 
                    class="objective-group__delete-btn" 
                    onclick="deleteObjectiveGroup(${group.id})"
                    title="Delete learning objective from page"
                    aria-label="Delete ${group.title}"
                    style="flex-shrink: 0;"
                >
                    <i class="fas fa-trash-alt"></i>
                </button>
                <textarea class="objective-group__title-input" rows="1"
                    title="Click to edit title"
                    onblur="updateMetaObjectiveTitle(${group.id}, this.value)"
                    onkeypress="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.blur(); }"
                    oninput="this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';"
                    style="background: transparent; border: 1px solid transparent; padding: 4px 8px; margin: 0; width: 100%; flex: 1; min-width: 0; box-sizing: border-box; font-size: 1.1em; font-weight: 600; font-family: inherit; color: inherit; transition: border-color 0.2s, background-color 0.2s; border-radius: 4px; resize: none; overflow: hidden; line-height: 1.4; min-height: 1.4em;"
                    onfocus="this.style.backgroundColor='#fff'; this.style.borderColor='#ccc'; this.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.1)'; this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';"
                    onfocusout="this.style.backgroundColor='transparent'; this.style.borderColor='transparent'; this.style.boxShadow='none';"
                >${currentName.replace(/"/g, '&quot;')}</textarea>
            </div>
            <div class="objective-group__header-right">
                ${group.objectiveId ? `
                <button type="button" 
                    class="objective-group__edit-btn" 
                    onclick="editMetaObjective(${group.id})"
                    title="Objective Settings"
                    aria-label="Settings for ${group.title}"
                >
                    <i class="fas fa-cog"></i>
                </button>
                ` : ''}
                <div class="objective-group__toggle" onclick="toggleObjectiveGroup(${group.id})">
                    <i class="fas fa-chevron-down"></i>
                </div>
            </div>
        </div>
        <div class="objective-group__content">
            ${emptyState}
            ${group.items.length > 0
      ? `
                <div class="granular-toolbar" id="granular-toolbar-${group.id}" style="display: none;">
                    <div class="granular-toolbar__left">
                        <label class="select-all-granular-label">
                            <input type="checkbox" class="select-all-granular-checkbox" onchange="selectAllGranularInGroup(${group.id})">
                            <span>Select all in this meta</span>
                        </label>
                        <span class="granular-selection-count">0 selected</span>
                    </div>
                    <div class="granular-toolbar__right">
                        <button type="button" class="btn btn--primary btn--small" onclick="showGranularizationModal(${group.id})">
                            Make more granular
                        </button>
                        <button type="button" class="btn btn--danger btn--small" onclick="deleteSelectedGranular(${group.id})">
                            Delete selected
                        </button>
                    </div>
                </div>
                <!-- DEBUG: Toolbar created for group ${group.id} with ${group.items.length} items -->
            `
      : ""
    }
            ${group.items
      .map((item) => createObjectiveItem(item, group.id))
      .join("")}
            <div class="objective-group__footer ${isWarning ? "objective-group__footer--warning" : ""}" style="display: flex; justify-content: space-between; align-items: center;">
                <div class="objective-group__footer-left">
                    <button type="button" class="btn btn--secondary btn--small" onclick="addNewGranularObjective(${group.id})" style="background: white; border: 1px solid #3498db; color: #3498db; border-radius: 4px; padding: 6px 12px; font-weight: 600; font-size: 12px; transition: all 0.2s; display: flex; align-items: center; gap: 6px;" onmouseover="this.style.backgroundColor='#f0f7ff'; this.style.borderColor='#2980b9';" onmouseout="this.style.backgroundColor='white'; this.style.borderColor='#3498db';">
                        <i class="fas fa-plus"></i> Add Granular Objective
                    </button>
                </div>
                <div class="objective-group__footer-right">
                    Total questions: ${totalCount} Minimum required per learning objective: 5 (${totalCount >= 5 ? "≥5" : "<5"})
                </div>
            </div>
        </div>
    `;

  return groupElement;
}

function createObjectiveItem(item, groupId) {
  const bloomChips = BLOOMLEVELS
    .map((level) => {
      const isSelected = item.bloom.includes(level);
      const isDisabled = item.mode === "auto";
      return `
            <button type="button" 
                class="bloom-chip ${isSelected ? "bloom-chip--selected" : ""} ${isDisabled ? "bloom-chip--disabled" : ""
        }"
                onclick="toggleBloomChip(${groupId}, ${item.id}, '${level}')"
                ${isDisabled ? "disabled" : ""}
                aria-checked="${isSelected}"
            >
                ${level}
            </button>
        `;
    })
    .join("");

  const bloomModeToggle =
    item.mode === "manual"
      ? `
        <div class="bloom-mode-toggle">
            <button type="button" class="bloom-mode-btn bloom-mode-btn--active">Choose Bloom</button>
            <button type="button" class="bloom-mode-btn bloom-mode-btn--inactive" disabled title="Not yet implemented">AI decide later</button>
        </div>
    `
      : `
        <div class="bloom-mode-toggle">
            <button type="button" class="bloom-mode-btn bloom-mode-btn--inactive" onclick="setBloomMode(${groupId}, ${item.id}, 'manual')">Choose Bloom</button>
            <button type="button" class="bloom-mode-btn bloom-mode-btn--active" disabled title="Not yet implemented">AI decide later</button>
            <span class="auto-pill">Auto (pending)</span>
        </div>
    `;

  const isSubLO = item.level === 2;
  const indentClass = isSubLO ? "objective-item--sub" : "";
  const subLOBadge = isSubLO ? '<span class="sub-lo-badge">Sub-LO</span>' : "";

  // Show validation message if mode is manual and no Bloom level is selected
  const showBloomValidation = item.mode === "manual" && item.bloom.length === 0;
  const bloomValidationMessage = showBloomValidation
    ? `<div class="objective-item__validation-message">
        <i class="fas fa-exclamation-circle"></i>
        <span>Please select at least one Bloom's Taxonomy level.</span>
      </div>`
    : "";

  return `
        <div class="objective-item ${indentClass}" data-item-id="${item.id
    }" data-parent-id="${item.parentId || ""}">
            <div class="objective-item__checkbox-wrapper">
                <button type="button" 
                    class="objective-item__delete-btn" 
                    onclick="deleteGranularObjective(${groupId}, ${item.id})"
                    title="Delete granular objective from page"
                    aria-label="Delete ${item.text}"
                >
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
            <div class="objective-item__content" style="flex: 1; min-width: 0;">
                <div class="objective-item__header" style="flex: 1; display: flex; width: 100%; min-width: 0;">
                    <div class="objective-item__text" style="flex: 1; width: 100%; min-width: 0;">
                        <textarea class="granular-objective-input" rows="1"
                            title="Click to edit granular objective"
                            onblur="updateGranularObjectiveText(${groupId}, ${item.id}, this.value)"
                            onkeypress="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.blur(); }"
                            oninput="this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';"
                            style="background: transparent; border: 1px solid transparent; padding: 4px; margin: 0; width: 100%; box-sizing: border-box; font-family: inherit; font-size: inherit; color: inherit; transition: border-color 0.2s, background-color 0.2s; border-radius: 4px; resize: none; overflow: hidden; line-height: 1.4; min-height: 1.4em;"
                            onfocus="this.style.backgroundColor='#fff'; this.style.borderColor='#ccc'; this.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.1)'; this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';"
                            onfocusout="this.style.backgroundColor='transparent'; this.style.borderColor='transparent'; this.style.boxShadow='none';"
                        >${item.text.replace(/"/g, '&quot;')}</textarea>
                    </div>
                    ${subLOBadge}
                </div>
                <div class="objective-item__controls">
                    <div class="objective-item__bloom-chips">
                        ${bloomChips}
                    </div>
                    <div class="objective-item__min">Min: ${item.minQuestions
    }</div>
                    ${bloomModeToggle}
                </div>
                ${bloomValidationMessage}
            </div>
            <div class="objective-item__tools">
                <div class="objective-item__stepper">
                    <button type="button" class="stepper-btn" onclick="decrementCount(${groupId}, ${item.id
    })" ${item.count <= item.minQuestions ? "disabled" : ""}>
                        –
                    </button>
                    <span class="stepper-value">${item.count}</span>
                    <button type="button" class="stepper-btn" onclick="incrementCount(${groupId}, ${item.id
    })" ${item.count >= 9 ? "disabled" : ""}>
                        +
                    </button>
                </div>
            </div>
        </div>
    `;
}

function toggleObjectiveGroup(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (group) {
    group.isOpen = !group.isOpen;
    renderObjectiveGroups();
  }
}

function toggleBloomChip(groupId, itemId, level) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  const item = group?.items.find((i) => i.id === itemId);

  if (item && item.mode === "manual") {
    const index = item.bloom.indexOf(level);
    if (index > -1) {
      item.bloom.splice(index, 1);
    } else {
      item.bloom.push(level);
    }
    renderObjectiveGroups();
    
    // Auto-save the new bloom selection if it's an existing objective
    if (group.objectiveId) {
      updateGranularObjectiveBloom(groupId);
    }
  }
}

/**
 * Handle auto-saving Bloom taxonomy changes
 */
async function updateGranularObjectiveBloom(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group || !group.objectiveId) return;

  try {
    const courseId = getCourseId();
    const currentName = group.title;

    const requestBody = {
      name: currentName,
      courseId: courseId,
      materialIds: group.materialIds || [],
      // Re-map the granular objectives, implicitly including our bloom update via state
      granularObjectives: group.items.map(i => ({
        id: i.granularId,
        text: i.text,
        bloomTaxonomies: i.bloom || []
      }))
    };

    const response = await fetch(`${API_ENDPOINTS.objective}/${group.objectiveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error("Failed to save bloom taxonomy");
    }
    
    // Silently succeed, no toast needed for every checkbox click
  } catch (err) {
    console.error("Error updating bloom taxonomy:", err);
    showToast("Failed to save changes automatically. Try refreshing.", "error");
  }
}

function setBloomMode(groupId, itemId, mode) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  const item = group?.items.find((i) => i.id === itemId);

  if (item) {
    item.mode = mode;
    if (mode === "auto") {
      item.bloom = [];
    }
    renderObjectiveGroups();
  }
}

function incrementCount(groupId, itemId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  const item = group?.items.find((i) => i.id === itemId);

  if (item && item.count < 9) {
    item.count++;
    renderObjectiveGroups();
    announceToScreenReader(`Count increased to ${item.count}`);
  }
}

function decrementCount(groupId, itemId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  const item = group?.items.find((i) => i.id === itemId);

  if (item && item.count > item.minQuestions) {
    item.count--;
    renderObjectiveGroups();
    announceToScreenReader(`Count decreased to ${item.count}`);
  }
}



async function editMetaObjective(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group || !group.objectiveId) {
    showToast("Cannot edit this learning objective", "warning");
    return;
  }

  const currentName = group.title;

  // Use the shared modal in edit mode
  currentEditGroupId = groupId;
  showCustomObjectiveModal("edit", {
    objectiveId: group.objectiveId,
    name: currentName,
    granularObjectives: group.items || [],
  });
}

/**
 * Handle inline title edits for Meta Learning Objectives
 */
async function updateMetaObjectiveTitle(groupId, newTitle) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group || !group.objectiveId) return;

  // Since the user requested the removal of "Learning Objective N: " 
  // group.title will exactly match the intended objective name.
  const currentName = group.title;
  const trimmedNewTitle = newTitle.trim();

  // Abort if no change or empty
  if (!trimmedNewTitle || currentName === trimmedNewTitle) {
    if (!trimmedNewTitle) {
        // Reset view if empty
        renderObjectiveGroups(); 
    }
    return;
  }

  const savingToast = showToast("Saving title...", "info");

  try {
    const courseId = getCourseId();

    // The PUT endpoint requires name, materialIds, and granularObjectives
    const requestBody = {
      name: trimmedNewTitle,
      courseId: courseId,
      // Pass existing materials and granular objectives unchanged
      materialIds: group.materialIds || [],
      granularObjectives: (group.items || []).map(item => ({
        id: item.granularId, // Maps back to existing ID
        text: item.text,
        bloomTaxonomies: item.bloom || []
      }))
    };

    const response = await fetch(`${API_ENDPOINTS.objective}/${group.objectiveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    let data;
    try {
      const responseText = await response.text();
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error('Invalid response from server');
    }

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to update learning objective title");
    }

    // Update state and UI
    group.title = trimmedNewTitle;
    
    if (savingToast) savingToast.remove();
    showToast("Title updated successfully", "success");
  } catch (err) {
    console.error("Error updating title:", err);
    if (savingToast) savingToast.remove();
    showToast(err.message || "Failed to save title", "error");
    renderObjectiveGroups(); // Revert UI on failure
  }
}

/**
 * Handle inline text edits for Granular Objectives
 */
async function updateGranularObjectiveText(groupId, itemId, newText) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group || !group.objectiveId) return;

  const item = group.items.find((i) => i.id === itemId);
  if (!item) return;

  const trimmedNewText = newText.trim();

  // Abort if no change or empty
  if (!trimmedNewText || item.text.trim() === trimmedNewText) {
    if (!trimmedNewText) {
        // Reset view if empty
        renderObjectiveGroups(); 
    }
    return;
  }

  // Update local state temporarily
  const previousText = item.text;
  item.text = trimmedNewText;

  const savingToast = showToast("Saving granular objective...", "info");

  try {
    const courseId = getCourseId();
    const currentName = group.title;

    // The PUT endpoint requires name, materialIds, and granularObjectives
    const requestBody = {
      name: currentName,
      courseId: courseId,
      materialIds: group.materialIds || [],
      // Re-map the granular objectives, implicitly including our text update via state
      granularObjectives: group.items.map(i => ({
        id: i.granularId,
        text: i.text,
        bloomTaxonomies: i.bloom || []
      }))
    };

    const response = await fetch(`${API_ENDPOINTS.objective}/${group.objectiveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    let data;
    try {
      const responseText = await response.text();
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error('Invalid response from server');
    }

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to update granular objective");
    }

    // Update newly created items with their DB-generated IDs
    if (data.granularObjectives && Array.isArray(data.granularObjectives)) {
      data.granularObjectives.forEach(dbObj => {
        // Try to match items that don't have an ID yet by their exact text
        const matchedItem = group.items.find(i => (!i.granularId && i.text === (dbObj.name || dbObj.text)) || i.granularId === dbObj._id?.toString());
        if (matchedItem && !matchedItem.granularId && dbObj._id) {
          matchedItem.granularId = dbObj._id.toString();
        }
      });
    }

    if (savingToast) savingToast.remove();
    showToast("Granular objective updated successfully", "success");
    // Background render to clean up focus states
    renderObjectiveGroups();
  } catch (err) {
    console.error("Error updating granular objective:", err);
    if (savingToast) savingToast.remove();
    showToast(err.message || "Failed to save granular objective", "error");
    // Revert local state
    item.text = previousText;
    renderObjectiveGroups(); 
  }
}

function addNewGranularObjective(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const newIndex = group.items.length + 1;
  const newItem = {
    id: Date.now() + newIndex,
    granularId: null, // Will be assigned by backend upon first blur/save
    text: "",
    bloom: [],
    minQuestions: 2,
    count: 2,
    mode: "manual",
    level: 1,
    selected: false,
  };

  group.items.push(newItem);
  renderObjectiveGroups();

  // Focus the newly created input
  setTimeout(() => {
    const inputs = document.querySelectorAll(`[data-group-id="${groupId}"] .granular-objective-input`);
    if (inputs && inputs.length > 0) {
      const lastInput = inputs[inputs.length - 1];
      lastInput.focus();
      lastInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}


function initializeModals() {
  // Custom objective modal (Settings only)
  const customModal = document.getElementById("custom-objective-modal");
  const customModalClose = document.getElementById("custom-modal-close");
  const customModalCancel = document.getElementById("custom-modal-cancel");
  const customModalSave = document.getElementById("custom-modal-save");

  if (customModalClose) {
    customModalClose.addEventListener("click", () => hideModal(customModal));
  }
  if (customModalCancel) {
    customModalCancel.addEventListener("click", () => hideModal(customModal));
  }
  if (customModalSave) {
    customModalSave.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleCustomObjectiveSubmission();
    });
  }

  // AI Generate objective modal
  const aiGenerateModal = document.getElementById("ai-generate-objective-modal");
  const aiGenerateModalClose = document.getElementById("ai-generate-modal-close");
  const aiGenerateModalCancel = document.getElementById("ai-generate-modal-cancel");
  const aiGenerateBtn = document.getElementById("ai-generate-btn");
  const aiRegenerateBtn = document.getElementById("ai-regenerate-btn");
  const aiSaveBtn = document.getElementById("ai-save-btn");

  if (aiGenerateModalClose) {
    aiGenerateModalClose.addEventListener("click", () => {
      // Prevent closing if button is disabled (during generation)
      if (aiGenerateModalClose.disabled) {
        return;
      }
      hideModal(aiGenerateModal);
    });
  }
  if (aiGenerateModalCancel) {
    aiGenerateModalCancel.addEventListener("click", () => {
      // Prevent closing if button is disabled (during generation)
      if (aiGenerateModalCancel.disabled) {
        return;
      }
      hideModal(aiGenerateModal);
    });
  }
  if (aiGenerateBtn) {
    aiGenerateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAIGenerateObjectives();
    });
  }
  if (aiRegenerateBtn) {
    aiRegenerateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAIGenerateObjectives();
    });
  }
  if (aiSaveBtn) {
    aiSaveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleAISaveObjectives();
    });
  }

  // Close AI modal on backdrop click and prevent content clicks from closing
  if (aiGenerateModal) {

    // Prevent clicks inside modal content from closing the modal
    const modalContent = aiGenerateModal.querySelector(".modal__content");
    if (modalContent) {
      modalContent.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }
  }

  // Delete confirmation modal
  const deleteModal = document.getElementById("delete-confirmation-modal");
  const deleteModalClose = document.getElementById("delete-modal-close");
  const deleteModalCancel = document.getElementById("delete-modal-cancel");
  const deleteModalViewOnly = document.getElementById("delete-modal-view-only");
  const deleteModalDbComplete = document.getElementById("delete-modal-db-complete");

  if (deleteModalClose) {
    deleteModalClose.addEventListener("click", () => hideModal(deleteModal));
  }
  if (deleteModalCancel) {
    deleteModalCancel.addEventListener("click", () => hideModal(deleteModal));
  }
  
  if (deleteModalViewOnly) {
    deleteModalViewOnly.addEventListener("click", () => {
      // Use the stored edit group id to know which objective group to delete
      if (currentEditGroupId) {
        deleteObjectiveGroup(currentEditGroupId, 'view-only');
      }
      hideModal(deleteModal);
    });
  }
  
  if (deleteModalDbComplete) {
    deleteModalDbComplete.addEventListener("click", () => {
      if (currentEditGroupId) {
        deleteObjectiveGroup(currentEditGroupId, 'db-complete');
      }
      hideModal(deleteModal);
    });
  }

  // Granularization modal
  const granularizationModal = document.getElementById("granularization-modal");
  const granularizationModalClose = document.getElementById(
    "granularization-modal-close"
  );
  const granularizationModalCancel = document.getElementById(
    "granularization-modal-cancel"
  );
  const granularizationModalConfirm = document.getElementById(
    "granularization-modal-confirm"
  );

  if (granularizationModalClose) {
    granularizationModalClose.addEventListener(
      "click",
      hideGranularizationModal
    );
  }
  if (granularizationModalCancel) {
    granularizationModalCancel.addEventListener(
      "click",
      hideGranularizationModal
    );
  }
  if (granularizationModalConfirm) {
    granularizationModalConfirm.addEventListener(
      "click",
      confirmGranularization
    );
  }

  // Handle checkbox interactions
  document.addEventListener("change", (e) => {
    if (e.target.id === "use-defaults") {
      const chooseLater = document.getElementById("choose-later");
      if (chooseLater) {
        chooseLater.checked = !e.target.checked;
      }
    } else if (e.target.id === "choose-later") {
      const useDefaults = document.getElementById("use-defaults");
      if (useDefaults) {
        useDefaults.checked = !e.target.checked;
      }
    }
  });
}

function renderKatex() {
  renderMathInElement(document.body, {
    delimiters: [
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true }
    ],
    throwOnError: false // prevents crashing on bad LaTeX
  });
}

// ===== STEP 3: SAVE QUIZ TO QUESTION BANK FUNCTIONS =====

function initializeQuizSelection() {
  // Reset state
  selectedQuizId = null;
  isCreatingNewQuiz = false;

  // Set up event listeners
  setupQuizSelectionListeners();

  // Switch to select tab by default
  switchQuizTab('select');

  // Default question limit logic removed as quizzes are now dynamically sized
}

function setupQuizSelectionListeners() {
  // Tab switching
  const tabButtons = document.querySelectorAll(".quiz-tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchQuizTab(tab);
    });
  });

  // Quiz selection dropdown
  const dropdown = document.getElementById("quiz-select-dropdown");
  if (dropdown) {
    dropdown.addEventListener("change", (e) => {
      selectedQuizId = e.target.value || null;
      isCreatingNewQuiz = false;
    });
  }

  // Quiz name input (for new quiz)
  const nameInput = document.getElementById("quiz-name-input");
  if (nameInput) {
    nameInput.addEventListener("input", () => {
      // Validation handled in handleSaveToQuiz
    });
  }
}


// ===== STEP 4: QUESTION GENERATION FUNCTIONS =====

// Helper function to get step 2 UI elements (cached for efficiency)
function getStep2UIElements() {
  return {
    questionsLoading: document.getElementById("questions-loading"),
    metaLoGroups: document.getElementById("meta-lo-groups"),
    contentHeader: document.querySelector(".step-panel[data-step='2'] .content-header"),
    emptyState: document.getElementById("empty-state"),
    regenerateAllBtn: document.getElementById("regenerate-all-btn"),
    backBtn: document.getElementById("back-btn"),
    continueBtn: document.getElementById("continue-btn"),
  };
}

// Helper function to check if questions are currently being generated
function isGeneratingQuestions() {
  const questionsLoading = document.getElementById("questions-loading");
  return questionsLoading && questionsLoading.style.display !== "none";
}

// Helper function to show/hide generation UI
function setGenerationUI(showLoading) {
  const ui = getStep2UIElements();

  if (showLoading) {
    // Show loading state
    if (ui.questionsLoading) ui.questionsLoading.style.display = "block";
    if (ui.metaLoGroups) ui.metaLoGroups.style.display = "none";
    if (ui.contentHeader) ui.contentHeader.style.display = "none";
    if (ui.emptyState) ui.emptyState.style.display = "none";
    // Disable navigation buttons during generation
    if (ui.backBtn) ui.backBtn.disabled = true;
    if (ui.continueBtn) ui.continueBtn.disabled = true;
  } else {
    // Hide loading state
    if (ui.questionsLoading) ui.questionsLoading.style.display = "none";
    if (ui.metaLoGroups) ui.metaLoGroups.style.display = "block";
    if (ui.contentHeader) ui.contentHeader.style.display = "block";
    // empty-state is managed by renderQuestionGroups()
    // Re-enable navigation buttons (updateNavigationButtons will set correct state)
    updateNavigationButtons();
  }
}

// Generate questions from uploaded content
async function generateQuestionsFromContent() {
  // Check if questionGenerator is initialized
  if (!questionGenerator) {
    try {
      // Try to initialize if not already done
      if (!contentGenerator) {
        contentGenerator = new window.ContentGenerator();
      }
      questionGenerator = new window.QuestionGenerator(contentGenerator);
    } catch (error) {
      console.error('Failed to initialize QuestionGenerator:', error);
      setGenerationUI(false);
      showToast('Failed to initialize question generator. Please refresh the page.', 'error');
      return;
    }
  }

  // Show loading UI
  setGenerationUI(true);

  try {
    // Generate questions using the question generator
    const questions = await questionGenerator.generateQuestions(
      state.course,
      state.objectiveGroups
    );

    // Convert questions to question groups format
    state.questionGroups = convertQuestionsToGroups(questions);

    // Update the UI
    renderStep2();
  } catch (error) {
    console.error('Failed to generate questions from content:', error);

    // Show error message in UI
    showQuestionGenerationError(error.message);

    // Clear any existing questions
    state.questionGroups = [];
  } finally {
    // Hide loading UI (renderStep2 will handle empty-state)
    setGenerationUI(false);
  }
}

// Show question generation error message
function showQuestionGenerationError(errorMessage) {
  const questionsContainer = document.getElementById("questions-container");
  if (!questionsContainer) return;

  // Clear existing content
  questionsContainer.innerHTML = "";

  // Create error message HTML
  const errorHTML = `
    <div class="error-message-container" style="
      text-align: center;
      padding: 40px 20px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      margin: 20px 0;
    ">
      <div style="color: #dc2626; font-size: 24px; margin-bottom: 16px;">
        ⚠️ Question Generation Unavailable
      </div>
      <div style="color: #374151; font-size: 16px; margin-bottom: 20px;">
        ${errorMessage ||
    "There is currently a problem with the question generation service."
    }
      </div>
      <div style="color: #6b7280; font-size: 14px; margin-bottom: 24px;">
        Please check that all required services are running and try again later.
      </div>
      <button onclick="retryQuestionGeneration()" style="
        background: #dc2626;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      ">
        Try Again
      </button>
    </div>
  `;

  questionsContainer.innerHTML = errorHTML;
}

// Retry question generation
function retryQuestionGeneration() {
  generateQuestionsFromContent();
}

// Convert generated questions to question groups format
function convertQuestionsToGroups(questions) {
  const groups = [];

  // Group questions by their metaCode (objective group)
  const groupedQuestions = {};

  questions.forEach((question) => {
    const metaCode = question.metaCode || "General Content";
    if (!groupedQuestions[metaCode]) {
      groupedQuestions[metaCode] = [];
    }
    groupedQuestions[metaCode].push(question);
  });

  // Create question groups with the expected structure
  Object.entries(groupedQuestions).forEach(
    ([metaCode, groupQuestions], index) => {
      const group = {
        id: index + 1,
        title: metaCode,
        isOpen: true, // Open all panels by default when generating for multiple learning objectives
        los: groupQuestions.map((question, itemIndex) => ({
          id: `lo-${index + 1}-${itemIndex + 1}`,
          code: `LO ${index + 1}.${itemIndex + 1}`,
          generated: question.count || 1,
          min: 1,
          badges: [],
          questions: [
            {
              id: question.id,
              title: question.text,
              stem: "Select the best answer:",
              options: {
                A: {
                  id: "A",
                  text: question.options?.A || "Option A",
                  feedback: `${question.correctAnswer === 'A' ? "Correct" : "Incorrect"} - ${question.explanation}`,
                },
                B: {
                  id: "B",
                  text: question.options?.B || "Option B",
                  feedback: `${question.correctAnswer === 'B' ? "Correct" : "Incorrect"} - ${question.explanation}`,
                },
                C: {
                  id: "C",
                  text: question.options?.C || "Option C",
                  feedback: `${question.correctAnswer === 'C' ? "Correct" : "Incorrect"} - ${question.explanation}`,
                },
                D: {
                  id: "D",
                  text: question.options?.D || "Option D",
                  feedback: `${question.correctAnswer === 'D' ? "Correct" : "Incorrect"} - ${question.explanation}`,
                },
              },
              correctAnswer: question.correctAnswer,
              bloom: question.bloomLevel || "Understand",
              difficulty: question.difficulty || "Medium",
              status: "Draft",
              lastEdited:
                question.lastEdited ||
                new Date().toISOString().slice(0, 16).replace("T", " "),
              by: question.by || "System",
              metaCode: question.metaCode || metaCode,
              loCode: question.loCode || question.text,
              granularObjectiveId: question.granularObjectiveId,
            },
          ],
        })),
      };

      groups.push(group);
    }
  );

  return groups;
}

function step2() {
  // Clear any existing questions
  state.questionGroups = [];

  // Generate questions from uploaded content instead of loading sample data
  if (state.objectiveGroups.length > 0) {
    generateQuestionsFromContent();
  } else {
    // Load sample data only if no real content
    state.questionGroups = JSON.parse(JSON.stringify(SAMPLE_QUESTION_DATA));
  }

  // Set up event listeners for Step 2
  setupStep2EventListeners();

  // Render the initial view
  renderStep2();
}

function setupStep2EventListeners() {
  // Filter controls
  const gloFilter = document.getElementById("glo-filter");
  const bloomFilter = document.getElementById("bloom-filter");
  const statusFilter = document.getElementById("status-filter");
  const searchInput = document.getElementById("search-input");
  if (gloFilter) gloFilter.addEventListener("change", handleFilterChange);
  if (bloomFilter) bloomFilter.addEventListener("change", handleFilterChange);
  if (statusFilter) statusFilter.addEventListener("change", handleFilterChange);
  if (searchInput) searchInput.addEventListener("input", handleSearchChange);

  // Action buttons
  const regenerateAllBtn = document.getElementById("regenerate-all-btn");

  if (regenerateAllBtn)
    regenerateAllBtn.addEventListener("click", handleRegenerateAll);
}

function renderStep2() {
  renderQuestionGroups();
  renderKatex();
}

function renderQuestionGroups() {
  const metaLoGroups = document.getElementById("meta-lo-groups");
  if (!metaLoGroups) return;

  const filteredGroups = getFilteredGroups();

  if (filteredGroups.length === 0) {
    // Only show empty state if not currently generating
    if (!isGeneratingQuestions()) {
      showEmptyState();
    }
    return;
  }

  hideEmptyState();

  metaLoGroups.innerHTML = filteredGroups
    .map(
      (group) => `
        <div class="meta-lo-group ${group.isOpen ? "meta-lo-group--expanded" : "meta-lo-group--collapsed"
        }" data-group-id="${group.id}">
            <div class="meta-lo-group__header" onclick="toggleMetaLoGroup('${group.id
        }')">
                <h3 class="meta-lo-group__title">${group.title}</h3>
                <div class="meta-lo-group__toggle">
                    <span>${group.isOpen ? "Collapse" : "Expand"}</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
            </div>
            <div class="meta-lo-group__content">
                ${group.los
          .map((lo) => renderGranularLoSection(lo, group))
          .join("")}
            </div>
        </div>
    `
    )
    .join("");

  // Set up question card event listeners
  setupQuestionCardListeners();

  // Re-render LaTeX after rendering questions
  renderKatex();
}

// Toggle meta learning objective group expand/collapse
function toggleMetaLoGroup(groupId) {
  // Convert string ID to number if needed (groups use numeric IDs)
  const id = typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
  const group = state.questionGroups.find((g) => g.id === id);
  if (group) {
    group.isOpen = !group.isOpen;
    renderQuestionGroups();
  }
}

// Make function available globally for onclick handlers
window.toggleMetaLoGroup = toggleMetaLoGroup;

function renderGranularLoSection(lo, group) {
  return `
        <div class="granular-lo-section">
            <div class="granular-lo-section__header">
                <h4 class="granular-lo-section__title">${lo.code}</h4>
                <div class="granular-lo-section__stats">
                    <div class="granular-lo-section__stat">
                        <span>Generated: ${lo.generated}</span>
                    </div>
                    <div class="granular-lo-section__stat">
                        <span>Min: ${lo.min}</span>
                    </div>
                    ${lo.badges
      .map((badge) => `<span class="badge">${badge}</span>`)
      .join("")}
                </div>
            </div>
            <div class="question-cards">
                ${lo.questions
      .map((question) => renderQuestionCard(question, group))
      .join("")}
            </div>
        </div>
    `;
}

function renderQuestionCard(question, group) {
  const isEditing = question.isEditing || false;

  return `
        <div class="question-card" data-question-id="${question.id}">
            <div class="question-card__header">
                <div class="question-card__content">
                    ${isEditing
      ? `<input type="text" class="question-card__title--editing" value="${question.title}" onchange="updateQuestionTitle('${question.id}', this.value)">`
      : `<h5 class="question-card__title">${question.title}</h5>`
    }
                    <div class="question-card__chips">
                        <span class="question-card__chip question-card__chip--meta">${question.metaCode
    }</span>
                        <span class="question-card__chip question-card__chip--lo">${question.loCode
    }</span>
                        <span class="question-card__chip question-card__chip--bloom">Bloom: ${question.bloom
    }</span>
                    </div>
                </div>
                <div class="question-card__metadata">
                    <div class="question-card__status">
                        <span class="status-pill status-pill--${question.status.toLowerCase()}">${question.status
    }</span>
                    </div>
                    <div>Last Edited: ${question.lastEdited}</div>
                    <div>By: ${question.by}</div>
                </div>
            </div>
            <div class="question-card__body">
                ${isEditing
      ? `<textarea class="question-card__stem--editing" onblur="updateQuestionStem('${question.id}', this.value)">${(question.stem || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>`
      : `<p class="question-card__stem">${question.stem}</p>`
    }
                <div class="question-card__options">
                    ${Object.values(question.options).map(
      (option, index) => {
        // correctAnswer is now a letter (A, B, C, D), compare with option.id
        const isCorrect = option.id === question.correctAnswer ||
          (typeof question.correctAnswer === 'number' && index === question.correctAnswer);
        return `
                        <div class="question-card__option ${isEditing ? "question-card__option--editing" : ""
          }">
                            <input type="radio" name="q-${question.id
          }" value="${option.id}" ${isCorrect ? "checked" : ""
          } disabled>
                            ${isEditing
            ? `<input type="text" value="${(option.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" onblur="saveOptionEdit('${question.id}', '${option.id}', this.value)">`
            : `<label>${option.id}. ${option.text}</label>`
          }
                        </div>
                        <div class="question-card__feedback">${isCorrect ? "Correct" : "Incorrect"}</div>
                    `;
      }
    )
      .join("")}
                </div>
            </div>
            <div class="question-card__footer">
                <div class="question-card__actions">
                    <button type="button" class="question-card__action-btn question-card__action-btn--edit" 
                            onclick="editQuestion('${question.id}')">
                        ${isEditing ? "Cancel" : "Edit"}
                    </button>
                    <button type="button" class="question-card__action-btn question-card__action-btn--flag" 
                            onclick="toggleQuestionFlag('${question.id}')"
                            ${question.flagStatus === false
      ? 'style="background: #ffebee; color: #d32f2f;"'
      : ""
    }
                            >
                        ${question.flagStatus === true ? "Unflag" : "Flag"}
                    </button>
                    <button type="button" class="question-card__action-btn question-card__action-btn--delete" 
                            onclick="deleteQuestion('${question.id}')">
                        Delete
                    </button>
                </div>
                ${isEditing
      ? `<button type="button" class="question-card__save-btn" onclick="saveQuestionEdit('${question.id}')">Save</button>`
      : ""
    }
            </div>
        </div>
    `;
}

function setupQuestionCardListeners() {
  // Event listeners for question cards are set up inline in the render functions
}

// ===== STEP 4 EVENT HANDLERS =====
async function handleRegenerateAll() {
  const ui = getStep2UIElements();

  // Update button state
  if (ui.regenerateAllBtn) {
    ui.regenerateAllBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Regenerating...';
    ui.regenerateAllBtn.disabled = true;
  }

  // Show loading UI
  setGenerationUI(true);

  try {
    // Clear existing questions
    state.questionGroups = [];

    // Generate new questions from content
    await generateQuestionsFromContent();

    showToast('Questions regenerated from uploaded content', 'success');
  } catch (error) {
    console.error('Failed to regenerate questions:', error);
    showQuestionGenerationError(error.message);
  } finally {
    // Restore button state
    if (ui.regenerateAllBtn) {
      ui.regenerateAllBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Regenerate All';
      ui.regenerateAllBtn.disabled = false;
    }

    // Hide loading UI (renderStep2 will handle empty-state)
    setGenerationUI(false);
  }
}



async function handleAddQuestionToBank(question) {
  try {
    const response = await fetch(API_ENDPOINTS.questionSave, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: question,
        courseId: getCourseId(),
      }),
    });

    if (response.ok) {
      showToast('Added 1 question to Question Bank', 'success');
    }
  } catch (error) {
    console.error('Failed to add question to Question Bank:', error);
    showToast('Failed to add question to Question Bank', 'error');
  }
}

function editQuestion(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    question.isEditing = !question.isEditing;
    renderQuestionGroups();
    // LaTeX will be automatically re-rendered by renderQuestionGroups()
  }
}

function updateQuestionTitle(questionId, newTitle) {
  const question = findQuestionById(questionId);
  if (question) {
    question.title = newTitle.trim();
  }
}

function updateQuestionOption(questionId, optionId, newText) {
  const question = findQuestionById(questionId);
  if (question && question.options[optionId]) {
    question.options[optionId].text = newText.trim();
  }
}

function updateQuestionStem(questionId, newStem) {
  const question = findQuestionById(questionId);
  if (question) {
    question.stem = newStem.trim();
  }
}

function saveQuestionEdit(questionId) {
  const question = findQuestionById(questionId);
  if (!question) {
    showToast("Question not found", "error");
    return;
  }

  // Simply update state - mark as not editing and update timestamp
  question.isEditing = false;
  question.lastEdited = new Date().toISOString().slice(0, 16).replace("T", " ");

  // Render the question groups (LaTeX will be automatically re-rendered)
  renderQuestionGroups();
  showToast("Question updated successfully", "success");
}

function saveOptionEdit(questionId, optionId, newText) {
  updateQuestionOption(questionId, optionId, newText);
}

function toggleQuestionFlag(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    question.flagStatus = !question.flagStatus;
    renderQuestionGroups();
    showToast(`Question ${question.flagStatus ? "Flagged" : "Unflagged"}`, "success");
  }
}

function deleteQuestion(questionId) {
  if (
    !confirm(
      "Are you sure you want to delete this question? This action cannot be undone."
    )
  ) {
    return;
  }

  // Remove from all groups - update local state only
  state.questionGroups.forEach((group) => {
    group.los.forEach((lo) => {
      const questionIndex = lo.questions.findIndex((q) => q.id === questionId || q._id === questionId);
      if (questionIndex > -1) {
        lo.questions.splice(questionIndex, 1);

        // If this LO has no questions left, remove it from the group
        if (lo.questions.length === 0) {
          const loIndex = group.los.findIndex(l => l.id === lo.id);
          if (loIndex > -1) {
            group.los.splice(loIndex, 1);
          }
        }
      }
    });

    // Remove empty LOs from the group
    group.los = group.los.filter(lo => lo.questions.length > 0);
  });

  // Remove empty groups
  state.questionGroups = state.questionGroups.filter(group => group.los.length > 0);

  // Remove from selection
  state.selectedQuestions.delete(questionId);

  renderQuestionGroups();
  showToast("Question deleted successfully", "success");
}

function findQuestionById(questionId) {
  for (const group of state.questionGroups) {
    for (const lo of group.los) {
      const question = lo.questions.find((q) => q.id === questionId);
      if (question) return question;
    }
  }
  return null;
}

function getFilteredGroups() {
  let filteredGroups = [...state.questionGroups];

  // Apply filters
  if (state.filters.glo !== "all") {
    filteredGroups = filteredGroups.filter(
      (group) => group.id === `meta-${state.filters.glo}`
    );
  }

  if (state.filters.bloom !== "all") {
    filteredGroups = filteredGroups.filter((group) => {
      return group.los.some((lo) =>
        lo.questions.some(
          (q) => q.bloom.toLowerCase() === state.filters.bloom.toLowerCase()
        )
      );
    });
  }

  if (state.filters.status !== "all") {
    filteredGroups = filteredGroups.filter((group) => {
      return group.los.some((lo) =>
        lo.questions.some(
          (q) => q.status.toLowerCase() === state.filters.status.toLowerCase()
        )
      );
    });
  }

  // Apply search
  if (state.filters.q) {
    const query = state.filters.q.toLowerCase();
    filteredGroups = filteredGroups.filter((group) => {
      return group.los.some((lo) =>
        lo.questions.some(
          (q) =>
            q.title.toLowerCase().includes(query) ||
            q.loCode.toLowerCase().includes(query) ||
            q.metaCode.toLowerCase().includes(query)
        )
      );
    });
  }

  return filteredGroups;
}

function showEmptyState() {
  // Don't show empty state if questions are currently being generated
  if (isGeneratingQuestions()) {
    return;
  }

  const ui = getStep2UIElements();
  if (ui.emptyState) ui.emptyState.style.display = "block";
  if (ui.metaLoGroups) ui.metaLoGroups.style.display = "none";
}

function hideEmptyState() {
  const ui = getStep2UIElements();
  if (ui.emptyState) ui.emptyState.style.display = "none";
  if (ui.metaLoGroups) ui.metaLoGroups.style.display = "block";
}

// ===== TOAST NOTIFICATIONS =====

function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const icon = document.createElement("i");
  icon.className = `fas fa-${getToastIcon(type)} toast__icon`;

  const messageEl = document.createElement("span");
  messageEl.className = "toast__message";
  messageEl.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast__close";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.onclick = () => toast.remove();

  toast.appendChild(icon);
  toast.appendChild(messageEl);
  toast.appendChild(closeBtn);

  toastContainer.appendChild(toast);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 5000);

  return toast;
}

function showSuccessModal(message, questionsCount) {
  const modal = document.getElementById("quiz-save-success-modal");
  const messageEl = document.getElementById("quiz-save-success-message");
  const closeBtn = document.getElementById("quiz-save-success-close");
  const goToBankBtn = document.getElementById("go-to-question-bank-btn");

  if (!modal) return;

  // Update message
  if (messageEl) {
    messageEl.textContent = message;
  }

  // Show modal
  modal.style.display = "flex";

  // Close button handler
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = "none";
    };
  }

  // Go to Question Bank button handler
  if (goToBankBtn) {
    goToBankBtn.onclick = () => {
      window.location.href = "/question-bank";
    };
  }

  // Close on background click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  };
}

function getToastIcon(type) {
  switch (type) {
    case "success":
      return "check-circle";
    case "warning":
      return "exclamation-triangle";
    case "error":
      return "times-circle";
    default:
      return "info-circle";
  }
}


// ===== UTILITY FUNCTIONS =====

function announceToScreenReader(message) {
  const srAnnouncements = document.getElementById("sr-announcements");
  if (srAnnouncements) {
    srAnnouncements.textContent = message;
    // Clear after a short delay
    setTimeout(() => {
      srAnnouncements.textContent = "";
    }, 1000);
  }
}

// Export functions for global access
window.toggleObjectiveGroup = toggleObjectiveGroup;
window.toggleBloomChip = toggleBloomChip;
window.setBloomMode = setBloomMode;

// ===== QUIZ SELECTION MODAL =====

let selectedQuizId = null;
let isCreatingNewQuiz = false;


async function loadQuizzesForCourse() {
  const dropdown = document.getElementById('quiz-select-dropdown');
  const emptyMessage = document.getElementById('quiz-select-empty');

  if (!dropdown) return;

  try {
    const courseId = getCourseId();
    const response = await fetch(`${API_ENDPOINTS.quizCourse}/${courseId}`);

    if (!response.ok) {
      throw new Error('Failed to load quizzes');
    }

    const data = await response.json();
    const quizzes = data.quizzes || [];

    dropdown.innerHTML = '';

    if (quizzes.length === 0) {
      dropdown.innerHTML = '<option value="">No quizzes available</option>';
      if (emptyMessage) emptyMessage.style.display = 'block';
    } else {
      dropdown.innerHTML = '<option value="">Select a quiz...</option>';
      quizzes.forEach((quiz) => {
        const option = document.createElement('option');
        option.value = quiz._id;
        option.textContent = quiz.name;
        dropdown.appendChild(option);
      });
      if (emptyMessage) emptyMessage.style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading quizzes:', error);
    dropdown.innerHTML = '<option value="">Error loading quizzes</option>';
    showToast('Failed to load quizzes', 'error');
  }
}


function switchQuizTab(tab) {
  // Update tab buttons
  const tabButtons = document.querySelectorAll(".quiz-tab-btn");
  tabButtons.forEach((btn) => {
    if (btn.dataset.tab === tab) {
      btn.classList.add("quiz-tab-btn--active");
    } else {
      btn.classList.remove("quiz-tab-btn--active");
    }
  });

  // Update tab content
  const selectTab = document.getElementById("quiz-select-tab");
  const createTab = document.getElementById("quiz-create-tab");

  if (tab === "select") {
    if (selectTab) selectTab.classList.add("quiz-tab-content--active");
    if (createTab) createTab.classList.remove("quiz-tab-content--active");
    isCreatingNewQuiz = false;
  } else {
    if (selectTab) selectTab.classList.remove("quiz-tab-content--active");
    if (createTab) createTab.classList.add("quiz-tab-content--active");
    isCreatingNewQuiz = true;
    selectedQuizId = null;
  }
}

async function handleSaveToQuiz() {
  try {
    let quizId = selectedQuizId;

    // If creating new quiz, create it first
    if (isCreatingNewQuiz) {
      const nameInput = document.getElementById("quiz-name-input");
      const descriptionInput = document.getElementById("quiz-description-input");
      const releaseDateInput = document.getElementById("quiz-release-date");
      const expireDateInput = document.getElementById("quiz-expire-date");

      if (!nameInput || !nameInput.value.trim()) {
        showToast("Please enter a quiz name", "error");
        return;
      }

      const courseId = getCourseId();

      const response = await fetch(API_ENDPOINTS.quiz, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseId: courseId,
          name: nameInput.value.trim(),
          description: descriptionInput.value.trim() || '',
          releaseDate: releaseDateInput ? releaseDateInput.value : null,
          expireDate: expireDateInput ? expireDateInput.value : null
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create quiz');
      }

      const data = await response.json();
      quizId = data.quiz._id || data.quiz.insertedId;
      if (typeof quizId === 'object' && quizId.toString) {
        quizId = quizId.toString();
      }
    }

    if (!quizId) {
      showToast("Please select or create a quiz", "error");
      return;
    }

    // Collect all questions from state
    const questions = [];
    for (const group of state.questionGroups) {
      for (const lo of group.los) {
        for (const question of lo.questions) {
          // Transform question to match the expected format
          questions.push({
            title: question.title || question.stem || "",
            stem: question.stem || question.title || "",
            options: question.options || [],
            correctAnswer: question.correctAnswer || 0,
            bloom: question.bloom || question.bloomLevel || "Understand",
            difficulty: question.difficulty || "medium",
            granularObjectiveId: question.granularObjectiveId || null,
            by: question.createdBy || "system",
            status: question.status || "Draft",
            flagStatus: question.flagStatus || false,
          });
        }
      }
    }

    if (questions.length === 0) {
      showToast("No questions to add", "warning");
      return;
    }

    // Add questions to quiz
    const courseId = getCourseId();

    const continueBtn = document.getElementById('continue-btn');
    if (continueBtn) {
      continueBtn.disabled = true;
      continueBtn.textContent = 'Saving...';
    }

    const response = await fetch(`${API_ENDPOINTS.quiz}/${quizId}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        courseId: courseId,
        questions: questions,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add questions to quiz');
    }

    const data = await response.json();

    const questionsCount = data.questionsAdded || questions.length;

    // Show success modal with button to question bank
    showSuccessModal(
      `Successfully added ${questionsCount} question${questionsCount !== 1 ? 's' : ''} to quiz!`,
      questionsCount
    );

    // Reset form
    const nameInput = document.getElementById("quiz-name-input");
    const descriptionInput = document.getElementById("quiz-description-input");
    if (nameInput) nameInput.value = "";
    if (descriptionInput) descriptionInput.value = "";
    selectedQuizId = null;
    isCreatingNewQuiz = false;

    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.textContent = "Save to Quiz";
    }

  } catch (error) {
    console.error("Error adding questions to quiz:", error);
    showToast(error.message || "Failed to add questions to quiz", "error");

    const continueBtn = document.getElementById("continue-btn");
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.textContent = "Continue";
    }
  }
}
window.incrementCount = incrementCount;
window.decrementCount = decrementCount;
window.editMetaObjective = editMetaObjective;
window.updateMetaObjectiveTitle = updateMetaObjectiveTitle;
window.updateGranularObjectiveText = updateGranularObjectiveText;
window.deleteObjectiveGroup = deleteObjectiveGroup;
window.deleteGranularObjective = deleteGranularObjective;
window.toggleGranularSelection = toggleGranularSelection;
window.selectAllGranularInGroup = selectAllGranularInGroup;
window.deleteSelectedGranular = deleteSelectedGranular;
window.showGranularizationModal = showGranularizationModal;
window.regenerateAllObjectivesFromContent = regenerateAllObjectivesFromContent;

// Step 2 function exports
window.editQuestion = editQuestion;
window.saveQuestionEdit = saveQuestionEdit;
window.saveOptionEdit = saveOptionEdit;
window.updateQuestionStem = updateQuestionStem;
window.updateQuestionTitle = updateQuestionTitle;
window.updateQuestionOption = updateQuestionOption;
window.toggleQuestionFlag = toggleQuestionFlag;
window.deleteQuestion = deleteQuestion;

// Step 3 function exports
