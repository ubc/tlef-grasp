// Question Bank Page JavaScript
// Handles interactions and functionality for the Question Bank layout

// Constants
const SELECTORS = {
  tabButton: '.tab-button',
  tabPanel: '.tab-panel',
  filtersSection: '.filters-section',
  quizFilter: 'quiz-filter',
  objectiveFilter: 'objective-filter',
  bloomFilter: 'bloom-filter',
  statusFilter: 'status-filter',
  flaggedFilter: 'flagged-filter',
  searchInput: 'search-input',
  materialFilter: 'material-filter',
  questionsTableBody: 'questions-table-body',
  selectAll: 'select-all',
  selectionCount: 'selection-count',
  actionBar: 'action-bar',
  approveBtn: 'approve-btn',
  unapproveBtn: 'unapprove-btn',
  flagBtn: 'flag-btn',
  deleteBtn: 'delete-btn',
  confirmModal: 'confirm-modal',
};

const API_ENDPOINTS = {
  currentUser: '/api/current-user',
  question: '/api/question',
  quiz: '/api/quiz',
  quizCourse: '/api/quiz/course',
  objective: '/api/objective',
  questionExport: '/api/question/export',
};

const STORAGE_KEYS = {
  selectedCourse: 'grasp-selected-course',
};

const TAB_NAMES = {
  overview: 'overview',
  objectives: "objectives",
};

const VALID_TABS = [TAB_NAMES.overview, TAB_NAMES.objectives];

const QUESTION_STATUS = {
  approved: 'Approved',
  draft: 'Draft',
  flagged: 'Flagged',
};

const NOTIFICATION_TIMEOUT = 3000;

/**
 * Convert MongoDB ID to string format consistently
 * @param {any} id - The ID to convert (can be ObjectId, string, or object with toString)
 * @returns {string} The ID as a string
 */
function toStringId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (id.toString) return id.toString();
  return String(id);
}

/**
 * Get ID from an object that may have _id or id property
 * @param {Object} obj - Object with _id or id property
 * @returns {string} The ID as a string
 */
function getObjectId(obj) {
  if (!obj) return '';
  return toStringId(obj._id || obj.id);
}

