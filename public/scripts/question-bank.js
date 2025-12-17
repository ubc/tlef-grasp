// Question Bank Page JavaScript
// Handles interactions and functionality for the new 3-panel layout and Review tab

class QuestionBankPage {
  constructor() {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    this.courseId = selectedCourse.id || null;
    this.courseName = selectedCourse.courseName || "";

    // Get current tab from URL search params, default to "overview"
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get("tab");
    const defaultTab = tabParam && ["overview", "review", "approved-history"].includes(tabParam) 
      ? tabParam 
      : "overview";

    this.state = {
      filters: { 
        quiz: "all", 
        objective: "all", 
        bloom: "all", 
        status: "all", 
        flagged: false,
        q: "" 
      },
      sort: { key: "title", dir: "asc" },
      selectedQuestionIds: new Set(),
      selectedHistoryId: null,
      currentTab: defaultTab,
    };

    this.questions = [];
    this.history = [];
    this.quizzes = [];
    this.allQuizzes = []; // Store all quizzes for filter dropdown
    this.objectivesMap = new Map(); // Map objective ID to objective name
    this.init();
  }

  async init() {
    this.initializeNavigation();
    this.initializeData();
    this.initializeEventListeners();
    
    // Set initial tab based on URL or default to overview
    await this.switchTab(this.state.currentTab);
  }

  initializeNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }

  async loadSavedQuestionSets() {
    if (!this.courseId) {
      console.error("No course ID available");
      this.quizzes = [];
      return;
    }

    try {
      // Load quizzes for the current course
      const response = await fetch(`/api/quiz/course/${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.quizzes && data.quizzes.length > 0) {
        // Load questions for each quiz
        const quizzesWithQuestions = await Promise.all(
          data.quizzes.map(async (quiz) => {
            try {
              const questionsResponse = await fetch(`/api/quiz/${quiz._id}/questions`);
              if (questionsResponse.ok) {
                const questionsData = await questionsResponse.json();
                const questions = questionsData.success && questionsData.questions 
                  ? questionsData.questions 
                  : [];

                return {
                  id: quiz._id ? (quiz._id.toString ? quiz._id.toString() : String(quiz._id)) : String(quiz.id || ""),
                  title: quiz.name || "Unnamed Quiz",
                  course: this.courseName,
                  week: null,
                  lecture: null,
                  releases: [
                    {
                      label: quiz.name || "Unnamed Quiz",
                      date: quiz.createdAt ? new Date(quiz.createdAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                    },
                  ],
                  questions: questions.map((q, qIndex) => {
                    const qId = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || `q_${qIndex}`);
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
                    };
                  }),
                  isOpen: false,
                  selection: new Set(),
                };
              }
              return null;
            } catch (error) {
              console.error(`Error loading questions for quiz ${quiz._id}:`, error);
              return null;
            }
          })
        );

        // Filter out null results
        this.quizzes = quizzesWithQuestions.filter(quiz => quiz !== null);
      } else {
        // No saved question sets - show empty state
        this.quizzes = [];
      }
    } catch (error) {
      console.error("Error loading saved question sets:", error);
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
      console.error("No course ID available");
      this.questions = [];
      return;
    }

    try {
      const response = await fetch(`/api/question?courseId=${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.questions) {
        // Map questions from database format to Overview format
        this.questions = data.questions.map((question) => {
          // Convert ID to string for consistent comparison
          const questionId = question._id ? (question._id.toString ? question._id.toString() : String(question._id)) : String(question.id || "");
          const objectiveId = question.learningObjectiveId ? (question.learningObjectiveId.toString ? question.learningObjectiveId.toString() : String(question.learningObjectiveId)) : null;
          
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
      console.error("Error loading questions for overview:", error);
      this.questions = [];
    }
  }

  async loadLearningObjectives() {
    if (!this.courseId) return;

    try {
      // Load all parent objectives for the course
      const response = await fetch(`/api/objective?courseId=${this.courseId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.objectives) {
          // Build map of objective ID to name
          data.objectives.forEach(objective => {
            const objId = objective._id ? (objective._id.toString ? objective._id.toString() : String(objective._id)) : String(objective.id || "");
            this.objectivesMap.set(objId, objective.name || "Unnamed Objective");
          });
        }
      }
    } catch (error) {
      console.error("Error loading learning objectives:", error);
    }
  }

  async loadQuizRelationships() {
    if (!this.courseId) return;

    try {
      // Load all quizzes for the course
      const quizzesResponse = await fetch(`/api/quiz/course/${this.courseId}`);
      if (quizzesResponse.ok) {
        const quizzesData = await quizzesResponse.json();
        if (quizzesData.success && quizzesData.quizzes) {
          this.allQuizzes = quizzesData.quizzes;

          // For each quiz, get its questions and map quizId to questions
          for (const quiz of this.allQuizzes) {
            const quizQuestionsResponse = await fetch(`/api/quiz/${quiz._id}/questions`);
            if (quizQuestionsResponse.ok) {
              const quizQuestionsData = await quizQuestionsResponse.json();
              if (quizQuestionsData.success && quizQuestionsData.questions) {
                const questionIds = new Set(
                  quizQuestionsData.questions.map(q => {
                    const qId = q._id ? (q._id.toString ? q._id.toString() : String(q._id)) : String(q.id || "");
                    return qId;
                  })
                );
                
                // Update questions with quizId
                this.questions.forEach(question => {
                  const questionId = String(question.id || "");
                  if (questionIds.has(questionId)) {
                    question.quizId = quiz._id ? (quiz._id.toString ? quiz._id.toString() : String(quiz._id)) : String(quiz.id || "");
                    question.quizName = quiz.name;
                  }
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error loading quiz relationships:", error);
    }
  }

  async initializeData() {
    // Load questions for Overview tab from database
    await this.loadQuestionsForOverview();

    // Load saved question sets from backend (for Review tab)
    await this.loadSavedQuestionSets();

    // Update filter options based on loaded data
    this.updateFilterOptions();

    // Sample history data
    this.history = [
      {
        id: 1,
        questionIds: [1, 2, 3, 4, 5],
        count: 5,
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        label: "Today, 3:00 PM",
      },
      {
        id: 2,
        questionIds: [6, 7],
        count: 2,
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        label: "Yesterday, 12:34 PM",
      },
      {
        id: 3,
        questionIds: [8],
        count: 1,
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        label: "Today, 2:00 PM",
      },
    ];
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

  async switchTab(tabName) {
    this.state.currentTab = tabName;
    console.log(`Switching to ${tabName} tab`);

    // Update tab button states
    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach((btn) => {
      if (btn.getAttribute("data-tab") === tabName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Show/hide filters section based on tab
    const filtersSection = document.querySelector(".filters-section");
    if (filtersSection) {
      if (tabName === "overview") {
        filtersSection.style.display = "block";
      } else {
        // Hide filters for Review and Approved History tabs
        filtersSection.style.display = "none";
      }
    }

    // Hide all tab panels
    const tabPanels = document.querySelectorAll(".tab-panel");
    tabPanels.forEach((panel) => (panel.style.display = "none"));

    // Show the selected tab panel
    const selectedPanel = document.getElementById(`${tabName}-panel`);
    if (selectedPanel) {
      selectedPanel.style.display = "block";
    }

    // Update page title
    if (tabName === "overview") {
      document.title = "Overview - Question Bank - GRASP";
      await this.renderOverview();
    } else if (tabName === "review") {
      document.title = "Review - Question Bank - GRASP";
      await this.renderReview();
    } else if (tabName === "approved-history") {
      document.title = "Approved History - Question Bank - GRASP";
      this.renderApprovedHistory();
    }
  }

  async renderAll() {
    if (this.state.currentTab === "overview") {
      await this.renderOverview();
    } else if (this.state.currentTab === "review") {
      this.renderReview();
    } else if (this.state.currentTab === "approved-history") {
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
          <p>Go to <a href="question-generation.html">Question Generation</a> to create and save your first quiz.</p>
        </div>
      `;
      return;
    }

    quizzesContainer.innerHTML = filteredQuizzes
      .map(
        (quiz) => `
      <div class="quiz-card" data-quiz-id="${
        quiz.id
      }" onclick="window.questionBankPage.navigateToQuestionReview(${quiz.id})">
        <div class="quiz-header">
          <div class="quiz-header-left">
            <div class="quiz-chips">
              ${quiz.week ? `<span class="quiz-chip">${quiz.week}</span>` : ""}
              ${
                quiz.lecture
                  ? `<span class="quiz-chip">${quiz.lecture}</span>`
                  : ""
              }
            </div>
            <h3 class="quiz-title">${quiz.title}</h3>
            <div class="quiz-releases">
              ${quiz.releases
                .map(
                  (release) => `
                <div class="release-item">${release.label} - ${release.date}</div>
              `
                )
                .join("")}
            </div>
          </div>
          <div class="quiz-header-right">
            <div class="quiz-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${this.getQuizProgress(
                  quiz
                )}%"></div>
              </div>
              <div class="progress-text">${this.getQuizProgress(
                quiz
              )}% Reviewed</div>
            </div>
            <button class="review-btn" 
                    onclick="event.stopPropagation(); window.questionBankPage.navigateToReview('${String(quiz.id).replace(/'/g, "\\'")}')">
              Review
            </button>
          </div>
        </div>
        <div class="quiz-details ${quiz.isOpen ? "expanded" : ""}">
          <div class="details-header">
            <h4 class="details-title">Questions</h4>
            <div class="details-select-all">
              <input type="checkbox" class="quiz-select-all" 
                     onclick="event.stopPropagation()"
                     onchange="window.questionBankPage.handleQuizSelectAll(${
                       quiz.id
                     }, this.checked)">
              <label>Select all</label>
            </div>
          </div>
          <div class="quiz-questions">
            ${this.renderQuizQuestions(quiz)}
          </div>
          <div class="quiz-bulk-actions ${
            quiz.selection.size > 0 ? "visible" : ""
          }">
            <button class="approve-btn" onclick="event.stopPropagation(); window.questionBankPage.handleQuizBulkAction(${
              quiz.id
            }, 'approve')">
              Approve selected
            </button>
            <button class="flag-btn" onclick="event.stopPropagation(); window.questionBankPage.handleQuizBulkAction(${
              quiz.id
            }, 'flag')">
              Flag selected
            </button>
            <button class="delete-btn" onclick="event.stopPropagation(); window.questionBankPage.handleQuizBulkAction(${
              quiz.id
            }, 'delete')">
              Delete selected
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    // Re-attach event listeners
    this.attachQuizEventListeners();

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
            <th style="width: 40px;"></th>
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
              <td>
                <input type="checkbox" class="question-checkbox" 
                       ${quiz.selection.has(question.id) ? "checked" : ""}
                       onchange="window.questionBankPage.toggleQuizQuestionSelection(${
                         quiz.id
                       }, ${question.id})">
              </td>
              <td class="question-title">${question.title}</td>
              <td><span class="question-lo">${question.loCode}</span></td>
              <td class="question-bloom">${question.bloom}</td>
              <td>
                <span class="question-status status-${question.status.toLowerCase()}">${
                question.status
              }</span>
              </td>
              <td>${question.lastEdited}</td>
              <td class="question-actions">
                <button class="question-action-btn approve" 
                        onclick="window.questionBankPage.handleQuestionAction(${
                          quiz.id
                        }, ${question.id}, 'approve')">
                  ${question.approved ? "Unapprove" : "Approve"}
                </button>
                <button class="question-action-btn flag" 
                        onclick="window.questionBankPage.handleQuestionAction(${
                          quiz.id
                        }, ${question.id}, 'flag')">
                  ${question.flagged ? "Unflag" : "Flag"}
                </button>
                <button class="question-action-btn edit" 
                        onclick="window.questionBankPage.handleQuestionAction(${
                          quiz.id
                        }, ${question.id}, 'edit')">
                  Edit
                </button>
                <button class="question-action-btn delete" 
                        onclick="window.questionBankPage.handleQuestionAction(${
                          quiz.id
                        }, ${question.id}, 'delete')">
                  Delete
                </button>
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
        this.handleQuestionEdit(quizId, questionId);
        return;
      case "delete":
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
    // Implementation for inline editing
    console.log(`Editing question ${questionId} in quiz ${quizId}`);
  }

  handleQuizBulkAction(quizId, action) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    if (!quiz || quiz.selection.size === 0) return;

    const selectedQuestions = quiz.questions.filter((q) =>
      quiz.selection.has(q.id)
    );

    switch (action) {
      case "approve":
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
      crossQuizCount.textContent = `${totalSelected} question${
        totalSelected !== 1 ? "s" : ""
      } selected`;

      // Enable/disable cross-quiz action buttons
      const crossButtons = [
        "cross-approve-btn",
        "cross-flag-btn",
        "cross-delete-btn",
      ];
      crossButtons.forEach((btnId) => {
        const btn = document.getElementById(btnId);
        if (btn) {
          btn.disabled = false;
        }
      });
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
        const question = this.questions.find((q) => String(q.id || "") === String(id));
        if (!question) return;

        try {
          const response = await fetch(`/api/question/${id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              flagStatus: shouldFlag,
            }),
          });

          if (response.ok) {
            question.flagged = shouldFlag;
            return { success: true, id };
          } else {
            console.error(`Failed to update question ${id}`);
            return { success: false, id };
          }
        } catch (error) {
          console.error(`Error updating question ${id}:`, error);
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
          const response = await fetch(`/api/question/${id}`, {
            method: "DELETE",
          });

          if (response.ok) {
            return { success: true, id };
          } else {
            console.error(`Failed to delete question ${id}`);
            return { success: false, id };
          }
        } catch (error) {
          console.error(`Error deleting question ${id}:`, error);
          return { success: false, id };
        }
      });

      const results = await Promise.all(deletePromises);
      const successCount = results.filter(r => r.success).length;

      // Remove successfully deleted questions from local state
      results.forEach((result) => {
        if (result.success) {
          const index = this.questions.findIndex((q) => String(q.id || "") === String(result.id));
          if (index > -1) {
            this.questions.splice(index, 1);
          }
          this.state.selectedQuestionIds.delete(String(result.id));
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
        affectedQuizzes.forEach((quiz) => {
          quiz.questions.forEach((q) => {
            if (quiz.selection.has(q.id)) {
              q.approved = true;
              q.status = "Approved";
            }
          });
        });
        this.showNotification(
          `Approved ${totalSelected} questions across ${
            affectedQuizzes.length
          } quiz${affectedQuizzes.length !== 1 ? "es" : ""}`,
          "success"
        );
        break;
      case "flag":
        affectedQuizzes.forEach((quiz) => {
          quiz.questions.forEach((q) => {
            if (quiz.selection.has(q.id)) {
              q.flagged = true;
              q.status = "Flagged";
            }
          });
        });
        this.showNotification(
          `Flagged ${totalSelected} questions across ${
            affectedQuizzes.length
          } quiz${affectedQuizzes.length !== 1 ? "es" : ""}`,
          "success"
        );
        break;
      case "delete":
        this.showModal(
          "Delete Questions",
          `Are you sure you want to delete ${totalSelected} question(s) across ${
            affectedQuizzes.length
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

    if (this.state.currentTab === "review") {
      this.renderQuizzes();
    } else if (this.state.currentTab === "overview") {
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

  // Overview tab methods (existing functionality)
  renderQuestions() {
    const questionList = document.getElementById("question-list");
    if (!questionList) return;

    const filteredQuestions = this.getFilteredQuestions();
    const sortedQuestions = this.sortQuestions(filteredQuestions);

    if (sortedQuestions.length === 0) {
      questionList.innerHTML = `
        <div class="empty-state">
          <p>No questions match the current filters.</p>
          <a href="#" class="clear-filters-link" onclick="window.questionBankPage.clearFilters()">Clear filters</a>
        </div>
      `;
      return;
    }

    questionList.innerHTML = sortedQuestions
      .map(
        (question) => `
      <div class="question-item" data-question-id="${question.id}">
        <input type="checkbox" id="q${question.id}" 
               ${
                 this.state.selectedQuestionIds.has(question.id)
                   ? "checked"
                   : ""
               }
               onchange="window.questionBankPage.toggleQuestionSelection(${
                 question.id
               })">
        <label for="q${question.id}">${question.title}</label>
      </div>
    `
      )
      .join("");

    this.attachQuestionEventListeners();
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
            <p>Go to <a href="question-generation.html">Question Generation</a> to create and save your first questions.</p>
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
        <td class="select-cell">
          <input type="checkbox" 
                 ${isSelected ? "checked" : ""}
                 onchange="window.questionBankPage.toggleQuestionSelection('${escapedId}')">
        </td>
        <td class="question-title-cell">
          <div class="question-title-wrapper">
            <div class="question-title-text ${question.flagged ? "flagged" : ""}">${escapedTitle}</div>
            <div class="question-action-buttons">
              <button class="question-view-btn" 
                      onclick="window.questionBankPage.openQuestionModal('${escapedId}')"
                      title="View/Edit Question">
                <i class="fas fa-eye"></i> View/Edit
              </button>
              ${question.status && question.status.toLowerCase() === 'approved' 
                ? `<button class="question-approve-btn question-approve-btn--unapprove" 
                           onclick="window.questionBankPage.toggleQuestionApproval('${escapedId}', false)"
                           title="Unapprove Question">
                    <i class="fas fa-times-circle"></i> Unapprove
                  </button>`
                : `<button class="question-approve-btn question-approve-btn--approve" 
                           onclick="window.questionBankPage.toggleQuestionApproval('${escapedId}', true)"
                           title="Approve Question">
                    <i class="fas fa-check-circle"></i> Approve
                  </button>`
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

  renderObjectives() {
    const tableBody = document.getElementById("objectives-table-body");
    if (!tableBody) return;

    const selectedQuestions = this.getSelectedQuestions();
    let objectivesData = [];

    if (selectedQuestions.length === 0) {
      objectivesData = this.getGlobalObjectivesSummary();
    } else if (selectedQuestions.length === 1) {
      const question = selectedQuestions[0];
      objectivesData = [
        {
          objective: question.objective,
          bloomLevel: question.bloomLevel,
        },
      ];
    } else {
      objectivesData = this.getMergedObjectivesView(selectedQuestions);
    }

    tableBody.innerHTML = objectivesData
      .map(
        (item) => `
      <div class="table-row">
        <div class="cell">${item.objective}</div>
        <div class="cell ${item.bloomLevel === "Mixed" ? "mixed" : ""}">${
          item.bloomLevel
        }</div>
      </div>
    `
      )
      .join("");
  }

  renderHistory() {
    const historyList = document.getElementById("history-list");
    if (!historyList) return;

    historyList.innerHTML = this.history
      .map(
        (item) => `
      <div class="history-item ${
        this.state.selectedHistoryId === item.id ? "selected" : ""
      }" 
           data-history-id="${item.id}">
        <input type="radio" name="radio" id="h${item.id}" 
               ${this.state.selectedHistoryId === item.id ? "checked" : ""}
               onchange="window.questionBankPage.selectHistoryItem(${item.id})">
        <label for="h${item.id}">
          <span class="history-text">${item.count} questions approved</span>
          <span class="radio-time">${item.label}</span>
        </label>
      </div>
    `
      )
      .join("");
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

  getGlobalObjectivesSummary() {
    const summary = {};
    this.questions.forEach((q) => {
      if (!summary[q.objective]) {
        summary[q.objective] = new Set();
      }
      summary[q.objective].add(q.bloomLevel);
    });

    return Object.entries(summary).map(([objective, bloomLevels]) => ({
      objective,
      bloomLevel: bloomLevels.size > 1 ? "Mixed" : Array.from(bloomLevels)[0],
    }));
  }

  getMergedObjectivesView(questions) {
    const summary = {};
    questions.forEach((q) => {
      if (!summary[q.objective]) {
        summary[q.objective] = new Set();
      }
      summary[q.objective].add(q.bloomLevel);
    });

    return Object.entries(summary).map(([objective, bloomLevels]) => ({
      objective,
      bloomLevel: bloomLevels.size > 1 ? "Mixed" : Array.from(bloomLevels)[0],
    }));
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

  selectHistoryItem(historyId) {
    if (this.state.selectedHistoryId === historyId) {
      this.state.selectedHistoryId = null;
    } else {
      this.state.selectedHistoryId = historyId;
    }

    this.renderHistory();
    this.renderQuestions();
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
    const actionButtons = ["flag-btn", "delete-btn"];

    actionButtons.forEach((btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = !hasSelection;
      }
    });

    // Update selection count
    const selectionCount = document.getElementById("selection-count");
    if (selectionCount) {
      const count = this.state.selectedQuestionIds.size;
      selectionCount.textContent = `${count} question${
        count !== 1 ? "s" : ""
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
    this.state.selectedHistoryId = null;

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

  attachQuestionEventListeners() {
    // Event listeners are already attached via inline onchange in the HTML
  }

  attachQuizEventListeners() {
    // Event listeners are already attached via inline onclick in the HTML
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

  // Navigation to Question Review
  navigateToQuestionReview(quizId) {
    const quiz = this.quizzes.find((q) => q.id === quizId);
    if (quiz && quiz.questions.length > 0) {
      const firstQuestionId = quiz.questions[0].id;
      window.location.href = `question-review.html?quizId=${quizId}&questionId=${firstQuestionId}`;
    }
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

    // Set filters
    this.state.filters.quiz = quizIdForFilter;
    this.state.filters.status = "Draft";

    // Update filter UI
    const quizFilter = document.getElementById("quiz-filter");
    const statusFilter = document.getElementById("status-filter");
    
    if (quizFilter) {
      quizFilter.value = quizIdForFilter;
    }
    if (statusFilter) {
      statusFilter.value = "Draft";
    }

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
  showNotification(message, type = "info") {
    console.log(`${type.toUpperCase()}: ${message}`);

    // Create a simple notification
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 1000;
      background-color: ${
        type === "success"
          ? "#27ae60"
          : type === "warning"
          ? "#f39c12"
          : "#3498db"
      };
      animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
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
      const response = await fetch(`/api/question/${questionId}`);
      if (!response.ok) {
        throw new Error("Failed to load question");
      }

      const data = await response.json();
      if (!data.success || !data.question) {
        throw new Error("Question not found");
      }

      const question = data.question;
      
      // Normalize options for storage
      let normalizedOptions = [];
      if (Array.isArray(question.options)) {
        normalizedOptions = question.options.map((opt, idx) => {
          if (typeof opt === 'string') {
            return { id: String.fromCharCode(65 + idx), text: opt };
          } else if (opt && typeof opt === 'object') {
            return { id: opt.id || String.fromCharCode(65 + idx), text: opt.text || opt };
          } else {
            return { id: String.fromCharCode(65 + idx), text: String(opt || '') };
          }
        });
      } else if (question.options && typeof question.options === 'object') {
        const keys = Object.keys(question.options).sort();
        normalizedOptions = keys.map((key, idx) => {
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
      this.currentEditingQuestion = {
        id: questionId,
        title: question.title || question.stem || "",
        stem: question.stem || question.title || "",
        options: normalizedOptions,
        correctAnswer: question.correctAnswer || 0,
      };

      // Render question in modal
      this.renderQuestionInModal(question);
      
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

  renderQuestionInModal(question) {
    const modalBody = document.getElementById("question-modal-body");
    const saveBtn = document.getElementById("question-modal-save");
    
    if (!modalBody) return;

    // Get objective name if available
    const objectiveName = question.learningObjectiveId 
      ? (this.objectivesMap.get(question.learningObjectiveId.toString()) || "Unknown Objective")
      : (question.granularObjectiveId ? "Granular Objective" : "No Objective");

    // Normalize options to array format
    let optionsArray = [];
    if (Array.isArray(question.options)) {
      // Already an array - could be array of strings or array of objects
      optionsArray = question.options.map((opt, idx) => {
        if (typeof opt === 'string') {
          return { id: String.fromCharCode(65 + idx), text: opt };
        } else if (opt && typeof opt === 'object') {
          return { id: opt.id || String.fromCharCode(65 + idx), text: opt.text || opt };
        } else {
          return { id: String.fromCharCode(65 + idx), text: String(opt || '') };
        }
      });
    } else if (question.options && typeof question.options === 'object') {
      // Object format with keys like A, B, C, D
      const keys = Object.keys(question.options).sort();
      optionsArray = keys.map((key, idx) => {
        const opt = question.options[key];
        if (typeof opt === 'string') {
          return { id: key, text: opt };
        } else if (opt && typeof opt === 'object') {
          return { id: opt.id || key, text: opt.text || opt };
        } else {
          return { id: key, text: String(opt || '') };
        }
      });
    } else {
      // No options or invalid format - create empty options
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
    const optionsHtml = optionsArray.map((option, index) => {
      const optionId = option.id || String.fromCharCode(65 + index); // A, B, C, D
      const optionText = option.text || '';
      const isCorrect = index === (question.correctAnswer || 0);
      
      return `
        <div class="question-modal-option">
          <div class="question-modal-option-header">
            <input type="radio" 
                   name="question-correct-answer" 
                   value="${index}" 
                   ${isCorrect ? "checked" : ""}
                   id="option-${index}"
                   onchange="window.questionBankPage.updateCorrectAnswer(${index})">
            <label for="option-${index}" class="question-modal-option-label">
              <span class="option-letter">${optionId}</span>
            </label>
          </div>
          <input type="text" 
                 class="question-modal-option-input" 
                 value="${(optionText || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;')}"
                 data-option-index="${index}"
                 placeholder="Enter option text...">
        </div>
      `;
    }).join("");

    modalBody.innerHTML = `
      <div class="question-modal-content">
        <div class="question-modal-header-info">
          <div class="question-modal-chips">
            <span class="question-modal-chip">${objectiveName}</span>
            <span class="question-modal-chip">${question.bloom || "N/A"}</span>
            <span class="question-modal-chip status-${(question.status || "Draft").toLowerCase()}">${question.status || "Draft"}</span>
            ${question.flagStatus ? '<span class="question-modal-chip flagged">Flagged</span>' : ''}
          </div>
        </div>
        
        <div class="question-modal-field">
          <label for="question-modal-title-input">Question Title</label>
          <input type="text" 
                 id="question-modal-title-input" 
                 class="question-modal-input" 
                 value="${(question.title || question.stem || "").replace(/"/g, '&quot;').replace(/'/g, '&#39;')}"
                 placeholder="Enter question title...">
        </div>

        <div class="question-modal-field">
          <label for="question-modal-stem-input">Question Stem</label>
          <textarea id="question-modal-stem-input" 
                    class="question-modal-textarea" 
                    rows="4"
                    placeholder="Enter question stem...">${(question.stem || question.title || "").replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        </div>

        <div class="question-modal-field">
          <label>Options</label>
          <div class="question-modal-options">
            ${optionsHtml}
          </div>
        </div>
      </div>
    `;

    // Show save button
    if (saveBtn) saveBtn.style.display = "inline-block";
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

  updateCorrectAnswer(optionIndex) {
    if (this.currentEditingQuestion) {
      this.currentEditingQuestion.correctAnswer = optionIndex;
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

      // Prepare update data
      const updateData = {
        title: title || stem,
        stem: stem || title,
        options: options,
        correctAnswer: this.currentEditingQuestion.correctAnswer || 0,
      };

      // Update question in database
      const response = await fetch(`/api/question/${this.currentEditingQuestion.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update question");
      }

      // Update local state
      const question = this.questions.find(q => String(q.id || "") === String(this.currentEditingQuestion.id));
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

  async toggleQuestionApproval(questionId, approve) {
    try {
      const newStatus = approve ? "Approved" : "Draft";
      
      const response = await fetch(`/api/question/${questionId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update question status");
      }

      // Update local state
      const question = this.questions.find(q => String(q.id || "") === String(questionId));
      if (question) {
        question.status = newStatus;
      }

      // Refresh table to show updated button
      this.renderQuestionsTable();
      this.showNotification(
        `Question ${approve ? "approved" : "unapproved"} successfully`,
        "success"
      );

    } catch (error) {
      console.error("Error toggling question approval:", error);
      this.showNotification(error.message || "Failed to update question status", "error");
    }
  }
}

// Initialize the page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.questionBankPage = new QuestionBankPage();
});

// Export for use in other files
window.QuestionBankPage = QuestionBankPage;
