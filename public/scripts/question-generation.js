// Question Generation JavaScript
// State management and functionality for the 5-step question generation process

// Development flag for mock API responses
const DEV_MODE = true;

// Content and Question Generation Modules
let contentGenerator = null;
let questionGenerator = null;
let pdfService = null;

// Main state object
const state = {
  step: 1,
  course: "",
  selectedCourse: "", // Global course selection for Steps 2-5
  files: [],
  urls: [],
  summary: "",
  objectives: [],
  questions: [],
  exportFormat: "qti",
  objectiveGroups: [], // New for Step 3
  objectiveToDelete: null, // New for Step 3
  selectedGroupIds: new Set(), // New for Step 3 multi-select
  // Step 4: Question Generation
  questionGroups: [], // Meta LO groups with granular LOs and questions
  selectedQuestions: new Set(), // Set of selected question IDs
  filters: {
    glo: "all",
    bloom: "all",
    status: "all",
    q: "", // search query
  },
  // Step 5: Select Output Format
  formats: {
    canvasSingle: { selected: false, releaseNow: true, date: "", time: "" },
    canvasSpaced: { selected: false, releaseNow: true, date: "", time: "" },
    h5p: { selected: false },
  },
  namingConvention: "module_week_quiz",
  saveAsDefault: false,
};

// Step titles for dynamic updates
const stepTitles = {
  1: "Upload Materials",
  2: "Review Summary",
  3: "Create Objectives",
  4: "Generate Questions",
  5: "Select Output Format",
};

// Bloom's taxonomy levels
const bloomLevels = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

// Predefined objectives for the dropdown
const PREDEFINED_OBJECTIVES = [
  {
    metaId: "enthalpy-spontaneity",
    metaTitle: "Understand spontaneity limits of enthalpy and internal energy",
    kind: "meta",
  },
  {
    metaId: "entropy-state-function",
    metaTitle: "Understand entropy as a state function",
    kind: "meta",
  },
  {
    metaId: "reversible-processes",
    metaTitle: "Compare reversible and irreversible processes",
    kind: "meta",
  },
  {
    metaId: "gibbs-energy",
    metaTitle: "Understand Gibbs free energy relationships",
    kind: "meta",
  },
  {
    metaId: "second-law",
    metaTitle: "Apply the second law of thermodynamics",
    kind: "meta",
  },
  {
    metaId: "expansion-work",
    metaTitle: "Analyze expansion work processes",
    kind: "meta",
  },
  {
    metaId: "isothermal-processes",
    metaTitle: "Quantify isothermal processes",
    kind: "meta",
  },
  {
    metaId: "misconceptions",
    metaTitle: "Identify and address misconceptions",
    kind: "meta",
  },
];

// Seed catalog for auto-populating granular objectives
const SEED_BY_META = {
  "enthalpy-spontaneity": {
    metaTitle: "Understand spontaneity limits of enthalpy and internal energy",
    seeds: [
      {
        title: "Distinguish between endergonic and exergonic reactions",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Understand", "Analyze"],
      },
      {
        title: "Calculate Gibbs free energy changes",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Analyze"],
      },
      {
        title: "Predict reaction spontaneity from thermodynamic data",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Analyze", "Evaluate"],
      },
    ],
  },
  "entropy-state-function": {
    metaTitle: "Understand entropy as a state function",
    seeds: [
      {
        title: "Define entropy and its relationship to disorder",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Calculate entropy changes for phase transitions",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Analyze"],
      },
      {
        title: "Apply the second law of thermodynamics",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Understand", "Apply"],
      },
    ],
  },
  "reversible-processes": {
    metaTitle: "Compare reversible and irreversible processes",
    seeds: [
      {
        title: "Define reversible and irreversible processes",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Calculate work for reversible vs irreversible expansion",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Analyze"],
      },
      {
        title: "Analyze efficiency differences between process types",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Analyze", "Evaluate"],
      },
    ],
  },
  "gibbs-energy": {
    metaTitle: "Understand Gibbs free energy relationships",
    seeds: [
      {
        title: "Define Gibbs free energy and its components",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Calculate ΔG from ΔH and ΔS values",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Analyze"],
      },
      {
        title: "Predict reaction direction from Gibbs free energy",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Analyze", "Evaluate"],
      },
    ],
  },
  "second-law": {
    metaTitle: "Apply the second law of thermodynamics",
    seeds: [
      {
        title: "State the second law of thermodynamics",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Calculate entropy changes for various processes",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Apply"],
      },
      {
        title: "Analyze entropy changes in chemical reactions",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Analyze", "Evaluate"],
      },
    ],
  },
  "expansion-work": {
    metaTitle: "Analyze expansion work processes",
    seeds: [
      {
        title: "Define expansion work and its types",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Calculate work for isothermal expansion",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Analyze"],
      },
      {
        title: "Compare work done in different expansion processes",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Analyze", "Evaluate"],
      },
    ],
  },
  "isothermal-processes": {
    metaTitle: "Quantify isothermal processes",
    seeds: [
      {
        title: "Define isothermal processes and their characteristics",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Calculate work and heat for isothermal expansion",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Analyze"],
      },
      {
        title: "Analyze energy changes in isothermal processes",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Analyze", "Evaluate"],
      },
    ],
  },
  misconceptions: {
    metaTitle: "Identify and address misconceptions",
    seeds: [
      {
        title: "Identify common misconceptions about thermodynamics",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Remember", "Understand"],
      },
      {
        title: "Explain why misconceptions are incorrect",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Understand", "Apply"],
      },
      {
        title: "Design activities to address misconceptions",
        min: 2,
        count: 2,
        mode: "manual",
        bloomChips: ["Apply", "Create"],
      },
    ],
  },
};

// Alternate seed catalog for refreshing granular objectives
const ALT_SEEDS_BY_META = {
  "enthalpy-spontaneity": [
    {
      title: "Analyze enthalpy changes in chemical reactions",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Compare endothermic and exothermic processes",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Understand", "Apply"],
    },
    {
      title: "Calculate heat of reaction from bond energies",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Predict spontaneity using Hess's Law",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
  ],
  "entropy-state-function": [
    {
      title: "Calculate entropy changes for phase transitions",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Analyze entropy changes in chemical reactions",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Compare entropy of different states of matter",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Understand", "Apply"],
    },
  ],
  "reversible-processes": [
    {
      title: "Calculate work for reversible expansion",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Compare efficiency of different process types",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Analyze energy changes in reversible cycles",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
  ],
  "gibbs-energy": [
    {
      title: "Calculate ΔG from ΔH and ΔS values",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Predict reaction direction from Gibbs free energy",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Analyze temperature dependence of spontaneity",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
  ],
  "second-law": [
    {
      title: "Calculate entropy changes for various processes",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Analyze entropy changes in chemical reactions",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Apply the second law to evaluate spontaneity",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
  ],
  "expansion-work": [
    {
      title: "Calculate work for isothermal expansion",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Compare work done in different expansion processes",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Analyze energy changes in expansion work",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
  ],
  "isothermal-processes": [
    {
      title: "Calculate work and heat for isothermal expansion",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Analyze"],
    },
    {
      title: "Analyze energy changes in isothermal processes",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
    {
      title: "Compare isothermal vs adiabatic processes",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Analyze", "Evaluate"],
    },
  ],
  misconceptions: [
    {
      title: "Explain why misconceptions are incorrect",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Understand", "Apply"],
    },
    {
      title: "Design activities to address misconceptions",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Apply", "Create"],
    },
    {
      title: "Evaluate common student misconceptions",
      min: 2,
      count: 2,
      mode: "manual",
      bloomChips: ["Evaluate", "Create"],
    },
  ],
};

// Generic templates for custom meta objectives
const GENERIC_GRANULAR_TEMPLATES = [
  {
    title: "Identify key concepts and principles",
    min: 2,
    count: 2,
    mode: "manual",
    bloomChips: ["Remember", "Understand"],
  },
  {
    title: "Explain the underlying mechanisms and relationships",
    min: 2,
    count: 2,
    mode: "manual",
    bloomChips: ["Understand", "Analyze"],
  },
  {
    title: "Apply knowledge to solve problems and make predictions",
    min: 2,
    count: 2,
    mode: "manual",
    bloomChips: ["Apply", "Evaluate"],
  },
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

  // Restore saved state from localStorage
  restoreState();

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

  console.log("Calling updateUI...");
  updateUI();

  console.log("Initialization complete!");
  
  // Set up auto-save for state changes
  setupStatePersistence();
});

// ===== MODULE INITIALIZATION =====

// ===== STATE PERSISTENCE FUNCTIONS =====

function saveState() {
  try {
    // Create a serializable copy of state (Sets need to be converted to arrays)
    const stateToSave = {
      step: state.step,
      course: state.course,
      selectedCourse: state.selectedCourse,
      files: state.files.map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        content: file.content, // Save content for restoration
      })),
      urls: state.urls,
      summary: state.summary,
      objectives: state.objectives,
      questions: state.questions,
      exportFormat: state.exportFormat,
      objectiveGroups: state.objectiveGroups,
      questionGroups: state.questionGroups,
      selectedGroupIds: Array.from(state.selectedGroupIds),
      selectedQuestions: Array.from(state.selectedQuestions),
      filters: state.filters,
      formats: state.formats,
      namingConvention: state.namingConvention,
      saveAsDefault: state.saveAsDefault,
      timestamp: Date.now(),
    };
    
    localStorage.setItem("questionGenerationState", JSON.stringify(stateToSave));
    console.log("State saved to localStorage");
  } catch (error) {
    console.error("Error saving state:", error);
  }
}

function restoreState() {
  try {
    const savedState = localStorage.getItem("questionGenerationState");
    if (!savedState) {
      console.log("No saved state found");
      return;
    }

    const parsedState = JSON.parse(savedState);
    
    // Check if state is recent (within 7 days)
    const stateAge = Date.now() - (parsedState.timestamp || 0);
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    if (stateAge > maxAge) {
      console.log("Saved state is too old, clearing it");
      localStorage.removeItem("questionGenerationState");
      return;
    }

    // Only restore if we're on the question-generation page
    const currentPath = window.location.pathname;
    if (!currentPath.includes("question-generation")) {
      console.log("Not on question-generation page, skipping state restoration");
      return;
    }

    // Restore state properties
    state.step = parsedState.step || state.step;
    state.course = parsedState.course || state.course;
    state.selectedCourse = parsedState.selectedCourse || state.selectedCourse;
    state.files = parsedState.files || state.files;
    state.urls = parsedState.urls || state.urls;
    state.summary = parsedState.summary || state.summary;
    state.objectives = parsedState.objectives || state.objectives;
    state.questions = parsedState.questions || state.questions;
    state.exportFormat = parsedState.exportFormat || state.exportFormat;
    state.objectiveGroups = parsedState.objectiveGroups || state.objectiveGroups;
    state.questionGroups = parsedState.questionGroups || state.questionGroups;
    state.selectedGroupIds = new Set(parsedState.selectedGroupIds || []);
    state.selectedQuestions = new Set(parsedState.selectedQuestions || []);
    state.filters = parsedState.filters || state.filters;
    state.formats = parsedState.formats || state.formats;
    state.namingConvention = parsedState.namingConvention || state.namingConvention;
    state.saveAsDefault = parsedState.saveAsDefault || state.saveAsDefault;

    console.log("State restored from localStorage:", {
      step: state.step,
      course: state.course,
      filesCount: state.files.length,
      questionsCount: state.questions.length,
      objectiveGroupsCount: state.objectiveGroups.length,
    });
  } catch (error) {
    console.error("Error restoring state:", error);
    // Clear corrupted state
    localStorage.removeItem("questionGenerationState");
  }
}

function setupStatePersistence() {
  // Save state on window unload
  window.addEventListener("beforeunload", () => {
    saveState();
  });

  // Save state periodically (every 30 seconds) as backup
  setInterval(() => {
    saveState();
  }, 30000);
  
  console.log("State persistence enabled");
}

function clearSavedState() {
  localStorage.removeItem("questionGenerationState");
  console.log("Saved state cleared");
}

async function loadCourseData() {
  try {
    console.log("Loading course data for question generation...");
    const response = await fetch("/api/courses");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Course data received:", data);

    if (data.success && data.courses && data.courses.length > 0) {
      console.log("Courses found:", data.courses.length);
      updateCourseDropdown(data.courses);
    } else {
      console.log("No courses available - showing empty state");
      // No courses available - show empty state
      showNoCoursesMessage();
    }
  } catch (error) {
    console.error("Error loading course data:", error);
    showNoCoursesMessage();
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
      option.value = course.code;
      option.textContent = `${course.code} - ${course.name}`;
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
    background-color: ${
      type === "warning" ? "#f39c12" : type === "error" ? "#e74c3c" : "#3498db"
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
  console.log("ContentGenerator available:", window.ContentGenerator);
  console.log("QuestionGenerator available:", window.QuestionGenerator);
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
  // Course selection
  const courseSelect = document.getElementById("course-select");
  if (courseSelect) {
    courseSelect.addEventListener("change", (e) => {
      state.course = e.target.value;
      state.selectedCourse = e.target.value;
      console.log("Course selected:", state.course);

      // Update course display if not on Step 1
      if (state.step > 1) {
        updateCourseDisplay();
      }

      // Show success message when course is selected
      if (state.course) {
        showNotification(`Course selected: ${state.course}`, "info");
      }
    });
  }

  // Navigation buttons
  const backBtn = document.getElementById("back-btn");
  const continueBtn = document.getElementById("continue-btn");

  if (backBtn) {
    backBtn.addEventListener("click", goToPreviousStep);
  }

  if (continueBtn) {
    // Use ButtonUtils if available to prevent duplicate listeners
    if (window.ButtonUtils) {
      window.ButtonUtils.safeAddEventListener(continueBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToNextStep();
      });
    } else {
      continueBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToNextStep();
      });
    }
  }

  // Step 1: File upload and material tiles
  initializeFileUpload();
  initializeMaterialTiles();

  // Step 3: Objectives - will be initialized when Step 3 is reached
  // Don't call here as it's async and should be called when step 3 is shown

  // Step 5: Export format selection
  initializeExportFormat();
}

