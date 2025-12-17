// Question Generation JavaScript
// State management and functionality for the 5-step question generation process

// Development flag for mock API responses
const DEV_MODE = true;

// PDF Service
let pdfService = null;
let questionGenerator = null;
let contentGenerator = null;

// Main state object
const state = {
  step: 1, // Step 1 is now Create Objectives (was step 3)
  course: JSON.parse(sessionStorage.getItem("grasp-selected-course")) || "",
  selectedCourse: JSON.parse(sessionStorage.getItem("grasp-selected-course")).courseName || "", // Course name for display
  summary: "",
  objectives: [],
  questions: [],
  exportFormat: "qti",
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
  // Step 3: Select Output Format
  formats: {
    canvasSingle: { selected: false, releaseNow: true, date: "", time: "" },
    canvasSpaced: { selected: false, releaseNow: true, date: "", time: "" },
    h5p: { selected: false },
  },
  namingConvention: "module_week_quiz",
  saveAsDefault: false,
};

// Step titles for dynamic updates
const STEPTITLES = {
  3: "Create Objectives",
  4: "Generate Questions",
  5: "Select Output Format",
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

// Sample question data for Step 4
const SAMPLE_QUESTION_DATA = [
  {
    id: "meta-1",
    title: "Meta LO 1",
    isOpen: true,
    stats: {
      configured: 8,
      min: 5,
      bloomSummary: "R/U/A",
    },
    los: [
      {
        id: "lo-1-1",
        code: "LO 1.1",
        generated: 3,
        min: 2,
        badges: ["1 top-up"],
        questions: [
          {
            id: "q-1-1-1",
            title: "Endergonic vs Exergonic",
            stem: "Select the best answer:",
            options: {
              A: {
                id: "A",
                text: "Endergonic reactions release energy",
                isCorrect: false,
                feedback:
                  "Incorrect — Endergonic reactions absorb energy from the surroundings.",
              },
              B: {
                id: "B",
                text: "Exergonic reactions absorb energy",
                isCorrect: false,
                feedback:
                  "Incorrect — Exergonic reactions release energy to the surroundings.",
              },
              C: {
                id: "C",
                text: "Endergonic reactions absorb energy",
                isCorrect: true,
                feedback:
                  "Correct — Endergonic reactions require energy input.",
              },
              D: {
                id: "D",
                text: "Both reactions release energy",
                isCorrect: false,
                feedback:
                  "Incorrect — Only exergonic reactions release energy.",
              },
            },
            status: "Draft",
            bloom: "Analyze",
            metaCode: "Meta LO 1",
            loCode: "LO 1.1",
            lastEdited: "2024-01-15 14:30",
            by: "System",
          },
          {
            id: "q-1-1-2",
            title: "Thermodynamic Spontaneity",
            stem: "Select the best answer:",
            options: {
              A: {
                id: "A",
                text: "Spontaneous reactions always occur quickly",
                isCorrect: false,
                feedback:
                  "Incorrect — Spontaneity is about thermodynamic favorability, not speed.",
              },
              B: {
                id: "B",
                text: "Non-spontaneous reactions cannot occur",
                isCorrect: false,
                feedback:
                  "Incorrect — Non-spontaneous reactions can occur with energy input.",
              },
              C: {
                id: "C",
                text: "Spontaneous reactions are thermodynamically favorable",
                isCorrect: true,
                feedback:
                  "Correct — Spontaneous reactions are thermodynamically favorable.",
              },
              D: {
                id: "D",
                text: "All reactions are spontaneous",
                isCorrect: false,
                feedback: "Incorrect — Not all reactions are spontaneous.",
              },
            },
            status: "Draft",
            bloom: "Understand",
            metaCode: "Meta LO 1",
            loCode: "LO 1.1",
            lastEdited: "2024-01-15 14:25",
            by: "System",
          },
        ],
      },
      {
        id: "lo-1-2",
        code: "LO 1.2",
        generated: 2,
        min: 2,
        badges: [],
        questions: [
          {
            id: "q-1-2-1",
            title: "Energy Conservation in Reactions",
            stem: "Select the best answer:",
            options: {
              A: {
                id: "A",
                text: "Energy is always conserved",
                isCorrect: true,
                feedback:
                  "Correct — Energy conservation is a fundamental law of physics.",
              },
              B: {
                id: "B",
                text: "Energy can be created in reactions",
                isCorrect: false,
                feedback: "Incorrect — Energy cannot be created or destroyed.",
              },
              C: {
                id: "C",
                text: "Energy is lost in exergonic reactions",
                isCorrect: false,
                feedback: "Incorrect — Energy is transferred, not lost.",
              },
              D: {
                id: "D",
                text: "Energy disappears in endergonic reactions",
                isCorrect: false,
                feedback: "Incorrect — Energy is transferred, not destroyed.",
              },
            },
            status: "Approved",
            bloom: "Remember",
            metaCode: "Meta LO 1",
            loCode: "LO 1.2",
            lastEdited: "2024-01-15 13:45",
            by: "System",
          },
        ],
      },
    ],
  },
  {
    id: "meta-2",
    title: "Meta LO 2",
    isOpen: false,
    stats: {
      configured: 6,
      min: 5,
      bloomSummary: "U/A/E",
    },
    los: [
      {
        id: "lo-2-1",
        code: "LO 2.1",
        generated: 4,
        min: 3,
        badges: [],
        questions: [
          {
            id: "q-2-1-1",
            title: "Entropy and Disorder",
            stem: "Select the best answer:",
            options: {
              A: {
                id: "A",
                text: "Entropy always increases",
                isCorrect: false,
                feedback:
                  "Incorrect — Entropy increases in isolated systems, not always.",
              },
              B: {
                id: "B",
                text: "Entropy measures disorder",
                isCorrect: true,
                feedback:
                  "Correct — Entropy is a measure of disorder or randomness.",
              },
              C: {
                id: "C",
                text: "Entropy decreases with temperature",
                isCorrect: false,
                feedback:
                  "Incorrect — Entropy generally increases with temperature.",
              },
              D: {
                id: "D",
                text: "Entropy is independent of state",
                isCorrect: false,
                feedback: "Incorrect — Entropy varies with physical state.",
              },
            },
            status: "Draft",
            bloom: "Analyze",
            metaCode: "Meta LO 2",
            loCode: "LO 2.1",
            lastEdited: "2024-01-15 14:20",
            by: "System",
          },
        ],
      },
    ],
  },
];

// Initialize the application
document.addEventListener("DOMContentLoaded", async function () {
  console.log("DOM Content Loaded - Starting initialization...");

  // Initialize GRASP navigation first to create sidebar
  if (window.GRASPNavigation) {
    console.log("GRASPNavigation available, creating instance...");
    new window.GRASPNavigation();
  } else {
    console.error("GRASPNavigation not available!");
  }

  console.log("Calling initializeNavigation...");
  initializeNavigation();

  console.log("Calling initializeEventListeners...");
  initializeEventListeners();

  console.log("Initializing content and question generators...");
  initializeModules();

  console.log("Loading course data...");
  await loadCourseData();

  console.log("Checking for course materials...");
  await checkCourseMaterials();

  console.log("Calling updateUI...");
  updateUI();

  console.log("Initialization complete!");
});

// ===== MODULE INITIALIZATION =====

async function loadCourseData() {
  try {
    if (state.selectedCourse) {
      // Update course display
      const courseValue = document.getElementById("course-value");
      if (courseValue) {
        courseValue.textContent = state.selectedCourse;
      }
    } else {
      showNoCourseSelectedMessage();
    }
  } catch (error) {
    console.error("Error loading course data:", error);
    showNoCourseSelectedMessage();
  }
}

async function checkCourseMaterials() {
  try {
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course"));
    if (!selectedCourse || !selectedCourse.id) {
      showNoCourseSelectedMessage();
      return;
    }

    // Check if course has materials
    const response = await fetch(`/api/material/course/${selectedCourse.id}`);
    const data = await response.json();

    if (data.success && data.materials && data.materials.length > 0) {
      console.log("Course has materials:", data.materials.length);
      // Show step content, hide no materials message
      const stepContent = document.getElementById("step-content");
      const noMaterialsMessage = document.getElementById("no-materials-message");
      if (stepContent) stepContent.style.display = "block";
      if (noMaterialsMessage) noMaterialsMessage.style.display = "none";

    } else {
      console.log("No materials found for course");
      // Show no materials message, hide step content
      const stepContent = document.getElementById("step-content");
      const noMaterialsMessage = document.getElementById("no-materials-message");
      if (stepContent) stepContent.style.display = "none";
      if (noMaterialsMessage) noMaterialsMessage.style.display = "block";
    }
  } catch (error) {
    console.error("Error checking course materials:", error);
    // On error, show no materials message
    const stepContent = document.getElementById("step-content");
    const noMaterialsMessage = document.getElementById("no-materials-message");
    if (stepContent) stepContent.style.display = "none";
    if (noMaterialsMessage) noMaterialsMessage.style.display = "block";
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

function updateCourseDropdown(courses) {
  const courseSelect = document.getElementById("course-select");
  if (courseSelect) {
    // Clear existing options except the first one
    courseSelect.innerHTML = '<option value="">Select a course...</option>';

    // Add course options
    courses.forEach((course) => {
      const option = document.createElement("option");
      option.value = course.courseCode;
      option.textContent = `${course.courseName}`;

      if (course._id === JSON.parse(sessionStorage.getItem("grasp-selected-course")).id) {
        option.selected = true;
      }
      courseSelect.appendChild(option);
    });
  }
}

function showNoCoursesMessage() {
  const courseSelect = document.getElementById("course-select");
  if (courseSelect) {
    courseSelect.innerHTML =
      '<option value="">No courses available. Please complete onboarding first.</option>';
  }
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
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 10000;
    background-color: ${type === "warning" ? "#f39c12" : type === "error" ? "#e74c3c" : "#3498db"
    };
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease-out;
  `;

  // Add to page
  document.body.appendChild(notification);

  // Remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 5000);
}

function initializeModules() {
  console.log("Initializing modules...");
  console.log("PDFParsingService available:", window.PDFParsingService);

  // Initialize PDF service
  pdfService = new window.PDFParsingService();
  console.log("PDF service created:", pdfService);

  // Initialize content generator
  contentGenerator = new window.ContentGenerator();
  console.log("Content generator created:", contentGenerator);

  // Initialize question generator with content generator
  questionGenerator = new window.QuestionGenerator(contentGenerator);
  console.log("Question generator created:", questionGenerator);

  console.log("Modules initialized successfully");
}

// ===== Generate Questions FUNCTIONS =====


// ===== NAVIGATION FUNCTIONS =====

function initializeNavigation() {
  console.log("Initializing navigation...");
  // Initialize GRASP navigation
  if (window.GRASPNavigation) {
    console.log("GRASPNavigation found, creating instance...");
    new window.GRASPNavigation();
  } else {
    console.error("GRASPNavigation not found!");
  }
}

function initializeEventListeners() {
  // Navigation buttons
  const backBtn = document.getElementById("back-btn");
  const continueBtn = document.getElementById("continue-btn");

  if (backBtn) {
    backBtn.addEventListener("click", goToPreviousStep);
  }

  if (continueBtn) {
    continueBtn.addEventListener("click", goToNextStep);
  }

  // Step 1: Objectives
  initializeObjectives();

  // Step 3: Export format selection
  initializeExportFormat();
}

function goToNextStep() {
  console.log("goToNextStep called, current step:", state.step);

  if (state.step === 3) {
    // Final step - show export summary modal
    showExportSummaryModal();
    return;
  }

  if (state.step < 3) {
    const currentStep = state.step;
    const nextStep = currentStep + 1;

    console.log("Moving from step", currentStep, "to step", nextStep);

    // Validate current step before proceeding
    if (validateCurrentStep()) {
      console.log("Step validation passed, updating step to:", nextStep);
      state.step = nextStep;
      updateUI();

      // Handle step-specific actions
      handleStepTransition(currentStep, nextStep);
    } else {
      console.log("Step validation failed for step:", currentStep);
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
  console.log("validateCurrentStep called for step:", state.step);

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
        
        console.log("Step 1 validation errors:", validationErrors);
        return false;
      }
      
      // Re-render to hide any validation messages if validation passes
      renderObjectiveGroups();

      const step1Valid = true;
      console.log(
        "Step 1 validation:",
        step1Valid,
        "objectiveGroups:",
        state.objectiveGroups.length
      );
      return step1Valid;
    case 2:
      // Step 2 validation - check if we have question groups with questions
      const step2Valid =
        state.questionGroups.length > 0 &&
        state.questionGroups.some((group) =>
          group.los.some((lo) => lo.questions.length > 0)
        );
      console.log(
        "Step 2 validation:",
        step2Valid,
        "questionGroups:",
        state.questionGroups.length
      );
      return step2Valid;
    default:
      console.log("Default case, returning true");
      return true;
  }
}

function handleStepTransition(fromStep, toStep) {
  console.log(
    "handleStepTransition called from step",
    fromStep,
    "to step",
    toStep
  );

  switch (toStep) {
    case 2:
      console.log("Initializing Step 2 (Generate Questions)");
      step2();
      break;
    case 3:
      console.log("Initializing Step 3 (Select Output Format)");
      initializeStep3(); // Use the old step 3 function
      break;
  }
}

// ===== UI UPDATE FUNCTIONS =====

function updateUI() {
  console.log("updateUI called for step:", state.step);
  updateStepper();
  updatePageTitle();
  updateCourseDisplay();
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

  // Also update the export title in Step 3 if it exists
  const exportTitle = document.querySelector(".export-title");
  if (exportTitle && state.step === 3) {
    exportTitle.textContent = STEPTITLES[state.step];
  }
}

function updateCourseDisplay() {
  const courseValue = document.getElementById("course-value");

  if (courseValue) {
    courseValue.textContent = state.selectedCourse || state.course;
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
      continueBtn.textContent = "Export Now";
      continueBtn.className = "btn btn--primary";
      // Export button state is managed by updateExportButtonState()
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

// Check if a word is a common word that shouldn't be treated as a concept
function isCommonWord(word) {
  const commonWords = [
    "This",
    "That",
    "With",
    "From",
    "They",
    "Have",
    "Been",
    "Will",
    "Were",
    "Said",
    "The",
    "And",
    "For",
    "Are",
    "But",
    "Not",
    "You",
    "All",
    "Can",
    "Had",
    "Her",
    "Was",
    "One",
    "Our",
    "Out",
    "Day",
    "Get",
    "Has",
    "Him",
    "His",
    "How",
    "Man",
    "New",
    "Now",
    "Old",
    "See",
    "Two",
    "Way",
    "Who",
    "Boy",
    "Did",
    "Its",
    "Let",
    "Put",
    "Say",
    "She",
    "Too",
    "Use",
  ];
  return commonWords.includes(word);
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
      // Get courseId from state.course
      const courseId = state.course ? state.course.id : JSON.parse(sessionStorage.getItem("grasp-selected-course")).id;
      const response = await fetch(`/api/objective?courseId=${encodeURIComponent(courseId)}`);
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
          !e.target.classList.contains("dropdown-option--disabled")) {
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
        // Don't close if clicking on the create custom button (handled by inline onclick)
        if (e.target.closest("#create-custom-btn")) {
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
window.showCustomObjectiveModalFromButton = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  hideAddObjectivesDropdown();
  setTimeout(() => {
    showCustomObjectiveModal();
  }, 100);
  return false;
};

async function showCustomObjectiveModal(mode = "create", editData = null) {
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
    modalTitle.textContent = mode === "edit" ? "Edit Learning Objective" : "Create New Learning Objective";
  }
  if (modalSaveButton) {
    modalSaveButton.textContent = mode === "edit" ? "Save Changes" : "Create";
  }

  const nameInput = document.getElementById("custom-objective-name");
  const container = document.getElementById("granular-objectives-container");

  // Clear or populate form based on mode
  if (mode === "edit" && editData) {
    // Edit mode - populate with existing data
    if (nameInput) {
      nameInput.value = editData.name || "";
    }

    if (container) {
      container.innerHTML = "";
      // Add granular objectives from edit data
      if (editData.granularObjectives && editData.granularObjectives.length > 0) {
        editData.granularObjectives.forEach((item) => {
          addGranularObjectiveInput(item.text || "", item.granularId || null);
        });
      } else {
        // Add one empty input if no granular objectives
        addGranularObjectiveInput();
      }
    }

    // Load materials with pre-selection for edit mode
    await loadMaterialsForModal(editData.objectiveId);
  } else {
    // Create mode - clear form
    if (nameInput) {
      nameInput.value = "";
    }

    if (container) {
      container.innerHTML = "";
      // Add one initial granular objective input
      addGranularObjectiveInput();
    }

    // Load materials (no pre-selection)
    loadMaterialsForModal();
  }

  modal.style.display = "flex";

  // Focus name input
  if (nameInput) {
    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 100);
  }
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
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course"));
    if (!selectedCourse || !selectedCourse.id) {
      if (loadingDiv) loadingDiv.style.display = "none";
      if (materialsEmpty) materialsEmpty.style.display = "block";
      return;
    }

    // Load materials and optionally get attached materials for edit mode
    const [materialsResponse, objectiveMaterialsResponse] = await Promise.all([
      fetch(`/api/material/course/${selectedCourse.id}`),
      objectiveId ? fetch(`/api/objective/${objectiveId}/materials`) : Promise.resolve(null)
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

function addGranularObjectiveInput(text = "", granularId = null) {
  const container = document.getElementById("granular-objectives-container");
  if (!container) return;

  const granularDiv = document.createElement("div");
  granularDiv.className = "granular-objective-item";
  granularDiv.setAttribute("data-granular-id", granularId || `new-${Date.now()}-${Math.random()}`);
  granularDiv.style.cssText = "margin: 0; padding: 0;";
  // Trim the text value to remove any leading/trailing whitespace
  const trimmedText = text.trim();
  granularDiv.innerHTML = `<div style="display: flex; gap: 8px; align-items: flex-start;"><input type="text" class="text-input granular-objective-input" placeholder="Enter granular objective..." value="${trimmedText.replace(/"/g, '&quot;')}" style="flex: 1; padding: 10px;" /><button type="button" class="btn btn--danger btn--small remove-granular-btn" style="padding: 10px 12px;" title="Remove"><i class="fas fa-times"></i></button></div>`;

  container.appendChild(granularDiv);

  // Add remove button handler
  const removeBtn = granularDiv.querySelector(".remove-granular-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      granularDiv.remove();
    });
  }
}

