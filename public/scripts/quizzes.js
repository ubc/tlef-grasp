// Quizzes Page JavaScript
// Handles management and creation of quizzes

// Constants
const SELECTORS = {
  tabButton: '.tab-button',
  tabPanel: '.tab-panel',
  quizzesContainer: 'quizzes-container',
  confirmModal: 'confirm-modal',
  questionDetailModal: 'question-detail-modal',
  exportSelectionModal: 'export-selection-modal',
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
  manageQuizzes: 'manage-quizzes',
  createQuiz: 'create-quiz',
};

const NOTIFICATION_TIMEOUT = 3000;

function renderKatex() {
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
    });
  }
}

/**
 * Convert MongoDB ID to string format consistently
 */
function toStringId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (id.toString) return id.toString();
  return String(id);
}

/**
 * Get ID from an object that may have _id or id property
 */
function getObjectId(obj) {
  if (!obj) return '';
  return toStringId(obj._id || obj.id);
}

class QuizzesPage {
  constructor() {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.selectedCourse) || '{}');
    this.courseId = selectedCourse.id || null;
    this.courseName = selectedCourse.courseName || '';

    this.state = {
      currentTab: TAB_NAMES.manageQuizzes,
    };

    this.quizzes = [];
    this.isFaculty = false;
    this.currentExportQuiz = null;

    // Wizard state
    this.wizardState = {
      step: 1,
      selectedMaterials: [],
      selectedObjectives: [],
      objectives: [],
      courseQuestions: [],
      matchedQuestionsCount: 0,
      deliveryFormat: 'all-approved'
    };

    this.init();
  }

  redirectToQuestionBank(quizId) {
    window.location.href = `/question-bank?quiz=${quizId}&status=Draft&tab=overview`;
  }

  async init() {
    await this.loadUserInfo();
    this.initializeNavigation();
    this.initializeEventListeners();
    await this.loadQuizzes();
    this.renderQuizzes();
    this.initCreateQuizWizard();
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

  initializeEventListeners() {
    // Export Modal Events
    const exportClose = document.getElementById('export-selection-close');
    const exportCancel = document.getElementById('export-selection-cancel');

    if (exportClose) exportClose.onclick = () => document.getElementById(SELECTORS.exportSelectionModal).style.display = 'none';
    if (exportCancel) exportCancel.onclick = () => document.getElementById(SELECTORS.exportSelectionModal).style.display = 'none';
    
    const formatBtns = document.querySelectorAll('.export-format-btn');
    formatBtns.forEach(btn => {
      btn.onclick = () => {
        const format = btn.getAttribute('data-format');
        this.performExport(format);
      };
    });

    // Tab switching
    const tabButtons = document.querySelectorAll(SELECTORS.tabButton);
    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tabName = button.getAttribute("data-tab");
        this.switchTab(tabName);
      });
    });

    // Modal events
    this.initializeModalEvents();
  }

  initializeModalEvents() {
    const modalClose = document.getElementById("modal-close");
    const modalCancel = document.getElementById("modal-cancel");
    const modalConfirm = document.getElementById("modal-confirm");
    const questionModalClose = document.getElementById("question-detail-close");

    if (modalClose) modalClose.addEventListener("click", () => this.hideModal());
    if (modalCancel) modalCancel.addEventListener("click", () => this.hideModal());
    if (modalConfirm) modalConfirm.addEventListener("click", () => this.confirmModalAction());
    
    if (questionModalClose) questionModalClose.addEventListener("click", () => this.hideQuestionModal());
  }

  // --- Create Quiz Wizard Logic ---
  
  initCreateQuizWizard() {
    // Delivery format buttons
    const formatBtns = document.querySelectorAll('#create-quiz-panel .delivery-format-btn');
    formatBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        formatBtns.forEach(b => b.classList.remove('delivery-format-btn--active'));
        btn.classList.add('delivery-format-btn--active');
        this.wizardState.deliveryFormat = btn.getAttribute('data-value');
        const hiddenInput = document.getElementById('quiz-delivery-format');
        if(hiddenInput) hiddenInput.value = this.wizardState.deliveryFormat;
      });
    });

    // Navigation buttons
    document.getElementById('btn-next-step-1')?.addEventListener('click', () => this.handleNextStep1());
    document.getElementById('btn-prev-step-2')?.addEventListener('click', () => this.switchWizardStep(1));
    document.getElementById('btn-next-step-2')?.addEventListener('click', () => this.handleNextStep2());
    document.getElementById('btn-prev-step-3')?.addEventListener('click', () => this.switchWizardStep(2));
    document.getElementById('btn-create-quiz')?.addEventListener('click', () => this.handleCreateQuiz());

    // Initially load step 1
    if (this.courseId) {
      this.loadMaterialsStep();
    }
  }

  async loadMaterialsStep() {
    const container = document.getElementById('material-selection-list');
    if (!container) return;

    container.innerHTML = '<div class="empty-state-mini"><i class="fas fa-spinner fa-spin"></i> Loading materials...</div>';

    try {
      const response = await fetch(`/api/material/course/${this.courseId}`);
      if (!response.ok) throw new Error('Failed to fetch materials');
      const data = await response.json();
      
      if (!data.success || !data.materials || data.materials.length === 0) {
        container.innerHTML = '<div class="empty-state-mini">No course materials found. Upload materials first.</div>';
        return;
      }

      container.innerHTML = data.materials.map(mat => {
        const fileType = mat.fileType || '';
        let typeIcon = "fas fa-file";
        let typeLabel = "File";
        let iconClass = "file";
        
        if (fileType.includes("pdf")) { typeIcon = "fas fa-file-pdf"; typeLabel = "PDF"; iconClass = "pdf"; }
        else if (fileType.includes("text")) { typeIcon = "fas fa-file-alt"; typeLabel = "TextBook"; iconClass = "textbook"; }
        else if (fileType.includes("word")) { typeIcon = "fas fa-file-word"; typeLabel = "WordDocument"; iconClass = "file"; }
        else if (fileType.includes("link")) { typeIcon = "fas fa-link"; typeLabel = "Link"; iconClass = "link"; }
        
        return `
        <label class="selection-item">
          <input type="checkbox" value="${mat.sourceId || mat._id}" class="material-checkbox">
          <div class="material-icon ${iconClass}" style="margin-right: 15px; width: 36px; height: 36px; font-size: 16px;">
            <i class="${typeIcon}"></i>
          </div>
          <div class="selection-details">
            <span class="selection-title">${mat.documentTitle || 'Untitled Material'}</span>
            <span class="selection-meta">${typeLabel}</span>
          </div>
        </label>
      `}).join('');
    } catch (error) {
      console.error(error);
      container.innerHTML = '<div class="empty-state-mini" style="color: red;">Error loading materials</div>';
    }
  }

  handleNextStep1() {
    const checkboxes = document.querySelectorAll('.material-checkbox:checked');
    if (checkboxes.length === 0) {
      this.showNotification('Please select at least one material', 'error');
      return;
    }
    
    this.wizardState.selectedMaterials = Array.from(checkboxes).map(cb => cb.value);
    this.loadObjectivesStep();
    this.switchWizardStep(2);
  }

  async loadObjectivesStep() {
    const container = document.getElementById('objective-selection-list');
    if (!container) return;
    
    container.innerHTML = '<div class="empty-state-mini"><i class="fas fa-spinner fa-spin"></i> Loading objectives...</div>';

    try {
      const response = await fetch(`${API_ENDPOINTS.objective}?courseId=${this.courseId}`);
      if (!response.ok) throw new Error('Failed to fetch objectives');
      const data = await response.json();
      
      if (!data.success || !data.objectives) {
        container.innerHTML = '<div class="empty-state-mini">No learning objectives found.</div>';
        return;
      }

      // Filter objectives that match the selected materials
      const relevantObjectives = data.objectives.filter(obj => {
        if (!obj.materialIds || !Array.isArray(obj.materialIds)) return false;
        return obj.materialIds.some(id => this.wizardState.selectedMaterials.includes(id));
      });

      this.wizardState.objectives = relevantObjectives;

      if (relevantObjectives.length === 0) {
        container.innerHTML = '<div class="empty-state-mini">No meta learning objectives found for selected materials.</div>';
        return;
      }

      container.innerHTML = relevantObjectives.map(obj => `
        <label class="selection-item">
          <input type="checkbox" value="${obj._id}" class="objective-checkbox">
          <div class="selection-details">
            <span class="selection-title">${obj.name}</span>
          </div>
        </label>
      `).join('');
    } catch (error) {
      console.error(error);
      container.innerHTML = '<div class="empty-state-mini" style="color: red;">Error loading objectives</div>';
    }
  }

  handleNextStep2() {
    const checkboxes = document.querySelectorAll('.objective-checkbox:checked');
    if (checkboxes.length === 0) {
      this.showNotification('Please select at least one learning objective', 'error');
      return;
    }
    
    this.wizardState.selectedObjectives = Array.from(checkboxes).map(cb => cb.value);
    this.loadSettingsStep();
    this.switchWizardStep(3);
  }

  async loadSettingsStep() {
    const countEl = document.getElementById('matched-questions-count');
    if (!countEl) return;
    countEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 16px;"></i>';

    try {
      if (this.wizardState.courseQuestions.length === 0) {
        const response = await fetch(`${API_ENDPOINTS.question}?courseId=${this.courseId}`);
        if (!response.ok) throw new Error('Failed to fetch questions');
        const data = await response.json();
        if (data.success && data.questions) {
          this.wizardState.courseQuestions = data.questions;
        }
      }

      const selectedObjStrs = this.wizardState.selectedObjectives.map(id => toStringId(id));
      
      const matchedQuestions = this.wizardState.courseQuestions.filter(q => {
        const parentId = toStringId(q.learningObjectiveId);
        return selectedObjStrs.includes(parentId);
      });

      // Calculate breakdown by learning objective
      const objectiveCounts = {};
      selectedObjStrs.forEach(id => objectiveCounts[id] = 0);
      
      matchedQuestions.forEach(q => {
        const parentId = toStringId(q.learningObjectiveId);
        if (objectiveCounts[parentId] !== undefined) {
          objectiveCounts[parentId]++;
        }
      });
      
      // Render breakdown
      const breakdownEl = document.getElementById('matched-questions-breakdown');
      if (breakdownEl) {
        breakdownEl.innerHTML = this.wizardState.objectives
          .filter(obj => selectedObjStrs.includes(toStringId(obj._id)))
          .map(obj => {
            const count = objectiveCounts[toStringId(obj._id)] || 0;
            return `
              <div class="objective-count-item" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e5e7eb; font-size: 13px; color: #4b5563;">
                <span class="objective-name" style="flex: 1; margin-right: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${obj.name}</span>
                <span class="objective-count" style="font-weight: 600; color: #111827; white-space: nowrap;">${count} Qs</span>
              </div>
            `;
          }).join('');
      }

      this.wizardState.matchedQuestionsCount = matchedQuestions.length;
      countEl.textContent = matchedQuestions.length;
      
    } catch (error) {
      console.error(error);
      countEl.textContent = 'Error';
    }
  }

  async handleCreateQuiz() {
    const nameInput = document.getElementById('new-quiz-name');
    const name = nameInput.value.trim();
    
    const releaseDateInput = document.getElementById('quiz-release-date');
    const expireDateInput = document.getElementById('quiz-expire-date');
    const releaseDate = releaseDateInput && releaseDateInput.value ? new Date(releaseDateInput.value).toISOString() : null;
    const expireDate = expireDateInput && expireDateInput.value ? new Date(expireDateInput.value).toISOString() : null;

    if (!name) {
      this.showNotification('Please provide a quiz name', 'error');
      return;
    }
    
    if (!releaseDate) {
      this.showNotification('Please select a release date', 'error');
      return;
    }

    if (!expireDate) {
      this.showNotification('Please select an expire date', 'error');
      return;
    }

    if (this.wizardState.matchedQuestionsCount === 0) {
      this.showNotification('No questions matched the selected objectives', 'error');
      return;
    }

    const btn = document.getElementById('btn-create-quiz');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    try {
      const selectedObjStrs = this.wizardState.selectedObjectives.map(id => toStringId(id));
      const matchedQuestions = this.wizardState.courseQuestions.filter(q => {
        const parentId = toStringId(q.learningObjectiveId);
        return selectedObjStrs.includes(parentId);
      });
      
      const questionIds = matchedQuestions.map(q => getObjectId(q));

      const quizResp = await fetch(API_ENDPOINTS.quiz, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          courseId: this.courseId,
          deliveryFormat: this.wizardState.deliveryFormat,
          releaseDate: releaseDate,
          expireDate: expireDate,
          questionIds: questionIds
        })
      });
      
      const quizData = await quizResp.json();
      if (!quizResp.ok || !quizData.success) throw new Error(quizData.error || 'Failed to create quiz');

      this.showNotification('Quiz created successfully', 'success');
      
      await this.loadQuizzes();
      this.renderQuizzes();
      this.switchTab(TAB_NAMES.manageQuizzes);
      
      nameInput.value = '';
      if(releaseDateInput) releaseDateInput.value = '';
      if(expireDateInput) expireDateInput.value = '';
      this.switchWizardStep(1);
      
    } catch (error) {
      console.error(error);
      this.showNotification(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  switchWizardStep(step) {
    this.wizardState.step = step;
    
    document.querySelectorAll('.wizard-step').forEach(el => {
      const s = parseInt(el.getAttribute('data-step'), 10);
      el.classList.toggle('active', s === step);
      el.classList.toggle('completed', s < step);
    });

    document.querySelectorAll('.wizard-step-content').forEach(el => {
      const contentStep = parseInt(el.id.replace('wizard-step-', ''), 10);
      if (contentStep === step) {
        el.style.display = 'block';
        setTimeout(() => el.classList.add('active'), 10);
      } else {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    });
  }

  switchTab(tabName) {
    this.state.currentTab = tabName;
    
    // Update buttons
    document.querySelectorAll(SELECTORS.tabButton).forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.style.display = panel.id === `${tabName}-panel` ? 'block' : 'none';
      panel.classList.toggle('active', panel.id === `${tabName}-panel`);
    });
  }

  async loadQuizzes() {
    if (!this.courseId) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.quizCourse}/${this.courseId}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      if (data.success && data.quizzes) {
        // For each quiz, fetch its questions
        this.quizzes = await Promise.all(
          data.quizzes.map(async (quiz) => {
            const qResp = await fetch(`${API_ENDPOINTS.quiz}/${quiz._id}/questions`);
            const qData = qResp.ok ? await qResp.json() : { success: false };
            const questions = qData.success ? qData.questions : [];
            
            return {
              ...quiz,
              id: getObjectId(quiz),
              questions: questions.map(q => ({
                ...q,
                id: getObjectId(q)
              }))
            };
          })
        );
      }
    } catch (error) {
      console.error('Error loading quizzes:', error);
      this.showNotification('Failed to load quizzes', 'error');
    }
  }

  renderQuizzes() {
    const container = document.getElementById(SELECTORS.quizzesContainer);
    if (!container) return;

    if (this.quizzes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-clipboard-list"></i>
          <h3>No Quizzes Found</h3>
          <p>There are no quizzes created for this course yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.quizzes.map(quiz => this.createQuizCard(quiz)).join('');
    
    renderKatex();
    if (typeof renderSmiles === 'function') renderSmiles();
  }

  createQuizCard(quiz) {
    const totalQuestions = quiz.questions.length;
    const approvedQuestions = quiz.questions.filter(q => q.status === 'Approved').length;
    const progress = totalQuestions > 0 ? (approvedQuestions / totalQuestions) * 100 : 0;
    const isPublished = quiz.published;

    // Format dates for datetime-local input (YYYY-MM-DDThh:mm)
    const formatDate = (dateString) => {
      if (!dateString) return '';
      const date = new Date(dateString);
      return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    };

    const releaseValue = formatDate(quiz.releaseDate);
    const expireValue = formatDate(quiz.expireDate);
    const deliveryFormat = quiz.deliveryFormat === "spaced-3phase" ? "spaced-3phase" : "all-approved";

    return `
      <div class="quiz-card" id="quiz-card-${quiz.id}">
        <div class="quiz-card-header">
          <h3 class="quiz-title">${quiz.name}</h3>
          <div class="quiz-created-date">Created: ${new Date(quiz.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <div class="quiz-progress-section">
          <div class="quiz-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-text">${Math.round(progress)}% Approved</div>
          </div>
        </div>
        <div class="quiz-dates-section">
          <div class="date-group">
            <label>Release Date</label>
            <input type="datetime-local" class="date-input" value="${releaseValue}" onchange="quizzesPage.updateQuizDate('${quiz.id}', 'releaseDate', this.value)">
          </div>
          <div class="date-group">
            <label>Expire Date</label>
            <input type="datetime-local" class="date-input" value="${expireValue}" onchange="quizzesPage.updateQuizDate('${quiz.id}', 'expireDate', this.value)">
          </div>
        </div>
        <div class="quiz-delivery-format-section">
          <label>Delivery Format</label>
          <div class="delivery-format-popup" aria-live="polite"></div>
          <div class="delivery-format-group" onmouseleave="hideDeliveryFormatPopup(this, event)">
            <button type="button" class="delivery-format-btn ${deliveryFormat === "all-approved" ? "delivery-format-btn--active" : ""}" data-value="all-approved" onmouseenter="showDeliveryFormatPopup(this)" onmouseleave="hideDeliveryFormatPopup(this, event)" onfocus="showDeliveryFormatPopup(this)" onblur="hideDeliveryFormatPopup(this, event)" onclick="quizzesPage.updateQuizDeliveryFormat('${quiz.id}', 'all-approved')">
              <span>Standard</span>
              <i class="fas fa-info-circle delivery-format-info-icon" aria-hidden="true"></i>
            </button>
            <button type="button" class="delivery-format-btn ${deliveryFormat === "spaced-3phase" ? "delivery-format-btn--active" : ""}" data-value="spaced-3phase" onmouseenter="showDeliveryFormatPopup(this)" onmouseleave="hideDeliveryFormatPopup(this, event)" onfocus="showDeliveryFormatPopup(this)" onblur="hideDeliveryFormatPopup(this, event)" onclick="quizzesPage.updateQuizDeliveryFormat('${quiz.id}', 'spaced-3phase')">
              <span>Adaptive</span>
              <i class="fas fa-info-circle delivery-format-info-icon" aria-hidden="true"></i>
            </button>
          </div>
          <template class="delivery-format-info-template" data-value="all-approved"><strong>Default.</strong> Delivers every approved question in the quiz, in the order they were added. Students see the same set every time — no personalization, no spaced repetition.</template>
          <template class="delivery-format-info-template" data-value="spaced-3phase">Three-phase spaced repetition tailored to each student: (1) one new question per granular learning objective, (2) remediation items the student failed in their previous quiz, (3) spaced review of previously-mastered objectives.</template>
        </div>
        <div class="quiz-card-actions">
          <div class="primary-actions">
            <button class="review-btn" onclick="quizzesPage.redirectToQuestionBank('${quiz.id}')">Review</button>
            <button class="export-btn" onclick="quizzesPage.exportQuiz('${quiz.id}')">Export</button>
            <button class="publish-btn ${isPublished ? 'published' : ''}" onclick="quizzesPage.togglePublish('${quiz.id}')">${isPublished ? 'Unpublish' : 'Publish'}</button>
          </div>
          <button class="delete-btn full-width" onclick="quizzesPage.deleteQuiz('${quiz.id}')">Delete</button>
        </div>
        <div class="quiz-details" id="quiz-details-${quiz.id}"></div>
      </div>
    `;
  }

  async viewQuestion(questionId) {
    try {
      const response = await fetch(`${API_ENDPOINTS.question}/${questionId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.question) {
          this.showQuestionModal(data.question);
        }
      }
    } catch (error) {
      console.error('Error loading question:', error);
    }
  }

  showQuestionModal(question) {
    const modal = document.getElementById(SELECTORS.questionDetailModal);
    const body = document.getElementById("question-modal-body");
    
    let optionsHtml = '';
    if (question.options) {
      optionsHtml = Object.entries(question.options).map(([key, opt]) => `
        <div class="option-preview ${key === question.correctAnswer ? 'correct' : ''}">
          <strong>${key}:</strong> ${typeof parseSmilesTags === 'function' ? parseSmilesTags(opt.text) : opt.text}
          ${opt.feedback ? `<div class="feedback"><em>Feedback:</em> ${opt.feedback}</div>` : ''}
        </div>
      `).join('');
    }

    body.innerHTML = `
      <div class="question-preview">
        <div class="preview-stem">${typeof parseSmilesTags === 'function' ? parseSmilesTags(question.stem) : question.stem}</div>
        <div class="preview-options">${optionsHtml}</div>
        <div class="preview-meta">
          <div><strong>Bloom Level:</strong> ${question.bloomLevel || question.bloom}</div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
    
    // Trigger rendering
    renderKatex();
    if (typeof renderSmiles === 'function') renderSmiles();
  }

  hideQuestionModal() {
    document.getElementById(SELECTORS.questionDetailModal).style.display = 'none';
  }

  async togglePublish(quizId) {
    const quiz = this.quizzes.find(q => q.id === quizId);
    if (!quiz) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.quiz}/${quizId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !quiz.published })
      });

      if (response.ok) {
        await this.loadQuizzes();
        this.renderQuizzes();
      }
    } catch (error) {
      console.error('Error toggling publish:', error);
    }
  }

  async deleteQuiz(quizId) {
    this.pendingAction = { type: 'deleteQuiz', id: quizId };
    this.showModal('Delete Quiz', 'Are you sure you want to delete this quiz? This action cannot be undone.');
  }

  async exportQuiz(quizId) {
    const quiz = this.quizzes.find(q => q.id === quizId);
    if (!quiz) return;

    this.currentExportQuiz = quiz;
    
    const modal = document.getElementById(SELECTORS.exportSelectionModal);
    const nameDisplay = document.getElementById('export-quiz-name-display');
    
    if (nameDisplay) nameDisplay.textContent = quiz.name;
    if (modal) modal.style.display = 'flex';
  }

  async performExport(format) {
    if (!this.currentExportQuiz) return;
    
    const quiz = this.currentExportQuiz;

    try {
      const response = await fetch(`${API_ENDPOINTS.questionExport}?format=${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: this.courseId,
          quizName: quiz.name,
          questions: quiz.questions
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        let extension = 'zip';
        if (format === 'csv') extension = 'csv';
        if (format === 'json') extension = 'json';
        
        a.download = `quiz-${quiz.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        
        document.getElementById(SELECTORS.exportSelectionModal).style.display = 'none';
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      console.error('Error exporting quiz:', error);
      this.showNotification('Failed to export quiz', 'error');
    }
  }

  showModal(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById(SELECTORS.confirmModal).style.display = 'flex';
  }

  hideModal() {
    document.getElementById(SELECTORS.confirmModal).style.display = 'none';
  }

  async confirmModalAction() {
    if (!this.pendingAction) return;

    if (this.pendingAction.type === 'deleteQuiz') {
      try {
        const response = await fetch(`${API_ENDPOINTS.quiz}/${this.pendingAction.id}`, {
          method: 'DELETE'
        });
        if (response.ok) {
          this.showNotification('Quiz deleted successfully', 'success');
          await this.loadQuizzes();
          this.renderQuizzes();
        }
      } catch (error) {
        console.error('Error deleting quiz:', error);
      }
    }

    this.hideModal();
    this.pendingAction = null;
  }

  async updateQuizDate(quizId, field, value) {
    try {
      const response = await fetch(`${API_ENDPOINTS.quiz}/${quizId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null })
      });

      if (!response.ok) {
        throw new Error('Failed to update quiz date');
      }

      // Update local state
      const quiz = this.quizzes.find(q => q.id === quizId);
      if (quiz) {
        quiz[field] = value;
      }
    } catch (error) {
      console.error('Error updating quiz date:', error);
    }
  }

  async updateQuizDeliveryFormat(quizId, value) {
    const quiz = this.quizzes.find(q => q.id === quizId);
    if (quiz && quiz.deliveryFormat === value) return;

    try {
      const response = await fetch(`${API_ENDPOINTS.quiz}/${quizId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryFormat: value })
      });

      if (!response.ok) {
        throw new Error('Failed to update delivery format');
      }

      if (quiz) {
        quiz.deliveryFormat = value;
      }
      this.renderQuizzes();
      this.showNotification('Delivery format updated');
    } catch (error) {
      console.error('Error updating delivery format:', error);
      this.showNotification('Failed to update delivery format', 'error');
    }
  }

  showNotification(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.warn('toast-container missing:', message);
      return;
    }

    const iconMap = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <i class="fas fa-${iconMap[type] || 'info-circle'} toast__icon"></i>
      <span class="toast__message"></span>
      <button type="button" class="toast__close" aria-label="Dismiss"><i class="fas fa-times"></i></button>
    `;
    toast.querySelector('.toast__message').textContent = message;
    toast.querySelector('.toast__close').addEventListener('click', () => toast.remove());

    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
  }
}

function showDeliveryFormatPopup(btn) {
  const container = btn.closest('.delivery-format-control, .quiz-delivery-format-section');
  if (!container) return;
  const popup = container.querySelector('.delivery-format-popup');
  const template = container.querySelector(`.delivery-format-info-template[data-value="${btn.dataset.value}"]`);
  if (popup && template) {
    popup.innerHTML = template.innerHTML;
    popup.classList.add('delivery-format-popup--visible');
  }
}

function hideDeliveryFormatPopup(el, event) {
  const group = el.closest('.delivery-format-group');
  if (event && event.relatedTarget && group) {
    const nextBtn = event.relatedTarget.closest && event.relatedTarget.closest('.delivery-format-btn');
    if (nextBtn && group.contains(nextBtn)) return;
  }
  const container = el.closest('.delivery-format-control, .quiz-delivery-format-section');
  if (!container) return;
  const popup = container.querySelector('.delivery-format-popup');
  if (popup) popup.classList.remove('delivery-format-popup--visible');
}

window.showDeliveryFormatPopup = showDeliveryFormatPopup;
window.hideDeliveryFormatPopup = hideDeliveryFormatPopup;

// Initialize page
let quizzesPage;
document.addEventListener('DOMContentLoaded', () => {
  quizzesPage = new QuizzesPage();
  window.quizzesPage = quizzesPage; // For onclick handlers
});