function goToNextStep() {
  console.log("goToNextStep called, current step:", state.step);

  if (state.step === 5) {
    // Final step - show export summary modal
    showExportSummaryModal();
    return;
  }

  if (state.step < 5) {
    const currentStep = state.step;
    const nextStep = currentStep + 1;

    console.log("Moving from step", currentStep, "to step", nextStep);

    // Validate current step before proceeding
    if (validateCurrentStep()) {
      console.log("Step validation passed, updating step to:", nextStep);
      state.step = nextStep;
      updateUI();
      saveState(); // Save state after step change

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
    saveState(); // Save state after step change
  }
}

function validateCurrentStep() {
  console.log("validateCurrentStep called for step:", state.step);

  switch (state.step) {
    case 1:
      const hasMaterials = state.files.length > 0 || state.urls.length > 0;
      const hasCourse = state.course && state.course.trim().length > 0;
      const step1Valid = hasMaterials && hasCourse;

      console.log(
        "Step 1 validation:",
        step1Valid,
        "files:",
        state.files.length,
        "urls:",
        state.urls.length,
        "course:",
        state.course
      );

      if (!hasCourse) {
        showNotification(
          "Please select a course before proceeding.",
          "warning"
        );
      } else if (!hasMaterials) {
        showNotification(
          "Please upload files or add URLs before proceeding.",
          "warning"
        );
      }

      return step1Valid;
    case 2:
      const step2Valid = state.summary.trim().length > 0;
      console.log(
        "Step 2 validation:",
        step2Valid,
        "summary length:",
        state.summary.trim().length
      );
      return step2Valid;
    case 3:
      const step3Valid =
        state.objectiveGroups.length > 0 &&
        state.objectiveGroups.every(
          (group) =>
            group.items.length > 0 &&
            group.items.every((item) => item.count >= item.minQuestions)
        );
      console.log(
        "Step 3 validation:",
        step3Valid,
        "objectiveGroups:",
        state.objectiveGroups.length
      );
      return step3Valid;
    case 4:
      // Step 4 validation - check if we have question groups with questions
      const step4Valid =
        state.questionGroups.length > 0 &&
        state.questionGroups.some((group) =>
          group.los.some((lo) => lo.questions.length > 0)
        );
      console.log(
        "Step 4 validation:",
        step4Valid,
        "questionGroups:",
        state.questionGroups.length
      );
      return step4Valid;
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
      console.log("Initializing Step 2");
      generateSummary();
      break;
    case 3:
      console.log("Initializing Step 3");
      // Initialize objectives when Step 3 is reached
      initializeObjectives().catch(error => {
        console.error("Error initializing objectives:", error);
      });
      break;
    case 4:
      console.log("Initializing Step 4");
      initializeStep4();
      break;
    case 5:
      console.log("Initializing Step 5");
      initializeStep5();
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
    title.textContent = stepTitles[state.step];
  }

  // Also update the export title in Step 5 if it exists
  const exportTitle = document.querySelector(".export-title");
  if (exportTitle && state.step === 5) {
    exportTitle.textContent = stepTitles[state.step];
  }
}

function updateCourseDisplay() {
  const courseDropdown = document.getElementById("course-dropdown");
  const courseDisplay = document.getElementById("course-display");
  const courseValue = document.getElementById("course-value");

  if (courseDropdown && courseDisplay && courseValue) {
    if (state.step === 1) {
      // Step 1: Show dropdown, hide display
      courseDropdown.style.display = "flex";
      courseDisplay.style.display = "none";
    } else {
      // Steps 2-5: Hide dropdown, show display
      courseDropdown.style.display = "none";
      courseDisplay.style.display = "flex";
      courseValue.textContent = state.selectedCourse;
    }
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
  const backBtn = document.getElementById("back-btn");
  const continueBtn = document.getElementById("continue-btn");

  if (backBtn) {
    backBtn.disabled = state.step === 1;
    if (state.step === 5) {
      backBtn.textContent = "Back";
      backBtn.className = "btn btn--secondary";
    } else {
      backBtn.textContent = "Back";
      backBtn.className = "btn btn--secondary";
    }
  }

  if (continueBtn) {
    if (state.step === 5) {
      continueBtn.textContent = "Export Now";
      continueBtn.className = "btn btn--primary";
    } else {
      continueBtn.textContent = "Continue";
      continueBtn.className = "btn btn--primary";
    }
  }
}

// ===== STEP 1: FILE UPLOAD FUNCTIONS =====

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
  dropArea.classList.add("drag-over");
}

function handleDragLeave(e) {
  e.preventDefault();
  const dropArea = document.getElementById("drop-area");
  dropArea.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  const dropArea = document.getElementById("drop-area");
  dropArea.classList.remove("drag-over");

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
    for (const file of files) {
      const fileObj = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: formatFileSize(file.size),
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
            fileObj.content = `PDF Document: ${
              file.name
            }\nFile Size: ${formatFileSize(file.size)}\nType: ${
              file.type
            }\n\nError: ${
              error.message
            }\n\nNote: PDF content could not be extracted.`;
          }
        } else {
          fileObj.content = `File: ${file.name}\nType: ${
            file.type
          }\nSize: ${formatFileSize(
            file.size
          )}\n\nThis file type is not directly readable as text content.`;
        }
      } catch (error) {
        console.error("Error reading file content:", error);
        fileObj.content = `File: ${file.name} (content could not be extracted)`;
      }

      // Process file with content generator - ensure course is selected
      try {
        if (!state.course) {
          console.warn(
            "No course selected, file will be processed without course association"
          );
          // Show warning to user
          showNotification(
            "Please select a course before uploading files for proper organization.",
            "warning"
          );
        }
        await contentGenerator.processFileForRAG(file, state.course || "");
      } catch (error) {
        console.error("Error processing file:", error);
      }

      state.files.push(fileObj);
    }

    renderFileList();
    announceToScreenReader(`${files.length} file(s) added`);
  } catch (error) {
    console.error("Error processing files:", error);
    showNotification("Error processing files. Please try again.", "error");
  } finally {
    // Hide spinner when upload is complete
    hideUploadSpinner();
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

function removeFile(fileId) {
  const index = state.files.findIndex((f) => f.id === fileId);
  if (index > -1) {
    const removedFile = state.files[index];
    state.files.splice(index, 1);
    renderFileList();
    announceToScreenReader(`Removed ${removedFile.name}`);
  }
}

function renderFileList() {
  const fileList = document.getElementById("file-list");
  if (!fileList) return;

  fileList.innerHTML = "";

  // Render files
  state.files.forEach((file) => {
    const fileItem = createFileItem(file);
    fileList.appendChild(fileItem);
  });

  // Render URLs
  state.urls.forEach((url) => {
    const urlItem = createUrlItem(url);
    fileList.appendChild(urlItem);
  });
}

function createFileItem(file) {
  const item = document.createElement("div");
  item.className = "file-item";

  const icon = getFileIcon(file.type);

  item.innerHTML = `
        <div class="file-item__info">
            <i class="${icon} file-item__icon"></i>
            <div class="file-item__details">
                <div class="file-item__name">${file.name}</div>
                <div class="file-item__size">${file.size}</div>
            </div>
        </div>
        <button type="button" class="file-item__remove" onclick="removeFile(${file.id})">
            <i class="fas fa-times"></i>
        </button>
    `;

  return item;
}

function createUrlItem(url) {
  const item = document.createElement("div");
  item.className = "file-item";

  item.innerHTML = `
        <div class="file-item__info">
            <i class="fas fa-link file-item__icon"></i>
            <div class="file-item__details">
                <div class="file-item__name">${url.url}</div>
                <div class="file-item__size">URL</div>
            </div>
        </div>
        <button type="button" class="file-item__remove" onclick="removeUrl(${url.id})">
            <i class="fas fa-times"></i>
        </button>
    `;

  return item;
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
      document.getElementById("file-input").click();
      break;
    case "url":
      openUrlModal();
      break;
    case "panopto":
      alert("Panopto integration coming soon!");
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
  modal.classList.add("modal--active");
  document.getElementById("text-content").focus();
}

function closeTextModal() {
  const modal = document.getElementById("text-modal");
  modal.classList.remove("modal--active");
  document.getElementById("text-content").value = "";
}

async function saveTextContent() {
  const textContent = document.getElementById("text-content").value.trim();
  if (textContent) {
    const textFile = {
      id: Date.now() + Math.random(),
      name: "Text Content",
      size: formatFileSize(new Blob([textContent]).size),
      type: "text/plain",
      content: textContent,
    };

    state.files.push(textFile);

    // Add text content to content generator
    await contentGenerator.processTextForRAG(textContent, state.course);

    renderFileList();
    closeTextModal();
    announceToScreenReader("Text content added");
    setTimeout(() => saveState(), 500); // Save state after text is added
  }
}

function openUrlModal() {
  const modal = document.getElementById("url-modal");
  modal.classList.add("modal--active");
  document.getElementById("url-input").focus();
}

function closeUrlModal() {
  const modal = document.getElementById("url-modal");
  modal.classList.remove("modal--active");
  document.getElementById("url-input").value = "";
}

async function saveUrlContent() {
  const urlContent = document.getElementById("url-input").value.trim();
  if (urlContent) {
    const urlObj = {
      id: Date.now() + Math.random(),
      url: urlContent,
    };

    state.urls.push(urlObj);

    // Add URL to content generator
    await contentGenerator.processUrlForRAG(urlContent, state.course);

    renderFileList();
    closeUrlModal();
    announceToScreenReader("URL added");
    setTimeout(() => saveState(), 500); // Save state after URL is added
  }
}

function removeUrl(urlId) {
  const index = state.urls.findIndex((u) => u.id === urlId);
  if (index > -1) {
    const removedUrl = state.urls[index];
    state.urls.splice(index, 1);
    renderFileList();
    announceToScreenReader(`Removed ${removedUrl.url}`);
  }
}

// ===== STEP 2: SUMMARY FUNCTIONS =====

async function generateSummary() {
  const summaryLoading = document.getElementById("summary-loading");
  const summaryText = document.getElementById("summary-text");

  if (summaryLoading) summaryLoading.style.display = "block";
  if (summaryText) summaryText.style.display = "none";

  try {
    console.log("Generating summary for course:", state.course);
    console.log("Files:", state.files);
    console.log("URLs:", state.urls);
    console.log("Content generator:", contentGenerator);

    if (!contentGenerator) {
      throw new Error("Content generator not initialized");
    }

    // Generate summary using content generator with actual uploaded content
    const summary = await contentGenerator.generateSummary(
      state.course,
      state.files,
      state.urls
    );
    console.log("Generated summary:", summary);
    state.summary = summary;
  } catch (error) {
    console.error("Summary generation failed:", error);
    if (DEV_MODE) {
      // Enhanced mock response that acknowledges RAG integration
      state.summary = `Summary generated using RAG-enhanced content analysis for ${state.course}. The uploaded materials have been processed and analyzed to identify key concepts and learning objectives suitable for question generation. This summary provides a foundation for creating targeted educational questions based on the course content.`;
    } else {
      state.summary = "Failed to generate summary. Please try again.";
    }
  }

  if (summaryLoading) summaryLoading.style.display = "none";
  if (summaryText) summaryText.style.display = "block";

  const summaryEditor = document.getElementById("summary-editor");
  if (summaryEditor) {
    summaryEditor.value = state.summary;
    summaryEditor.addEventListener("input", (e) => {
      state.summary = e.target.value;
      setTimeout(() => saveState(), 1000); // Save state when summary is edited
    });
  }
  
  setTimeout(() => saveState(), 500); // Save state after summary is generated
}

function prepareContentForSummary() {
  let content = "";

  // Add file contents
  state.files.forEach((file) => {
    if (file.content) {
      content += file.content + "\n\n";
    }
  });

  // Add URLs
  state.urls.forEach((url) => {
    content += `URL: ${url.url}\n\n`;
  });

  return content;
}

// ===== STEP 3: OBJECTIVES FUNCTIONS =====

// Generate learning objectives from uploaded content
async function generateLearningObjectivesFromContent() {
  console.log("Generating learning objectives from uploaded content...");

  try {
    // Check if we have any content
    const hasFiles = state.files.length > 0 && state.files.some(f => {
      const content = f.content || "";
      return content.length > 0 && 
             !content.includes("PDF content could not be extracted") &&
             !content.includes("Error:") &&
             !content.startsWith("PDF Document:");
    });
    const hasUrls = state.urls.length > 0;
    const hasSummary = state.summary && state.summary.length > 0;

    if (!hasFiles && !hasUrls && !hasSummary) {
      console.warn("No content available for objective generation");
      showNotification("No content available. Please upload files or add content in Step 1.", "warning");
      return;
    }

    // Show loading state
    const generateBtn = document.getElementById("generate-objectives-btn");
    if (generateBtn) {
      const originalText = generateBtn.innerHTML;
      generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Extracting...';
      generateBtn.disabled = true;
    }

    // Extract key topics and concepts from the summary and uploaded files using LLM
    let contentAnalysis = await analyzeContentForObjectives();

    if (!contentAnalysis || contentAnalysis.length === 0) {
      console.warn("No topics extracted from content");
      showNotification("Could not extract topics from content. Using default objectives.", "warning");
      // Use default objectives
      contentAnalysis = getDefaultObjectives();
      if (!contentAnalysis || contentAnalysis.length === 0) {
        return;
      }
    }

    // Create learning objective groups based on content analysis
    console.log("Content analysis result:", contentAnalysis);
    console.log("Number of topics:", contentAnalysis.length);
    
    state.objectiveGroups = contentAnalysis.map((topic, index) => {
      // Ensure granularObjectives exists
      const granularObjectives = topic.granularObjectives || [];
      console.log(`Topic ${index + 1} (${topic.title}): ${granularObjectives.length} granular objectives`);
      
      if (granularObjectives.length === 0) {
        console.warn(`Topic ${index + 1} has no granular objectives, creating default`);
        granularObjectives.push({
          text: `Understand key concepts in ${topic.title}`,
          bloom: ["Understand"],
          minQuestions: 2,
          count: 2,
        });
      }
      
      return {
        id: index + 1,
        metaId: `content-generated-${index + 1}`,
        title: topic.title || `Learning Objective ${index + 1}`,
        isOpen: index === 0, // Open first group by default
        selected: false,
        items: granularObjectives.map((objective, objIndex) => ({
          id: parseFloat(`${index + 1}.${objIndex + 1}`),
          text: objective.text || `Objective ${objIndex + 1}`,
          bloom: Array.isArray(objective.bloom) ? objective.bloom : [objective.bloom || "Understand"],
          minQuestions: objective.minQuestions || 2,
          count: objective.count || 2,
          mode: "manual",
          level: 1,
          selected: false,
        })),
      };
    });

    console.log(
      `Generated ${state.objectiveGroups.length} learning objective groups from content`
    );

    // Show success message
    if (state.objectiveGroups.length > 0) {
      showNotification(
        `Successfully generated ${state.objectiveGroups.length} learning objective group(s) from content`,
        "success"
      );
      
      // Render objectives immediately so they're visible
      renderObjectiveGroups();
    }
    
    setTimeout(() => saveState(), 500); // Save state after objectives are generated

    // Restore button state
    if (generateBtn) {
      generateBtn.innerHTML = originalText;
      generateBtn.disabled = false;
    }
  } catch (error) {
    console.error("Error generating learning objectives:", error);
    console.error("Error stack:", error.stack);
    
    // Show more specific error message
    let errorMessage = "Error generating learning objectives. ";
    if (error.message) {
      errorMessage += error.message;
    } else {
      errorMessage += "Please try again or add manually.";
    }
    
    showNotification(errorMessage, "error");
    
    // Try to use fallback - generate default objectives
    try {
      console.log("Attempting to use default objectives as fallback...");
      const defaultObjectives = getDefaultObjectives();
      if (defaultObjectives && defaultObjectives.length > 0) {
        state.objectiveGroups = defaultObjectives.map((topic, index) => ({
          id: index + 1,
          metaId: `default-${index + 1}`,
          title: `Learning Objective ${index + 1}: ${topic.title}`,
          isOpen: index === 0,
          selected: false,
          items: topic.granularObjectives.map((objective, objIndex) => ({
            id: parseFloat(`${index + 1}.${objIndex + 1}`),
            text: objective.text,
            bloom: Array.isArray(objective.bloom) ? objective.bloom : [objective.bloom || "Understand"],
            minQuestions: objective.minQuestions || 2,
            count: objective.count || 2,
            mode: "manual",
            level: 1,
            selected: false,
          })),
        }));
        
        renderObjectiveGroups();
        showNotification("Using default learning objectives. You can edit or add more.", "info");
      }
    } catch (fallbackError) {
      console.error("Fallback also failed:", fallbackError);
    }
    
    // Restore button state
    const generateBtn = document.getElementById("generate-objectives-btn");
    if (generateBtn) {
      generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate from Content';
      generateBtn.disabled = false;
    }
  }
}

// Handle generate objectives button click
async function handleGenerateObjectivesFromContent() {
  // Check if there's existing content
  const hasContent = state.files.length > 0 || state.urls.length > 0 || (state.summary && state.summary.length > 0);
  
  if (!hasContent) {
    showNotification("Please upload files or add content in Step 1 first.", "warning");
    return;
  }

  // Ask for confirmation if objectives already exist
  if (state.objectiveGroups.length > 0) {
    const confirmMessage = "This will replace all existing learning objectives with new ones generated from your content. Continue?";
    if (!confirm(confirmMessage)) {
      return;
    }
  }

  // Clear existing objectives
  state.objectiveGroups = [];

  // Generate new objectives (now async)
  await generateLearningObjectivesFromContent();

  // Update UI
  renderObjectiveGroups();

  // Announce to screen reader
  announceToScreenReader(
    `Generated ${state.objectiveGroups.length} learning objective groups from uploaded content.`
  );
}

// Analyze uploaded content to extract learning objectives
async function analyzeContentForObjectives() {
  const topics = [];

  // Extract content from uploaded files
  const allContent = [];
  state.files.forEach((file) => {
    if (file.content && file.content.trim().length > 0) {
      // Check if this is actual PDF content or just an error message
      if (!file.content.includes("PDF content could not be extracted") && 
          !file.content.includes("Error:") &&
          !file.content.startsWith("PDF Document:")) {
      allContent.push(file.content);
      }
    }
  });

  // Add URLs as content
  state.urls.forEach((url) => {
    if (url.url && url.url.trim().length > 0) {
    allContent.push(`URL: ${url.url}`);
    }
  });

  // Add summary content
  if (state.summary && state.summary.trim().length > 0) {
    allContent.push(state.summary);
  }

  // Check if we have any content
  if (allContent.length === 0) {
    console.warn("No content available for objective extraction");
    // Return default objectives
    return getDefaultObjectives();
  }

  // Combine all content
  const combinedContent = allContent.join("\n\n");

  // Validate content length
  if (combinedContent.trim().length < 50) {
    console.warn("Content too short for meaningful extraction");
    return getDefaultObjectives();
  }

  console.log("=== EXTRACTING LEARNING OBJECTIVES ===");
  console.log("Content length:", combinedContent.length);
  console.log("Number of files:", state.files.length);

  // Try to extract using LLM API first
  try {
    console.log("Attempting LLM-based objective extraction...");
    console.log("Content length:", combinedContent.length);
    console.log("Sending request to /api/rag-llm/extract-objectives");
    
    const response = await fetch("/api/rag-llm/extract-objectives", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: combinedContent,
        course: state.course || "",
      }),
    });

    console.log("Response status:", response.status, response.statusText);

    if (response.ok) {
      const data = await response.json();
      console.log("Response data:", data);
      
      if (data.success && data.objectives && data.objectives.length > 0) {
        console.log(`✅ Extracted ${data.objectives.length} objectives using ${data.method}`);
        console.log("Objectives structure:", JSON.stringify(data.objectives, null, 2));
        
        // Validate and ensure proper structure
        const validatedObjectives = data.objectives.map((obj, index) => {
          // Ensure granularObjectives exists and is an array
          if (!obj.granularObjectives || !Array.isArray(obj.granularObjectives)) {
            console.warn(`Objective ${index} missing granularObjectives, creating default`);
            return {
              title: obj.title || `Learning Objective ${index + 1}`,
              description: obj.description || `Master concepts related to ${obj.title || 'this topic'}`,
              granularObjectives: obj.text ? [{
                text: obj.text,
                bloom: obj.bloom || ["Understand"],
                minQuestions: obj.minQuestions || 2,
                count: obj.count || 2,
              }] : [{
                text: `Understand key concepts in ${obj.title || 'this topic'}`,
                bloom: ["Understand"],
                minQuestions: 2,
                count: 2,
              }],
            };
          }
          
          // Ensure each granular objective has required fields
          const validatedGranular = obj.granularObjectives.map((granular, gIndex) => ({
            text: granular.text || `Objective ${gIndex + 1}`,
            bloom: Array.isArray(granular.bloom) ? granular.bloom : [granular.bloom || "Understand"],
            minQuestions: granular.minQuestions || 2,
            count: granular.count || 2,
          }));
          
          return {
            title: obj.title || `Learning Objective ${index + 1}`,
            description: obj.description || `Master concepts related to ${obj.title || 'this topic'}`,
            granularObjectives: validatedGranular,
          };
        });
        
        console.log("Validated objectives:", validatedObjectives);
        return validatedObjectives;
      } else {
        console.warn("API returned success but no objectives:", data);
        // Fall through to pattern matching
      }
    } else {
      // Try to get error details from response
      const errorData = await response.json().catch(() => ({ 
        error: `HTTP ${response.status}`,
        details: response.statusText 
      }));
      console.warn("LLM extraction failed:", errorData);
      // Don't throw - fall through to pattern matching instead
      console.log("Falling back to pattern matching due to API error");
    }
  } catch (error) {
    console.error("LLM extraction error:", error);
    console.error("Error details:", error.message, error.stack);
    // Don't throw here - fall through to pattern matching
  }

  // Fallback to pattern-based extraction
  console.log("Using pattern-based extraction as fallback...");
  const contentTopics = extractTopicsFromContent(combinedContent);

  // Generate learning objectives for each topic
  contentTopics.forEach((topic) => {
    const granularObjectives = generateGranularObjectivesForTopic(topic);
    topics.push({
      title: topic.title,
      description: topic.description,
      granularObjectives: granularObjectives,
    });
  });

  // If no topics were extracted, create default objectives based on course
  if (topics.length === 0) {
    return getDefaultObjectives();
  }

  return topics;
}