async function handleCustomObjectiveSubmission() {
  const modal = document.getElementById("custom-objective-modal");
  const nameInput = document.getElementById("custom-objective-name");
  const container = document.getElementById("granular-objectives-container");
  const saveButton = document.getElementById("custom-modal-save");
  const modeInput = document.getElementById("custom-modal-mode");
  const objectiveIdInput = document.getElementById("custom-modal-objective-id");

  const mode = modeInput ? modeInput.value : "create";
  const objectiveId = objectiveIdInput ? objectiveIdInput.value : null;

  if (!nameInput || !nameInput.value.trim()) {
    showToast("Please enter a learning objective name", "warning");
    return;
  }

  // Collect granular objectives with IDs for edit mode
  const granularInputs = container.querySelectorAll(".granular-objective-input");
  const granularObjectives = [];
  granularInputs.forEach((input) => {
    const text = input.value.trim();
    if (text) {
      const granularItem = input.closest(".granular-objective-item");
      const granularId = granularItem ? granularItem.getAttribute("data-granular-id") : null;
      // Only include id if it's a valid MongoDB ObjectId (not a new item)
      if (granularId && granularId.startsWith("new-")) {
        granularObjectives.push({ text });
      } else if (granularId) {
        granularObjectives.push({ id: granularId, text });
      } else {
        granularObjectives.push({ text });
      }
    }
  });

  if (granularObjectives.length === 0) {
    showToast("Please add at least one granular objective", "warning");
    return;
  }

  // Collect selected materials
  const materialCheckboxes = document.querySelectorAll(".material-checkbox:checked");
  const selectedMaterials = Array.from(materialCheckboxes).map(cb => cb.value);

  // Disable button to prevent double submission
  const originalButtonText = saveButton ? saveButton.innerHTML : (mode === "edit" ? "Save Changes" : "Create");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML = mode === "edit" ? "Saving..." : "Creating...";
  }

  // Safety timeout to re-enable button if something hangs (30 seconds)
  const timeoutId = setTimeout(() => {
    console.error("Timeout: Button re-enabled after 30 seconds");
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = originalButtonText;
    }
  }, 30000);

  try {
    // Get courseId from state.course (which is stored as {id: courseId, name: courseName})
    const courseId = state.course ? state.course.id : JSON.parse(sessionStorage.getItem("grasp-selected-course")).id;
    
    const requestBody = {
      name: nameInput.value.trim(),
      granularObjectives: granularObjectives,
      materialIds: selectedMaterials,
      courseId: courseId,
    };

    console.log(`${mode === "edit" ? "Updating" : "Creating"} learning objective:`, {
      name: nameInput.value.trim(),
      granularCount: granularObjectives.length,
      mode: mode,
      objectiveId: objectiveId
    });

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout after 25 seconds")), 25000);
    });

    // Save to database with timeout - use PUT for edit, POST for create
    const url = mode === "edit" && objectiveId
      ? `/api/objective/${objectiveId}`
      : "/api/objective";
    const method = mode === "edit" ? "PUT" : "POST";

    console.log(`Sending ${method} request to ${url}...`);

    const fetchPromise = fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }).catch((fetchError) => {
      console.error("Fetch error:", fetchError);
      throw new Error(`Network error: ${fetchError.message}`);
    });

    console.log("Fetch request sent, waiting for response...");
    let response;
    try {
      response = await Promise.race([fetchPromise, timeoutPromise]);
      console.log("Response received:", response.status, response.statusText);
    } catch (raceError) {
      console.error("Request failed or timed out:", raceError);
      throw raceError;
    }

    // Parse response once - handle both success and error cases
    let data;
    try {
      const responseText = await response.text();
      console.log("Response text:", responseText);
      data = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      console.error("Error parsing response:", parseError);
      throw new Error("Invalid response from server");
    }

    if (!response.ok || !data.success) {
      const errorMessage = data.error || `Failed to ${mode === "edit" ? "update" : "create"} learning objective: ${response.status}`;
      console.error("Error response:", errorMessage);
      throw new Error(errorMessage);
    }

    console.log("Response data:", data);

    const objectiveName = nameInput.value.trim();

    if (mode === "edit" && currentEditGroupId) {
      // Update existing group in UI
      const group = state.objectiveGroups.find((g) => g.id === currentEditGroupId);
      if (group) {
        // Update the group title
        const groupNumber = state.objectiveGroups.findIndex((g) => g.id === currentEditGroupId) + 1;
        group.title = `Learning Objective ${groupNumber}: ${objectiveName}`;

        // Update granular objectives in the group
        if (data.granularObjectives && Array.isArray(data.granularObjectives)) {
          group.items = data.granularObjectives.map((granular, index) => ({
            id: parseFloat(`${groupNumber}.${index + 1}`),
            granularId: granular._id ? granular._id.toString() : null,
            text: granular.name || granular.text || "",
            bloom: [],
            minQuestions: 2,
            count: 2,
            mode: "manual",
            level: 1,
            selected: false,
          }));
        }
      }

      renderObjectiveGroups();
      hideModal(modal);
      showToast("Learning objective updated successfully", "success");
      announceToScreenReader(`Updated learning objective: ${objectiveName}`);
      currentEditGroupId = null;
    } else {
      // Create new group
      // Validate response data
      if (!data.objective) {
        throw new Error("Invalid response: objective data missing");
      }

      if (!data.objective._id) {
        throw new Error("Invalid response: objective ID missing");
      }

      if (!data.granularObjectives || !Array.isArray(data.granularObjectives)) {
        console.warn("No granular objectives in response, using empty array");
        data.granularObjectives = [];
      }

      // Add to UI
      const newGroupId = Date.now() + Math.random();
      const newGroupNumber = state.objectiveGroups.length + 1;

      const newGroup = {
        id: newGroupId,
        objectiveId: data.objective._id.toString(),
        metaId: `db-${data.objective._id}`,
        title: `Learning Objective ${newGroupNumber}: ${objectiveName}`,
        isOpen: true,
        selected: false,
        items: data.granularObjectives.map((granular, index) => ({
          id: parseFloat(`${newGroupNumber}.${index + 1}`),
          granularId: granular._id ? granular._id.toString() : null,
          text: granular.name || granular.text || "",
          bloom: [],
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

      showToast("Learning objective created successfully", "success");
      announceToScreenReader(
        `Added learning objective: ${objectiveName} with ${granularObjectives.length} granular objective${granularObjectives.length !== 1 ? 's' : ''}.`
      );

      // Refresh dropdown to include new objective
      try {
        await initializeAddObjectivesDropdown();
      } catch (dropdownError) {
        console.error("Error refreshing dropdown:", dropdownError);
        // Don't throw - this is not critical
      }
    }

    // Clear the form and hide modal
    nameInput.value = "";
    container.innerHTML = "";

    // Clear material selections
    const materialCheckboxes = document.querySelectorAll(".material-checkbox");
    materialCheckboxes.forEach(cb => cb.checked = false);

    hideModal(modal);
  } catch (error) {
    console.error(`Error ${mode === "edit" ? "updating" : "creating"} learning objective:`, error);
    showToast(error.message || `Failed to ${mode === "edit" ? "update" : "create"} learning objective`, "error");
  } finally {
    // Clear timeout
    clearTimeout(timeoutId);
    // Re-enable button
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = originalButtonText;
    }
  }
}

function hideModal(modal) {
  if (modal) {
    modal.style.display = "none";

    // Clear material selections if it's the custom objective modal
    if (modal.id === "custom-objective-modal") {
      const materialCheckboxes = document.querySelectorAll(".material-checkbox");
      materialCheckboxes.forEach(cb => cb.checked = false);
    }
  }
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
      // Get courseId from state.course
      const courseId = state.course ? state.course.id : JSON.parse(sessionStorage.getItem("grasp-selected-course")).id;
      const response = await fetch(`/api/objective/${objectiveId}/granular?courseId=${encodeURIComponent(courseId)}`);
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
        title: `Learning Objective ${newGroupNumber}: ${objectiveName}`,
        isOpen: true,
        selected: false,
        items: granularObjectives.map((granular, index) => ({
          id: parseFloat(`${newGroupNumber}.${index + 1}`),
          granularId: granular._id ? granular._id.toString() : null,
          text: granular.name,
          bloom: [],
          minQuestions: 2,
          count: 2,
          mode: "manual",
          level: 1,
          selected: false,
        })),
      };

      // If no granular objectives, add a default one
      if (newGroup.items.length === 0) {
        newGroup.items.push({
          id: parseFloat(`${newGroupNumber}.1`),
          text: "Draft granular objective (edit me).",
          bloom: [],
          minQuestions: 2,
          count: 2,
          mode: "manual",
          level: 1,
          selected: false,
        });
      }

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
  state.objectiveGroups.forEach((group, index) => {
    const groupNumber = index + 1;
    const titleMatch = group.title.match(/^Learning Objective \d+: (.+)$/);
    if (titleMatch) {
      group.title = `Learning Objective ${groupNumber}: ${titleMatch[1]}`;
    }
  });
}