class QuestionBankPage {
  constructor() {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.selectedCourse) || '{}');
    this.courseId = selectedCourse.id || null;
    this.courseName = selectedCourse.courseName || '';

    // Get current tab from URL search params, default to "overview"
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    const defaultTab = tabParam && VALID_TABS.includes(tabParam)
      ? tabParam
      : TAB_NAMES.overview;

    // Check if flagged filter should be enabled from URL
    const flaggedParam = urlParams.get("flagged");
    const flaggedFilterEnabled = flaggedParam === "true";
    this.flaggedFilterEnabled = flaggedFilterEnabled; // Store for use in initializeEventListeners

    // Get material from URL search params
    const materialParam = urlParams.get('material') || 'all';

    this.state = {
      filters: {
        quiz: urlParams.get('quiz') || "all",
        objective: urlParams.get('objective') || "all",
        bloom: urlParams.get('bloom') || "all",
        status: urlParams.get('status') || "all",
        flagged: flaggedParam === "true",
        q: urlParams.get('q') || "",
        material: materialParam
      },
      sort: { key: "title", dir: "asc" },
      selectedQuestionIds: new Set(),
      currentTab: defaultTab,
    };

    this.questions = [];
    this.allQuizzes = []; // Store all quizzes for filter dropdown
    this.objectivesMap = new Map(); // Map objective ID to objective name
    this.isFaculty = false; // Cache faculty status
    this.detailedObjectives = []; // Store detailed objectives
    this.courseMaterials = []; // Store course materials
    this.init();
  }

  async init() {
    await this.loadUserInfo();
    this.initializeNavigation();
    this.initializeData();
    this.initializeEventListeners();
    this.initializePermissionBasedUI();

    // Set initial tab based on URL or default to overview
    await this.switchTab(this.state.currentTab);
  }

  async loadUserInfo() {
    try {
      const response = await fetch(API_ENDPOINTS.currentUser);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.isFaculty = data.user.isFaculty || false;
        }
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  }

  initializeNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }



  updateFilterOptions() {
    this.updateQuizFilter();
    this.updateLearningObjectivesFilter();
    this.updateBloomLevelsFilter();
    this.updateStatusFilter();
    this.updateMaterialFilter();
  }

  updateMaterialFilter() {
    const materialFilter = document.getElementById("material-filter");
    if (!materialFilter) return;

    const currentFilter = this.state.filters.material;

    // Clear existing options except "All Materials"
    materialFilter.innerHTML = '<option value="all">All Materials</option>';

    // Add materials from courseMaterials
    this.courseMaterials.forEach((material) => {
      const id = material.sourceId;
      const iconInfo = this.getMaterialIcon(material.fileType || '');
      const name = material.documentTitle || material.fileName || material.name || "Unnamed Material";
      
      const option = document.createElement("option");
      option.value = id;
      option.textContent = name;
      option.setAttribute('data-icon', iconInfo.icon);
      option.setAttribute('data-icon-color', iconInfo.color);
      materialFilter.appendChild(option);
    });

    // Set selected value
    materialFilter.value = currentFilter;

    // Initialize/Re-initialize Select2
    const self = this;
    $(materialFilter).select2({
      templateResult: formatMaterial,
      templateSelection: formatMaterial,
      escapeMarkup: function(m) { return m; },
      width: '100%',
      placeholder: "Search materials..."
    }).on('select2:open', function() {
      // Set placeholder for the search input in the dropdown
      const searchField = document.querySelector('.select2-search__field');
      if (searchField) {
        searchField.placeholder = "Search materials...";
      }
    });

    function formatMaterial(state) {
      if (!state.id) return state.text;
      
      let icon = 'fas fa-list';
      let color = '#3498db';
      
      if (state.id !== 'all') {
        const element = state.element;
        icon = $(element).data('icon') || 'fas fa-file-alt';
        color = $(element).data('icon-color') || '#6c757d';
      }
      
      return `<span><i class="${icon}" style="color: ${color}"></i>${state.text}</span>`;
    }

    // Handle Select2 change
    $(materialFilter).on('change', async (e) => {
      const newVal = e.target.value;
      if (self.state.filters.material !== newVal) {
        self.state.filters.material = newVal;
        self.updateUrlParams();
        await self.renderObjectives();
      }
    });
  }



  updateQuizFilter() {
    const quizFilter = document.getElementById("quiz-filter");
    if (!quizFilter) return;

    // Clear existing options except "All Quizzes"
    quizFilter.innerHTML = '<option value="all">All Quizzes</option>';

    // Add quizzes from allQuizzes
    this.allQuizzes.forEach((quiz) => {
      const option = document.createElement("option");
      option.value = quiz._id || quiz.id;
      option.textContent = quiz.name || "Unnamed Quiz";
      quizFilter.appendChild(option);
    });

    // Set selected value from state
    quizFilter.value = this.state.filters.quiz;
  }

  updateLearningObjectivesFilter() {
    const objectiveFilter = document.getElementById("objective-filter");
    if (!objectiveFilter) return;

    // Clear existing options except "All Objectives"
    objectiveFilter.innerHTML = '<option value="all">All Objectives</option>';

    // Collect unique learning objective IDs from questions
    const objectiveIds = new Set();
    this.questions.forEach((question) => {
      if (question.objectiveId) {
        objectiveIds.add(question.objectiveId);
      }
    });

    // Add objectives to filter using their names
    Array.from(objectiveIds)
      .map(id => ({
        id: id,
        name: this.objectivesMap.get(id) || `Objective ${id.substring(0, 8)}...`
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((objective) => {
        const option = document.createElement("option");
        option.value = objective.id;
        option.textContent = objective.name;
        objectiveFilter.appendChild(option);
      });

    // Set selected value from state
    objectiveFilter.value = this.state.filters.objective;
  }

  updateBloomLevelsFilter() {
    const bloomFilter = document.getElementById("bloom-filter");
    if (!bloomFilter) return;

    // Clear existing options except "All Bloom Levels"
    bloomFilter.innerHTML = '<option value="all">All Bloom Levels</option>';

    // Collect unique bloom levels from questions
    const bloomLevels = new Set();
    this.questions.forEach((question) => {
      if (question.bloom) {
        bloomLevels.add(question.bloom);
      }
    });

    // Add bloom levels to filter
    Array.from(bloomLevels)
      .sort()
      .forEach((bloom) => {
        const option = document.createElement("option");
        option.value = bloom;
        option.textContent = bloom;
        bloomFilter.appendChild(option);
      });

    // Set selected value from state
    bloomFilter.value = this.state.filters.bloom;
  }

  updateStatusFilter() {
    const statusFilter = document.getElementById("status-filter");
    if (!statusFilter) return;

    // Clear existing options except "All Statuses"
    statusFilter.innerHTML = '<option value="all">All Statuses</option>';

    // Always include Approved and Draft
    const requiredStatuses = ["Approved", "Draft"];
    requiredStatuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusFilter.appendChild(option);
    });

    // Collect unique statuses from questions (excluding already added ones)
    const statuses = new Set();
    this.questions.forEach((question) => {
      if (question.status && !requiredStatuses.includes(question.status)) {
        statuses.add(question.status);
      }
    });

    // Add other statuses to filter
    Array.from(statuses)
      .sort()
      .forEach((status) => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        statusFilter.appendChild(option);
      });

    // Set selected value from state
    statusFilter.value = this.state.filters.status;
  }

  async loadQuestionsForOverview() {
    if (!this.courseId) {
      this.questions = [];
      return;
    }

    try {
      const response = await fetch(`${API_ENDPOINTS.question}?courseId=${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.questions) {
        // Map questions from database format to Overview format
        this.questions = data.questions.map((question) => {
          const questionId = getObjectId(question);
          const objectiveId = toStringId(question.learningObjectiveId) || null;

          return {
            id: questionId,
            title: question.title || question.stem || "",
            stem: question.stem || question.title || "",
            objectiveId: objectiveId, // Store the objective ID
            glo: objectiveId || "", // Will be replaced with name after loading objectives
            bloom: question.bloom || question.bloomLevel || "Understand",
            flagged: question.flagStatus || false,
            published: question.published || false,
            status: question.status || "Draft",
            quizId: question.quizId || null, // Will be populated when we load quiz relationships
            granularObjectiveId: question.granularObjectiveId || null,
            parentObjectiveId: question.learningObjectiveId || question.parentObjectiveId || null,
          };
        });

        // Load learning objectives to get their names
        await this.loadLearningObjectives();

        // Update questions with objective names
        this.questions.forEach(question => {
          if (question.objectiveId && this.objectivesMap.has(question.objectiveId)) {
            question.glo = this.objectivesMap.get(question.objectiveId);
          }
        });

        // Load quiz relationships to populate quizId for each question
        await this.loadQuizRelationships();
      } else {
        this.questions = [];
      }
    } catch (error) {
      console.error('Error loading questions for overview:', error);
      this.questions = [];
    }
  }

  async loadLearningObjectives() {
    if (!this.courseId) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.objective}?courseId=${this.courseId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.objectives) {
          data.objectives.forEach(objective => {
            const objId = getObjectId(objective);
            this.objectivesMap.set(objId, objective.name || 'Unnamed Objective');
          });
        }
      }
    } catch (error) {
      console.error('Error loading learning objectives:', error);
    }
  }



  async loadQuizRelationships() {
    if (!this.courseId) return;

    try {
      const quizzesResponse = await fetch(`${API_ENDPOINTS.quizCourse}/${this.courseId}`);
      if (quizzesResponse.ok) {
        const quizzesData = await quizzesResponse.json();
        if (quizzesData.success && quizzesData.quizzes) {
          this.allQuizzes = quizzesData.quizzes;

          for (const quiz of this.allQuizzes) {
            const quizQuestionsResponse = await fetch(`${API_ENDPOINTS.quiz}/${quiz._id}/questions`);
            if (quizQuestionsResponse.ok) {
              const quizQuestionsData = await quizQuestionsResponse.json();
              if (quizQuestionsData.success && quizQuestionsData.questions) {
                const questionIds = new Set(
                  quizQuestionsData.questions.map(q => getObjectId(q))
                );

                this.questions.forEach(question => {
                  const questionId = toStringId(question.id);
                  if (questionIds.has(questionId)) {
                    question.quizId = getObjectId(quiz);
                    question.quizName = quiz.name;
                    question.isInPublishedQuiz = quiz.published || false;
                  }
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading quiz relationships:', error);
    }
  }

  async initializeData() {
    // Load questions for Overview tab from database
    await this.loadQuestionsForOverview();

    // Update filter options based on loaded data
    this.updateFilterOptions();
  }

  initializeEventListeners() {
    // Tab switching with URL update
    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        const tabName = button.getAttribute("data-tab");

        this.state.currentTab = tabName;
        this.updateUrlParams();

        await this.switchTab(tabName);
      });
    });

    // Handle browser back/forward buttons
    window.addEventListener("popstate", (e) => {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get("tab") || "overview";
      this.switchTab(tabParam);
    });

    // Filters (using the main filters section)
    const quizFilter = document.getElementById("quiz-filter");
    const objectiveFilter = document.getElementById("objective-filter");

    if (quizFilter) {
      quizFilter.addEventListener("change", async (e) => {
        this.state.filters.quiz = e.target.value;
        await this.applyFilters();
      });
    }
    const bloomFilter = document.getElementById("bloom-filter");
    const statusFilter = document.getElementById("status-filter");
    const flaggedFilter = document.getElementById("flagged-filter");
    const searchInput = document.getElementById("search-input");


    if (objectiveFilter) {
      objectiveFilter.addEventListener("change", async (e) => {
        this.state.filters.objective = e.target.value;
        await this.applyFilters();
      });
    }

    if (bloomFilter) {
      bloomFilter.addEventListener("change", async (e) => {
        this.state.filters.bloom = e.target.value;
        await this.applyFilters();
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener("change", async (e) => {
        this.state.filters.status = e.target.value;
        await this.applyFilters();
      });
    }

    if (flaggedFilter) {
      // Set initial state from URL parameter
      if (this.flaggedFilterEnabled) {
        flaggedFilter.checked = true;
      }
      flaggedFilter.addEventListener("change", async (e) => {
        this.state.filters.flagged = e.target.checked;
        await this.applyFilters();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", async (e) => {
        this.state.filters.q = e.target.value;
        await this.applyFilters();
      });
    }

    // Material filter group is handled inside updateMaterialFilter because it's re-rendered


    // Sortable headers
    this.initializeSortableHeaders();

    // Action buttons
    this.initializeActionButtons();


    // Modal events
    this.initializeModalEvents();
    this.initializeObjectiveEvents(); 
  }
  initializeSortableHeaders() {
    const sortableHeaders = document.querySelectorAll(".sortable-header");
    sortableHeaders.forEach((header) => {
      header.addEventListener("click", () => {
        const sortKey = header.getAttribute("data-sort");
        this.handleSort(sortKey);
      });
    });
  }

  initializeActionButtons() {
    const approveBtn = document.getElementById("approve-btn");
    const unapproveBtn = document.getElementById("unapprove-btn");
    const flagBtn = document.getElementById("flag-btn");
    const deleteBtn = document.getElementById("delete-btn");

    if (approveBtn) approveBtn.addEventListener("click", () => this.handleBulkApprove());
    if (unapproveBtn) unapproveBtn.addEventListener("click", () => this.handleBulkUnapprove());
    if (flagBtn) flagBtn.addEventListener("click", () => this.handleFlag());
    if (deleteBtn)
      deleteBtn.addEventListener("click", () => this.handleDelete());

    // Select all checkbox
    const selectAllCheckbox = document.getElementById("select-all");
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener("change", (e) =>
        this.handleSelectAll(e.target.checked)
      );
    }
  }


  initializeModalEvents() {
    const modal = document.getElementById("confirm-modal");
    const modalClose = document.getElementById("modal-close");
    const modalCancel = document.getElementById("modal-cancel");
    const modalConfirm = document.getElementById("modal-confirm");

    if (modalClose) {
      modalClose.addEventListener("click", () => this.hideModal());
    }
    if (modalCancel) {
      modalCancel.addEventListener("click", () => this.hideModal());
    }
    if (modalConfirm) {
      modalConfirm.addEventListener("click", () => this.confirmModalAction());
    }

    // Close modal on outside click
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          this.hideModal();
        }
      });
    }
  }

  // ==================== Permission & Authorization Helpers ====================

  /**
   * Check if user has faculty permissions, show error if not
   * @param {string} action - The action being attempted (for error message)
   * @returns {boolean} True if user is faculty, false otherwise
   */
  requireFaculty(action = "perform this action") {
    if (!this.isFaculty) {
      this.showNotification(`Only faculty can ${action}`, "error");
      return false;
    }
    return true;
  }

  /**
   * Check if user can edit a question (faculty can always edit, staff cannot edit approved questions)
   * @param {string} questionId - The question ID
   * @returns {boolean} True if user can edit the question
   */
  canEditQuestion(questionId) {
    if (this.isFaculty) return true; // Faculty can always edit

    // Non-faculty can only edit draft questions, not approved questions
    const question = this.questions.find(q => String(q.id || "") === String(questionId));
    if (question) {
      const status = question.status || "Draft";
      return status.toLowerCase() !== "approved";
    }



    return true; // Default to allowing edit if question not found
  }

  /**
   * Get permission-based HTML for conditional rendering
   * @param {string} html - HTML to render if user has permission
   * @param {boolean} hasPermission - Whether user has permission
   * @returns {string} HTML string or empty string
   */
  renderIfPermitted(html, hasPermission) {
    return hasPermission ? html : "";
  }

  /**
   * Initialize UI elements based on user permissions
   * Hides action bar, checkboxes, and buttons for non-faculty users
   */
  initializePermissionBasedUI() {
    if (this.isFaculty) return; // No need to hide anything for faculty

    // Elements to hide for non-faculty
    const elementsToHide = [
      { id: "action-bar", description: "action bar" },
      { id: "approve-btn", description: "approve button" },
      { id: "unapprove-btn", description: "unapprove button" },
      { id: "flag-btn", description: "flag button" },
      { id: "delete-btn", description: "delete button" },
    ];

    elementsToHide.forEach(({ id, description }) => {
      const element = document.getElementById(id);
      if (element) {
        element.style.display = "none";
      } else {
        console.warn(`Permission UI: Element "${id}" (${description}) not found`);
      }
    });

    // Hide select-all checkbox header cell
    const selectAllCheckbox = document.getElementById("select-all");
    if (selectAllCheckbox) {
      const selectAllCell = selectAllCheckbox.closest("th");
      if (selectAllCell) {
        selectAllCell.style.display = "none";
      }
    }
  }

  async switchTab(tabName) {
    this.state.currentTab = tabName;

    // Update tab button states
    const tabButtons = document.querySelectorAll(SELECTORS.tabButton);
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Show/hide filters section based on tab
    const filtersSection = document.querySelector(SELECTORS.filtersSection);
    if (filtersSection) {
      filtersSection.style.display = tabName === TAB_NAMES.overview ? 'block' : 'none';
    }

    // Hide all tab panels
    const tabPanels = document.querySelectorAll(SELECTORS.tabPanel);
    tabPanels.forEach((panel) => (panel.style.display = 'none'));

    // Show the selected tab panel
    const selectedPanel = document.getElementById(`${tabName}-panel`);
    if (selectedPanel) {
      selectedPanel.style.display = 'block';
    }

    // Update page title and render appropriate content
    const tabTitles = {
      [TAB_NAMES.overview]: 'Questions',
      [TAB_NAMES.review]: 'Quizzes',
      [TAB_NAMES.objectives]: 'Learning Objectives',
    };
    document.title = `${tabTitles[tabName] || 'Question Bank'} - Question Bank - GRASP`;

    if (tabName === TAB_NAMES.overview) {
      await this.renderOverview();
    } else if (tabName === TAB_NAMES.objectives) {
      await this.renderObjectives();
    }
  }

  async renderAll() {
    if (this.state.currentTab === TAB_NAMES.overview) {
      await this.renderOverview();
    } else if (this.state.currentTab === TAB_NAMES.objectives) {
      await this.renderObjectives();
    }
  }

  async renderOverview() {
    await this.loadQuestionsForOverview();
    this.renderQuestionsTable();
    this.updateActionButtons();
  }


  // Selection handlers
  handleSelectAll(checked) {
    const visibleQuestions = this.getFilteredQuestions();

    if (checked) {
      visibleQuestions.forEach((q) => {
        const id = String(q.id || "");
        this.state.selectedQuestionIds.add(id);
      });
    } else {
      visibleQuestions.forEach((q) => {
        const id = String(q.id || "");
        this.state.selectedQuestionIds.delete(id);
      });
    }

    this.renderQuestionsTable();
    this.updateActionButtons();
  }

  clearOutOfViewSelections() {
    const visibleQuestions = this.getFilteredQuestions();
    const visibleIds = new Set(visibleQuestions.map((q) => String(q.id || "")));

    // Remove selections for questions no longer visible
    for (const selectedId of this.state.selectedQuestionIds) {
      if (!visibleIds.has(String(selectedId))) {
        this.state.selectedQuestionIds.delete(selectedId);
      }
    }
  }

  // Action handlers for Overview tab
  async handleFlag() {
    if (!this.requireFaculty("bulk flag questions")) return;

    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    // Disable button during operation
    const flagBtn = document.getElementById("flag-btn");
    if (flagBtn) flagBtn.disabled = true;

    try {
      // Determine if we're flagging or unflagging based on first question
      const firstQuestion = this.questions.find((q) =>
        String(q.id || "") === String(selectedQuestions[0])
      );
      const shouldFlag = !firstQuestion?.flagged;

      // Update all selected questions
      const updatePromises = selectedQuestions.map(async (id) => {
        const question = this.questions.find((q) => toStringId(q.id) === toStringId(id));
        if (!question) return { success: false, id };

        try {
          const response = await fetch(`${API_ENDPOINTS.question}/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              flagStatus: shouldFlag,
            }),
          });

          if (response.ok) {
            question.flagged = shouldFlag;
            return { success: true, id };
          }
          return { success: false, id };
        } catch {
          return { success: false, id };
        }
      });

      const results = await Promise.all(updatePromises);
      const successCount = results.filter(r => r.success).length;

      if (successCount > 0) {
        this.renderQuestionsTable();
        this.showNotification(
          `${shouldFlag ? 'Flagged' : 'Unflagged'} ${successCount} question(s)`,
          "success"
        );
      } else {
        this.showNotification("Failed to update questions", "error");
      }
    } catch (error) {
      console.error("Error flagging questions:", error);
      this.showNotification("Error flagging questions", "error");
    } finally {
      // Re-enable button
      if (flagBtn) flagBtn.disabled = false;
    }
  }

  async handleBulkApprove() {
    if (!this.requireFaculty("bulk approve questions")) return;

    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    // Disable button during operation
    const approveBtn = document.getElementById("approve-btn");
    if (approveBtn) approveBtn.disabled = true;

    try {
      // Update all selected questions to Approved status
      const updatePromises = selectedQuestions.map(async (id) => {
        const question = this.questions.find((q) => toStringId(q.id) === toStringId(id));
        if (!question) return { success: false, id };

        try {
          const response = await fetch(`${API_ENDPOINTS.question}/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: QUESTION_STATUS.approved,
            }),
          });

          if (response.ok) {
            question.status = QUESTION_STATUS.approved;
            question.approved = true;
            return { success: true, id };
          }
          return { success: false, id };
        } catch {
          return { success: false, id };
        }
      });

      const results = await Promise.all(updatePromises);
      const successCount = results.filter(r => r.success).length;

      if (successCount > 0) {
        this.renderQuestionsTable();
        this.showNotification(
          `Approved ${successCount} question(s)`,
          "success"
        );
      } else {
        this.showNotification("Failed to approve questions", "error");
      }
    } catch (error) {
      console.error("Error approving questions:", error);
      this.showNotification("Error approving questions", "error");
    } finally {
      // Re-enable button
      if (approveBtn) approveBtn.disabled = false;
    }
  }

  async handleBulkUnapprove() {
    if (!this.requireFaculty("bulk unapprove questions")) return;

    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    // Disable button during operation
    const unapproveBtn = document.getElementById("unapprove-btn");
    if (unapproveBtn) unapproveBtn.disabled = true;

    try {
      // Update all selected questions to Draft status
      const updatePromises = selectedQuestions.map(async (id) => {
        const question = this.questions.find((q) => toStringId(q.id) === toStringId(id));
        if (!question) return { success: false, id };

        try {
          const response = await fetch(`${API_ENDPOINTS.question}/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: QUESTION_STATUS.draft,
            }),
          });

          if (response.ok) {
            question.status = QUESTION_STATUS.draft;
            question.approved = false;
            return { success: true, id };
          }
          return { success: false, id };
        } catch {
          return { success: false, id };
        }
      });

      const results = await Promise.all(updatePromises);
      const successCount = results.filter(r => r.success).length;

      if (successCount > 0) {
        this.renderQuestionsTable();
        this.showNotification(
          `Unapproved ${successCount} question(s)`,
          "success"
        );
      } else {
        this.showNotification("Failed to unapprove questions", "error");
      }
    } catch (error) {
      console.error("Error unapproving questions:", error);
      this.showNotification("Error unapproving questions", "error");
    } finally {
      // Re-enable button
      if (unapproveBtn) unapproveBtn.disabled = false;
    }
  }

  async handleDelete() {
    if (!this.requireFaculty("delete questions")) return;

    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedQuestions.length} question(s)? This action cannot be undone.`
      )
    ) {
      return;
    }

    // Disable button during operation
    const deleteBtn = document.getElementById("delete-btn");
    if (deleteBtn) deleteBtn.disabled = true;

    try {
      // Delete all selected questions from database
      const deletePromises = selectedQuestions.map(async (id) => {
        try {
          const response = await fetch(`${API_ENDPOINTS.question}/${id}`, {
            method: 'DELETE',
          });

          return { success: response.ok, id };
        } catch {
          return { success: false, id };
        }
      });

      const results = await Promise.all(deletePromises);
      const successCount = results.filter(r => r.success).length;

      // Remove successfully deleted questions from local state
      results.forEach((result) => {
        if (result.success) {
          const index = this.questions.findIndex((q) => toStringId(q.id) === toStringId(result.id));
          if (index > -1) {
            this.questions.splice(index, 1);
          }
          this.state.selectedQuestionIds.delete(toStringId(result.id));
        }
      });

      if (successCount > 0) {
        this.renderQuestionsTable();
        this.updateActionButtons();
        this.showNotification(`Deleted ${successCount} question(s)`, "success");
      } else {
        this.showNotification("Failed to delete questions", "error");
      }
    } catch (error) {
      console.error("Error deleting questions:", error);
      this.showNotification("Error deleting questions", "error");
    } finally {
      // Re-enable button
      if (deleteBtn) deleteBtn.disabled = false;
    }
  }

  async applyFilters() {
    this.clearOutOfViewSelections();

    // Update URL parameters
    this.updateUrlParams();

    if (this.state.currentTab === TAB_NAMES.overview) {
      await this.renderOverview();
    } else if (this.state.currentTab === TAB_NAMES.objectives) {
      await this.renderObjectives();
    }
  }

  /**
   * Update URL parameters to reflect current filter and tab state
   */
  updateUrlParams() {
    const url = new URL(window.location);
    const filters = this.state.filters;

    // Update tab
    url.searchParams.set('tab', this.state.currentTab);

    // Helper to update param or delete if default
    const updateParam = (name, value, defaultValue = 'all') => {
      if (value && value !== defaultValue && value !== '') {
        url.searchParams.set(name, value);
      } else {
        url.searchParams.delete(name);
      }
    };

    updateParam('quiz', filters.quiz);
    updateParam('objective', filters.objective);
    updateParam('bloom', filters.bloom);
    updateParam('status', filters.status);
    updateParam('q', filters.q, '');
    updateParam('material', filters.material);
    
    // Flagged is a boolean
    if (filters.flagged) {
      url.searchParams.set('flagged', 'true');
    } else {
      url.searchParams.delete('flagged');
    }

    window.history.pushState({}, "", url);
  }

  // Sorting functionality
  handleSort(sortKey) {
    if (this.state.sort.key === sortKey) {
      // Toggle direction if same column
      this.state.sort.dir = this.state.sort.dir === "asc" ? "desc" : "asc";
    } else {
      // New column, set to ascending
      this.state.sort.key = sortKey;
      this.state.sort.dir = "asc";
    }

    this.updateSortIcons();
    this.renderQuestionsTable();
  }

  updateSortIcons() {
    const headers = document.querySelectorAll(".sortable-header");
    headers.forEach((header) => {
      const sortKey = header.getAttribute("data-sort");
      const icon = header.querySelector("[data-sort-icon]");

      if (this.state.sort.key === sortKey) {
        icon.className =
          this.state.sort.dir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
        header.setAttribute(
          "aria-sort",
          this.state.sort.dir === "asc" ? "ascending" : "descending"
        );
      } else {
        icon.className = "fas fa-sort";
        header.setAttribute("aria-sort", "none");
      }
    });
  }


  renderQuestionsTable() {
    const tableBody = document.getElementById("questions-table-body");
    if (!tableBody) return;

    const filteredQuestions = this.getFilteredQuestions();
    const sortedQuestions = this.sortQuestions(filteredQuestions);

    if (sortedQuestions.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            <p>No questions available.</p>
            <p>You haven't saved any questions from question generation yet.</p>
            <p>Go to <a href="/question-generation">Question Generation</a> to create and save your first questions.</p>
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = sortedQuestions
      .map(
        (question) => {
          const questionId = String(question.id || "");
          const isSelected = this.state.selectedQuestionIds.has(questionId);
          const escapedId = questionId.replace(/"/g, '&quot;');
          const escapedTitle = (question.title || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          const escapedGlo = (question.glo || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');

          return `
      <tr data-question-id="${escapedId}" class="${isSelected ? "selected" : ""}">
        ${this.renderIfPermitted(`
          <td class="select-cell">
            <input type="checkbox" 
                   ${isSelected ? "checked" : ""}
                   onchange="window.questionBankPage.toggleQuestionSelection('${escapedId}')">
          </td>
        `, this.isFaculty)}
        <td class="question-title-cell">
          <div class="question-title-wrapper">
            <div class="question-title-text ${question.flagged ? "flagged" : ""}">${escapedTitle}</div>
            <div class="question-action-buttons">
              <button class="question-flag-btn ${question.flagged ? 'question-flag-btn--flagged' : ''}" 
                      onclick="window.questionBankPage.toggleQuestionFlag('${escapedId}')"
                      title="${question.flagged ? 'Unflag Question' : 'Flag Question'}">
                <i class="fas fa-flag"></i> ${question.flagged ? 'Unflag' : 'Flag'}
              </button>
              <button class="question-view-btn" 
                      onclick="window.questionBankPage.openQuestionModal('${escapedId}')"
                      title="${this.canEditQuestion(questionId) ? 'View/Edit Question' : 'View Question (Read-only - approved question)'}">
                <i class="fas fa-eye"></i> ${this.canEditQuestion(questionId) ? 'View/Edit' : 'View Only'}
              </button>
              ${this.isFaculty
              ? (question.status && question.status.toLowerCase() === 'approved'
                ? `<button class="question-approve-btn question-approve-btn--unapprove" 
                             onclick="window.questionBankPage.toggleQuestionApproval('${escapedId}', false)"
                             title="Unapprove Question">
                      <i class="fas fa-times-circle"></i> Unapprove
                    </button>`
                : `<button class="question-approve-btn question-approve-btn--approve" 
                             onclick="window.questionBankPage.toggleQuestionApproval('${escapedId}', true)"
                             title="Approve Question">
                      <i class="fas fa-check-circle"></i> Approve
                    </button>`)
              : ''
            }
            </div>
          </div>
        </td>
        <td class="glo-cell">
          <div class="glo-text">${escapedGlo}</div>
        </td>
        <td class="bloom-cell">
          <span class="bloom-chip">${question.bloom || "N/A"}</span>
        </td>
        <td class="status-cell">
          <span class="status-pill status-pill--${(question.status || "Draft").toLowerCase()}">${question.status || "Draft"}</span>
        </td>
      </tr>
    `;
        }
      )
      .join("");

    this.updateSelectAllCheckbox();
    this.updateActionButtons();
  }

  getFilteredQuestions() {
    let filtered = [...this.questions];

    // Filter by quiz
    if (this.state.filters.quiz !== "all") {
      filtered = filtered.filter((q) => {
        const questionQuizId = q.quizId?.toString();
        const filterQuizId = this.state.filters.quiz.toString();
        return questionQuizId === filterQuizId;
      });
    }

    // Filter by learning objective
    if (this.state.filters.objective !== "all") {
      filtered = filtered.filter((q) => {
        const questionObjId = String(q.objectiveId || "");
        const filterObjId = String(this.state.filters.objective);
        return questionObjId === filterObjId;
      });
    }

    // Filter by bloom level
    if (this.state.filters.bloom !== "all") {
      filtered = filtered.filter((q) => q.bloom === this.state.filters.bloom);
    }

    // Filter by status
    if (this.state.filters.status !== "all") {
      filtered = filtered.filter((q) => q.status === this.state.filters.status);
    }

    // Filter by flagged
    if (this.state.filters.flagged) {
      filtered = filtered.filter((q) => q.flagged === true);
    }

    // Filter by search query
    if (this.state.filters.q) {
      const searchTerm = this.state.filters.q.toLowerCase();
      filtered = filtered.filter(
        (q) => {
          const titleMatch = q.title && q.title.toLowerCase().includes(searchTerm);
          const stemMatch = q.stem && q.stem.toLowerCase().includes(searchTerm);
          const gloMatch = q.glo && q.glo.toLowerCase().includes(searchTerm);
          return titleMatch || stemMatch || gloMatch;
        }
      );
    }

    return filtered;
  }

  sortQuestions(questions) {
    return [...questions].sort((a, b) => {
      const { key, dir } = this.state.sort;

      let aValue, bValue;

      switch (key) {
        case "title":
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case "glo":
          aValue = a.glo.toLowerCase();
          bValue = b.glo.toLowerCase();
          break;
        case "bloom":
          aValue = a.bloom.toLowerCase();
          bValue = b.bloom.toLowerCase();
          break;
        default:
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
      }

      if (dir === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  }


  toggleQuestionSelection(questionId) {
    // Ensure questionId is a string for consistent comparison
    const id = String(questionId || "");

    if (this.state.selectedQuestionIds.has(id)) {
      this.state.selectedQuestionIds.delete(id);
    } else {
      this.state.selectedQuestionIds.add(id);
    }

    this.updateSelectAllCheckbox();
    this.updateActionButtons();
    // Re-render to update checkbox states
    this.renderQuestionsTable();
  }


  updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById("select-all");
    if (!selectAllCheckbox) return;

    const visibleQuestions = this.getFilteredQuestions();
    const selectedCount = visibleQuestions.filter((q) => {
      const id = String(q.id || "");
      return this.state.selectedQuestionIds.has(id);
    }).length;

    if (selectedCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.setAttribute("aria-checked", "false");
    } else if (selectedCount === visibleQuestions.length) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.setAttribute("aria-checked", "true");
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
      selectAllCheckbox.setAttribute("aria-checked", "mixed");
    }
  }

  updateActionButtons() {
    const hasSelection = this.state.selectedQuestionIds.size > 0;
    const approveBtn = document.getElementById("approve-btn");
    const unapproveBtn = document.getElementById("unapprove-btn");
    const flagBtn = document.getElementById("flag-btn");
    const deleteBtn = document.getElementById("delete-btn");

    // Buttons are already hidden/shown in initializePermissionBasedUI for non-faculty
    if (approveBtn && this.isFaculty) {
      approveBtn.disabled = !hasSelection;
    }

    if (unapproveBtn && this.isFaculty) {
      unapproveBtn.disabled = !hasSelection;
    }

    if (flagBtn && this.isFaculty) {
      flagBtn.disabled = !hasSelection;
    }

    if (deleteBtn && this.isFaculty) {
      deleteBtn.disabled = !hasSelection;
    }

    // Update selection count
    const selectionCount = document.getElementById("selection-count");
    if (selectionCount) {
      const count = this.state.selectedQuestionIds.size;
      selectionCount.textContent = `${count} question${count !== 1 ? "s" : ""
        } selected`;
    }
  }

  clearFilters() {
    this.state.filters = {
      quiz: "all",
      objective: "all",
      bloom: "all",
      status: "all",
      flagged: false,
      q: "",
    };

    const quizFilter = document.getElementById("quiz-filter");
    const objectiveFilter = document.getElementById("objective-filter");
    const bloomFilter = document.getElementById("bloom-filter");
    const statusFilter = document.getElementById("status-filter");
    const flaggedFilter = document.getElementById("flagged-filter");
    const searchInput = document.getElementById("search-input");

    if (quizFilter) quizFilter.value = "all";
    if (bloomFilter) bloomFilter.value = "all";
    if (statusFilter) statusFilter.value = "all";
    if (flaggedFilter) flaggedFilter.checked = false;
    if (searchInput) searchInput.value = "";

    this.renderAll();
  }

  getSelectedQuestions() {
    return this.questions.filter((q) => {
      const id = String(q.id || "");
      return this.state.selectedQuestionIds.has(id);
    });
  }


  // Modal Management
  showModal(title, message, onConfirm) {
    const modal = document.getElementById("confirm-modal");
    const modalTitle = document.getElementById("modal-title");
    const modalMessage = document.getElementById("modal-message");

    if (modal && modalTitle && modalMessage) {
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      modal.style.display = "flex";

      this.pendingModalAction = onConfirm;
    }
  }

  hideModal() {
    const modal = document.getElementById("confirm-modal");
    if (modal) {
      modal.style.display = "none";
      this.pendingModalAction = null;
    }
  }

  confirmModalAction() {
    if (this.pendingModalAction) {
      this.pendingModalAction();
    }
    this.hideModal();
  }




  // Notification System
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, NOTIFICATION_TIMEOUT);
  }

  // Question Detail Modal Functions
  async openQuestionModal(questionId) {
    const modal = document.getElementById("question-detail-modal");
    const modalBody = document.getElementById("question-modal-body");
    const saveBtn = document.getElementById("question-modal-save");

    if (!modal || !modalBody) return;

    // Show modal
    modal.style.display = "flex";

    // Show loading state
    modalBody.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 24px;"></i><p>Loading question...</p></div>';
    saveBtn.style.display = "none";

    try {
      // Fetch full question details from API
      const response = await fetch(`${API_ENDPOINTS.question}/${questionId}`);
      if (!response.ok) {
        throw new Error('Failed to load question');
      }

      const data = await response.json();
      if (!data.success || !data.question) {
        throw new Error('Question not found');
      }

      const question = data.question;

      // Check if user can edit this question
      const canEdit = this.canEditQuestion(questionId);

      // Options are always objects with keys A, B, C, D - convert to array for display
      const optionKeys = ['A', 'B', 'C', 'D'];
      let normalizedOptions = [];
      if (question.options && typeof question.options === 'object') {
        normalizedOptions = optionKeys.map((key) => {
          const opt = question.options[key];
          if (typeof opt === 'string') {
            return { id: key, text: opt, feedback: "" };
          } else if (opt && typeof opt === 'object') {
            return { id: opt.id || key, text: opt.text || opt, feedback: opt.feedback || "" };
          } else {
            return { id: key, text: String(opt || ''), feedback: "" };
          }
        });
      }

      // Ensure we have at least 4 options
      while (normalizedOptions.length < 4) {
        normalizedOptions.push({
          id: String.fromCharCode(65 + normalizedOptions.length),
          text: ''
        });
      }

      // Store original question for comparison
      // Convert correctAnswer to letter format (A, B, C, D) if it's a number
      let correctAnswerLetter = question.correctAnswer;
      if (typeof question.correctAnswer === 'number') {
        correctAnswerLetter = ['A', 'B', 'C', 'D'][question.correctAnswer] || 'A';
      } else if (typeof question.correctAnswer === 'string') {
        correctAnswerLetter = question.correctAnswer.toUpperCase();
      } else {
        correctAnswerLetter = 'A';
      }

      this.currentEditingQuestion = {
        id: questionId,
        title: question.title || question.stem || "",
        stem: question.stem || question.title || "",
        options: normalizedOptions,
        correctAnswer: correctAnswerLetter,
        canEdit: canEdit,
      };

      // Render question in modal (uses this.currentEditingQuestion)
      this.renderQuestionInModal();

      // Set up event listeners
      this.setupQuestionModalListeners();

    } catch (error) {
      console.error("Error loading question:", error);
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <i class="fas fa-exclamation-circle" style="font-size: 24px; margin-bottom: 10px;"></i>
          <p>Failed to load question details</p>
          <p style="font-size: 12px; color: #6c757d;">${error.message}</p>
        </div>
      `;
    }
  }

  renderQuestionInModal() {
    // Use currentEditingQuestion which has normalized data (correctAnswer as letter, options as array)
    if (!this.currentEditingQuestion) {
      console.error("currentEditingQuestion not set");
      return;
    }

    const question = this.currentEditingQuestion;
    const modalBody = document.getElementById("question-modal-body");
    const saveBtn = document.getElementById("question-modal-save");

    if (!modalBody) return;

    // Get canEdit from currentEditingQuestion
    const canEdit = question.canEdit !== undefined ? question.canEdit : this.canEditQuestion(question.id);

    // Get objective name if available
    const objectiveName = question.learningObjectiveId
      ? (this.objectivesMap.get(question.learningObjectiveId.toString()) || "Unknown Objective")
      : (question.granularObjectiveId ? "Granular Objective" : "No Objective");

    // Options are already normalized to array format in currentEditingQuestion
    let optionsArray = question.options || [];
    if (!Array.isArray(optionsArray) || optionsArray.length === 0) {
      // Fallback: create empty options
      optionsArray = [
        { id: 'A', text: '' },
        { id: 'B', text: '' },
        { id: 'C', text: '' },
        { id: 'D', text: '' }
      ];
    }

    // Ensure we have at least 4 options
    while (optionsArray.length < 4) {
      optionsArray.push({
        id: String.fromCharCode(65 + optionsArray.length),
        text: ''
      });
    }

    // Format options
    // Get correctAnswer as letter (A, B, C, D) - already normalized in currentEditingQuestion
    let correctAnswerLetter = question.correctAnswer || 'A';
    if (typeof correctAnswerLetter === 'string') {
      correctAnswerLetter = correctAnswerLetter.toUpperCase();
    } else {
      correctAnswerLetter = 'A';
    }

    const isReadOnly = !(question.canEdit !== undefined ? question.canEdit : this.canEditQuestion(question.id));
    const readonlyAttr = isReadOnly ? 'readonly' : '';
    const disabledAttr = isReadOnly ? 'disabled' : '';
    const readonlyClass = isReadOnly ? 'readonly' : '';
    const readonlyStyle = isReadOnly ? 'background-color: #f5f5f5; cursor: not-allowed;' : '';

    const optionsHtml = optionsArray.map((option, index) => {
      const optionId = option.id || String.fromCharCode(65 + index); // A, B, C, D
      const optionText = option.text || '';
      const optionFeedback = option.feedback || "";
      const isCorrect = optionId === correctAnswerLetter;
      const escapedText = (optionText || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const escapedFeedback = (optionFeedback || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');

      return `
        <div class="question-modal-option">
          <div class="question-modal-option-header">
            <input type="radio" 
                   name="question-correct-answer" 
                   value="${optionId}" 
                   ${isCorrect ? "checked" : ""}
                   ${disabledAttr}
                   id="option-${index}"
                   onchange="window.questionBankPage.updateCorrectAnswer('${optionId}')">
            <label for="option-${index}" class="question-modal-option-label">
              <span class="option-letter">${optionId}</span>
            </label>
          </div>
          <div class="question-modal-option-fields">
            <input type="text" 
                   class="question-modal-option-input ${readonlyClass}" 
                   value="${escapedText}"
                   data-option-index="${index}"
                   placeholder="Enter option text..."
                   ${readonlyAttr}
                   style="${readonlyStyle}">
            <input type="text" 
                   class="question-modal-feedback-input ${readonlyClass}" 
                   value="${escapedFeedback}"
                   data-option-index="${index}"
                   placeholder="Feedback for this option..."
                   ${readonlyAttr}
                   style="${readonlyStyle}; margin-top: 5px; font-size: 0.9em; font-style: italic; background-color: #f9fafb;">
          </div>
        </div>
      `;
    }).join("");

    // Build warning HTML separately to avoid template literal nesting issues
    const warningHtml = isReadOnly
      ? '<div class="question-modal-warning" style="background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 6px; margin-bottom: 20px; color: #856404;"><i class="fas fa-lock"></i> This question is approved and cannot be edited.</div>'
      : '';

    const escapedTitle = (question.title || question.stem || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const escapedStem = (question.stem || question.title || "").replace(/</g, '&lt;').replace(/>/g, '&gt;');

    modalBody.innerHTML = `
      <div class="question-modal-content">
        ${warningHtml}
        <div class="question-modal-field">
          <label for="question-modal-title-input">Question Title</label>
          <input type="text" 
                 id="question-modal-title-input" 
                 class="question-modal-input ${readonlyClass}" 
                 value="${escapedTitle}"
                 placeholder="Enter question title..."
                 ${readonlyAttr}
                 style="${readonlyStyle}">
        </div>

        <div class="question-modal-field">
          <label for="question-modal-stem-input">Question Stem</label>
          <textarea id="question-modal-stem-input" 
                    class="question-modal-textarea ${readonlyClass}" 
                    rows="4"
                    placeholder="Enter question stem..."
                    ${readonlyAttr}
                    style="${readonlyStyle}">${escapedStem}</textarea>
        </div>

        <div class="question-modal-field">
          <label>Options</label>
          <div class="question-modal-options">
            ${optionsHtml}
          </div>
        </div>
      </div>
    `;

    // Show/hide save button based on edit permission
    if (saveBtn) {
      saveBtn.style.display = isReadOnly ? "none" : "inline-block";
    }
  }

  setupQuestionModalListeners() {
    const modal = document.getElementById("question-detail-modal");
    const closeBtn = document.getElementById("question-modal-close");
    const cancelBtn = document.getElementById("question-modal-cancel");
    const saveBtn = document.getElementById("question-modal-save");

    if (closeBtn) {
      closeBtn.onclick = () => this.closeQuestionModal();
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => this.closeQuestionModal();
    }

    if (saveBtn) {
      saveBtn.onclick = () => this.saveQuestionChanges();
    }

    // Close on outside click
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) {
          this.closeQuestionModal();
        }
      };
    }
  }

  updateCorrectAnswer(optionLetter) {
    if (this.currentEditingQuestion) {
      // optionLetter should be A, B, C, or D
      this.currentEditingQuestion.correctAnswer = typeof optionLetter === 'string'
        ? optionLetter.toUpperCase()
        : (typeof optionLetter === 'number' ? ['A', 'B', 'C', 'D'][optionLetter] : 'A');
    }
  }

  async saveQuestionChanges() {
    if (!this.currentEditingQuestion) return;


    const saveBtn = document.getElementById("question-modal-save");
    if (saveBtn) saveBtn.disabled = true;

    try {
      const titleInput = document.getElementById("question-modal-title-input");
      const stemInput = document.getElementById("question-modal-stem-input");
      const optionInputs = document.querySelectorAll(".question-modal-option-input");

      const title = titleInput ? titleInput.value.trim() : "";
      const stem = stemInput ? stemInput.value.trim() : "";
      
      const feedbackInputs = document.querySelectorAll(".question-modal-feedback-input");
      const feedbackMap = new Map();
      feedbackInputs.forEach(input => {
        const index = input.dataset.optionIndex;
        const optionId = String.fromCharCode(65 + parseInt(index));
        feedbackMap.set(optionId, input.value.trim());
      });

      const options = Array.from(optionInputs).map((input, index) => {
        const optionId = String.fromCharCode(65 + parseInt(input.dataset.optionIndex || index));
        return {
          id: optionId,
          text: input.value.trim(),
          feedback: feedbackMap.get(optionId) || ""
        };
      });

      // Validate
      if (!title && !stem) {
        this.showNotification("Question title or stem is required", "error");
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      if (options.some(opt => !opt.text)) {
        this.showNotification("All options must have text", "error");
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      // Find the original question to preserve its nested option properties (like feedback)
      const originalQuestion = this.questions.find(q => toStringId(q.id) === toStringId(this.currentEditingQuestion.id)) || {};
      const originalOptions = originalQuestion.options || {};

      // Convert options array back to object format {A: {text: "..."}, B: {text: "..."}}
      // Merging with the original option object to preserve 'feedback' and other metadata
      const optionsObject = {};
      options.forEach(opt => {
        const oldOption = originalOptions[opt.id];
        if (typeof oldOption === 'object' && oldOption !== null) {
          optionsObject[opt.id] = { ...oldOption, text: opt.text, feedback: opt.feedback };
        } else {
          // Since the backend supports both, we'll keep the object structure to be safe and future-proof
          optionsObject[opt.id] = { text: opt.text, feedback: opt.feedback };
        }
      });

      // Ensure correctAnswer is a letter (A, B, C, D)
      let correctAnswerLetter = this.currentEditingQuestion.correctAnswer || 'A';
      if (typeof correctAnswerLetter === 'number') {
        correctAnswerLetter = ['A', 'B', 'C', 'D'][correctAnswerLetter] || 'A';
      } else if (typeof correctAnswerLetter === 'string') {
        correctAnswerLetter = correctAnswerLetter.toUpperCase();
      }

      // Prepare update data
      const updateData = {
        title: title || stem,
        stem: stem || title,
        options: optionsObject,
        correctAnswer: correctAnswerLetter,
      };

      // Update question in database
      const response = await fetch(`${API_ENDPOINTS.question}/${this.currentEditingQuestion.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update question');
      }

      // Update local state
      const question = this.questions.find(q => toStringId(q.id) === toStringId(this.currentEditingQuestion.id));
      if (question) {
        question.title = updateData.title;
        question.stem = updateData.stem;
      }

      // Close modal and refresh table
      this.closeQuestionModal();
      this.renderQuestionsTable();
      this.showNotification("Question updated successfully", "success");

    } catch (error) {
      console.error("Error saving question:", error);
      this.showNotification(error.message || "Failed to save question", "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  closeQuestionModal() {
    const modal = document.getElementById("question-detail-modal");
    if (modal) {
      modal.style.display = "none";
    }
    this.currentEditingQuestion = null;
  }

  async toggleQuestionFlag(questionId) {
    try {
      const question = this.questions.find(q => toStringId(q.id) === toStringId(questionId));
      if (!question) {
        throw new Error('Question not found');
      }

      const newFlagStatus = !question.flagged;

      const response = await fetch(`${API_ENDPOINTS.question}/${questionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flagStatus: newFlagStatus,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update question flag status');
      }

      question.flagged = newFlagStatus;



      this.renderQuestionsTable();
      this.showNotification(
        `Question ${newFlagStatus ? 'flagged' : 'unflagged'} successfully`,
        'success'
      );

    } catch (error) {
      console.error('Error toggling question flag:', error);
      this.showNotification(error.message || 'Failed to update question flag status', 'error');
    }
  }

  async toggleQuestionApproval(questionId, approve) {
    try {
      const newStatus = approve ? QUESTION_STATUS.approved : QUESTION_STATUS.draft;

      const response = await fetch(`${API_ENDPOINTS.question}/${questionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update question status');
      }

      const question = this.questions.find(q => toStringId(q.id) === toStringId(questionId));
      if (question) {
        question.status = newStatus;
      }

      this.renderQuestionsTable();
      this.showNotification(
        `Question ${approve ? 'approved' : 'unapproved'} successfully`,
        'success'
      );

    } catch (error) {
      console.error('Error toggling question approval:', error);
      this.showNotification(error.message || 'Failed to update question status', 'error');
    }
  }

  // ==================== Learning Objectives Tab Logic ====================

  initializeObjectiveEvents() {
    // Add button removed per user request
    
    const modalClose = document.getElementById('objective-modal-close');
    const modalCancel = document.getElementById('objective-modal-cancel');
    if (modalClose) modalClose.addEventListener('click', () => {
      document.getElementById('objective-modal').style.display = 'none';
    });
    if (modalCancel) modalCancel.addEventListener('click', () => {
      document.getElementById('objective-modal').style.display = 'none';
    });

    // Close modal on outside click
    const modal = document.getElementById('objective-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      });
    }
  }

  async renderObjectives() {
    const container = document.getElementById('objectives-container');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">Loading learning objectives...</p></div>';

    try {
      // Load objectives and materials in parallel
      await Promise.all([
        this.loadDetailedObjectives(),
        this.loadCourseMaterials()
      ]);

      if (this.detailedObjectives.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="background: white; padding: 60px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center;">
            <i class="fas fa-bullseye fa-4x" style="color: #e2e8f0; margin-bottom: 20px; display: block;"></i>
            <h3 style="font-size: 20px; color: #2d3748; margin-bottom: 10px;">No Learning Objectives Found</h3>
            <p style="color: #718096; margin-bottom: 10px;">Learning objectives are usually imported from course materials.</p>
          </div>
        `;
        return;
      }

      // Populate material filter dropdown
      this.updateMaterialFilter();

      // Apply material filter
      let filteredObjectives = this.detailedObjectives;
      if (this.state.filters.material !== 'all') {
        filteredObjectives = this.detailedObjectives.filter(obj => 
          obj.materialIds && obj.materialIds.includes(this.state.filters.material)
        );
      }

      if (filteredObjectives.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="background: white; padding: 60px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center;">
            <i class="fas fa-filter fa-4x" style="color: #e2e8f0; margin-bottom: 20px; display: block;"></i>
            <h3 style="font-size: 20px; color: #2d3748; margin-bottom: 10px;">No matching objectives</h3>
            <p style="color: #718096; margin-bottom: 10px;">Try adjusting your material filter.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      filteredObjectives.forEach(objective => {
        container.appendChild(this.createObjectiveCard(objective));
      });

    } catch (error) {
      console.error('Error rendering objectives:', error);
      container.innerHTML = '<div class="error-message" style="color: #e53e3e; text-align: center; padding: 40px; background: #fff5f5; border-radius: 12px; border: 1px solid #feb2b2;">Failed to load learning objectives. Please try again.</div>';
    }
  }

  async loadDetailedObjectives() {
    if (!this.courseId) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.objective}?courseId=${this.courseId}`);
      if (!response.ok) throw new Error('Failed to fetch objectives');
      
      const data = await response.json();
      if (data.success && data.objectives) {
        this.detailedObjectives = await Promise.all(data.objectives.map(async (obj) => {
          const objId = getObjectId(obj);
          
          // Fetch granular objectives
          const granularResp = await fetch(`${API_ENDPOINTS.objective}/${objId}/granular?courseId=${this.courseId}`);
          const granularData = await granularResp.json();
          
          // Fetch associated materials
          const materialsResp = await fetch(`${API_ENDPOINTS.objective}/${objId}/materials`);
          const materialsData = await materialsResp.json();
          
          return {
            id: objId,
            name: obj.name,
            granular: granularData.success ? granularData.objectives : [],
            materialIds: materialsData.success ? materialsData.materials.map(m => m.sourceId) : []
          };
        }));

        // Also update the map for other tabs
        this.detailedObjectives.forEach(obj => {
          this.objectivesMap.set(obj.id, obj.name);
        });
      }
    } catch (error) {
      console.error('Error loading detailed objectives:', error);
      throw error;
    }
  }

  async loadCourseMaterials() {
    if (!this.courseId) return;
    
    try {
      const response = await fetch(`/api/material/course/${this.courseId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.courseMaterials = data.materials || [];
        }
      }
    } catch (error) {
      console.error('Error loading course materials:', error);
    }
  }

  createObjectiveCard(objective) {
    const card = document.createElement('div');
    card.className = 'objective-card';
    card.setAttribute('data-id', objective.id);

    const associatedMaterials = this.courseMaterials.filter(m => 
      objective.materialIds.includes(m.sourceId)
    );

    card.innerHTML = `
      <div class="objective-card-header">
        <div class="objective-card-title-area">
          <i class="fas fa-bullseye" style="color: #3498db; font-size: 20px;"></i>
          <h3>${this.escapeHtml(objective.name)}</h3>
        </div>
        <div class="objective-card-actions">
          <button class="btn-icon" onclick="questionBankPage.showEditObjectiveModal('${objective.id}')" title="Edit Objective">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn-icon btn-danger" onclick="questionBankPage.handleDeleteObjective('${objective.id}')" title="Delete Objective">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="objective-card-body">
        <div class="granular-section">
          <h4><i class="fas fa-level-down-alt"></i> Granular Objectives</h4>
          <ul class="granular-list" id="granular-list-${objective.id}">
            ${objective.granular.length > 0 ? 
              objective.granular.map(g => this.createGranularItemHtml(objective.id, g)).join('') : 
              '<li class="no-data-message" style="padding: 15px; background: #f8fafc; border-radius: 8px; border: 1px dashed #e2e8f0; color: #a0aec0; font-size: 13px; list-style: none;">No granular objectives defined.</li>'
            }
          </ul>
          <div class="add-granular-form">
            <input type="text" id="new-granular-input-${objective.id}" placeholder="Enter granular objective..." class="form-control" style="padding: 8px 12px; font-size: 13px;">
            <button class="btn btn-primary" style="padding: 8px 15px; white-space: nowrap;" onclick="questionBankPage.handleAddGranular('${objective.id}')">
              <i class="fas fa-plus"></i> Add Granular Learning Objective
            </button>
          </div>
        </div>
        <div class="materials-section">
          <h4>Associated Materials</h4>
          <div class="materials-tags">
            ${associatedMaterials.length > 0 ? 
              associatedMaterials.map(m => {
                const iconInfo = this.getMaterialIcon(m.fileType || '');
                return `
                  <span class="material-tag" title="${this.escapeHtml(m.source || m.filename || '')}">
                    <i class="${iconInfo.icon}" style="color: ${iconInfo.color}; margin-right: 6px;"></i>
                    ${this.escapeHtml(m.documentTitle || m.fileName || m.name || 'Unnamed')}
                  </span>
                `;
              }).join('') : 
              '<span class="no-materials-text">No materials linked.</span>'
            }
          </div>
        </div>
      </div>
    `;

    return card;
  }

  createGranularItemHtml(objectiveId, granular) {
    const gId = getObjectId(granular);
    const text = granular.name || granular.text || '';
    return `
      <li class="granular-item" id="granular-item-${gId}">
        <span class="granular-text" id="granular-text-${gId}">${this.escapeHtml(text)}</span>
        <div class="granular-actions">
          <button class="btn-icon btn-sm" onclick="questionBankPage.showEditGranular('${objectiveId}', '${gId}')" title="Edit">
            <i class="fas fa-pencil-alt" style="font-size: 11px;"></i>
          </button>
          <button class="btn-icon btn-sm btn-danger" onclick="questionBankPage.handleDeleteGranular('${objectiveId}', '${gId}')" title="Delete">
            <i class="fas fa-times" style="font-size: 11px;"></i>
          </button>
        </div>
      </li>
    `;
  }

  // ==================== Objective CRUD ====================

  async showEditObjectiveModal(objectiveId) {
    const objective = this.detailedObjectives.find(o => o.id === objectiveId);
    if (!objective) return;

    const modal = document.getElementById('objective-modal');
    const title = document.getElementById('objective-modal-title');
    const nameInput = document.getElementById('objective-name-input');
    const saveBtn = document.getElementById('objective-modal-save');
    
    title.textContent = 'Edit Learning Objective';
    nameInput.value = objective.name;
    saveBtn.onclick = () => this.handleSaveObjective(objectiveId);
    
    this.renderMaterialsSelection(objective.materialIds);
    modal.style.display = 'flex';
  }

  renderMaterialsSelection(selectedIds = []) {
    const container = document.getElementById('objective-materials-list');
    if (!container) return;

    if (!this.courseMaterials || this.courseMaterials.length === 0) {
      container.innerHTML = '<p class="no-data-message" style="grid-column: 1/-1; text-align: center; padding: 20px;">No course materials available.</p>';
      return;
    }

    container.innerHTML = this.courseMaterials.map(material => {
      const id = material.sourceId;
      const checked = selectedIds.includes(id) ? 'checked' : '';
      const iconInfo = this.getMaterialIcon(material.fileType || '');
      return `
        <label class="material-checkbox-item">
          <input type="checkbox" name="objective-material" value="${id}" ${checked}>
          <i class="${iconInfo.icon}" style="color: ${iconInfo.color}; width: 20px; text-align: center; font-size: 14px;"></i>
          <span class="material-checkbox-label" title="${this.escapeHtml(material.source || material.filename || '')}">${this.escapeHtml(material.documentTitle || material.fileName || material.name || 'Unnamed')}</span>
        </label>
      `;
    }).join('');
  }

  async handleSaveObjective(editingId = null) {
    const nameInput = document.getElementById('objective-name-input');
    const name = nameInput.value.trim();
    
    if (!name) {
      this.showNotification('Please enter an objective name', 'error');
      return;
    }

    const selectedCheckboxes = document.querySelectorAll('input[name="objective-material"]:checked');
    const materialIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    try {
      let result;
      if (editingId) {
        // Update existing
        const response = await fetch(`${API_ENDPOINTS.objective}/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, courseId: this.courseId })
        });
        result = await response.json();
        
        if (result.success) {
          // Update materials separately
          await fetch(`${API_ENDPOINTS.objective}/${editingId}/materials`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materialIds })
          });
        }
      } else {
        // Create new
        const response = await fetch(API_ENDPOINTS.objective, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, courseId: this.courseId })
        });
        result = await response.json();
        
        if (result.success && materialIds.length > 0) {
          const newId = getObjectId(result.objective);
          await fetch(`${API_ENDPOINTS.objective}/${newId}/materials`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materialIds })
          });
        }
      }

      if (result.success) {
        document.getElementById('objective-modal').style.display = 'none';
        this.showNotification(`Objective ${editingId ? 'updated' : 'created'} successfully`, 'success');
        await this.renderObjectives();
        await this.loadLearningObjectives(); // Refresh filter dropdowns
        this.updateFilterOptions();
      } else {
        throw new Error(result.error || 'Failed to save objective');
      }
    } catch (error) {
      console.error('Error saving objective:', error);
      this.showNotification(error.message, 'error');
    }
  }

  async handleDeleteObjective(objectiveId) {
    if (!confirm('Are you sure you want to delete this learning objective? This will also delete all associated granular objectives.')) {
      return;
    }

    try {
      const response = await fetch(`${API_ENDPOINTS.objective}/${objectiveId}`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (data.success) {
        this.showNotification('Learning objective deleted', 'success');
        await this.renderObjectives();
        await this.loadLearningObjectives();
        this.updateFilterOptions();
      } else {
        throw new Error(data.error || 'Failed to delete objective');
      }
    } catch (error) {
      console.error('Error deleting objective:', error);
      this.showNotification(error.message, 'error');
    }
  }

  // ==================== Granular Objective CRUD ====================

  async handleAddGranular(parentId) {
    const input = document.getElementById(`new-granular-input-${parentId}`);
    const text = input.value.trim();

    if (!text) return;

    try {
      // Get current objective to update its granular list
      const objective = this.detailedObjectives.find(o => o.id === parentId);
      const newGranular = { text: text }; // Use 'text' as expected by some API parts
      const updatedGranularList = [...objective.granular, newGranular];

      const response = await fetch(`${API_ENDPOINTS.objective}/${parentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          granularObjectives: updatedGranularList,
          courseId: this.courseId 
        })
      });

      const data = await response.json();
      if (data.success) {
        input.value = '';
        this.showNotification('Granular objective added', 'success');
        await this.renderObjectives();
      } else {
        throw new Error(data.error || 'Failed to add granular objective');
      }
    } catch (error) {
      console.error('Error adding granular objective:', error);
      this.showNotification(error.message, 'error');
    }
  }

  showEditGranular(parentId, granularId) {
    const textSpan = document.getElementById(`granular-text-${granularId}`);
    const currentText = textSpan.textContent;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'granular-edit-input';
    input.value = currentText;
    
    const container = textSpan.parentElement;
    const actionsDiv = container.querySelector('.granular-actions');
    
    container.querySelector('.granular-text').style.display = 'none';
    actionsDiv.style.display = 'none';
    
    const editForm = document.createElement('div');
    editForm.className = 'granular-edit-form';
    editForm.style.display = 'flex';
    editForm.style.gap = '5px';
    editForm.style.flex = '1';
    
    editForm.appendChild(input);
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-icon btn-sm btn-primary';
    saveBtn.innerHTML = '<i class="fas fa-check"></i>';
    saveBtn.onclick = () => this.handleUpdateGranular(parentId, granularId, input.value);
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-icon btn-sm';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
    cancelBtn.onclick = () => {
      container.querySelector('.granular-text').style.display = 'inline';
      actionsDiv.style.display = 'flex';
      editForm.remove();
    };
    
    editForm.appendChild(saveBtn);
    editForm.appendChild(cancelBtn);
    
    container.insertBefore(editForm, actionsDiv);
    input.focus();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    };
  }

  async handleUpdateGranular(parentId, granularId, newText) {
    if (!newText.trim()) return;

    try {
      const objective = this.detailedObjectives.find(o => o.id === parentId);
      const updatedGranularList = objective.granular.map(g => {
        if (getObjectId(g) === granularId) {
          return { ...g, text: newText.trim(), name: newText.trim() };
        }
        return g;
      });

      const response = await fetch(`${API_ENDPOINTS.objective}/${parentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          granularObjectives: updatedGranularList,
          courseId: this.courseId 
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showNotification('Granular objective updated', 'success');
        await this.renderObjectives();
      } else {
        throw new Error(data.error || 'Failed to update granular objective');
      }
    } catch (error) {
      console.error('Error updating granular objective:', error);
      this.showNotification(error.message, 'error');
    }
  }

  async handleDeleteGranular(parentId, granularId) {
    if (!confirm('Are you sure you want to delete this granular objective?')) return;

    try {
      const objective = this.detailedObjectives.find(o => o.id === parentId);
      const updatedGranularList = objective.granular.filter(g => getObjectId(g) !== granularId);

      const response = await fetch(`${API_ENDPOINTS.objective}/${parentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          granularObjectives: updatedGranularList,
          courseId: this.courseId 
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showNotification('Granular objective deleted', 'success');
        await this.renderObjectives();
      } else {
        throw new Error(data.error || 'Failed to delete granular objective');
      }
    } catch (error) {
      console.error('Error deleting granular objective:', error);
      this.showNotification(error.message, 'error');
    }
  }

  // ==================== Helpers ====================

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getMaterialIcon(type) {
    const info = { icon: "fas fa-file", color: "#718096" };
    if (!type) return info;
    
    const t = type.toLowerCase();
    if (t.includes("pdf")) {
      info.icon = "fas fa-file-pdf";
      info.color = "#e74c3c";
    } else if (t.includes("text") || t.includes("plain")) {
      info.icon = "fas fa-file-alt";
      info.color = "#f39c12";
    } else if (t.includes("word") || t.includes("officedocument")) {
      info.icon = "fas fa-file-word";
      info.color = "#3498db";
    } else if (t.includes("link")) {
      info.icon = "fas fa-link";
      info.color = "#9b59b6";
    } else if (t.includes("video")) {
      info.icon = "fas fa-file-video";
      info.color = "#27ae60";
    }
    return info;
  }
}

// Initialize the page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.questionBankPage = new QuestionBankPage();
});

// Export for use in other files
window.QuestionBankPage = QuestionBankPage;