// Get default learning objectives when content extraction fails
function getDefaultObjectives() {
  const courseName = state.course || "this course";
  return [
    {
      title: `Understand key concepts in ${courseName}`,
      description: `Master fundamental concepts covered in ${courseName} materials`,
      granularObjectives: [
        {
          text: "Identify and define key terms and concepts",
          bloom: ["Remember", "Understand"],
          minQuestions: 2,
          count: 2,
        },
        {
          text: "Explain relationships between different concepts",
          bloom: ["Understand", "Analyze"],
          minQuestions: 2,
          count: 2,
        },
        {
          text: "Apply knowledge to solve problems",
          bloom: ["Apply", "Evaluate"],
          minQuestions: 2,
          count: 2,
        },
      ],
    },
  ];
}

// Extract topics from content using text analysis
function extractTopicsFromContent(content) {
  const topics = [];

  // Enhanced topic extraction with more specific patterns
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  // Look for various types of headers and topics
  const sectionHeaders = lines.filter(
    (line) =>
      line.match(/^(Chapter|Section|Topic|Unit|Module)\s+\d+/i) ||
      line.match(/^[A-Z][A-Z\s]+$/i) ||
      line.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+/) ||
      (line.includes(":") && line.length < 100) ||
      line.match(/^\d+\.\s+[A-Z]/) || // Numbered sections
      line.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+/) // Multi-word concepts
  );

  // Extract unique topics with better cleaning
  const uniqueTopics = new Set();
  sectionHeaders.forEach((header) => {
    let cleanHeader = header
      .replace(/^(Chapter|Section|Topic|Unit|Module)\s+\d+[:\-\s]*/i, "")
      .replace(/^\d+\.\s*/, "") // Remove numbered prefixes
      .replace(/^[A-Z]+\s*/, "") // Remove all-caps prefixes
      .trim();

    // Extract meaningful parts from headers
    if (cleanHeader.includes(":")) {
      cleanHeader = cleanHeader.split(":")[0].trim();
    }

    if (cleanHeader.length > 5 && cleanHeader.length < 100) {
      uniqueTopics.add(cleanHeader);
    }
  });

  // Convert to topic objects with enhanced analysis
  Array.from(uniqueTopics)
    .slice(0, 5)
    .forEach((topic) => {
      const topicAnalysis = analyzeTopicContent(topic, content);
      topics.push({
        title: topic,
        description: `Master ${
          topicAnalysis.description || `concepts related to ${topic}`
        }`,
        keywords: topicAnalysis.keywords,
        specificContent: topicAnalysis.specificContent,
      });
    });

  // If no clear topics found, analyze content for key concepts with better extraction
  if (topics.length === 0) {
    const keyConcepts = extractKeyConceptsEnhanced(content);
    keyConcepts.slice(0, 3).forEach((concept) => {
      const topicAnalysis = analyzeTopicContent(concept, content);
      topics.push({
        title: concept,
        description: `Understand and apply ${concept}`,
        keywords: topicAnalysis.keywords,
        specificContent: topicAnalysis.specificContent,
      });
    });
  }

  return topics;
}