// ===== DELETE OBJECTIVE GROUP FUNCTION =====

function deleteObjectiveGroup(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  // Remove the group
  state.objectiveGroups = state.objectiveGroups.filter(
    (g) => g.id !== groupId
  );

  // Renumber remaining groups
  renumberObjectiveGroups();

  // Update UI
  renderObjectiveGroups();

  // Update dropdown to re-enable deleted objective
  updateDropdownDisabledState();

  // Announce deletion
  announceToScreenReader(`Deleted ${group.title} from page.`);
}

function deleteGranularObjective(groupId, itemId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const item = group.items.find((i) => i.id === itemId);
  if (!item) return;

  // Remove the item from the group
  group.items = group.items.filter((i) => i.id !== itemId);

  // Update UI
  renderObjectiveGroups();

  // Announce deletion
  announceToScreenReader(`Deleted granular objective: ${item.text}`);
}

// ===== GRANULAR SELECTION FUNCTIONS =====

function toggleGranularSelection(groupId, itemId) {
  console.log(
    "toggleGranularSelection called with groupId:",
    groupId,
    "itemId:",
    itemId
  );
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) {
    console.error("Group not found:", groupId);
    return;
  }

  const item = group.items.find((i) => i.id === itemId);
  if (!item) {
    console.error("Item not found:", itemId);
    return;
  }

  console.log("Found item:", item, "current selected state:", item.selected);
  item.selected = !item.selected;
  console.log("Item selected state changed to:", item.selected);

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
  console.log("updateGranularToolbar called with groupId:", groupId);
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) {
    console.error("Group not found for toolbar update:", groupId);
    return;
  }

  const toolbar = document.getElementById(`granular-toolbar-${groupId}`);
  const selectionCount = document.querySelector(
    `#granular-toolbar-${groupId} .granular-selection-count`
  );
  const selectAllCheckbox = document.querySelector(
    `#granular-toolbar-${groupId} .select-all-granular-checkbox`
  );

  console.log("Toolbar elements found:", {
    toolbar: !!toolbar,
    selectionCount: !!selectionCount,
    selectAllCheckbox: !!selectAllCheckbox,
  });

  if (toolbar && selectionCount && selectAllCheckbox) {
    const selectedCount = group.items.filter((item) => item.selected).length;
    const allSelected =
      group.items.length > 0 && group.items.every((item) => item.selected);

    console.log("Selection state:", { selectedCount, allSelected });

    // Show/hide toolbar based on selection
    toolbar.style.display = selectedCount > 0 ? "flex" : "none";

    // Update selection count
    selectionCount.textContent = `${selectedCount} selected`;

    // Update select all checkbox
    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = selectedCount > 0 && !allSelected;

    console.log("Toolbar updated, display set to:", toolbar.style.display);
  } else {
    console.error("Some toolbar elements not found for group:", groupId);
    console.log("Available elements:", {
      toolbar: toolbar,
      selectionCount: selectionCount,
      selectAllCheckbox: selectAllCheckbox,
    });
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
  console.log("showGranularizationModal called with groupId:", groupId);
  console.log("GroupId type:", typeof groupId, "Value:", groupId);
  console.log(
    "Current state.objectiveGroups:",
    state.objectiveGroups.map((g) => ({ id: g.id, type: typeof g.id }))
  );

  const modal = document.getElementById("granularization-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.dataset.groupId = groupId;
    console.log("Modal displayed, groupId set to:", modal.dataset.groupId);
    console.log("Modal dataset groupId type:", typeof modal.dataset.groupId);

    // Focus the modal
    const closeBtn = document.getElementById("granularization-modal-close");
    if (closeBtn) closeBtn.focus();
  } else {
    console.error("Granularization modal not found!");
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
  console.log("confirmGranularization called");
  const modal = document.getElementById("granularization-modal");
  const groupId = parseInt(modal.dataset.groupId);

  console.log("Modal groupId (raw):", modal.dataset.groupId);
  console.log("Modal groupId (parsed):", groupId);

  if (!groupId || isNaN(groupId)) {
    console.error("Invalid groupId found in modal:", modal.dataset.groupId);
    return;
  }

  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) {
    console.error("Group not found for ID:", groupId);
    console.log(
      "Available group IDs:",
      state.objectiveGroups.map((g) => g.id)
    );
    return;
  }

  console.log("Found group:", group);
  console.log("Group ID type:", typeof group.id, "Value:", group.id);

  const selectedItems = group.items.filter((item) => item.selected);
  console.log("Selected items:", selectedItems);

  if (selectedItems.length === 0) {
    console.error("No items selected");
    return;
  }

  // Get modal options
  const countPerItem = parseInt(
    document.querySelector('input[name="granular-count"]:checked').value
  );
  const useDefaults = document.getElementById("use-defaults").checked;

  console.log(
    "Modal options - countPerItem:",
    countPerItem,
    "useDefaults:",
    useDefaults
  );

  // Create sub-LOs for each selected item
  let totalSubLOs = 0;

  selectedItems.forEach((item) => {
    const subLOs = createSubLOs(item, countPerItem, useDefaults);
    console.log("Created subLOs for item", item.id, ":", subLOs);
    group.items.push(...subLOs);
    totalSubLOs += subLOs.length;
  });

  console.log("Total subLOs created:", totalSubLOs);
  console.log("Group items after creation:", group.items);

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
  }

}

