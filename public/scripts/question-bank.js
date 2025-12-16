// Question Bank Page JavaScript
// Handles interactions and functionality for the new 3-panel layout and Review tab

class QuestionBankPage {
  constructor() {
    this.state = {
      course: "all",
      filters: { objective: "all", bloom: "all", status: "all", q: "" },
      sort: { key: "views", dir: "desc" },
      selectedQuestionIds: new Set(),
      selectedHistoryId: null,
      currentTab: "review",
    };

    this.questions = [];
    this.history = [];
    this.quizzes = [];
    this.init();
  }

  async init() {
    this.initializeNavigation();
    this.initializeData();
    this.initializeEventListeners();
    this.renderAll();
  }

  initializeNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }

  async loadSavedQuestionSets() {
    try {
      const response = await fetch("/api/quiz-questions/quizzes");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.quizzes && data.quizzes.length > 0) {
        // Convert file storage quiz data to quiz format
        this.quizzes = data.quizzes.map((quiz, index) => ({
          id: quiz._id || `quiz_${index}`,
          title: quiz.quizName,
          course: quiz.courseName,
          week: quiz.quizWeek,
          lecture: `Lecture ${index + 1}`,
          releases: [
            {
              label: quiz.quizName,
              date: new Date().toISOString().split("T")[0],
            },
          ],
          questions: quiz.questions.map((q, qIndex) => ({
            id: q.id || q._id || `q_${qIndex}`,
            title: q.questionText,
            course: q.courseName,
            loCode: q.learningObjective,
            bloom: q.bloomsLevel,
            status: q.status || "Draft",
            lastEdited: new Date(q.updatedAt || q.createdAt).toLocaleString(),
            approved: q.status === "Approved",
            flagged: q.flagged || false,
            views: q.views || 0,
            published: q.published || false,
          })),
          isOpen: false,
          selection: new Set(),
        }));
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
    this.updateLearningObjectivesFilter();
    this.updateBloomLevelsFilter();
    this.updateStatusFilter();
  }

  updateLearningObjectivesFilter() {
    const objectiveFilter = document.getElementById("objective-filter");
    if (!objectiveFilter) return;

    // Clear existing options except "All Objectives"
    objectiveFilter.innerHTML = '<option value="all">All Objectives</option>';

    // Collect unique learning objectives from all quizzes
    const objectives = new Set();
    this.quizzes.forEach((quiz) => {
      quiz.questions.forEach((question) => {
        if (question.loCode) {
          objectives.add(question.loCode);
        }
      });
    });

    // Add objectives to filter
    Array.from(objectives)
      .sort()
      .forEach((objective) => {
        const option = document.createElement("option");
        option.value = objective;
        option.textContent = objective;
        objectiveFilter.appendChild(option);
      });
  }

  updateBloomLevelsFilter() {
    const bloomFilter = document.getElementById("bloom-filter");
    if (!bloomFilter) return;

    // Clear existing options except "All Bloom Levels"
    bloomFilter.innerHTML = '<option value="all">All Bloom Levels</option>';

    // Collect unique bloom levels from all quizzes
    const bloomLevels = new Set();
    this.quizzes.forEach((quiz) => {
      quiz.questions.forEach((question) => {
        if (question.bloom) {
          bloomLevels.add(question.bloom);
        }
      });
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

    // Collect unique statuses from all quizzes
    const statuses = new Set();
    this.quizzes.forEach((quiz) => {
      quiz.questions.forEach((question) => {
        if (question.status) {
          statuses.add(question.status);
        }
      });
    });

    // Add statuses to filter
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
    try {
      const response = await fetch("/api/quiz-questions");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.questions) {
        // Convert file storage questions to Overview format
        this.questions = data.questions.map((question) => ({
          id: question.id || question._id,
          title: question.questionText,
          glo: question.learningObjective,
          bloom: question.bloomsLevel,
          views: question.views || Math.floor(Math.random() * 200) + 50,
          flagged: question.flagged || false,
          published: question.published || false,
          status: question.status || "Draft",
          course: question.courseName,
          week: parseInt(question.quizWeek?.replace("Week ", "")) || 1,
        }));
      } else {
        this.questions = [];
      }
    } catch (error) {
      console.error("Error loading questions for overview:", error);
      this.questions = [];
    }
  }

  async initializeData() {
    // Load saved question sets from backend
    await this.loadSavedQuestionSets();

    // Update filter options based on loaded data
    this.updateFilterOptions();

    // Load questions for Overview tab from saved quiz data
    await this.loadQuestionsForOverview();

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
    // Tab switching
    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        const tabName = button.getAttribute("data-tab");
        await this.switchTab(tabName);
      });
    });

    // Filters (using the main filters section)
    const objectiveFilter = document.getElementById("objective-filter");
    const bloomFilter = document.getElementById("bloom-filter");
    const statusFilter = document.getElementById("status-filter");
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
    const editBtn = document.getElementById("edit-btn");
    const flagBtn = document.getElementById("flag-btn");
    const deleteBtn = document.getElementById("delete-btn");
    const publishBtn = document.getElementById("publish-btn");

    if (editBtn) editBtn.addEventListener("click", () => this.handleEdit());
    if (flagBtn) flagBtn.addEventListener("click", () => this.handleFlag());
    if (deleteBtn)
      deleteBtn.addEventListener("click", () => this.handleDelete());
    if (publishBtn)
      publishBtn.addEventListener("click", () => this.handlePublish());

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
      this.renderReview();
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

  renderReview() {
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
            <button class="open-details-btn ${quiz.isOpen ? "expanded" : ""}" 
                    onclick="event.stopPropagation(); window.questionBankPage.toggleQuizDetails(${
                      quiz.id
                    })">
              Open details <i class="fas fa-chevron-down"></i>
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
    let filtered = [...this.quizzes];

    // Apply course filter
    if (this.state.course !== "all") {
      filtered = filtered.filter((quiz) => {
        // Check if any question in the quiz belongs to the selected course
        return quiz.questions.some(
          (question) =>
            question.course === this.state.course ||
            quiz.title.toLowerCase().includes(this.state.course.toLowerCase())
        );
      });
    }

    return filtered;
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
      visibleQuestions.forEach((q) => this.state.selectedQuestionIds.add(q.id));
    } else {
      visibleQuestions.forEach((q) =>
        this.state.selectedQuestionIds.delete(q.id)
      );
    }

    this.renderQuestionsTable();
    this.updateActionButtons();
  }

  clearOutOfViewSelections() {
    const visibleQuestions = this.getFilteredQuestions();
    const visibleIds = new Set(visibleQuestions.map((q) => q.id));

    // Remove selections for questions no longer visible
    for (const selectedId of this.state.selectedQuestionIds) {
      if (!visibleIds.has(selectedId)) {
        this.state.selectedQuestionIds.delete(selectedId);
      }
    }
  }

  // Action handlers for Overview tab
  handleEdit() {
    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    // For now, just show a toast
    this.showToast(
      `Edit mode enabled for ${selectedQuestions.length} question(s)`
    );
  }

  handleFlag() {
    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    selectedQuestions.forEach((id) => {
      const question = this.questions.find((q) => q.id === id);
      if (question) {
        question.flagged = !question.flagged;
      }
    });

    this.renderQuestionsTable();
    this.showToast(`Flagged ${selectedQuestions.length} question(s)`);
  }

  handleDelete() {
    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    if (
      confirm(
        `Are you sure you want to delete ${selectedQuestions.length} question(s)?`
      )
    ) {
      selectedQuestions.forEach((id) => {
        const index = this.questions.findIndex((q) => q.id === id);
        if (index > -1) {
          this.questions.splice(index, 1);
        }
      });

      this.state.selectedQuestionIds.clear();
      this.renderQuestionsTable();
      this.updateActionButtons();
      this.showToast(`Deleted ${selectedQuestions.length} question(s)`);
    }
  }

  handlePublish() {
    const selectedQuestions = Array.from(this.state.selectedQuestionIds);
    if (selectedQuestions.length === 0) return;

    if (
      confirm(
        `Are you sure you want to publish ${selectedQuestions.length} question(s)?`
      )
    ) {
      selectedQuestions.forEach((id) => {
        const question = this.questions.find((q) => q.id === id);
        if (question) {
          question.published = true;
        }
      });

      this.renderQuestionsTable();
      this.showToast(`Published ${selectedQuestions.length} question(s)`);
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
        (question) => `
      <tr data-question-id="${question.id}" class="${
          this.state.selectedQuestionIds.has(question.id) ? "selected" : ""
        }">
        <td class="select-cell">
          <input type="checkbox" 
                 ${
                   this.state.selectedQuestionIds.has(question.id)
                     ? "checked"
                     : ""
                 }
                 onchange="window.questionBankPage.toggleQuestionSelection(${
                   question.id
                 })">
        </td>
        <td class="question-title-cell">
          <div class="question-title-text ${
            question.flagged ? "flagged" : ""
          }">${question.title}</div>
        </td>
        <td class="glo-cell">
          <div class="glo-text">${question.glo}</div>
        </td>
        <td class="bloom-cell">
          <span class="bloom-chip">${question.bloom}</span>
        </td>
        <td class="views-cell">${question.views}</td>
      </tr>
    `
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

    if (this.state.filters.objective !== "all") {
      filtered = filtered.filter((q) =>
        q.glo.includes(this.state.filters.objective)
      );
    }

    if (this.state.filters.bloom !== "all") {
      filtered = filtered.filter((q) => q.bloom === this.state.filters.bloom);
    }

    if (this.state.filters.status !== "all") {
      filtered = filtered.filter((q) => q.status === this.state.filters.status);
    }

    if (this.state.filters.q) {
      const searchTerm = this.state.filters.q.toLowerCase();
      filtered = filtered.filter(
        (q) =>
          q.title.toLowerCase().includes(searchTerm) ||
          q.glo.toLowerCase().includes(searchTerm)
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
        case "views":
          aValue = a.views;
          bValue = b.views;
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
    if (this.state.selectedQuestionIds.has(questionId)) {
      this.state.selectedQuestionIds.delete(questionId);
    } else {
      this.state.selectedQuestionIds.add(questionId);
    }

    this.updateSelectAllCheckbox();
    this.updateActionButtons();
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
    const selectedCount = visibleQuestions.filter((q) =>
      this.state.selectedQuestionIds.has(q.id)
    ).length;

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
    const actionButtons = ["edit-btn", "flag-btn", "delete-btn", "publish-btn"];

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
      objective: "all",
      bloom: "all",
      status: "all",
      q: "",
    };
    this.state.selectedHistoryId = null;

    const objectiveFilter = document.getElementById("objective-filter");
    const bloomFilter = document.getElementById("bloom-filter");
    const statusFilter = document.getElementById("status-filter");
    const searchInput = document.getElementById("search-input");

    if (objectiveFilter) objectiveFilter.value = "all";
    if (bloomFilter) bloomFilter.value = "all";
    if (statusFilter) statusFilter.value = "all";
    if (searchInput) searchInput.value = "";

    this.renderAll();
  }

  getSelectedQuestions() {
    return this.questions.filter((q) =>
      this.state.selectedQuestionIds.has(q.id)
    );
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
}

// Initialize the page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.questionBankPage = new QuestionBankPage();
});

// Export for use in other files
window.QuestionBankPage = QuestionBankPage;
