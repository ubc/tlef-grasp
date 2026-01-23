// Question Bank Page JavaScript
// Handles interactions and functionality for the new 3-panel layout and Review tab

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
  questionsTableBody: 'questions-table-body',
  quizzesContainer: 'quizzes-container',
  selectAll: 'select-all',
  selectionCount: 'selection-count',
  actionBar: 'action-bar',
  flagBtn: 'flag-btn',
  deleteBtn: 'delete-btn',
  crossQuizActions: 'cross-quiz-actions',
  crossQuizCount: 'cross-quiz-count',
  crossApproveBtn: 'cross-approve-btn',
  crossFlagBtn: 'cross-flag-btn',
  crossDeleteBtn: 'cross-delete-btn',
  confirmModal: 'confirm-modal',
  questionDetailModal: 'question-detail-modal',
  exportSummaryModal: 'export-summary-modal',
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
  review: 'review',
  approvedHistory: 'approved-history',
};

const VALID_TABS = [TAB_NAMES.overview, TAB_NAMES.review, TAB_NAMES.approvedHistory];

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

    this.state = {
      filters: {
        quiz: "all",
        objective: "all",
        bloom: "all",
        status: "all",
        flagged: flaggedFilterEnabled,
        q: ""
      },
      sort: { key: "title", dir: "asc" },
      selectedQuestionIds: new Set(),
      currentTab: defaultTab,
    };

    this.questions = [];
    this.quizzes = [];
    this.allQuizzes = []; // Store all quizzes for filter dropdown
    this.objectivesMap = new Map(); // Map objective ID to objective name
    this.isFaculty = false; // Cache faculty status
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

  async loadSavedQuestionSets() {
    if (!this.courseId) {
      this.quizzes = [];
      return;
    }

    try {
      // Load quizzes for the current course
      const response = await fetch(`${API_ENDPOINTS.quizCourse}/${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.quizzes && data.quizzes.length > 0) {
        // Load questions for each quiz
        const quizzesWithQuestions = await Promise.all(
          data.quizzes.map(async (quiz) => {
            try {
              const questionsResponse = await fetch(`${API_ENDPOINTS.quiz}/${quiz._id}/questions`);
              if (questionsResponse.ok) {
                const questionsData = await questionsResponse.json();
                const questions = questionsData.success && questionsData.questions
                  ? questionsData.questions
                  : [];

                return {
                  id: getObjectId(quiz),
                  title: quiz.name || "Unnamed Quiz",
                  course: this.courseName,
                  week: null,
                  lecture: null,
                  published: quiz.published || false,
                  createdAt: quiz.createdAt || new Date(),
                  releases: [
                    {
                      label: quiz.name || "Unnamed Quiz",
                      date: quiz.createdAt ? new Date(quiz.createdAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                    },
                  ],
                  questions: questions.map((q, qIndex) => {
                    const qId = getObjectId(q) || `q_${qIndex}`;
                    return {
                      id: qId,
                      title: q.title || q.stem || q.questionText || "",
                      course: this.courseName,
                      loCode: q.granularObjectiveId || q.learningObjective || "",
                      bloom: q.bloom || q.bloomLevel || "Understand",
                      status: q.status || "Draft",
                      lastEdited: q.updatedAt || q.createdAt ? new Date(q.updatedAt || q.createdAt).toLocaleString() : new Date().toLocaleString(),
                      approved: q.status === "Approved",
                      flagged: q.flagStatus || q.flagged || false,
                      published: q.published || false,
                      isInPublishedQuiz: quiz.published || false,
                    };
                  }),
                  isOpen: false,
                  selection: new Set(),
                };
              }
              return null;
            } catch {
              return null;
            }
          })
        );

        // Filter out null results
        this.quizzes = quizzesWithQuestions.filter(quiz => quiz !== null);
      } else {
        this.quizzes = [];
      }
    } catch (error) {
      console.error('Error loading saved question sets:', error);
      this.quizzes = [];
    }
  }

  updateFilterOptions() {
    this.updateQuizFilter();
    this.updateLearningObjectivesFilter();
    this.updateBloomLevelsFilter();
    this.updateStatusFilter();
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

    // Load saved question sets from backend (for Review tab)
    await this.loadSavedQuestionSets();

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

        // Update URL search params
        const url = new URL(window.location);
        url.searchParams.set("tab", tabName);
        window.history.pushState({ tab: tabName }, "", url);

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
    const bloomFilter = document.getElementById("bloom-filter");
    const statusFilter = document.getElementById("status-filter");
    const flaggedFilter = document.getElementById("flagged-filter");
    const searchInput = document.getElementById("search-input");

    if (quizFilter) {
      quizFilter.addEventListener("change", async (e) => {
        this.state.filters.quiz = e.target.value;
        await this.applyFilters();
      });
    }

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

    // Sortable headers
    this.initializeSortableHeaders();

    // Action buttons
    this.initializeActionButtons();

    // Cross-quiz action buttons
    this.initializeCrossQuizActions();

    // Modal events
    this.initializeModalEvents();
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
    const flagBtn = document.getElementById("flag-btn");
    const deleteBtn = document.getElementById("delete-btn");

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

  initializeCrossQuizActions() {
    const crossApproveBtn = document.getElementById("cross-approve-btn");
    const crossFlagBtn = document.getElementById("cross-flag-btn");
    const crossDeleteBtn = document.getElementById("cross-delete-btn");

    if (crossApproveBtn) {
      crossApproveBtn.addEventListener("click", () =>
        this.handleCrossQuizAction("approve")
      );
    }
    if (crossFlagBtn) {
      crossFlagBtn.addEventListener("click", () =>
        this.handleCrossQuizAction("flag")
      );
    }
    if (crossDeleteBtn) {
      crossDeleteBtn.addEventListener("click", () =>
        this.handleCrossQuizAction("delete")
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
   * Check if a question belongs to a published quiz
   * @param {string} questionId - The question ID
   * @returns {boolean} True if question is in a published quiz
   */
  isQuestionInPublishedQuiz(questionId) {
    const question = this.questions.find(q => String(q.id || "") === String(questionId));
    if (!question) {
      // Also check in quiz questions
      for (const quiz of this.quizzes) {
        const quizQuestion = quiz.questions.find(q => String(q.id) === String(questionId));
        if (quizQuestion) {
          return quiz.published || false;
        }
      }
      return false;
    }
    return question.isInPublishedQuiz || false;
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

    // Also check in quiz questions
    for (const quiz of this.quizzes) {
      const quizQuestion = quiz.questions.find(q => String(q.id) === String(questionId));
      if (quizQuestion) {
        const status = quizQuestion.status || "Draft";
        return status.toLowerCase() !== "approved";
      }
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
      { id: "flag-btn", description: "flag button" },
      { id: "delete-btn", description: "delete button" },
      { id: "cross-flag-btn", description: "cross-quiz flag button" },
      { id: "cross-delete-btn", description: "cross-quiz delete button" },
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
      [TAB_NAMES.overview]: 'Overview',
      [TAB_NAMES.review]: 'Review',
      [TAB_NAMES.approvedHistory]: 'Approved History',
    };
    document.title = `${tabTitles[tabName] || 'Question Bank'} - Question Bank - GRASP`;

    if (tabName === TAB_NAMES.overview) {
      await this.renderOverview();
    } else if (tabName === TAB_NAMES.review) {
      await this.renderReview();
    } else if (tabName === TAB_NAMES.approvedHistory) {
      this.renderApprovedHistory();
    }
  }

  async renderAll() {
    if (this.state.currentTab === TAB_NAMES.overview) {
      await this.renderOverview();
    } else if (this.state.currentTab === TAB_NAMES.review) {
      this.renderReview();
    } else if (this.state.currentTab === TAB_NAMES.approvedHistory) {
      this.renderApprovedHistory();
    }
  }

  async renderOverview() {
    // Reload questions from saved quiz data
    await this.loadQuestionsForOverview();
    this.renderQuestionsTable();
    this.updateActionButtons();
  }

  async renderReview() {
    // Reload quiz data to get updated question statuses
    await this.loadSavedQuestionSets();
    this.renderQuizzes();
    this.updateCrossQuizActions();
  }

  renderApprovedHistory() {
    // Placeholder for approved history content
    const approvedHistoryPanel = document.getElementById(
      "approved-history-panel"
    );
    if (approvedHistoryPanel) {
      approvedHistoryPanel.innerHTML = `
        <div class="empty-state">
          <h3>Approved History</h3>
          <p>This tab will show the approved history content.</p>
        </div>
      `;
    }
  }

  renderQuizzes() {
    const quizzesContainer = document.getElementById("quizzes-container");
    if (!quizzesContainer) return;

    const filteredQuizzes = this.getFilteredQuizzes();

    if (filteredQuizzes.length === 0) {
      quizzesContainer.innerHTML = `
        <div class="empty-state">
          <h3>No quizzes to review</h3>
          <p>You haven't saved any quizzes from question generation yet.</p>
          <p>Go to <a href="/question-generation">Question Generation</a> to create and save your first quiz.</p>
        </div>
      `;
      return;
    }

    quizzesContainer.innerHTML = filteredQuizzes
      .map(
        (quiz) => {
          const createdDate = quiz.createdAt
            ? new Date(quiz.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          const progressPercent = this.getQuizProgress(quiz);
          const quizIdEscaped = String(quiz.id).replace(/'/g, "\\'");

          return `
      <div class="quiz-card" data-quiz-id="${quiz.id}">
        <div class="quiz-card-header">
          <h3 class="quiz-title">${quiz.title}</h3>
          <div class="quiz-created-date">Created: ${createdDate}</div>
        </div>
        <div class="quiz-progress-section">
          <div class="quiz-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="progress-text">${progressPercent}% Approved</div>
          </div>
        </div>
        <div class="quiz-card-actions">
          <button class="review-btn" 
                  onclick="event.stopPropagation(); window.questionBankPage.navigateToReview('${quizIdEscaped}')">
            Review
          </button>
          <button class="export-btn" 
                  onclick="event.stopPropagation(); window.questionBankPage.exportQuiz('${quizIdEscaped}')">
            Export
          </button>
          ${this.renderIfPermitted(`
            <button class="publish-btn ${quiz.published ? 'published' : ''}" 
                    onclick="event.stopPropagation(); window.questionBankPage.toggleQuizPublish('${quizIdEscaped}')">
              ${quiz.published ? 'Unpublish' : 'Publish'}
            </button>
            <button class="delete-btn" 
                    onclick="event.stopPropagation(); window.questionBankPage.deleteQuiz('${quizIdEscaped}')">
              Delete
            </button>
          `, this.isFaculty)}
        </div>
        <div class="quiz-details ${quiz.isOpen ? "expanded" : ""}">
          <div class="details-header">
            <h4 class="details-title">Questions</h4>
            ${this.renderIfPermitted(`
              <div class="details-select-all">
                <input type="checkbox" class="quiz-select-all" 
                       onclick="event.stopPropagation()"
                       onchange="window.questionBankPage.handleQuizSelectAll(${quiz.id
            }, this.checked)">
                <label>Select all</label>
              </div>
            `, this.isFaculty)}
          </div>
          <div class="quiz-questions">
            ${this.renderQuizQuestions(quiz)}
          </div>
          <div class="quiz-bulk-actions ${quiz.selection.size > 0 ? "visible" : ""
            }">
            ${this.isFaculty
              ? `<button class="approve-btn" onclick="event.stopPropagation(); window.questionBankPage.handleQuizBulkAction(${quiz.id
              }, 'approve')">
                Approve selected
              </button>`
              : ''
            }
            ${this.renderIfPermitted(`
              <button class="flag-btn" onclick="event.stopPropagation(); window.questionBankPage.handleQuizBulkAction(${quiz.id
              }, 'flag')">
                Flag selected
              </button>
              <button class="delete-btn" onclick="event.stopPropagation(); window.questionBankPage.handleQuizBulkAction(${quiz.id
              }, 'delete')">
                Delete selected
              </button>
            `, this.isFaculty)}
          </div>
        </div>
      </div>
    `;
        }
      )
      .join("");

    // Re-attach event listeners

    // Update filter options after rendering
    this.updateFilterOptions();
  }

  renderQuizQuestions(quiz) {
    const filteredQuestions = this.getFilteredQuizQuestions(quiz);

    if (filteredQuestions.length === 0) {
      return `
        <div class="empty-state">
          <p>No questions match the current filters.</p>
        </div>
      `;
    }

    return `
      <table class="questions-table">
        <thead>
          <tr>
            ${this.renderIfPermitted('<th style="width: 40px;"></th>', this.isFaculty)}
            <th>Question Title</th>
            <th>Associated GLO</th>
            <th>Bloom</th>
            <th>Status</th>
            <th>Last Edited</th>
            <th style="width: 200px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filteredQuestions
        .map(
          (question) => `
            <tr data-question-id="${question.id}">
              ${this.renderIfPermitted(`
              <td>
                <input type="checkbox" class="question-checkbox" 
                       ${quiz.selection.has(question.id) ? "checked" : ""}
                       onchange="window.questionBankPage.toggleQuizQuestionSelection(${quiz.id
            }, ${question.id})">
              </td>
            `, this.isFaculty)}
              <td class="question-title">${question.title}</td>
              <td><span class="question-lo">${question.loCode}</span></td>
              <td class="question-bloom">${question.bloom}</td>
              <td>
                <span class="question-status status-${question.status.toLowerCase()}">${question.status
            }</span>
              </td>
              <td>${question.lastEdited}</td>
              <td class="question-actions">
                ${this.isFaculty
              ? `<button class="question-action-btn approve" 
                            onclick="window.questionBankPage.handleQuestionAction(${quiz.id
              }, ${question.id}, 'approve')">
                    ${question.approved ? "Unapprove" : "Approve"}
                  </button>`
              : ''
            }
                <button class="question-action-btn flag" 
                        onclick="window.questionBankPage.handleQuestionAction(${quiz.id
            }, ${question.id}, 'flag')">
                  ${question.flagged ? "Unflag" : "Flag"}
                </button>
                ${this.canEditQuestion(question.id)
              ? `<button class="question-action-btn edit" 
                            onclick="window.questionBankPage.handleQuestionAction(${quiz.id
              }, ${question.id}, 'edit')">
                      Edit
                    </button>`
              : ''
            }
                ${this.isFaculty
              ? `<button class="question-action-btn delete" 
                            onclick="window.questionBankPage.handleQuestionAction(${quiz.id
              }, ${question.id}, 'delete')">
                    Delete
                  </button>`
              : ''
            }
              </td>
            </tr>
          `
        )
        .join("")}
        </tbody>
      </table>
    `;
  }

  getFilteredQuizzes() {
    // All quizzes are already filtered by course (loaded from sessionStorage)
    return [...this.quizzes];
  }

  getFilteredQuizQuestions(quiz) {
    let filtered = [...quiz.questions];

    // Apply objective filter
    if (this.state.filters.objective !== "all") {
      filtered = filtered.filter((q) =>
        q.loCode.includes(this.state.filters.objective)
      );
    }

    // Apply bloom filter
    if (this.state.filters.bloom !== "all") {
      filtered = filtered.filter((q) => q.bloom === this.state.filters.bloom);
    }

    // Apply status filter
    if (this.state.filters.status !== "all") {
      filtered = filtered.filter((q) => q.status === this.state.filters.status);
    }

    // Apply search filter
    if (this.state.filters.q) {
      const searchTerm = this.state.filters.q.toLowerCase();
      filtered = filtered.filter(
        (q) =>
          q.title.toLowerCase().includes(searchTerm) ||
          q.loCode.toLowerCase().includes(searchTerm)
      );
    }

    return filtered;
  }

  getQuizProgress(quiz) {
    const approvedCount = quiz.questions.filter((q) => q.approved).length;
    const totalCount = quiz.questions.length;
    return totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;
  }

  toggleQuizDetails(quizId) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    if (quiz) {
      quiz.isOpen = !quiz.isOpen;
      this.renderQuizzes();
    }
  }

  toggleQuizQuestionSelection(quizId, questionId) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    if (quiz) {
      if (quiz.selection.has(questionId)) {
        quiz.selection.delete(questionId);
      } else {
        quiz.selection.add(questionId);
      }
      this.updateCrossQuizActions();
      this.renderQuizzes();
    }
  }

  handleQuizSelectAll(quizId, checked) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    if (quiz) {
      const filteredQuestions = this.getFilteredQuizQuestions(quiz);
      if (checked) {
        filteredQuestions.forEach((q) => quiz.selection.add(q.id));
      } else {
        filteredQuestions.forEach((q) => quiz.selection.delete(q.id));
      }
      this.updateCrossQuizActions();
      this.renderQuizzes();
    }
  }

  handleQuestionAction(quizId, questionId, action) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    const question = quiz.questions.find((q) => q.id === questionId);

    if (!quiz || !question) return;

    switch (action) {
      case "approve":
        if (!this.requireFaculty("approve questions")) return;
        question.approved = !question.approved;
        question.status = question.approved ? "Approved" : "Draft";
        this.showNotification(
          `Question ${question.approved ? "approved" : "unapproved"}`,
          "success"
        );
        break;
      case "flag":
        question.flagged = !question.flagged;
        question.status = question.flagged ? "Flagged" : "Draft";
        this.showNotification(
          `Question ${question.flagged ? "flagged" : "unflagged"}`,
          "success"
        );
        break;
      case "edit":
        if (!this.canEditQuestion(questionId)) {
          this.showNotification("You cannot edit questions in published quizzes", "error");
          return;
        }
        this.handleQuestionEdit(quizId, questionId);
        return;
      case "delete":
        if (!this.requireFaculty("delete questions")) return;
        this.showModal(
          "Delete Question",
          `Are you sure you want to delete "${question.title}"?`,
          () => {
            const questionIndex = quiz.questions.findIndex(
              (q) => q.id === questionId
            );
            if (questionIndex > -1) {
              quiz.questions.splice(questionIndex, 1);
              quiz.selection.delete(questionId);
              this.showNotification("Question deleted", "success");
              this.renderQuizzes();
              this.updateCrossQuizActions();
            }
          }
        );
        return;
    }

    // Update progress and re-render
    this.renderQuizzes();
    this.updateCrossQuizActions();
  }

  handleQuestionEdit(quizId, questionId) {
    // Open the question modal for editing
    this.openQuestionModal(questionId);
  }

  handleQuizBulkAction(quizId, action) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    if (!quiz || quiz.selection.size === 0) return;

    const selectedQuestions = quiz.questions.filter((q) =>
      quiz.selection.has(q.id)
    );

    switch (action) {
      case "approve":
        if (!this.requireFaculty("approve questions")) return;
        selectedQuestions.forEach((q) => {
          q.approved = true;
          q.status = "Approved";
        });
        this.showNotification(
          `Approved ${selectedQuestions.length} questions`,
          "success"
        );
        break;
      case "flag":
        if (!this.requireFaculty("bulk flag questions")) return;
        selectedQuestions.forEach((q) => {
          q.flagged = true;
          q.status = "Flagged";
        });
        this.showNotification(
          `Flagged ${selectedQuestions.length} questions`,
          "success"
        );
        break;
      case "delete":
        if (!this.requireFaculty("delete questions")) return;
        this.showModal(
          "Delete Questions",
          `Are you sure you want to delete ${selectedQuestions.length} question(s)?`,
          () => {
            selectedQuestions.forEach((q) => {
              const questionIndex = quiz.questions.findIndex(
                (question) => question.id === q.id
              );
              if (questionIndex > -1) {
                quiz.questions.splice(questionIndex, 1);
              }
            });
            quiz.selection.clear();
            this.showNotification(
              `Deleted ${selectedQuestions.length} questions`,
              "success"
            );
            this.renderQuizzes();
            this.updateCrossQuizActions();
          }
        );
        return;
    }

    // Update progress and re-render
    this.renderQuizzes();
    this.updateCrossQuizActions();
  }

  updateCrossQuizActions() {
    const crossQuizActions = document.getElementById("cross-quiz-actions");
    const crossQuizCount = document.getElementById("cross-quiz-count");

    if (!crossQuizActions || !crossQuizCount) return;

    // Count total selected questions across all quizzes
    let totalSelected = 0;
    this.quizzes.forEach((quiz) => {
      totalSelected += quiz.selection.size;
    });

    if (totalSelected > 0) {
      crossQuizActions.style.display = "flex";
      crossQuizCount.textContent = `${totalSelected} question${totalSelected !== 1 ? "s" : ""
        } selected`;

      // Show/hide approve button based on user role
      const crossApproveBtn = document.getElementById("cross-approve-btn");
      if (crossApproveBtn) {
        if (this.isFaculty) {
          crossApproveBtn.style.display = "inline-flex";
          crossApproveBtn.disabled = false;
        } else {
          crossApproveBtn.style.display = "none";
        }
      }

      // Check if any selected questions are approved (for staff delete restriction)
      let hasApprovedQuestions = false;
      if (!this.isFaculty) {
        this.quizzes.forEach((quiz) => {
          if (quiz.selection.size > 0) {
            quiz.questions.forEach((q) => {
              if (quiz.selection.has(q.id) && q.status && q.status.toLowerCase() === 'approved') {
                hasApprovedQuestions = true;
              }
            });
          }
        });
      }

      // Enable/disable cross-quiz action buttons
      // Buttons are already hidden/shown in initializePermissionBasedUI for non-faculty
      const crossFlagBtn = document.getElementById("cross-flag-btn");
      const crossDeleteBtn = document.getElementById("cross-delete-btn");

      if (crossFlagBtn && this.isFaculty) {
        crossFlagBtn.disabled = false;
      }

      if (crossDeleteBtn && this.isFaculty) {
        crossDeleteBtn.disabled = false;
        crossDeleteBtn.title = "";
      }
    } else {
      crossQuizActions.style.display = "none";

      // Disable cross-quiz action buttons
      const crossButtons = [
        "cross-approve-btn",
        "cross-flag-btn",
        "cross-delete-btn",
      ];
      crossButtons.forEach((btnId) => {
        const btn = document.getElementById(btnId);
        if (btn) {
          btn.disabled = true;
        }
      });
    }
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

  handleCrossQuizAction(action) {
    let totalSelected = 0;
    let affectedQuizzes = [];

    // Collect all selected questions across quizzes
    this.quizzes.forEach((quiz) => {
      if (quiz.selection.size > 0) {
        totalSelected += quiz.selection.size;
        affectedQuizzes.push(quiz);
      }
    });

    if (totalSelected === 0) return;

    switch (action) {
      case "approve":
        if (!this.requireFaculty("approve questions")) return;
        affectedQuizzes.forEach((quiz) => {
          quiz.questions.forEach((q) => {
            if (quiz.selection.has(q.id)) {
              q.approved = true;
              q.status = "Approved";
            }
          });
        });
        this.showNotification(
          `Approved ${totalSelected} questions across ${affectedQuizzes.length
          } quiz${affectedQuizzes.length !== 1 ? "es" : ""}`,
          "success"
        );
        break;
      case "flag":
        if (!this.requireFaculty("bulk flag questions")) return;
        affectedQuizzes.forEach((quiz) => {
          quiz.questions.forEach((q) => {
            if (quiz.selection.has(q.id)) {
              q.flagged = true;
              q.status = "Flagged";
            }
          });
        });
        this.showNotification(
          `Flagged ${totalSelected} questions across ${affectedQuizzes.length
          } quiz${affectedQuizzes.length !== 1 ? "es" : ""}`,
          "success"
        );
        break;
      case "delete":
        if (!this.requireFaculty("delete questions")) return;
        this.showModal(
          "Delete Questions",
          `Are you sure you want to delete ${totalSelected} question(s) across ${affectedQuizzes.length
          } quiz${affectedQuizzes.length !== 1 ? "es" : ""}?`,
          () => {
            affectedQuizzes.forEach((quiz) => {
              const questionsToRemove = quiz.questions.filter((q) =>
                quiz.selection.has(q.id)
              );
              questionsToRemove.forEach((q) => {
                const questionIndex = quiz.questions.findIndex(
                  (question) => question.id === q.id
                );
                if (questionIndex > -1) {
                  quiz.questions.splice(questionIndex, 1);
                }
              });
              quiz.selection.clear();
            });
            this.showNotification(
              `Deleted ${totalSelected} questions`,
              "success"
            );
            this.renderQuizzes();
            this.updateCrossQuizActions();
          }
        );
        return;
    }

    // Clear all selections and re-render
    this.quizzes.forEach((quiz) => quiz.selection.clear());
    this.renderQuizzes();
    this.updateCrossQuizActions();
  }

  async applyFilters() {
    // Clear selections for rows no longer visible
    this.clearOutOfViewSelections();

    if (this.state.currentTab === TAB_NAMES.review) {
      this.renderQuizzes();
    } else if (this.state.currentTab === TAB_NAMES.overview) {
      await this.renderOverview();
    }
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
    const flagBtn = document.getElementById("flag-btn");
    const deleteBtn = document.getElementById("delete-btn");

    // Buttons are already hidden/shown in initializePermissionBasedUI for non-faculty
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
    if (objectiveFilter) objectiveFilter.value = "all";
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

  // Export quiz questions (only approved questions)
  async exportQuiz(quizId) {
    const quiz = this.quizzes.find((q) => String(q.id) === String(quizId));
    if (!quiz || !quiz.questions || quiz.questions.length === 0) {
      this.showNotification("No questions to export", "error");
      return;
    }

    // Filter to only approved questions
    const approvedQuestions = quiz.questions.filter(q =>
      q.approved === true || q.status === "Approved"
    );

    if (approvedQuestions.length === 0) {
      this.showNotification("No approved questions to export", "error");
      return;
    }

    // Show export modal with format selection
    this.showExportModal(quiz, approvedQuestions);
  }

  // Delete quiz and all associated questions
  async deleteQuiz(quizId) {
    if (!this.requireFaculty("delete quizzes")) return;

    const quiz = this.quizzes.find((q) => String(q.id) === String(quizId));
    if (!quiz) {
      this.showNotification("Quiz not found", "error");
      return;
    }

    const questionCount = quiz.questions ? quiz.questions.length : 0;
    const quizTitle = quiz.title || "this quiz";

    // Show confirmation modal
    this.showModal(
      'Delete Quiz',
      `Are you sure you want to delete "${quizTitle}"? This will permanently delete the quiz and all ${questionCount} question(s) associated with it. This action cannot be undone.`,
      async () => {
        try {
          const response = await fetch(`${API_ENDPOINTS.quiz}/${quizId}`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete quiz');
          }

          // Remove quiz from local state
          const quizIndex = this.quizzes.findIndex((q) => toStringId(q.id) === toStringId(quizId));
          if (quizIndex > -1) {
            this.quizzes.splice(quizIndex, 1);
          }

          // Also remove from allQuizzes if it exists there
          const allQuizIndex = this.allQuizzes.findIndex((q) => getObjectId(q) === toStringId(quizId));
          if (allQuizIndex > -1) {
            this.allQuizzes.splice(allQuizIndex, 1);
          }

          // Remove questions from local state that were associated with this quiz
          const questionIds = new Set(quiz.questions.map(q => toStringId(q.id)));
          this.questions = this.questions.filter(q => !questionIds.has(toStringId(q.id)));

          // Refresh the UI
          this.renderQuizzes();
          this.updateFilterOptions();
          this.showNotification(`Quiz "${quizTitle}" and ${questionCount} question(s) deleted successfully`, 'success');
        } catch (error) {
          console.error('Error deleting quiz:', error);
          this.showNotification(error.message || 'Failed to delete quiz', 'error');
        }
      }
    );
  }

  // Toggle quiz published status
  async toggleQuizPublish(quizId) {
    if (!this.requireFaculty("publish or unpublish quizzes")) return;

    const quiz = this.quizzes.find((q) => String(q.id) === String(quizId));
    if (!quiz) {
      this.showNotification("Quiz not found", "error");
      return;
    }

    const newPublishedStatus = !quiz.published;
    const action = newPublishedStatus ? "publish" : "unpublish";
    const quizTitle = quiz.title || "this quiz";

    try {
      const response = await fetch(`${API_ENDPOINTS.quiz}/${quizId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          published: newPublishedStatus,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${action} quiz`);
      }

      // Update local state
      quiz.published = newPublishedStatus;

      // Also update in allQuizzes if it exists there
      const allQuiz = this.allQuizzes.find((q) => getObjectId(q) === toStringId(quizId));
      if (allQuiz) {
        allQuiz.published = newPublishedStatus;
      }

      // Refresh the UI
      this.renderQuizzes();
      this.showNotification(`Quiz "${quizTitle}" ${newPublishedStatus ? 'published' : 'unpublished'} successfully`, 'success');
    } catch (error) {
      console.error(`Error ${action}ing quiz:`, error);
      this.showNotification(error.message || `Failed to ${action} quiz`, 'error');
    }
  }

  showExportModal(quiz, approvedQuestions) {
    const modal = document.getElementById("export-summary-modal");
    const modalBody = document.getElementById("export-summary-modal-body");

    if (!modal || !modalBody) {
      console.error("Export modal not found");
      return;
    }

    // Helper function to escape HTML
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    const quizName = escapeHtml(quiz.name || quiz.title || 'Untitled Quiz');
    const quizId = String(quiz.id).replace(/'/g, "\\'");

    // Generate export options HTML
    const exportOptionsHTML = `
      <div class="export-options">
        <div class="export-info">
          <h3>${quizName}</h3>
          <div class="export-stats">
            <div class="stat-item">
              <span class="stat-label">Total Questions:</span>
              <strong class="stat-value">${quiz.questions.length}</strong>
            </div>
            <div class="stat-item">
              <span class="stat-label">Approved Questions:</span>
              <strong class="stat-value approved">${approvedQuestions.length}</strong>
            </div>
          </div>
          <p class="export-note">
            <i class="fas fa-info-circle"></i>
            Only approved questions will be exported.
          </p>
        </div>
        
        <h4 class="export-format-title">Select Export Format</h4>
        <div class="export-format-buttons">
          <button class="export-format-btn" onclick="window.questionBankPage.handleExportFormat('csv', '${quizId}')">
            <i class="fas fa-file-csv"></i>
            <span>CSV</span>
          </button>
          <button class="export-format-btn" onclick="window.questionBankPage.handleExportFormat('json', '${quizId}')">
            <i class="fas fa-file-code"></i>
            <span>JSON</span>
          </button>
          <button class="export-format-btn" onclick="window.questionBankPage.handleExportFormat('qti', '${quizId}')">
            <i class="fas fa-file-code"></i>
            <span>QTI</span>
            <small>Canvas</small>
          </button>
        </div>
      </div>
    `;

    modalBody.innerHTML = exportOptionsHTML;
    modal.style.display = "flex";

    // Setup close button
    const closeBtn = document.getElementById("export-summary-modal-close");
    const confirmBtn = document.getElementById("export-summary-confirm");

    if (closeBtn) {
      closeBtn.onclick = () => this.hideExportModal();
    }
    if (confirmBtn) {
      confirmBtn.onclick = () => this.hideExportModal();
    }
  }

  hideExportModal() {
    const modal = document.getElementById("export-summary-modal");
    if (modal) {
      modal.style.display = "none";
    }
  }

  async handleExportFormat(format, quizId) {
    const quiz = this.quizzes.find((q) => String(q.id) === String(quizId));
    if (!quiz || !quiz.questions || quiz.questions.length === 0) {
      this.showNotification("No questions to export", "error");
      return;
    }

    // Filter to only approved questions
    const approvedQuestions = quiz.questions.filter(q =>
      q.approved === true || q.status === "Approved"
    );

    if (approvedQuestions.length === 0) {
      this.showNotification("No approved questions to export", "error");
      this.hideExportModal();
      return;
    }

    // Get course information
    const selectedCourse = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.selectedCourse));
    const courseName = selectedCourse?.courseName || 'Course';

    // Fetch full question details for approved questions only
    const questionPromises = approvedQuestions.map(async (q) => {
      try {
        const response = await fetch(`${API_ENDPOINTS.question}/${q.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.question) {
            return data.question;
          }
        }
        return q;
      } catch {
        return q;
      }
    });

    const fullQuestions = await Promise.all(questionPromises);

    // Convert questions to export format
    const questions = fullQuestions.map(q => ({
      text: q.title || q.stem || "",
      stem: q.stem || q.title || "",
      options: q.options || {},
      correctAnswer: q.correctAnswer || "A",
      bloomLevel: q.bloom || q.bloomLevel || "Understand",
      difficulty: q.difficulty || "Medium",
    }));

    try {
      const response = await fetch(`${API_ENDPOINTS.questionExport}?format=${format}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          course: courseName,
          questions: questions,
          quizName: quiz.title || quiz.name || 'Quiz',
          quizDescription: quiz.description || '',
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const filename = `${quiz.title || quiz.name || 'quiz'}-${format}.${this.getFileExtension(format)}`;
        this.downloadFile(blob, filename);
        this.showNotification(`Exported as ${format.toUpperCase()}`, 'success');
        this.hideExportModal();
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      console.error('Export failed:', error);
      this.showNotification('Export failed. Please try again.', 'error');
    }
  }

  getFileExtension(format) {
    switch (format) {
      case "csv":
        return "csv";
      case "json":
        return "json";
      case "qti":
        return "zip"; // Canvas requires QTI in ZIP format
      default:
        return "txt";
    }
  }

  downloadFile(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // Navigate to Overview tab with quiz and status filters set
  async navigateToReview(quizId) {
    // Find the quiz to get its name/ID for the filter
    const quiz = this.quizzes.find((q) => String(q.id) === String(quizId));
    if (!quiz) return;

    // The quiz ID is already stored as a string in quiz.id
    // But we need to match it with the filter which uses _id or id from allQuizzes
    // Find the matching quiz in allQuizzes to get the correct ID format
    const quizForFilter = this.allQuizzes.find((q) => {
      const qId = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || "");
      return qId === String(quizId);
    });

    // Use the ID from allQuizzes if found, otherwise use the quizId
    const quizIdForFilter = quizForFilter
      ? (quizForFilter._id ? (quizForFilter._id.toString ? quizForFilter._id.toString() : String(quizForFilter._id)) : String(quizForFilter.id || quizId))
      : String(quizId);

    // Set filters - RESET everything else
    this.state.filters.quiz = quizIdForFilter;
    this.state.filters.status = "Draft";
    this.state.filters.objective = "all";
    this.state.filters.bloom = "all";
    this.state.filters.flagged = false;
    this.state.filters.q = "";

    // Update filter UI
    const quizFilter = document.getElementById("quiz-filter");
    const statusFilter = document.getElementById("status-filter");
    const objectiveFilter = document.getElementById("objective-filter");
    const bloomFilter = document.getElementById("bloom-filter");
    const flaggedFilter = document.getElementById("flagged-filter");
    const searchInput = document.getElementById("search-input");

    if (quizFilter) quizFilter.value = quizIdForFilter;
    if (statusFilter) statusFilter.value = "Draft";
    if (objectiveFilter) objectiveFilter.value = "all";
    if (bloomFilter) bloomFilter.value = "all";
    if (flaggedFilter) flaggedFilter.checked = false;
    if (searchInput) searchInput.value = "";

    // Switch to Overview tab
    await this.switchTab("overview");

    // Update URL
    const url = new URL(window.location);
    url.searchParams.set("tab", "overview");
    window.history.pushState({ tab: "overview" }, "", url);

    // Apply filters to show the filtered questions
    await this.applyFilters();
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
    // Allow viewing, but editing will be disabled if question is in published quiz
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
            return { id: key, text: opt };
          } else if (opt && typeof opt === 'object') {
            return { id: opt.id || key, text: opt.text || opt };
          } else {
            return { id: key, text: String(opt || '') };
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
      const isCorrect = optionId === correctAnswerLetter;
      const escapedText = (optionText || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
          <input type="text" 
                 class="question-modal-option-input ${readonlyClass}" 
                 value="${escapedText}"
                 data-option-index="${index}"
                 placeholder="Enter option text..."
                 ${readonlyAttr}
                 style="${readonlyStyle}">
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

    // Check if user can still edit this question (in case quiz was published while modal was open)
    if (!this.canEditQuestion(this.currentEditingQuestion.id)) {
      this.showNotification("You cannot edit questions in published quizzes", "error");
      this.closeQuestionModal();
      return;
    }

    const saveBtn = document.getElementById("question-modal-save");
    if (saveBtn) saveBtn.disabled = true;

    try {
      const titleInput = document.getElementById("question-modal-title-input");
      const stemInput = document.getElementById("question-modal-stem-input");
      const optionInputs = document.querySelectorAll(".question-modal-option-input");

      const title = titleInput ? titleInput.value.trim() : "";
      const stem = stemInput ? stemInput.value.trim() : "";
      const options = Array.from(optionInputs).map((input, index) => {
        const optionId = String.fromCharCode(65 + parseInt(input.dataset.optionIndex || index));
        return {
          id: optionId,
          text: input.value.trim()
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

      // Convert options array back to object format {A: "...", B: "...", C: "...", D: "..."}
      const optionsObject = {};
      options.forEach(opt => {
        optionsObject[opt.id] = opt.text;
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

      // Also update in quiz questions if present
      for (const quiz of this.quizzes) {
        const quizQuestion = quiz.questions.find(q => toStringId(q.id) === toStringId(questionId));
        if (quizQuestion) {
          quizQuestion.flagged = newFlagStatus;
        }
      }

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
}

// Initialize the page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.questionBankPage = new QuestionBankPage();
});

// Export for use in other files
window.QuestionBankPage = QuestionBankPage;