function createObjectiveGroup(group) {
  const groupElement = document.createElement("div");
  groupElement.className = `objective-group ${group.isOpen ? "objective-group--expanded" : "objective-group--collapsed"
    }`;
  groupElement.setAttribute("data-group-id", group.id);

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
      : "";

  console.log(
    "Creating objective group HTML for group:",
    group.id,
    "with",
    group.items.length,
    "items"
  );
  groupElement.innerHTML = `
        <div class="objective-group__header">
            <div class="objective-group__header-left">
                <button type="button" 
                    class="objective-group__delete-btn" 
                    onclick="deleteObjectiveGroup(${group.id})"
                    title="Delete learning objective from page"
                    aria-label="Delete ${group.title}"
                >
                    <i class="fas fa-trash-alt"></i>
                </button>
                <h3 class="objective-group__title" 
                    tabindex="0" 
                    onclick="toggleObjectiveGroup(${group.id})"
                >${group.title}</h3>
            </div>
            <div class="objective-group__header-right">
                ${group.objectiveId ? `
                <button type="button" 
                    class="objective-group__edit-btn" 
                    onclick="editMetaObjective(${group.id})"
                    title="Edit learning objective"
                    aria-label="Edit ${group.title}"
                >
                    <i style="margin-right: 5px;" class="fas fa-pencil-alt"></i>
                    Edit
                </button>
                ` : ''}
                <div class="objective-group__toggle" onclick="toggleObjectiveGroup(${group.id
    })">
                    <span>${itemCount} objectives</span>
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
            ${itemCount > 0
      ? `
                <div class="objective-group__footer ${isWarning ? "objective-group__footer--warning" : ""
      }">
                    Total: ${totalCount} Required minimum: 5 (${totalCount >= 5 ? "≥5" : "<5"
      })
                </div>
            `
      : ""
    }
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
        <span>Please select a Bloom level</span>
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
            <div class="objective-item__content">
                <div class="objective-item__header">
                    <div class="objective-item__text">
                        ${item.text}
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

// Store current editing state
let currentEditGroupId = null;

async function editMetaObjective(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group || !group.objectiveId) {
    showToast("Cannot edit this learning objective", "warning");
    return;
  }

  // Extract the objective name from the title (remove "Learning Objective X: " prefix)
  const titleMatch = group.title.match(/^Learning Objective \d+: (.+)$/);
  const currentName = titleMatch ? titleMatch[1] : group.title;

  // Use the shared modal in edit mode
  currentEditGroupId = groupId;
  showCustomObjectiveModal("edit", {
    objectiveId: group.objectiveId,
    name: currentName,
    granularObjectives: group.items || [],
  });
}


function initializeModals() {
  // Custom objective modal
  const customModal = document.getElementById("custom-objective-modal");
  const customModalClose = document.getElementById("custom-modal-close");
  const customModalCancel = document.getElementById("custom-modal-cancel");
  const customModalSave = document.getElementById("custom-modal-save");
  const addGranularBtn = document.getElementById("add-granular-btn");

  if (customModalClose) {
    customModalClose.addEventListener("click", () => hideModal(customModal));
  }
  if (customModalCancel) {
    customModalCancel.addEventListener("click", () => hideModal(customModal));
  }
  if (customModalSave) {
    customModalSave.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Create button clicked");
      handleCustomObjectiveSubmission();
    });
  }
  if (addGranularBtn) {
    addGranularBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      addGranularObjectiveInput();
    });
  }

  // Delete confirmation modal
  const deleteModal = document.getElementById("delete-confirmation-modal");
  const deleteModalClose = document.getElementById("delete-modal-close");
  const deleteModalCancel = document.getElementById("delete-modal-cancel");
  const deleteModalConfirm = document.getElementById("delete-modal-confirm");

  if (deleteModalClose) {
    deleteModalClose.addEventListener("click", () => hideModal(deleteModal));
  }
  if (deleteModalCancel) {
    deleteModalCancel.addEventListener("click", () => hideModal(deleteModal));
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

// ===== STEP 3: EXPORT FORMAT FUNCTIONS =====

function initializeExportFormat() {
  const exportOptions = document.querySelectorAll(
    'input[name="export-format"]'
  );

  exportOptions.forEach((option) => {
    option.addEventListener("change", (e) => {
      state.exportFormat = e.target.value;
    });
  });
}

function renderQuestions() {
  const questionsList = document.getElementById("questions-list");
  if (!questionsList) return;

  questionsList.innerHTML = "";

  state.questions.forEach((question) => {
    const questionItem = createQuestionItem(question);
    questionsList.appendChild(questionItem);
  });
}

function createQuestionItem(question) {
  const options = question.options
    .map((option, index) => {
      const isCorrect = index === question.correctAnswer;
      return `<li class="question-item__option ${isCorrect ? "question-item__option--correct" : ""
        }">${option}</li>`;
    })
    .join("");

  item.innerHTML = `
        <div class="question-item__header">
            <div class="question-item__metadata">
                <span>Bloom: ${question.bloomLevel}</span>
                <span>Difficulty: ${question.difficulty}</span>
                <span>Type: ${question.type}</span>
            </div>
        </div>
        <div class="question-item__text">${question.text}</div>
        <ul class="question-item__options">
            ${options}
        </ul>
    `;

  return item;
}