// Enhanced topic content analysis
function analyzeTopicContent(topic, content) {
  const topicLower = topic.toLowerCase();
  const result = {
    description: "",
    keywords: [],
    specificContent: [],
  };

  // Find sentences that mention the topic
  const relevantSentences = content
    .split(/[.!?]+/)
    .filter(
      (sentence) =>
        sentence.toLowerCase().includes(topicLower) && sentence.length > 20
    );

  // Extract keywords from relevant sentences
  relevantSentences.forEach((sentence) => {
    const words = sentence
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 && !isCommonWord(word) && word.match(/^[A-Za-z]+$/) // Only alphabetic words
      )
      .slice(0, 3);
    result.keywords.push(...words);
  });

  // Remove duplicates and limit
  result.keywords = [...new Set(result.keywords)].slice(0, 5);

  // Extract specific content snippets
  relevantSentences.slice(0, 3).forEach((sentence) => {
    if (sentence.length > 30 && sentence.length < 150) {
      result.specificContent.push(sentence.trim());
    }
  });

  // Generate description based on content
  if (result.specificContent.length > 0) {
    const firstContent = result.specificContent[0];
    if (firstContent.includes("is") || firstContent.includes("are")) {
      result.description = firstContent.substring(0, 80) + "...";
    }
  }

  return result;
}

// Enhanced key concept extraction
function extractKeyConceptsEnhanced(content) {
  const concepts = [];

  // Look for capitalized words that might be concepts
  const words = content.split(/\s+/);
  const capitalizedWords = words.filter(
    (word) =>
      word.length > 3 && word.match(/^[A-Z][a-z]+$/) && !isCommonWord(word)
  );

  // Count frequency and get most common
  const wordCount = {};
  capitalizedWords.forEach((word) => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });

  // Also look for compound concepts (two or more capitalized words together)
  const compoundConcepts =
    content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  compoundConcepts.forEach((concept) => {
    if (concept.length > 5 && concept.length < 50) {
      wordCount[concept] = (wordCount[concept] || 0) + 1;
    }
  });

  const sortedWords = Object.entries(wordCount)
    .sort(([, a], [, b]) => b - a)
    .map(([word]) => word)
    .slice(0, 5);

  return sortedWords;
}

// Extract keywords for a specific topic
function extractKeywordsForTopic(topic, content) {
  const keywords = [];
  const topicLower = topic.toLowerCase();

  // Find sentences that mention the topic
  const sentences = content
    .split(/[.!?]+/)
    .filter((sentence) => sentence.toLowerCase().includes(topicLower));

  // Extract potential keywords from these sentences
  sentences.forEach((sentence) => {
    const words = sentence
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 &&
          ![
            "this",
            "that",
            "with",
            "from",
            "they",
            "have",
            "been",
            "will",
            "were",
            "said",
          ].includes(word.toLowerCase())
      )
      .slice(0, 3);
    keywords.push(...words);
  });

  return [...new Set(keywords)].slice(0, 5);
}

// Extract key concepts from content
function extractKeyConcepts(content) {
  const concepts = [];

  // Look for capitalized words that might be concepts
  const words = content.split(/\s+/);
  const capitalizedWords = words.filter(
    (word) =>
      word.length > 3 &&
      word.match(/^[A-Z][a-z]+$/) &&
      ![
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
      ].includes(word)
  );

  // Count frequency and get most common
  const wordCount = {};
  capitalizedWords.forEach((word) => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });

  const sortedWords = Object.entries(wordCount)
    .sort(([, a], [, b]) => b - a)
    .map(([word]) => word)
    .slice(0, 5);

  return sortedWords;
}

// Generate granular objectives for a topic
function generateGranularObjectivesForTopic(topic) {
  const objectives = [];
  const content = getCombinedContent();

  // Extract specific content related to this topic
  const topicContent = extractContentForTopic(topic.title, content);

  // Generate context-specific objectives based on actual content
  if (topicContent.specificConcepts.length > 0) {
    // Create objectives based on specific concepts found in content
    topicContent.specificConcepts.forEach((concept, index) => {
      if (index < 3) {
        // Limit to 3 specific objectives
        objectives.push({
          text: `Explain ${concept} as described in the course materials`,
          bloom: ["Understand", "Analyze"],
          minQuestions: 2,
          count: 2,
        });
      }
    });
  }

  // Generate objectives based on specific examples or applications mentioned
  if (topicContent.examples.length > 0) {
    topicContent.examples.forEach((example, index) => {
      if (index < 2) {
        // Limit to 2 example-based objectives
        objectives.push({
          text: `Apply concepts to ${example} scenarios`,
          bloom: ["Apply", "Evaluate"],
          minQuestions: 2,
          count: 2,
        });
      }
    });
  }

  // Generate objectives based on specific processes or procedures mentioned
  if (topicContent.processes.length > 0) {
    topicContent.processes.forEach((process, index) => {
      if (index < 2) {
        // Limit to 2 process-based objectives
        objectives.push({
          text: `Analyze the ${process} process and its applications`,
          bloom: ["Analyze", "Evaluate"],
          minQuestions: 2,
          count: 2,
        });
      }
    });
  }

  // If no specific content found, create more targeted generic objectives
  if (objectives.length === 0) {
    objectives.push(
      {
        text: `Identify and define key terms and concepts from ${state.course} materials`,
        bloom: ["Remember", "Understand"],
        minQuestions: 2,
        count: 2,
      },
      {
        text: `Explain relationships between different concepts as presented in the course content`,
        bloom: ["Understand", "Analyze"],
        minQuestions: 2,
        count: 2,
      },
      {
        text: `Apply knowledge from ${state.course} materials to solve problems`,
        bloom: ["Apply", "Evaluate"],
        minQuestions: 2,
        count: 2,
      }
    );
  }

  return objectives;
}

