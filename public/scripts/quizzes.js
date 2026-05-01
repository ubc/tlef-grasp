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

  showNotification(message, type = 'success') {
    if (window.showToast) {
      window.showToast(message, type);
    } else {
      alert(message);
    }
  }
}

// Initialize page
let quizzesPage;
document.addEventListener('DOMContentLoaded', () => {
  quizzesPage = new QuizzesPage();
  window.quizzesPage = quizzesPage; // For onclick handlers
});