// ===== STEP 3: SELECT OUTPUT FORMAT FUNCTIONS =====

function initializeStep3() {
  console.log("initializeStep3 called");

  // Set up event listeners for Step 3
  setupStep3EventListeners();

  // Initialize the view
  updateStep3UI();

  // Ensure initial state is reflected in UI
  updateSelectedFormatsCount();
  updateExportButtonState();
  updateNamingConventionPanel();

  console.log("Step 3 initialized with state:", {
    formats: state.formats,
    namingConvention: state.namingConvention,
    saveAsDefault: state.saveAsDefault,
  });
}

function setupStep3EventListeners() {
  // Format selection checkboxes
  const canvasSingleCheckbox = document.getElementById(
    "canvas-single-checkbox"
  );
  const canvasSpacedCheckbox = document.getElementById(
    "canvas-spaced-checkbox"
  );
  const h5pCheckbox = document.getElementById("h5p-checkbox");

  if (canvasSingleCheckbox)
    canvasSingleCheckbox.addEventListener("change", handleFormatSelection);
  if (canvasSpacedCheckbox)
    canvasSpacedCheckbox.addEventListener("change", handleFormatSelection);
  if (h5pCheckbox)
    h5pCheckbox.addEventListener("change", handleFormatSelection);

  // Release immediately toggles
  const canvasSingleReleaseNow = document.getElementById(
    "canvas-single-release-now"
  );
  const canvasSpacedReleaseNow = document.getElementById(
    "canvas-spaced-release-now"
  );

  if (canvasSingleReleaseNow)
    canvasSingleReleaseNow.addEventListener("change", handleReleaseNowToggle);
  if (canvasSpacedReleaseNow)
    canvasSpacedReleaseNow.addEventListener("change", handleReleaseNowToggle);

  // Date and time inputs
  const dateInputs = document.querySelectorAll(".date-input");
  const timeInputs = document.querySelectorAll(".time-input");

  dateInputs.forEach((input) =>
    input.addEventListener("change", handleDateChange)
  );
  timeInputs.forEach((input) =>
    input.addEventListener("change", handleTimeChange)
  );

  // Naming convention select
  const namingConventionSelect = document.getElementById(
    "naming-convention-select"
  );
  if (namingConventionSelect)
    namingConventionSelect.addEventListener(
      "change",
      handleNamingConventionChange
    );

  // Save as default checkbox
  const saveAsDefaultCheckbox = document.getElementById("save-as-default");
  if (saveAsDefaultCheckbox)
    saveAsDefaultCheckbox.addEventListener("change", handleSaveAsDefaultChange);

  // Export summary modal
  const exportSummaryModalClose = document.getElementById(
    "export-summary-modal-close"
  );
  const exportSummaryConfirm = document.getElementById(
    "export-summary-confirm"
  );

  if (exportSummaryModalClose)
    exportSummaryModalClose.addEventListener("click", hideExportSummaryModal);
  if (exportSummaryConfirm)
    exportSummaryConfirm.addEventListener("click", hideExportSummaryModal);

  // Make entire cards clickable
  const exportOptionCards = document.querySelectorAll(".export-option-card");
  exportOptionCards.forEach((card) => {
    card.addEventListener("click", (e) => {
      // Don't trigger if clicking on checkbox or input
      if (
        e.target.type === "checkbox" ||
        e.target.tagName === "INPUT" ||
        e.target.tagName === "SELECT"
      ) {
        return;
      }

      const checkbox = card.querySelector(".export-option-card__checkbox");
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        handleFormatSelection();
      }
    });
  });
}