// Extract specific content related to a topic
function extractContentForTopic(topicTitle, content) {
  const topicLower = topicTitle.toLowerCase();
  const result = {
    specificConcepts: [],
    examples: [],
    processes: [],
  };

  // Find sentences that mention the topic
  const sentences = content
    .split(/[.!?]+/)
    .filter(
      (sentence) =>
        sentence.toLowerCase().includes(topicLower) && sentence.length > 20
    );

  // Extract specific concepts (capitalized terms, technical terms)
  sentences.forEach((sentence) => {
    // Look for technical terms, proper nouns, and specific concepts
    const words = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (words) {
      words.forEach((word) => {
        if (word.length > 3 && !isCommonWord(word)) {
          result.specificConcepts.push(word);
        }
      });
    }

    // Look for examples (sentences with "for example", "such as", "including")
    if (sentence.match(/for example|such as|including|e\.g\./i)) {
      const exampleMatch = sentence.match(
        /(?:for example|such as|including|e\.g\.)\s*([^,.]{10,50})/i
      );
      if (exampleMatch) {
        result.examples.push(exampleMatch[1].trim());
      }
    }

    // Look for processes (sentences with "process", "method", "technique", "approach")
    if (sentence.match(/process|method|technique|approach|procedure/i)) {
      const processMatch = sentence.match(
        /(\w+\s+(?:process|method|technique|approach|procedure))/i
      );
      if (processMatch) {
        result.processes.push(processMatch[1].trim());
      }
    }
  });

  // Remove duplicates and limit results
  result.specificConcepts = [...new Set(result.specificConcepts)].slice(0, 5);
  result.examples = [...new Set(result.examples)].slice(0, 3);
  result.processes = [...new Set(result.processes)].slice(0, 3);

  return result;
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
async function initializeObjectives() {
  console.log("=== INITIALIZING STEP 3: OBJECTIVES ===");
  console.log("Current objective groups:", state.objectiveGroups.length);
  console.log("Files:", state.files.length);
  console.log("URLs:", state.urls.length);
  console.log("Summary length:", state.summary ? state.summary.length : 0);
  
  // If objectives were already generated in Step 2, they should be in state.objectiveGroups
  // Render them first so they're visible
  if (state.objectiveGroups.length > 0) {
    console.log("Found existing objectives, rendering them...");
    renderObjectiveGroups();
  }
  
  // Generate learning objectives from uploaded content if no groups exist
  if (state.objectiveGroups.length === 0) {
    // Check if we have content to generate from
    const hasContent = state.files.length > 0 || state.urls.length > 0 || (state.summary && state.summary.length > 0);
    if (hasContent) {
      console.log("Auto-generating learning objectives from uploaded content...");
      await generateLearningObjectivesFromContent();
    } else {
      console.log("No content available for auto-generation. User can generate manually.");
    }
  }

  // Initialize add objectives button
  const addObjectivesBtn = document.getElementById("add-objectives-btn");
  if (addObjectivesBtn) {
    addObjectivesBtn.addEventListener("click", toggleAddObjectivesDropdown);
  }

  // Initialize generate objectives from content button
  const generateObjectivesBtn = document.getElementById("generate-objectives-btn");
  if (generateObjectivesBtn) {
    generateObjectivesBtn.addEventListener("click", handleGenerateObjectivesFromContent);
  }

  // Initialize dropdown functionality
  initializeAddObjectivesDropdown();

  // Initialize modals
  initializeModals();

  // Initialize multi-select toolbar
  updateMultiSelectToolbar();

  // Render initial state (in case objectives were added)
  renderObjectiveGroups();
}

function initializeAddObjectivesDropdown() {
  const dropdown = document.getElementById("add-objectives-dropdown");
  const searchInput = document.getElementById("objective-search");
  const dropdownOptions = document.getElementById("dropdown-options");
  const createCustomBtn = document.getElementById("create-custom-btn");

  // Populate predefined options with new schema
  dropdownOptions.innerHTML = PREDEFINED_OBJECTIVES.map(
    (objective) =>
      `<div class="dropdown-option" data-meta-id="${objective.metaId}" data-meta-title="${objective.metaTitle}">${objective.metaTitle}</div>`
  ).join("");

  // Search functionality
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const options = dropdownOptions.querySelectorAll(".dropdown-option");

      options.forEach((option) => {
        const text = option.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
          option.classList.remove("dropdown-option--hidden");
        } else {
          option.classList.add("dropdown-option--hidden");
        }
      });
    });
  }

  // Option selection
  dropdownOptions.addEventListener("click", (e) => {
    if (e.target.classList.contains("dropdown-option")) {
      const metaId = e.target.dataset.metaId;
      const metaTitle = e.target.dataset.metaTitle;
      handleMetaObjectiveSelection(metaId, metaTitle);
      hideAddObjectivesDropdown();
    }
  });

  // Create custom objective
  if (createCustomBtn) {
    createCustomBtn.addEventListener("click", () => {
      hideAddObjectivesDropdown();
      showCustomObjectiveModal();
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !dropdown?.contains(e.target) &&
      !e.target.closest("#add-objectives-btn")
    ) {
      hideAddObjectivesDropdown();
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

  if (dropdown && addBtn) {
    dropdown.style.display = "block";
    addBtn.style.position = "relative";

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

function showCustomObjectiveModal() {
  const modal = document.getElementById("custom-objective-modal");
  if (modal) {
    modal.style.display = "flex";
    const textInput = document.getElementById("custom-objective-text");
    if (textInput) {
      setTimeout(() => textInput.focus(), 100);
    }
  }
}

function handleCustomObjectiveSubmission() {
  const modal = document.getElementById("custom-objective-modal");
  const textInput = document.getElementById("custom-objective-text");

  if (textInput && textInput.value.trim()) {
    const customTitle = textInput.value.trim();

    // Create new custom meta learning objective group
    const newGroupId = Date.now() + Math.random();
    const newGroupNumber = state.objectiveGroups.length + 1;

    const newGroup = {
      id: newGroupId,
      metaId: `custom-${newGroupId}`,
      title: `Learning Objective ${newGroupNumber}: ${customTitle}`,
      isOpen: true,
      selected: false, // Add selected property for multi-select
      items: [
        {
          id: parseFloat(`${newGroupNumber}.1`),
          text: "Draft granular objective (edit me).",
          bloom: [],
          minQuestions: 2,
          count: 2,
          mode: "manual",
          level: 1,
          selected: false,
        },
      ],
    };

    // Append to the end of the groups array
    state.objectiveGroups.push(newGroup);

    // Renumber all groups
    renumberObjectiveGroups();

    // Clear the input and hide modal
    textInput.value = "";
    hideModal(modal);

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

    announceToScreenReader(
      `Added custom objective: ${customTitle} with 1 granular objective.`
    );
  }
}

function hideModal(modal) {
  if (modal) {
    modal.style.display = "none";
  }
}

function handleMetaObjectiveSelection(metaId, metaTitle) {
  // Check if this meta objective already exists
  const existingGroup = state.objectiveGroups.find(
    (group) => group.metaId === metaId
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

    announceToScreenReader(`Meta objective revealed: ${metaTitle}`);
  } else {
    // Create new meta learning objective group with auto-seeded granular objectives
    const newGroupId = Date.now() + Math.random();
    const newGroupNumber = state.objectiveGroups.length + 1;

    // Get seeds from the catalog
    const seeds = SEED_BY_META[metaId]?.seeds || [];

    const newGroup = {
      id: newGroupId,
      metaId: metaId,
      title: `Learning Objective ${newGroupNumber}: ${metaTitle}`,
      isOpen: true,
      selected: false, // Add selected property for multi-select
      items: seeds.map((seed, index) => ({
        id: parseFloat(`${newGroupNumber}.${index + 1}`),
        text: seed.title,
        bloom: seed.bloomChips,
        minQuestions: seed.min,
        count: seed.count,
        mode: seed.mode,
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

    // Announce with count of granular objectives
    const granularCount = seeds.length;
    announceToScreenReader(
      `Added ${metaTitle} with ${granularCount} granular objectives.`
    );
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

// ===== MULTI-SELECT FUNCTIONS =====

function toggleGroupSelection(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (group) {
    group.selected = !group.selected;

    if (group.selected) {
      state.selectedGroupIds.add(groupId);
    } else {
      state.selectedGroupIds.delete(groupId);
    }

    updateMultiSelectToolbar();
    renderObjectiveGroups();
  }
}

function selectAllGroups() {
  const selectAllCheckbox = document.getElementById("select-all-groups");
  const isChecked = selectAllCheckbox.checked;

  state.objectiveGroups.forEach((group) => {
    group.selected = isChecked;
    if (isChecked) {
      state.selectedGroupIds.add(group.id);
    } else {
      state.selectedGroupIds.delete(group.id);
    }
  });

  updateMultiSelectToolbar();
  renderObjectiveGroups();
}

function deleteSelectedGroups() {
  const selectedCount = state.selectedGroupIds.size;

  if (selectedCount === 0) return;

  // Show confirmation dialog
  const confirmMessage = `Delete ${selectedCount} meta learning objective${
    selectedCount > 1 ? "s" : ""
  } and all granular objectives?`;

  if (confirm(confirmMessage)) {
    // Remove selected groups
    state.objectiveGroups = state.objectiveGroups.filter(
      (group) => !group.selected
    );

    // Clear selection
    state.selectedGroupIds.clear();

    // Renumber remaining groups
    renumberObjectiveGroups();

    // Update UI
    updateMultiSelectToolbar();
    renderObjectiveGroups();

    // Announce deletion
    announceToScreenReader(`Deleted ${selectedCount} meta objectives.`);
  }
}

function updateMultiSelectToolbar() {
  const toolbar = document.getElementById("multi-select-toolbar");
  const deleteSelectedBtn = document.getElementById("delete-selected-btn");
  const selectAllCheckbox = document.getElementById("select-all-groups");

  if (toolbar && deleteSelectedBtn && selectAllCheckbox) {
    const hasSelectedGroups = state.selectedGroupIds.size > 0;
    const allGroupsSelected =
      state.objectiveGroups.length > 0 &&
      state.objectiveGroups.every((group) => group.selected);

    // Show/hide toolbar based on whether there are groups
    toolbar.style.display = state.objectiveGroups.length > 0 ? "block" : "none";

    // Update delete button state
    deleteSelectedBtn.disabled = !hasSelectedGroups;

    // Update select all checkbox
    selectAllCheckbox.checked = allGroupsSelected;
    selectAllCheckbox.indeterminate = hasSelectedGroups && !allGroupsSelected;
  }
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

function refreshMetaObjectives(groupId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (!group) return;

  const metaTitle = group.title.replace(/^Learning Objective \d+: /, "");
  const confirmMessage = `Replace granular objectives in '${metaTitle}' with a fresh template set? This removes current granular items.`;

  if (confirm(confirmMessage)) {
    // Check if this is a content-generated objective
    if (group.metaId && group.metaId.startsWith("content-generated-")) {
      // Regenerate from content
      regenerateObjectiveFromContent(group);
    } else {
      // Use predefined templates
      let newSeeds;
      if (group.metaId && group.metaId.startsWith("custom-")) {
        // Custom meta - use generic templates
        newSeeds = GENERIC_GRANULAR_TEMPLATES;
      } else if (ALT_SEEDS_BY_META[group.metaId]) {
        // Known meta - use alternate seeds
        newSeeds = ALT_SEEDS_BY_META[group.metaId];
      } else {
        // Fallback to generic templates
        newSeeds = GENERIC_GRANULAR_TEMPLATES;
      }

      // Replace items with new seeds
      group.items = newSeeds.map((seed, index) => ({
        id: parseFloat(`${group.id}.${index + 1}`),
        text: seed.title,
        bloom: seed.bloomChips,
        minQuestions: seed.min,
        count: seed.count,
        mode: seed.mode,
        level: 1, // Granular level
        selected: false,
      }));
    }

    // Expand the group
    group.isOpen = true;

    // Update UI
    renderObjectiveGroups();

    // Scroll into view
    setTimeout(() => {
      const groupElement = document.querySelector(
        `[data-group-id="${groupId}"]`
      );
      if (groupElement) {
        groupElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);

    // Announce refresh
    announceToScreenReader(`Refreshed granular objectives for ${metaTitle}.`);
  }
}

// Regenerate objective from uploaded content
function regenerateObjectiveFromContent(group) {
  const topicTitle = group.title.replace(/^Learning Objective \d+: /, "");

  // Create a topic object for regeneration
  const topic = {
    title: topicTitle,
    description: `Master concepts related to ${topicTitle}`,
    keywords: extractKeywordsForTopic(topicTitle, getCombinedContent()),
  };

  // Generate new granular objectives
  const newObjectives = generateGranularObjectivesForTopic(topic);

  // Replace items with new objectives
  group.items = newObjectives.map((objective, index) => ({
    id: parseFloat(`${group.id}.${index + 1}`),
    text: objective.text,
    bloom: objective.bloom,
    minQuestions: objective.minQuestions,
    count: objective.count,
    mode: "manual",
    level: 1,
    selected: false,
  }));
}

// Get combined content from all sources
function getCombinedContent() {
  const allContent = [];

  // Extract content from uploaded files
  state.files.forEach((file) => {
    if (file.content) {
      allContent.push(file.content);
    }
  });

  // Add URLs as content
  state.urls.forEach((url) => {
    allContent.push(`URL: ${url.url}`);
  });

  // Add summary content
  if (state.summary) {
    allContent.push(state.summary);
  }

  return allContent.join("\n\n");
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
  } else {
    // Hide empty state and render groups
    if (emptyState) {
      emptyState.style.display = "none";
    }

    state.objectiveGroups.forEach((group) => {
      const groupElement = createObjectiveGroup(group);
      groupsContainer.appendChild(groupElement);
    });
  }

  // Update multi-select toolbar after rendering
  updateMultiSelectToolbar();
}

function createObjectiveGroup(group) {
  const groupElement = document.createElement("div");
  groupElement.className = `objective-group ${
    group.isOpen ? "objective-group--expanded" : "objective-group--collapsed"
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
                <input type="checkbox" 
                    class="objective-group__checkbox" 
                    ${group.selected ? "checked" : ""} 
                    onchange="toggleGroupSelection(${group.id})"
                    aria-label="Select ${group.title}"
                >
                <h3 class="objective-group__title" 
                    tabindex="0" 
                    onclick="toggleObjectiveGroup(${group.id})"
                >${group.title}</h3>
            </div>
            <div class="objective-group__header-right">
                <button type="button" 
                    class="objective-group__refresh-btn" 
                    onclick="refreshMetaObjectives(${group.id})"
                    title="Refresh granular objectives"
                    aria-label="Refresh granular objectives for ${group.title}"
                >
                    <i class="fas fa-sync-alt"></i>
                </button>
                <div class="objective-group__toggle" onclick="toggleObjectiveGroup(${
                  group.id
                })">
                    <span>${itemCount} objectives</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
            </div>
        </div>
        <div class="objective-group__content">
            ${emptyState}
            ${
              group.items.length > 0
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
            ${
              itemCount > 0
                ? `
                <div class="objective-group__footer ${
                  isWarning ? "objective-group__footer--warning" : ""
                }">
                    Total: ${totalCount} Required minimum: 5 (${
                    totalCount >= 5 ? "≥5" : "<5"
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
  const bloomChips = bloomLevels
    .map((level) => {
      const isSelected = item.bloom.includes(level);
      const isDisabled = item.mode === "auto";
      return `
            <button type="button" 
                class="bloom-chip ${isSelected ? "bloom-chip--selected" : ""} ${
        isDisabled ? "bloom-chip--disabled" : ""
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
            <button type="button" class="bloom-mode-btn bloom-mode-btn--inactive" onclick="setBloomMode(${groupId}, ${item.id}, 'auto')">AI decide later</button>
        </div>
    `
      : `
        <div class="bloom-mode-toggle">
            <button type="button" class="bloom-mode-btn bloom-mode-btn--inactive" onclick="setBloomMode(${groupId}, ${item.id}, 'manual')">Choose Bloom</button>
            <button type="button" class="bloom-mode-btn bloom-mode-btn--active">AI decide later</button>
            <span class="auto-pill">Auto (pending)</span>
        </div>
    `;

  const isSubLO = item.level === 2;
  const indentClass = isSubLO ? "objective-item--sub" : "";
  const subLOBadge = isSubLO ? '<span class="sub-lo-badge">Sub-LO</span>' : "";

  return `
        <div class="objective-item ${indentClass}" data-item-id="${
    item.id
  }" data-parent-id="${item.parentId || ""}">
            <div class="objective-item__checkbox-wrapper">
                <input type="checkbox" 
                    class="objective-item__checkbox" 
                    ${item.selected ? "checked" : ""} 
                    onchange="toggleGranularSelection(${groupId}, ${item.id})"
                    aria-label="Select ${item.text}"
                >
            </div>
            <button type="button" class="objective-item__delete" onclick="confirmDeleteObjective(${groupId}, ${
    item.id
  })" aria-label="Remove objective">
                ×
            </button>
            <div class="objective-item__content">
                <div class="objective-item__header">
                    <div class="objective-item__text" contenteditable="true" onblur="updateObjectiveText(${groupId}, ${
    item.id
  }, this.textContent)">
                        ${item.text}
                    </div>
                    ${subLOBadge}
                </div>
                <div class="objective-item__controls">
                    <div class="objective-item__bloom-chips">
                        ${bloomChips}
                    </div>
                    <div class="objective-item__min">Min: ${
                      item.minQuestions
                    }</div>
                    ${bloomModeToggle}
                </div>
            </div>
            <div class="objective-item__tools">
                <div class="objective-item__stepper">
                    <button type="button" class="stepper-btn" onclick="decrementCount(${groupId}, ${
    item.id
  })" ${item.count <= item.minQuestions ? "disabled" : ""}>
                        –
                    </button>
                    <span class="stepper-value">${item.count}</span>
                    <button type="button" class="stepper-btn" onclick="incrementCount(${groupId}, ${
    item.id
  })" ${item.count >= 9 ? "disabled" : ""}>
                        +
                    </button>
                </div>
                <button type="button" class="objective-item__action-btn" onclick="editObjective(${groupId}, ${
    item.id
  })" title="Edit objective">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button type="button" class="objective-item__action-btn objective-item__action-btn--disabled" title="Connect AI later" disabled>
                    <i class="fas fa-sync-alt"></i>
                </button>
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

function updateObjectiveText(groupId, itemId, text) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  const item = group?.items.find((i) => i.id === itemId);

  if (item) {
    item.text = text;
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

function editObjective(groupId, itemId) {
  const itemElement = document.querySelector(
    `[data-item-id="${itemId}"] .objective-item__text`
  );
  if (itemElement) {
    itemElement.focus();
    itemElement.classList.add("objective-item__text--editing");

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(itemElement);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function confirmDeleteObjective(groupId, itemId) {
  state.objectiveToDelete = { groupId, itemId };
  const modal = document.getElementById("delete-confirmation-modal");
  if (modal) {
    modal.style.display = "flex";
  }
}

function deleteObjective(groupId, itemId) {
  const group = state.objectiveGroups.find((g) => g.id === groupId);
  if (group) {
    const index = group.items.findIndex((i) => i.id === itemId);
    if (index > -1) {
      const removedItem = group.items[index];
      group.items.splice(index, 1);

      // If group becomes empty, remove it and renumber
      if (group.items.length === 0) {
        const groupIndex = state.objectiveGroups.findIndex(
          (g) => g.id === groupId
        );
        if (groupIndex > -1) {
          state.objectiveGroups.splice(groupIndex, 1);
          renumberObjectiveGroups();
        }
      }

      renderObjectiveGroups();
      announceToScreenReader(`Removed objective: ${removedItem.text}`);
    }
  }
}

function initializeModals() {
  // Custom objective modal
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
    customModalSave.addEventListener("click", handleCustomObjectiveSubmission);
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
  if (deleteModalConfirm) {
    deleteModalConfirm.addEventListener("click", () => {
      if (state.objectiveToDelete) {
        deleteObjective(
          state.objectiveToDelete.groupId,
          state.objectiveToDelete.itemId
        );
        state.objectiveToDelete = null;
        hideModal(deleteModal);
      }
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

// ===== STEP 5: EXPORT FORMAT FUNCTIONS =====

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

// ===== STEP 4: QUESTIONS FUNCTIONS =====

async function generateQuestions() {
  const questionsLoading = document.getElementById("questions-loading");
  const questionsList = document.getElementById("questions-list");

  if (questionsLoading) questionsLoading.style.display = "block";
  if (questionsList) questionsList.style.display = "none";

  try {
    console.log("=== QUESTION GENERATION DEBUG ===");
    console.log("Starting question generation with:", {
      course: state.course,
      summaryLength: state.summary.length,
      objectiveGroupsCount: state.objectiveGroups.length,
      questionGenerator: !!questionGenerator,
    });

    // Log the content summary
    console.log("=== CONTENT SUMMARY ===");
    console.log("Summary:", state.summary);
    console.log("Summary length:", state.summary.length);

    // Log objective groups
    console.log("=== OBJECTIVE GROUPS ===");
    console.log("Number of groups:", state.objectiveGroups.length);
    state.objectiveGroups.forEach((group, index) => {
      console.log(`Group ${index + 1}:`, {
        title: group.title,
        itemsCount: group.items.length,
        items: group.items.map((item) => ({
          id: item.id,
          text: item.text,
          bloom: item.bloom,
          count: item.count,
        })),
      });
    });

    // Log uploaded files
    console.log("=== UPLOADED FILES ===");
    console.log("Files count:", state.files.length);
    state.files.forEach((file, index) => {
      console.log(`File ${index + 1}:`, {
        name: file.name,
        type: file.type,
        contentLength: file.content ? file.content.length : 0,
        hasContent: !!file.content,
      });
    });

    // Log URLs
    console.log("=== URLS ===");
    console.log("URLs count:", state.urls.length);
    state.urls.forEach((url, index) => {
      console.log(`URL ${index + 1}:`, url.url);
    });

    // Generate questions using question generator
    console.log("=== CALLING QUESTION GENERATOR ===");
    const questions = await questionGenerator.generateQuestions(
      state.course,
      state.summary,
      state.objectiveGroups
    );

    console.log("=== GENERATED QUESTIONS ===");
    console.log("Questions count:", questions.length);
    questions.forEach((question, index) => {
      console.log(`Question ${index + 1}:`, {
        id: question.id,
        text: question.text,
        type: question.type,
        bloomLevel: question.bloomLevel,
        difficulty: question.difficulty,
        metaCode: question.metaCode,
        loCode: question.loCode,
        by: question.by,
      });
    });

    state.questions = questions;
    setTimeout(() => saveState(), 500); // Save state after questions are generated
  } catch (error) {
    console.error("Question generation failed:", error);

    // Try to generate at least some questions using fallback
    try {
      console.log("Attempting fallback question generation...");
      const fallbackQuestions =
        await questionGenerator.generateGeneralQuestions(
          state.course,
          state.summary
        );
      state.questions = fallbackQuestions;
      console.log("Fallback questions generated:", fallbackQuestions.length);
    } catch (fallbackError) {
      console.error("Fallback generation also failed:", fallbackError);

      // Last resort: create basic questions from objectives
      state.questions = state.objectiveGroups.flatMap((group) =>
        group.items.map((item) => ({
          id: `${item.id}-fallback`,
          text: `Based on the uploaded materials, which of the following best relates to: ${item.text}?`,
          type: "multiple-choice",
          options: [
            "The most accurate answer based on course content",
            "A partially correct answer",
            "An answer that doesn't relate to the objective",
            "An incorrect answer",
          ],
          correctAnswer: 0,
          bloomLevel: item.bloom[0] || "Understand",
          difficulty: "Medium",
          metaCode: group.title,
          loCode: item.text,
          lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
          by: "Fallback System",
        }))
      );

      console.log("Created basic fallback questions:", state.questions.length);
    }
  }

  if (questionsLoading) questionsLoading.style.display = "none";
  if (questionsList) questionsList.style.display = "block";

  renderQuestions();
}

function prepareContentForQuestions() {
  let content = `Summary: ${state.summary}\n\n`;
  content += `Objectives:\n`;
  state.objectiveGroups.forEach((group) => {
    group.items.forEach((item) => {
      content += `- ${item.text} (${item.bloom.join(", ")}) Min: ${
        item.minQuestions
      }, Count: ${item.count}\n`;
    });
  });
  content += `\nGenerate multiple choice questions based on this content.`;

  return content;
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
      return `<li class="question-item__option ${
        isCorrect ? "question-item__option--correct" : ""
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

// ===== STEP 5: SELECT OUTPUT FORMAT FUNCTIONS =====

function initializeStep5() {
  console.log("initializeStep5 called");

  // Set up event listeners for Step 5
  setupStep5EventListeners();

  // Initialize the view
  updateStep5UI();

  // Ensure initial state is reflected in UI
  updateSelectedFormatsCount();
  updateExportButtonState();
  updateNamingConventionPanel();

  console.log("Step 5 initialized with state:", {
    formats: state.formats,
    namingConvention: state.namingConvention,
    saveAsDefault: state.saveAsDefault,
  });
}

function setupStep5EventListeners() {
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

  // Export summary modal buttons - these will be re-initialized when modal is shown
  // since the modal content is dynamically generated
  // We set up the modal container click handler here
  const exportSummaryModal = document.getElementById("export-summary-modal");
  if (exportSummaryModal) {
    // Close modal when clicking outside
    if (window.ButtonUtils) {
      window.ButtonUtils.safeAddEventListener(exportSummaryModal, "click", (e) => {
        if (e.target === exportSummaryModal) {
          hideExportSummaryModal();
        }
      });
    } else {
      exportSummaryModal.addEventListener("click", (e) => {
        if (e.target === exportSummaryModal) {
          hideExportSummaryModal();
        }
      });
    }
  }

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
  updateStep5UI();
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

function updateStep5UI() {
  console.log("updateStep5UI called");
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

    if (state.step === 5) {
      continueBtn.textContent = "Export Now";
      
      // Remove existing click handlers to prevent duplicates
      const newContinueBtn = continueBtn.cloneNode(true);
      continueBtn.parentNode.replaceChild(newContinueBtn, continueBtn);
      
      // Add click handler to show export summary modal
      if (window.ButtonUtils) {
        window.ButtonUtils.safeAddEventListener(newContinueBtn, "click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!newContinueBtn.disabled) {
            showExportSummaryModal();
          }
        });
      } else {
        newContinueBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!newContinueBtn.disabled) {
            showExportSummaryModal();
          }
        });
      }
    }
  }
}

function showExportSummaryModal() {
  const modal = document.getElementById("export-summary-modal");
  const modalBody = document.getElementById("export-summary-modal-body");

  if (modal && modalBody) {
    modalBody.innerHTML = generateExportSummaryHTML();
    modal.style.display = "flex";
    document.body.style.overflow = "hidden"; // Prevent background scrolling

    // Re-initialize event listeners for modal buttons (they're in the dynamically generated HTML)
    setTimeout(() => {
      const closeBtn = document.getElementById("export-summary-modal-close");
      const cancelBtn = document.getElementById("export-summary-cancel");
      const confirmBtn = document.getElementById("export-summary-confirm");
      
      if (closeBtn) {
        if (window.ButtonUtils) {
          window.ButtonUtils.safeAddEventListener(closeBtn, "click", hideExportSummaryModal);
        } else {
          closeBtn.addEventListener("click", hideExportSummaryModal);
        }
      }
      
      if (cancelBtn) {
        if (window.ButtonUtils) {
          window.ButtonUtils.safeAddEventListener(cancelBtn, "click", hideExportSummaryModal);
        } else {
          cancelBtn.addEventListener("click", hideExportSummaryModal);
        }
      }
      
      if (confirmBtn) {
        if (window.ButtonUtils) {
          window.ButtonUtils.preventDoubleClick(confirmBtn, handleExportConfirm);
        } else {
          confirmBtn.addEventListener("click", handleExportConfirm);
        }
      }
      
      // Close modal when clicking outside
      if (window.ButtonUtils) {
        window.ButtonUtils.safeAddEventListener(modal, "click", (e) => {
          if (e.target === modal) {
            hideExportSummaryModal();
          }
        });
      } else {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) {
            hideExportSummaryModal();
          }
        });
      }
      
      // Focus trap
      if (closeBtn) closeBtn.focus();
    }, 100);
  }
}

async function handleExportConfirm() {
  console.log("Export confirmed, starting export process...");
  
  // Get all selected formats
  const formatsToExport = [];
  if (state.formats.canvasSingle.selected) {
    formatsToExport.push({
      format: 'canvasSingle',
      type: 'qti',
      name: generateQuizName('canvasSingle', 1),
    });
  }
  if (state.formats.canvasSpaced.selected) {
    // Split questions into multiple quizzes for spaced repetition
    const totalQuestions = getTotalQuestionsCount();
    const quizCount = Math.max(1, Math.ceil(totalQuestions / 10)); // ~10 questions per quiz
    for (let i = 1; i <= quizCount; i++) {
      formatsToExport.push({
        format: 'canvasSpaced',
        type: 'qti',
        name: generateQuizName('canvasSpaced', i),
        quizNumber: i,
        totalQuizzes: quizCount,
      });
    }
  }
  if (state.formats.h5p.selected) {
    formatsToExport.push({
      format: 'h5p',
      type: 'h5p',
      name: 'h5p-questions',
    });
  }

  if (formatsToExport.length === 0) {
    showNotification("Please select at least one export format.", "warning");
    return;
  }

  // Show loading state
  const exportConfirmBtn = document.getElementById("export-summary-confirm");
  if (exportConfirmBtn) {
    exportConfirmBtn.disabled = true;
    exportConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
  }

  try {
    // Collect all unique questions to save to question bank (avoid duplicates)
    const allQuestionsToSave = new Map(); // Use Map to track unique questions by ID
    
    // Export each format
    for (const exportConfig of formatsToExport) {
      await exportQuizFormat(exportConfig);
      
      // Small delay between exports to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // After all exports, collect unique questions from the first format
    // (we don't want to save duplicates for each format)
    if (formatsToExport.length > 0) {
      const firstFormatQuestions = getQuestionsForExport(formatsToExport[0]);
      firstFormatQuestions.forEach((q) => {
        const questionId = q.id || `${q.text || q.question || ''}_${Date.now()}`;
        if (!allQuestionsToSave.has(questionId)) {
          allQuestionsToSave.set(questionId, q);
        }
      });
    }

    // Save all exported questions to question bank (only once, not per format)
    if (allQuestionsToSave.size > 0) {
      await saveQuestionsToQuestionBank(Array.from(allQuestionsToSave.values()));
    }

    showNotification(
      `Successfully exported ${formatsToExport.length} file(s) and saved ${allQuestionsToSave.size} question(s) to Question Bank!`,
      "success"
    );
    
    // Close modal after successful export
    hideExportSummaryModal();
    
    // Optionally navigate to question bank after a delay
    setTimeout(() => {
      if (confirm("Would you like to view your questions in the Question Bank?")) {
        window.location.href = "/question-bank.html";
      }
    }, 2000);
  } catch (error) {
    console.error("Export failed:", error);
    showNotification("Export failed. Please try again.", "error");
  } finally {
    // Restore button state
    if (exportConfirmBtn) {
      exportConfirmBtn.disabled = false;
      exportConfirmBtn.innerHTML = "Confirm Export";
    }
  }
}

// Get total questions count from question groups
function getTotalQuestionsCount() {
  let count = 0;
  if (state.questionGroups && Array.isArray(state.questionGroups)) {
    state.questionGroups.forEach((group) => {
      if (group.los && Array.isArray(group.los)) {
        group.los.forEach((lo) => {
          if (lo.questions && Array.isArray(lo.questions)) {
            count += lo.questions.length;
          }
        });
      }
    });
  }
  return count || (state.questions ? state.questions.length : 0);
}

// Get questions for a specific export config
function getQuestionsForExport(exportConfig) {
  const { format, quizNumber, totalQuizzes } = exportConfig;
  
  // Get all questions from question groups
  const allQuestions = [];
  if (state.questionGroups && Array.isArray(state.questionGroups)) {
    state.questionGroups.forEach((group) => {
      if (group.los && Array.isArray(group.los)) {
        group.los.forEach((lo) => {
          if (lo.questions && Array.isArray(lo.questions)) {
            lo.questions.forEach((q) => {
              allQuestions.push({
                ...q,
                metaCode: group.title,
                loCode: lo.text || lo.title,
              });
            });
          }
        });
      }
    });
  }
  
  // For spaced review, split questions
  if (format === 'canvasSpaced' && quizNumber && totalQuizzes) {
    const questionsPerQuiz = Math.ceil(allQuestions.length / totalQuizzes);
    const startIndex = (quizNumber - 1) * questionsPerQuiz;
    const endIndex = Math.min(startIndex + questionsPerQuiz, allQuestions.length);
    return allQuestions.slice(startIndex, endIndex);
  }
  
  return allQuestions;
}

// Save questions to question bank
async function saveQuestionsToQuestionBank(questions) {
  try {
    console.log(`Saving ${questions.length} questions to question bank...`);
    
    // Get course name from state
    const courseName = state.course || "General Course";
    const quizName = generateQuizName(state.formats.canvasSingle.selected ? 'canvasSingle' : 'canvasSpaced', 1);
    const quizWeek = `Week ${getCurrentWeek() || 1}`;
    
    // Transform questions to match question bank format
    const questionsToSave = questions.map((question, index) => ({
      courseName: courseName,
      quizName: quizName,
      quizWeek: quizWeek,
      learningObjective: question.loCode || question.metaCode || `LO ${index + 1}`,
      bloomsLevel: Array.isArray(question.bloom) ? question.bloom[0] : (question.bloom || question.bloomLevel || "Understand"),
      questionText: question.text || question.question || question.title || `Question ${index + 1}`,
      questionType: question.type || "multiple-choice",
      difficulty: question.difficulty || "medium",
      options: question.options || [],
      correctAnswer: question.correctAnswer || 0,
      explanation: question.explanation || "",
      status: "Draft",
      views: 0,
      flagged: false,
      published: false,
    }));
    
    // Save to backend
    const response = await fetch("/api/quiz-questions/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        courseName: courseName,
        quizName: quizName,
        quizWeek: quizWeek,
        questions: questionsToSave,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Saved ${result.insertedCount || questionsToSave.length} questions to question bank`);
      return result;
    } else {
      const errorData = await response.json().catch(() => ({ error: "Save failed" }));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Error saving questions to question bank:", error);
    // Don't throw - export should still succeed even if saving to bank fails
    showNotification("Questions exported but failed to save to Question Bank. You can add them manually.", "warning");
  }
}

async function exportQuizFormat(exportConfig) {
  const { format, type, name, quizNumber, totalQuizzes } = exportConfig;
  
  console.log(`Exporting ${format} format:`, exportConfig);

  // Get questions using the same logic as getQuestionsForExport
  let questionsToExport = getQuestionsForExport(exportConfig);

  if (questionsToExport.length === 0) {
    console.warn(`No questions to export for ${format}`);
    throw new Error(`No questions available to export for ${format}`);
  }
  
  console.log(`Exporting ${questionsToExport.length} questions for ${format}`);

  try {
    const response = await fetch(`/api/questions/export?format=${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        course: state.course,
        summary: state.summary,
        objectives: state.objectiveGroups,
        questions: questionsToExport,
        exportConfig: {
          format: format,
          quizName: name,
          quizNumber: quizNumber,
          totalQuizzes: totalQuizzes,
          namingConvention: state.namingConvention,
          releaseDate: format === 'canvasSingle' ? state.formats.canvasSingle.date : 
                       format === 'canvasSpaced' ? state.formats.canvasSpaced.date : null,
          releaseTime: format === 'canvasSingle' ? state.formats.canvasSingle.time : 
                       format === 'canvasSpaced' ? state.formats.canvasSpaced.time : null,
          releaseNow: format === 'canvasSingle' ? state.formats.canvasSingle.releaseNow : 
                      format === 'canvasSpaced' ? state.formats.canvasSpaced.releaseNow : false,
        },
      }),
    });

    if (response.ok) {
      const blob = await response.blob();
      const filename = getExportFilename(name, type, quizNumber);
      downloadFile(blob, filename);
      console.log(`✅ Exported ${filename}`);
    } else {
      const errorData = await response.json().catch(() => ({ error: "Export failed" }));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Error exporting ${format}:`, error);
    throw error;
  }
}

function generateQuizName(format, quizNumber = null) {
  const course = state.course || "Course";
  const convention = state.namingConvention || "module_week_quiz";
  
  switch (convention) {
    case "course_quiz":
      return quizNumber ? `${course} – Quiz ${quizNumber}` : `${course} – Quiz`;
    case "module_week_quiz":
      // Extract week number if available, otherwise use quiz number or current week
      const week = quizNumber || getCurrentWeek() || 1;
      return `Week ${String(week).padStart(2, '0')} – Quiz`;
    case "topic_date":
      const date = new Date().toISOString().split('T')[0];
      return `${course} – ${date}`;
    default:
      return quizNumber ? `${course} – Quiz ${quizNumber}` : `${course} – Quiz`;
  }
}

function getExportFilename(name, type, quizNumber = null) {
  const timestamp = Date.now();
  const extension = getFileExtension(type);
  
  let filename = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  
  if (quizNumber) {
    filename += `-${quizNumber}`;
  }
  
  filename += `-${timestamp}.${extension}`;
  
  return filename;
}

function getCurrentWeek() {
  // Calculate current week of the year
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const week = Math.floor(diff / oneDay / 7) + 1;
  return week;
}

function hideExportSummaryModal() {
  const modal = document.getElementById("export-summary-modal");
  if (modal) {
    modal.style.display = "none";
    document.body.style.overflow = ""; // Restore scrolling
    
    // Restore button states
    const exportConfirmBtn = document.getElementById("export-summary-confirm");
    if (exportConfirmBtn) {
      exportConfirmBtn.disabled = false;
      exportConfirmBtn.innerHTML = "Confirm Export";
    }
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
      html += ` - Scheduled for ${state.formats.canvasSingle.date}${
        state.formats.canvasSingle.time
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
      html += ` - Scheduled for ${state.formats.canvasSpaced.date}${
        state.formats.canvasSpaced.time
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

// Generate questions from uploaded content
let questionGenerationCancelled = false;

async function generateQuestionsFromContent() {
  console.log("=== GENERATING QUESTIONS FROM CONTENT ===");
  console.log("Summary length:", state.summary.length);
  console.log("Objective groups:", state.objectiveGroups.length);

  // Reset cancellation flag
  questionGenerationCancelled = false;

  // Show loading spinner with progress
  const questionsLoading = document.getElementById("questions-loading");
  const metaLoGroups = document.getElementById("meta-lo-groups");

  if (questionsLoading) {
    questionsLoading.style.display = "block";
    updateQuestionProgress(0, 0, "Starting question generation...");
  }
  if (metaLoGroups) metaLoGroups.style.display = "none";

  try {
    // Count total objectives for progress tracking
    let totalObjectives = 0;
    state.objectiveGroups.forEach(group => {
      totalObjectives += group.items.length;
    });

    // Progress callback
    const progressCallback = (processed, total, currentObjective, qNum, qTotal) => {
      if (questionGenerationCancelled) {
        throw new Error("Question generation cancelled by user");
      }
      
      const progress = total > 0 ? Math.round((processed / total) * 100) : 0;
      let message = `Processing objective ${processed} of ${total}`;
      if (currentObjective) {
        message += `: ${currentObjective.substring(0, 50)}${currentObjective.length > 50 ? '...' : ''}`;
      }
      if (qNum && qTotal) {
        message += ` (Question ${qNum}/${qTotal})`;
      }
      updateQuestionProgress(progress, processed, message);
    };

    // Generate questions using the question generator with progress tracking
    const questions = await questionGenerator.generateQuestions(
      state.course,
      state.summary,
      state.objectiveGroups,
      progressCallback
    );

    console.log("Generated questions:", questions.length);

    // Convert questions to question groups format
    state.questionGroups = convertQuestionsToGroups(questions);

    console.log("Question groups created:", state.questionGroups.length);

    // Save questions to localStorage for review access
    try {
      const questionsForReview = {
        questionGroups: state.questionGroups,
        timestamp: Date.now(),
        course: state.course,
      };
      localStorage.setItem('questionsForReview', JSON.stringify(questionsForReview));
      console.log("Questions saved for review");
    } catch (error) {
      console.error("Error saving questions for review:", error);
    }

    // Update the UI
    renderStep4();
    
    // Show success message
    showNotification(
      `Successfully generated ${questions.length} question(s) from ${totalObjectives} objective(s)`,
      "success"
    );
  } catch (error) {
    console.error("Failed to generate questions from content:", error);
    
    if (error.message.includes("cancelled")) {
      showNotification("Question generation cancelled", "info");
      return;
    }

    // Fallback to template-based generation
    console.log("Falling back to fast template generation...");
    try {
      const templateQuestions = generateTemplateQuestions(state.objectiveGroups);
      state.questionGroups = convertQuestionsToGroups(templateQuestions);
      renderStep4();
      showNotification(
        `Generated ${templateQuestions.length} template questions (LLM unavailable or timed out)`,
        "warning"
      );
    } catch (fallbackError) {
      console.error("Template generation also failed:", fallbackError);
      // Last resort: sample data
      state.questionGroups = JSON.parse(JSON.stringify(SAMPLE_QUESTION_DATA));
      console.log("Fell back to sample data");
      renderStep4();
      showNotification("Using sample questions. Please try again later.", "error");
    }
  } finally {
    // Hide loading spinner
    if (questionsLoading) {
      questionsLoading.style.display = "none";
      updateQuestionProgress(0, 0, "");
    }
    if (metaLoGroups) metaLoGroups.style.display = "block";
  }
}

// Update question generation progress
function updateQuestionProgress(percentage, processed, message) {
  const questionsLoading = document.getElementById("questions-loading");
  if (!questionsLoading) return;

  // Update progress text
  const progressText = questionsLoading.querySelector("p");
  if (progressText) {
    if (message) {
      progressText.innerHTML = `
        <div style="margin-bottom: 10px;">${message}</div>
        <div style="font-size: 14px; color: #7f8c8d;">Progress: ${percentage}% (${processed} objectives processed)</div>
      `;
    } else {
      progressText.textContent = "Generating questions...";
    }
  }

  // Add progress bar if it doesn't exist
  let progressBar = questionsLoading.querySelector(".progress-bar");
  if (!progressBar) {
    progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.style.cssText = `
      width: 100%;
      height: 6px;
      background: #e0e0e0;
      border-radius: 3px;
      margin-top: 15px;
      overflow: hidden;
    `;
    const progressFill = document.createElement("div");
    progressFill.className = "progress-fill";
    progressFill.style.cssText = `
      height: 100%;
      background: linear-gradient(90deg, #3498db, #2980b9);
      width: ${percentage}%;
      transition: width 0.3s ease;
    `;
    progressBar.appendChild(progressFill);
    questionsLoading.appendChild(progressBar);
  } else {
    const progressFill = progressBar.querySelector(".progress-fill");
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
  }

  // Add cancel button if it doesn't exist
  let cancelBtn = questionsLoading.querySelector(".cancel-generation-btn");
  if (!cancelBtn) {
    cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel-generation-btn";
    cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
    cancelBtn.style.cssText = `
      margin-top: 15px;
      padding: 8px 16px;
      background: #e74c3c;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    `;
    cancelBtn.addEventListener("click", () => {
      questionGenerationCancelled = true;
      cancelBtn.disabled = true;
      cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
    });
    questionsLoading.appendChild(cancelBtn);
  }
}

// Generate template questions as fast fallback
function generateTemplateQuestions(objectiveGroups) {
  const questions = [];
  
  objectiveGroups.forEach((group, groupIndex) => {
    group.items.forEach((objective, objIndex) => {
      const bloomLevel = Array.isArray(objective.bloom) ? objective.bloom[0] : (objective.bloom || "Understand");
      const count = objective.count || 2;
      
      for (let i = 0; i < count; i++) {
        questions.push({
          id: `${objective.id}-${i + 1}`,
          text: `Question about: ${objective.text}`,
          type: "multiple-choice",
          options: [
            "Option A (correct)",
            "Option B",
            "Option C",
            "Option D"
          ],
          correctAnswer: 0,
          bloomLevel: bloomLevel,
          difficulty: "Medium",
          metaCode: group.title,
          loCode: objective.text,
          lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
          by: "Template System",
        });
      }
    });
  });
  
  return questions;
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
      const bloomLevels = [...new Set(groupQuestions.map((q) => q.bloomLevel))];

      const group = {
        id: index + 1,
        title: metaCode,
        isOpen: index === 0,
        stats: {
          configured: totalQuestions,
          min: Math.max(1, Math.floor(totalQuestions * 0.6)), // At least 60% of questions
          bloomSummary: bloomLevels.slice(0, 3).join("/"), // First 3 bloom levels
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
            },
          ],
        })),
      };

      groups.push(group);
    }
  );

  return groups;
}

function initializeStep4() {
  console.log("initializeStep4 called");

  // Clear any existing questions
  state.questions = [];
  state.questionGroups = [];

  // Generate questions from uploaded content instead of loading sample data
  if (state.summary && state.objectiveGroups.length > 0) {
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

  // Set up event listeners for Step 4
  setupStep4EventListeners();

  // Render the initial view
  renderStep4();
}

function setupStep4EventListeners() {
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
  const addSelectedToBankBtn = document.getElementById(
    "add-selected-to-bank-btn"
  );

  if (regenerateAllBtn)
    regenerateAllBtn.addEventListener("click", handleRegenerateAll);
  if (exportBtn) exportBtn.addEventListener("click", handleExport);
  if (addToBankBtn) addToBankBtn.addEventListener("click", handleAddToBank);
  if (addSelectedToBankBtn)
    addSelectedToBankBtn.addEventListener("click", handleAddSelectedToBank);

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

function renderStep4() {
  const metaLoGroups = document.getElementById("meta-lo-groups");
  if (!metaLoGroups) return;

  const filteredGroups = getFilteredGroups();

  if (filteredGroups.length === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();

  metaLoGroups.innerHTML = filteredGroups
    .map(
      (group) => `
        <div class="meta-lo-group ${
          group.isOpen ? "meta-lo-group--expanded" : "meta-lo-group--collapsed"
        }" data-group-id="${group.id}">
            <div class="meta-lo-group__header" onclick="toggleMetaLoGroup('${
              group.id
            }')">
                <h3 class="meta-lo-group__title">${group.title}</h3>
                <div class="meta-lo-group__stats">
                    <div class="meta-lo-group__stat">
                        <span>Configured: ${group.stats.configured}</span>
                    </div>
                    <div class="meta-lo-group__stat">
                        <span>Minimum: ${group.stats.min}</span>
                    </div>
                    <div class="meta-lo-group__stat">
                        <span>Bloom: ${group.stats.bloomSummary}</span>
                    </div>
                    <div class="meta-lo-group__toggle">
                        <span>${group.isOpen ? "Collapse" : "Expand"}</span>
                        <i class="fas fa-chevron-down"></i>
                    </div>
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
  const isSelected = state.selectedQuestions.has(question.id);
  const isEditing = question.isEditing || false;

  return `
        <div class="question-card" data-question-id="${question.id}">
            <div class="question-card__header">
                <input type="checkbox" class="question-card__checkbox" 
                       ${isSelected ? "checked" : ""} 
                       onchange="toggleQuestionSelection('${question.id}')">
                <div class="question-card__content">
                    ${
                      isEditing
                        ? `<input type="text" class="question-card__title--editing" value="${question.title}" onblur="saveQuestionEdit('${question.id}')">`
                        : `<h5 class="question-card__title">${question.title}</h5>`
                    }
                    <div class="question-card__chips">
                        <span class="question-card__chip question-card__chip--meta">${
                          question.metaCode
                        }</span>
                        <span class="question-card__chip question-card__chip--lo">${
                          question.loCode
                        }</span>
                        <span class="question-card__chip question-card__chip--bloom">Bloom: ${
                          question.bloom
                        }</span>
                    </div>
                </div>
                <div class="question-card__metadata">
                    <div class="question-card__status">
                        <span class="status-pill status-pill--${question.status.toLowerCase()}">${
    question.status
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
                        <div class="question-card__option ${
                          isEditing ? "question-card__option--editing" : ""
                        }">
                            <input type="radio" name="q-${
                              question.id
                            }" value="${option.id}" ${
                          option.isCorrect ? "checked" : ""
                        } disabled>
                            ${
                              isEditing
                                ? `<input type="text" value="${option.text}" onblur="saveOptionEdit('${question.id}', '${option.id}', this.value)">`
                                : `<label>${option.id}. ${option.text}</label>`
                            }
                        </div>
                        <div class="question-card__feedback">${option.id} ${
                          option.isCorrect ? "Correct" : "Incorrect"
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
                    <button type="button" class="question-card__action-btn question-card__action-btn--regenerate" 
                            onclick="regenerateQuestion('${
                              question.id
                            }')" disabled 
                            title="Connect AI later">
                        Regenerate
                    </button>
                    <button type="button" class="question-card__action-btn question-card__action-btn--flag" 
                            onclick="toggleQuestionFlag('${question.id}')"
                            ${
                              question.status === "Flagged"
                                ? 'style="background: #ffebee; color: #d32f2f;"'
                                : ""
                            }>
                        ${question.status === "Flagged" ? "Unflag" : "Flag"}
                    </button>
                    <button type="button" class="question-card__action-btn question-card__action-btn--approve" 
                            onclick="toggleQuestionApproval('${question.id}')"
                            ${
                              question.status === "Approved"
                                ? 'style="background: #e8f5e8; color: #388e3c;"'
                                : ""
                            }>
                        ${
                          question.status === "Approved"
                            ? "Unapprove"
                            : "Approve"
                        }
                    </button>
                    <button type="button" class="question-card__action-btn question-card__action-btn--delete" 
                            onclick="deleteQuestion('${question.id}')">
                        Delete
                    </button>
                </div>
                ${
                  isEditing
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

function toggleMetaLoGroup(groupId) {
  const group = state.questionGroups.find((g) => g.id === groupId);
  if (group) {
    group.isOpen = !group.isOpen;
    renderStep4();
  }
}

function toggleQuestionSelection(questionId) {
  if (state.selectedQuestions.has(questionId)) {
    state.selectedQuestions.delete(questionId);
  } else {
    state.selectedQuestions.add(questionId);
  }

  updateSelectionUI();
}

function updateSelectionUI() {
  const stickyBottomActions = document.getElementById("sticky-bottom-actions");
  const selectionCount = document.querySelector(".selection-count");

  if (state.selectedQuestions.size > 0) {
    stickyBottomActions.style.display = "flex";
    if (selectionCount) {
      selectionCount.textContent = `${state.selectedQuestions.size} question${
        state.selectedQuestions.size === 1 ? "" : "s"
      } selected`;
    }
  } else {
    stickyBottomActions.style.display = "none";
  }
}

function handleFilterChange() {
  const gloFilter = document.getElementById("glo-filter");
  const bloomFilter = document.getElementById("bloom-filter");
  const statusFilter = document.getElementById("status-filter");

  state.filters.glo = gloFilter ? gloFilter.value : "all";
  state.filters.bloom = bloomFilter ? bloomFilter.value : "all";
  state.filters.status = statusFilter ? statusFilter.value : "all";

  renderStep4();
}

function handleSearchChange() {
  const searchInput = document.getElementById("search-input");
  state.filters.q = searchInput ? searchInput.value : "";

  renderStep4();
}

async function handleRegenerateAll() {
  console.log("=== REGENERATING ALL QUESTIONS FROM CONTENT ===");

  // Show loading state
  const regenerateAllBtn = document.getElementById("regenerate-all-btn");
  const questionsLoading = document.getElementById("questions-loading");
  const metaLoGroups = document.getElementById("meta-lo-groups");

  if (regenerateAllBtn) {
    const originalText = regenerateAllBtn.textContent;
    regenerateAllBtn.textContent = "Regenerating...";
    regenerateAllBtn.disabled = true;
  }

  // Show loading spinner
  if (questionsLoading) questionsLoading.style.display = "block";
  if (metaLoGroups) metaLoGroups.style.display = "none";

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
    showToast("Failed to regenerate questions", "error");
  } finally {
    // Restore button state
    if (regenerateAllBtn) {
      regenerateAllBtn.textContent = originalText;
      regenerateAllBtn.disabled = false;
    }

    // Hide loading spinner
    if (questionsLoading) questionsLoading.style.display = "none";
    if (metaLoGroups) metaLoGroups.style.display = "block";
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

function handleAddToBank() {
  // Add all questions to question bank
  const allQuestionIds = new Set();
  state.questionGroups.forEach((group) => {
    group.los.forEach((lo) => {
      lo.questions.forEach((question) => {
        allQuestionIds.add(question.id);
      });
    });
  });

  state.selectedQuestions = allQuestionIds;
  handleAddSelectedToBank();
}

function handleAddSelectedToBank() {
  if (state.selectedQuestions.size === 0) {
    showToast("No questions selected", "warning");
    return;
  }

  showToast(
    `Added ${state.selectedQuestions.size} question${
      state.selectedQuestions.size === 1 ? "" : "s"
    } to Question Bank`,
    "success"
  );
  state.selectedQuestions.clear();
  updateSelectionUI();

  // Navigate to question bank after a short delay to allow toast to show
  setTimeout(() => {
    window.location.href = "question-bank.html";
  }, 1500);
}

function editQuestion(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    question.isEditing = !question.isEditing;
    renderStep4();
  }
}

function saveQuestionEdit(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    // In a real app, you'd save the edited values here
    question.isEditing = false;
    renderStep4();
    showToast("Question updated successfully", "success");
  }
}

function saveOptionEdit(questionId, optionId, newText) {
  const question = findQuestionById(questionId);
  if (question && question.options[optionId]) {
    question.options[optionId].text = newText;
    showToast("Option updated successfully", "success");
  }
}

function regenerateQuestion(questionId) {
  // This would connect to AI in a real implementation
  showToast("AI connection required for regeneration", "info");
}

function toggleQuestionFlag(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    if (question.status === "Flagged") {
      question.status = "Draft";
    } else {
      question.status = "Flagged";
    }
    renderStep4();
    showToast(`Question ${question.status.toLowerCase()}`, "success");
  }
}

function toggleQuestionApproval(questionId) {
  const question = findQuestionById(questionId);
  if (question) {
    if (question.status === "Approved") {
      question.status = "Draft";
    } else {
      question.status = "Approved";
    }
    renderStep4();
    showToast(`Question ${question.status.toLowerCase()}`, "success");
  }
}

function deleteQuestion(questionId) {
  if (
    confirm(
      "Are you sure you want to delete this question? This action cannot be undone."
    )
  ) {
    // Remove from all groups
    state.questionGroups.forEach((group) => {
      group.los.forEach((lo) => {
        lo.questions = lo.questions.filter((q) => q.id !== questionId);
      });
    });

    // Remove from selection
    state.selectedQuestions.delete(questionId);

    renderStep4();
    showToast("Question deleted successfully", "success");
  }
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
  const emptyState = document.getElementById("empty-state");
  const metaLoGroups = document.getElementById("meta-lo-groups");

  if (emptyState) emptyState.style.display = "block";
  if (metaLoGroups) metaLoGroups.style.display = "none";
}

function hideEmptyState() {
  const emptyState = document.getElementById("empty-state");
  const metaLoGroups = document.getElementById("meta-lo-groups");

  if (emptyState) emptyState.style.display = "none";
  if (metaLoGroups) metaLoGroups.style.display = "block";
}

// ===== TOAST NOTIFICATIONS =====

function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = "toast";

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

// ===== STEP 5: EXPORT FUNCTIONS =====

async function exportQuestions() {
  const format = state.exportFormat;

  try {
    const response = await fetch(`/api/questions/export?format=${format}`, {
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
    csv += `"${q.text}","${q.options[0]}","${q.options[1]}","${
      q.options[2]
    }","${q.options[3]}","${q.options[q.correctAnswer]}","${q.bloomLevel}","${
      q.difficulty
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
window.removeFile = removeFile;
window.removeUrl = removeUrl;
window.toggleObjectiveGroup = toggleObjectiveGroup;
window.toggleBloomChip = toggleBloomChip;
window.setBloomMode = setBloomMode;
window.updateObjectiveText = updateObjectiveText;
window.incrementCount = incrementCount;
window.decrementCount = decrementCount;
window.editObjective = editObjective;
window.confirmDeleteObjective = confirmDeleteObjective;
window.toggleGroupSelection = toggleGroupSelection;
window.selectAllGroups = selectAllGroups;
window.deleteSelectedGroups = deleteSelectedGroups;
window.toggleGranularSelection = toggleGranularSelection;
window.selectAllGranularInGroup = selectAllGranularInGroup;
window.deleteSelectedGranular = deleteSelectedGranular;
window.showGranularizationModal = showGranularizationModal;
window.refreshMetaObjectives = refreshMetaObjectives;
window.regenerateAllObjectivesFromContent = regenerateAllObjectivesFromContent;
window.handleGenerateObjectivesFromContent = handleGenerateObjectivesFromContent;

// Module functions for global access
window.generateSummary = generateSummary;
window.generateQuestions = generateQuestions;
window.contentGenerator = contentGenerator;
window.questionGenerator = questionGenerator;
window.pdfService = pdfService;

// Test function for debugging
window.testSummaryGeneration = async function () {
  console.log("Testing summary generation...");
  console.log("State:", state);
  console.log("Content generator:", contentGenerator);

  if (!contentGenerator) {
    console.error("Content generator not available!");
    return;
  }

  try {
    const summary = await contentGenerator.generateSummary(
      state.course,
      state.files,
      state.urls
    );
    console.log("Test summary:", summary);
    return summary;
  } catch (error) {
    console.error("Test failed:", error);
    return null;
  }
};

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

// Step 4 function exports
window.toggleMetaLoGroup = toggleMetaLoGroup;
window.toggleQuestionSelection = toggleQuestionSelection;
window.editQuestion = editQuestion;
window.saveQuestionEdit = saveQuestionEdit;
window.saveOptionEdit = saveOptionEdit;
window.regenerateQuestion = regenerateQuestion;
window.toggleQuestionFlag = toggleQuestionFlag;
window.toggleQuestionApproval = toggleQuestionApproval;
window.deleteQuestion = deleteQuestion;

// Step 5 function exports
window.handleFormatSelection = handleFormatSelection;
window.handleReleaseNowToggle = handleReleaseNowToggle;
window.handleDateChange = handleDateChange;
window.handleTimeChange = handleTimeChange;
window.handleNamingConventionChange = handleNamingConventionChange;
window.handleSaveAsDefaultChange = handleSaveAsDefaultChange;