function handleFormatSelection() {
  const canvasSingleCheckbox = document.getElementById(
    "canvas-single-checkbox"
  );
  const canvasSpacedCheckbox = document.getElementById(
    "canvas-spaced-checkbox"
  );
  const h5pCheckbox = document.getElementById("h5p-checkbox");

  // Update state
  state.formats.canvasSingle.selected = canvasSingleCheckbox
    ? canvasSingleCheckbox.checked
    : false;
  state.formats.canvasSpaced.selected = canvasSpacedCheckbox
    ? canvasSpacedCheckbox.checked
    : false;
  state.formats.h5p.selected = h5pCheckbox ? h5pCheckbox.checked : false;

  console.log("Format selection updated:", {
    canvasSingle: state.formats.canvasSingle.selected,
    canvasSpaced: state.formats.canvasSpaced.selected,
    h5p: state.formats.h5p.selected,
  });

  // Update UI
  updateStep3UI();
  updateExportButtonState();
}

function handleReleaseNowToggle() {
  const canvasSingleReleaseNow = document.getElementById(
    "canvas-single-release-now"
  );
  const canvasSpacedReleaseNow = document.getElementById(
    "canvas-spaced-release-now"
  );

  // Update state
  state.formats.canvasSingle.releaseNow = canvasSingleReleaseNow
    ? canvasSingleReleaseNow.checked
    : false;
  state.formats.canvasSpaced.releaseNow = canvasSpacedReleaseNow
    ? canvasSpacedReleaseNow.checked
    : false;

  // Update UI
  updateScheduleControls();
}

function handleDateChange() {
  const canvasSingleDate = document.getElementById(
    "canvas-single-release-date"
  );
  const canvasSpacedDate = document.getElementById(
    "canvas-spaced-release-date"
  );

  // Update state
  state.formats.canvasSingle.date = canvasSingleDate
    ? canvasSingleDate.value
    : "";
  state.formats.canvasSpaced.date = canvasSpacedDate
    ? canvasSpacedDate.value
    : "";

  // Validate dates
  validateDates();
}

function handleTimeChange() {
  const canvasSingleTime = document.getElementById(
    "canvas-single-release-time"
  );
  const canvasSpacedTime = document.getElementById(
    "canvas-spaced-release-time"
  );

  // Update state
  state.formats.canvasSingle.time = canvasSingleTime
    ? canvasSingleTime.value
    : "";
  state.formats.canvasSpaced.time = canvasSpacedTime
    ? canvasSpacedTime.value
    : "";
}

function handleNamingConventionChange() {
  const namingConventionSelect = document.getElementById(
    "naming-convention-select"
  );
  if (namingConventionSelect) {
    state.namingConvention = namingConventionSelect.value;
    updateNamingConventionPreview();
  }
}

function handleSaveAsDefaultChange() {
  const saveAsDefaultCheckbox = document.getElementById("save-as-default");
  if (saveAsDefaultCheckbox) {
    state.saveAsDefault = saveAsDefaultCheckbox.checked;
  }
}

function updateStep3UI() {
  console.log("updateStep3UI called");
  updateSelectedFormatsCount();
  updateCardSelectionStates();
  updateNamingConventionPanel();
  updateScheduleControls();
  updateExportButtonState();
}

function updateSelectedFormatsCount() {
  // Calculate count based on actual checkbox states
  const canvasSingleSelected = state.formats.canvasSingle.selected;
  const canvasSpacedSelected = state.formats.canvasSpaced.selected;
  const h5pSelected = state.formats.h5p.selected;

  const count = [
    canvasSingleSelected,
    canvasSpacedSelected,
    h5pSelected,
  ].filter(Boolean).length;

  const countElement = document.getElementById("selected-formats-count");
  if (countElement) {
    countElement.textContent = count;
  }

  console.log(
    "Selected formats count updated:",
    count,
    "Canvas Single:",
    canvasSingleSelected,
    "Canvas Spaced:",
    canvasSpacedSelected,
    "H5P:",
    h5pSelected
  );
}

function updateCardSelectionStates() {
  const cards = document.querySelectorAll(".export-option-card");
  cards.forEach((card) => {
    const format = card.dataset.format;
    const checkbox = card.querySelector(".export-option-card__checkbox");

    if (checkbox && checkbox.checked) {
      card.classList.add("export-option-card--selected");
    } else {
      card.classList.remove("export-option-card--selected");
    }
  });
}

function updateNamingConventionPanel() {
  const namingConventionPanel = document.getElementById(
    "naming-convention-panel"
  );
  const hasCanvasFormat =
    state.formats.canvasSingle.selected || state.formats.canvasSpaced.selected;

  if (namingConventionPanel) {
    namingConventionPanel.style.display = hasCanvasFormat ? "block" : "none";
    console.log(
      "Naming convention panel visibility:",
      hasCanvasFormat ? "visible" : "hidden"
    );

    // Update the preview when the panel becomes visible
    if (hasCanvasFormat) {
      updateNamingConventionPreview();
    }
  }
}

function updateScheduleControls() {
  // Canvas Single
  const canvasSingleScheduleControls = document.getElementById(
    "canvas-single-schedule-controls"
  );
  if (canvasSingleScheduleControls) {
    if (state.formats.canvasSingle.releaseNow) {
      canvasSingleScheduleControls.classList.add("schedule-controls--disabled");
    } else {
      canvasSingleScheduleControls.classList.remove(
        "schedule-controls--disabled"
      );
    }
  }

  // Canvas Spaced
  const canvasSpacedScheduleControls = document.getElementById(
    "canvas-spaced-schedule-controls"
  );
  if (canvasSpacedScheduleControls) {
    if (state.formats.canvasSpaced.releaseNow) {
      canvasSpacedScheduleControls.classList.add("schedule-controls--disabled");
    } else {
      canvasSpacedScheduleControls.classList.remove(
        "schedule-controls--disabled"
      );
    }
  }
}

function updateNamingConventionPreview() {
  const exampleElement = document.getElementById("naming-convention-example");
  if (!exampleElement) return;

  switch (state.namingConvention) {
    case "course_quiz":
      exampleElement.textContent = "CHEM 101 – Quiz 1";
      break;
    case "module_week_quiz":
      exampleElement.textContent = "Week 05 – Quiz";
      break;
    case "topic_date":
      exampleElement.textContent = "Thermodynamics – 2024-01-15";
      break;
    default:
      exampleElement.textContent = "Week 05 – Quiz";
  }
}

function validateDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Validate Canvas Single date
  if (
    state.formats.canvasSingle.date &&
    !state.formats.canvasSingle.releaseNow
  ) {
    const selectedDate = new Date(state.formats.canvasSingle.date);
    if (selectedDate < today) {
      showDateWarning(
        "canvas-single-release-date",
        "Date cannot be in the past"
      );
    } else {
      hideDateWarning("canvas-single-release-date");
    }
  }

  // Validate Canvas Spaced date
  if (
    state.formats.canvasSpaced.date &&
    !state.formats.canvasSpaced.releaseNow
  ) {
    const selectedDate = new Date(state.formats.canvasSpaced.date);
    if (selectedDate < today) {
      showDateWarning(
        "canvas-spaced-release-date",
        "Date cannot be in the past"
      );
    } else {
      hideDateWarning("canvas-spaced-release-date");
    }
  }
}

function showDateWarning(dateInputId, message) {
  const dateInput = document.getElementById(dateInputId);
  if (dateInput) {
    // Remove existing warning
    const existingWarning = dateInput.parentNode.querySelector(".date-warning");
    if (existingWarning) {
      existingWarning.remove();
    }

    // Add new warning
    const warning = document.createElement("div");
    warning.className = "date-warning";
    warning.textContent = message;
    warning.style.color = "#e74c3c";
    warning.style.fontSize = "12px";
    warning.style.marginTop = "4px";
    dateInput.parentNode.appendChild(warning);
  }
}

function hideDateWarning(dateInputId) {
  const dateInput = document.getElementById(dateInputId);
  if (dateInput) {
    const existingWarning = dateInput.parentNode.querySelector(".date-warning");
    if (existingWarning) {
      existingWarning.remove();
    }
  }
}

function updateExportButtonState() {
  const continueBtn = document.getElementById("continue-btn");
  if (continueBtn) {
    // Check if any format is selected
    const hasSelectedFormats =
      state.formats.canvasSingle.selected ||
      state.formats.canvasSpaced.selected ||
      state.formats.h5p.selected;

    continueBtn.disabled = !hasSelectedFormats;

    console.log("Export button state updated:", {
      hasSelectedFormats,
      disabled: !hasSelectedFormats,
      canvasSingle: state.formats.canvasSingle.selected,
      canvasSpaced: state.formats.canvasSpaced.selected,
      h5p: state.formats.h5p.selected,
    });

    if (state.step === 3) {
      continueBtn.textContent = "Export Now";
    }
  }
}

function showExportSummaryModal() {
  const modal = document.getElementById("export-summary-modal");
  const modalBody = document.getElementById("export-summary-modal-body");

  if (modal && modalBody) {
    modalBody.innerHTML = generateExportSummaryHTML();
    modal.style.display = "flex";

    // Focus trap
    const closeBtn = document.getElementById("export-summary-modal-close");
    if (closeBtn) closeBtn.focus();
  }
}

function hideExportSummaryModal() {
  const modal = document.getElementById("export-summary-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function generateExportSummaryHTML() {
  let html = '<div class="export-summary">';

  // Selected formats
  html += "<h4>Selected Formats:</h4><ul>";
  if (state.formats.canvasSingle.selected) {
    html += "<li>Canvas (single quiz)";
    if (state.formats.canvasSingle.releaseNow) {
      html += " - Release immediately";
    } else {
      html += ` - Scheduled for ${state.formats.canvasSingle.date}${state.formats.canvasSingle.time
        ? ` at ${state.formats.canvasSingle.time}`
        : ""
        }`;
    }
    html += "</li>";
  }

  if (state.formats.canvasSpaced.selected) {
    html += "<li>Canvas (spaced review quiz)";
    if (state.formats.canvasSpaced.releaseNow) {
      html += " - Release immediately";
    } else {
      html += ` - Scheduled for ${state.formats.canvasSpaced.date}${state.formats.canvasSpaced.time
        ? ` at ${state.formats.canvasSpaced.time}`
        : ""
        }`;
    }
    html += "</li>";
  }

  if (state.formats.h5p.selected) {
    html += "<li>H5P (individual elements)</li>";
  }
  html += "</ul>";

  // Naming convention
  if (
    state.formats.canvasSingle.selected ||
    state.formats.canvasSpaced.selected
  ) {
    html += "<h4>Canvas Naming Convention:</h4>";
    html += `<p>${getNamingConventionDisplayText()}</p>`;
  }

  // Save as default
  if (state.saveAsDefault) {
    html += "<h4>Settings:</h4>";
    html += "<p>Save export settings as default</p>";
  }

  html += "</div>";
  return html;
}

function getNamingConventionDisplayText() {
  switch (state.namingConvention) {
    case "course_quiz":
      return "Course – Quiz 1, 2, 3…";
    case "module_week_quiz":
      return "Module Week – Quiz";
    case "topic_date":
      return "Topic – YYYY-MM-DD";
    default:
      return "Module Week – Quiz";
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
  console.log("=== GENERATING QUESTIONS FROM CONTENT ===");
  console.log("Summary length:", state.summary.length);
  console.log("Objective groups:", state.objectiveGroups.length);

  // Show loading UI
  setGenerationUI(true);

  try {
    // Generate questions using the question generator
    const questions = await questionGenerator.generateQuestions(
      state.course,
      state.objectiveGroups
    );

    console.log("Generated questions:", questions.length);

    // Convert questions to question groups format
    state.questionGroups = convertQuestionsToGroups(questions);

    console.log("Question groups created:", state.questionGroups.length);

    // Update the UI
    renderStep2();
  } catch (error) {
    console.error("Failed to generate questions from content:", error);

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
  console.log("Retrying question generation...");
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
      // Calculate stats for the group
      const totalQuestions = groupQuestions.length;
      const totalCount = groupQuestions.reduce(
        (sum, q) => sum + (q.count || 1),
        0
      );
      const BLOOMLEVELS = [...new Set(groupQuestions.map((q) => q.bloomLevel))];

      const group = {
        id: index + 1,
        title: metaCode,
        isOpen: index === 0,
        stats: {
          configured: totalQuestions,
          min: Math.max(1, Math.floor(totalQuestions * 0.6)), // At least 60% of questions
          bloomSummary: BLOOMLEVELS.slice(0, 3).join("/"), // First 3 bloom levels
        },
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
                  text: question.options[0] || "Option A",
                  feedback: "A Incorrect",
                },
                B: {
                  id: "B",
                  text: question.options[1] || "Option B",
                  feedback: "B Incorrect",
                },
                C: {
                  id: "C",
                  text: question.options[2] || "Option C",
                  feedback: "C Correct",
                },
                D: {
                  id: "D",
                  text: question.options[3] || "Option D",
                  feedback: "D Incorrect",
                },
              },
              correctAnswer: question.correctAnswer || 0,
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
  console.log("step2 called");

  // Clear any existing questions
  state.questions = [];
  state.questionGroups = [];

  // Generate questions from uploaded content instead of loading sample data
  if (state.objectiveGroups.length > 0) {
    console.log("Generating questions from uploaded content...");
    generateQuestionsFromContent();
  } else {
    console.log("No content available for question generation");
    // Load sample data only if no real content
    state.questionGroups = JSON.parse(JSON.stringify(SAMPLE_QUESTION_DATA));
    console.log(
      "Sample data loaded, questionGroups length:",
      state.questionGroups.length
    );
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
  const exportBtn = document.getElementById("export-btn");
  const addToBankBtn = document.getElementById("add-to-bank-btn");

  if (regenerateAllBtn)
    regenerateAllBtn.addEventListener("click", handleRegenerateAll);
  if (exportBtn) exportBtn.addEventListener("click", handleExport);
  if (addToBankBtn) addToBankBtn.addEventListener("click", handleAddToBank);

  // Export dropdown
  const exportDropdownClose = document.getElementById("export-dropdown-close");
  if (exportDropdownClose)
    exportDropdownClose.addEventListener("click", hideExportDropdown);

  // Export option buttons
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("export-option-btn")) {
      handleExportFormat(e.target.dataset.format);
    }
  });
}

function renderStep2() {
  renderQuestionGroups();
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
                <p class="question-card__stem">${question.stem}</p>
                <div class="question-card__options">
                    ${Object.values(question.options)
      .map(
        (option) => `
                        <div class="question-card__option ${isEditing ? "question-card__option--editing" : ""
          }">
                            <input type="radio" name="q-${question.id
          }" value="${option.id}" ${option.isCorrect ? "checked" : ""
          } disabled>
                            ${isEditing
            ? `<input type="text" value="${option.text}" onblur="saveOptionEdit('${question.id}', '${option.id}', this.value)">`
            : `<label>${option.id}. ${option.text}</label>`
          }
                        </div>
                        <div class="question-card__feedback">${option.id} ${option.isCorrect ? "Correct" : "Incorrect"
          } — ${option.feedback}</div>
                    `
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
                            ${
                              question.flagStatus === false
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
  console.log("=== REGENERATING ALL QUESTIONS FROM CONTENT ===");

  const ui = getStep2UIElements();

  // Update button state
  if (ui.regenerateAllBtn) {
    ui.regenerateAllBtn.textContent = "Regenerating...";
    ui.regenerateAllBtn.disabled = true;
  }

  // Show loading UI
  setGenerationUI(true);

  try {
    // Clear existing questions
    state.questions = [];
    state.questionGroups = [];

    // Generate new questions from content
    await generateQuestionsFromContent();

    console.log("Questions regenerated successfully");
    showToast("Questions regenerated from uploaded content", "success");
  } catch (error) {
    console.error("Failed to regenerate questions:", error);
    showQuestionGenerationError(error.message);
  } finally {
    // Restore button state
    if (ui.regenerateAllBtn) {
      ui.regenerateAllBtn.textContent = 'Questions added to the Bank';
      ui.regenerateAllBtn.disabled = false;
    }

    // Hide loading UI (renderStep2 will handle empty-state)
    setGenerationUI(false);
  }
}

function handleExport() {
  showExportDropdown();
}

function showExportDropdown() {
  const exportDropdown = document.getElementById("export-dropdown");
  if (exportDropdown) {
    exportDropdown.style.display = "block";
  }
}

function hideExportDropdown() {
  const exportDropdown = document.getElementById("export-dropdown");
  if (exportDropdown) {
    exportDropdown.style.display = "none";
  }
}

function handleExportFormat(format) {
  hideExportDropdown();
  showToast(`Export prepared as ${format.toUpperCase()}`, "success");
}

async function handleAddToBank() {
  for (const group of state.questionGroups) {
    for (const lo of group.los) {
      for (const question of lo.questions) {
        await handleAddQuestionToBank(question);
      }
    }
  }

  showToast("Questions added to Question Bank", "success");
}

async function handleAddQuestionToBank(question) {
  console.log("Adding question to question bank:", question);
  // Adding questions to question bank.
  try {
    const response = await fetch(`/api/question/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: question,
        courseId: state.course.id ? state.course.id : JSON.parse(sessionStorage.getItem("grasp-selected-course")).id,
      }),
    });

    if (response.ok) {
      showToast(
        `Added 1 question to Question Bank`,
        "success"
      );

      // Disable AddToBank button
      const addToBankBtn = document.getElementById("add-to-bank-btn");
      if (addToBankBtn) addToBankBtn.disabled = true;
    }
  } catch (error) {
    console.error("Failed to add question to Question Bank:", error);
    showToast("Failed to add question to Question Bank", "error");
  }
}

function editQuestion(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    question.isEditing = !question.isEditing;
    renderQuestionGroups();
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

function saveQuestionEdit(questionId) {
  const question = findQuestionById(questionId);
  if (!question) {
    showToast("Question not found", "error");
    return;
  }

  // Simply update state - mark as not editing and update timestamp
  question.isEditing = false;
  question.lastEdited = new Date().toISOString().slice(0, 16).replace("T", " ");
  
  // Render the question groups
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

// ===== STEP 3: EXPORT FUNCTIONS =====

async function exportQuestions() {
  const format = state.exportFormat;

  try {
    const response = await fetch(`/api/question/export?format=${format}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        course: state.course,
        summary: state.summary,
        objectives: state.objectiveGroups, // Export the full objectiveGroups array
        questions: state.questions,
      }),
    });

    if (response.ok) {
      const blob = await response.blob();
      downloadFile(
        blob,
        `questions-${state.course}-${format}.${getFileExtension(format)}`
      );
    } else {
      throw new Error("Export failed");
    }
  } catch (error) {
    console.error("Export failed:", error);
    if (DEV_MODE) {
      // Mock export for development
      const mockData = createMockExportData();
      const blob = new Blob([mockData], { type: getMimeType(format) });
      downloadFile(
        blob,
        `questions-${state.course}-${format}.${getFileExtension(format)}`
      );
    } else {
      alert("Export failed. Please try again.");
    }
  }
}

function createMockExportData() {
  const format = state.exportFormat;

  switch (format) {
    case "csv":
      return createMockCSV();
    case "json":
      return createMockJSON();
    case "qti":
    default:
      return createMockQTI();
  }
}

function createMockCSV() {
  let csv =
    "Question,Option A,Option B,Option C,Option D,Correct Answer,Bloom Level,Difficulty\n";
  state.questions.forEach((q) => {
    csv += `"${q.text}","${q.options[0]}","${q.options[1]}","${q.options[2]
      }","${q.options[3]}","${q.options[q.correctAnswer]}","${q.bloomLevel}","${q.difficulty
      }"\n`;
  });
  return csv;
}

function createMockJSON() {
  return JSON.stringify(
    {
      course: state.course,
      summary: state.summary,
      objectives: state.objectiveGroups, // Export the full objectiveGroups array
      questions: state.questions,
    },
    null,
    2
  );
}

function createMockQTI() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="GRASP_QUESTIONS" title="${state.course} Questions">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>qmd_timelimit</fieldlabel>
        <fieldentry>PT30M</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
  </assessment>
</questestinterop>`;
}

function getFileExtension(format) {
  switch (format) {
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "qti":
      return "xml";
    default:
      return "txt";
  }
}

function getMimeType(format) {
  switch (format) {
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "qti":
      return "application/xml";
    default:
      return "text/plain";
  }
}

function downloadFile(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
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
window.incrementCount = incrementCount;
window.decrementCount = decrementCount;
window.editMetaObjective = editMetaObjective;
window.deleteObjectiveGroup = deleteObjectiveGroup;
window.deleteGranularObjective = deleteGranularObjective;
window.toggleGranularSelection = toggleGranularSelection;
window.selectAllGranularInGroup = selectAllGranularInGroup;
window.deleteSelectedGranular = deleteSelectedGranular;
window.showGranularizationModal = showGranularizationModal;
window.regenerateAllObjectivesFromContent = regenerateAllObjectivesFromContent;

// Test function for PDF parsing
window.testPDFParsing = async function (file) {
  console.log("Testing PDF parsing...");
  console.log("PDF service:", pdfService);

  if (!pdfService) {
    console.error("PDF service not available!");
    return;
  }

  if (!file) {
    console.error("No file provided!");
    return;
  }

  try {
    const result = await pdfService.parsePDF(file);
    console.log("PDF parsing result:", result);
    return result;
  } catch (error) {
    console.error("PDF parsing test failed:", error);
    return null;
  }
};

// Step 2 function exports
window.editQuestion = editQuestion;
window.saveQuestionEdit = saveQuestionEdit;
window.saveOptionEdit = saveOptionEdit;
window.updateQuestionTitle = updateQuestionTitle;
window.updateQuestionOption = updateQuestionOption;
window.toggleQuestionFlag = toggleQuestionFlag;
window.deleteQuestion = deleteQuestion;

// Step 3 function exports
window.handleFormatSelection = handleFormatSelection;
window.handleReleaseNowToggle = handleReleaseNowToggle;
window.handleDateChange = handleDateChange;
window.handleTimeChange = handleTimeChange;
window.handleNamingConventionChange = handleNamingConventionChange;
window.handleSaveAsDefaultChange = handleSaveAsDefaultChange;
