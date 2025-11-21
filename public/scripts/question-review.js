// Question Review Page JavaScript
// Handles the detailed question review interface with editing, approval, and publishing

class QuestionReviewPage {
  constructor() {
    this.state = {
      review: {
        quizId: null,
        questionId: null,
        quizzes: [],
        currentQuiz: null,
        currentQuestion: null,
        editMode: false,
        unsavedChanges: false
      }
    };
    
    this.init();
  }

  init() {
    this.initializeNavigation();
    this.initializeData();
    this.parseURL();
    this.initializeEventListeners();
    this.renderAll();
  }

  initializeNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }

  async initializeData() {
    // Load actual generated questions from localStorage or API
    await this.loadGeneratedQuestions();
    
    // If no questions loaded, use sample data as fallback
    if (this.state.review.quizzes.length === 0) {
      this.loadSampleData();
    }
  }
  
  async loadGeneratedQuestions() {
    try {
      // First, try to load from localStorage (from question-generation page)
      const questionsForReview = localStorage.getItem('questionsForReview');
      if (questionsForReview) {
        const data = JSON.parse(questionsForReview);
        if (data.questionGroups && data.questionGroups.length > 0) {
          this.convertQuestionGroupsToQuizzes(data.questionGroups);
          console.log(`Loaded ${this.state.review.quizzes.length} quiz(es) from localStorage`);
          return;
        }
      }
      
      // Also check questionGenerationState
      const savedState = localStorage.getItem('questionGenerationState');
      if (savedState) {
        const state = JSON.parse(savedState);
        if (state.questionGroups && state.questionGroups.length > 0) {
          this.convertQuestionGroupsToQuizzes(state.questionGroups);
          console.log(`Loaded ${this.state.review.quizzes.length} quiz(es) from questionGenerationState`);
          return;
        }
      }
      
      // If not in localStorage, try API endpoint
      const response = await fetch('/api/questions/for-review');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.questions && data.questions.length > 0) {
          this.convertQuestionsToQuizzes(data.questions);
          console.log(`Loaded ${this.state.review.quizzes.length} quiz(es) from API`);
          return;
        }
      }
      
      console.log("No generated questions found, using sample data");
    } catch (error) {
      console.error("Error loading generated questions:", error);
      // Fall back to sample data on error
      this.loadSampleData();
    }
  }
  
  convertQuestionGroupsToQuizzes(questionGroups) {
    // Group questions by metaCode (objective group)
    const quizMap = new Map();
    
    questionGroups.forEach((group) => {
      const quizKey = group.title || `Quiz ${group.id}`;
      
      if (!quizMap.has(quizKey)) {
        quizMap.set(quizKey, {
          id: group.id,
          title: quizKey,
          week: group.week || 'Week 1',
          lecture: group.lecture || 'Lecture 1',
          questions: [],
        });
      }
      
      const quiz = quizMap.get(quizKey);
      
      // Add questions from each LO in the group
      if (group.los && Array.isArray(group.los)) {
        group.los.forEach((lo) => {
          if (lo.questions && Array.isArray(lo.questions)) {
            lo.questions.forEach((q) => {
              quiz.questions.push(this.convertQuestionToReviewFormat(q, group.title, lo.text || lo.title));
            });
          }
        });
      }
    });
    
    this.state.review.quizzes = Array.from(quizMap.values());
  }
  
  convertQuestionsToQuizzes(questions) {
    // Group questions by metaCode or course
    const quizMap = new Map();
    
    questions.forEach((q) => {
      const quizKey = q.metaCode || q.course || 'Generated Questions';
      
      if (!quizMap.has(quizKey)) {
        quizMap.set(quizKey, {
          id: Date.now() + Math.random(),
          title: quizKey,
          week: q.week || 'Week 1',
          lecture: q.lecture || 'Lecture 1',
          questions: [],
        });
      }
      
      const quiz = quizMap.get(quizKey);
      quiz.questions.push(this.convertQuestionToReviewFormat(q, q.metaCode, q.loCode));
    });
    
    this.state.review.quizzes = Array.from(quizMap.values());
  }
  
  convertQuestionToReviewFormat(question, metaCode, loCode) {
    // Convert question from generation format to review format
    const options = [];
    
    if (question.options && Array.isArray(question.options)) {
      question.options.forEach((opt, index) => {
        const label = String.fromCharCode(65 + index); // A, B, C, D
        options.push({
          id: label,
          label: label,
          text: typeof opt === 'string' ? opt : (opt.text || opt),
          isCorrect: question.correctAnswer === index || question.correctAnswer === label,
          feedback: question.explanation || ''
        });
      });
    } else {
      // Default options if none provided
      options.push(
        { id: 'A', label: 'A', text: 'Option A', isCorrect: false, feedback: '' },
        { id: 'B', label: 'B', text: 'Option B', isCorrect: true, feedback: '' },
        { id: 'C', label: 'C', text: 'Option C', isCorrect: false, feedback: '' },
        { id: 'D', label: 'D', text: 'Option D', isCorrect: false, feedback: '' }
      );
    }
    
    return {
      id: question.id || `q_${Date.now()}_${Math.random()}`,
      title: question.text || question.title || 'Untitled Question',
      prompt: question.text || question.question || question.title || 'Question prompt',
      options: options,
      status: question.status || 'unpublished',
      flagged: question.flagged || false,
      metaCode: metaCode || question.metaCode,
      loCode: loCode || question.loCode,
      bloomLevel: question.bloomLevel || question.bloom,
      difficulty: question.difficulty || 'Medium',
      history: question.history || [
        {
          by: question.by || 'System',
          change: 'Generated question',
          ts: question.lastEdited || new Date().toISOString().slice(0, 16).replace('T', ' ')
        }
      ],
      comments: question.comments || []
    };
  }
  
  loadSampleData() {
    // Sample quiz data matching the screenshot (fallback)
    this.state.review.quizzes = [
      {
        id: 1,
        title: 'Quiz 3A',
        week: 'Week 3',
        lecture: 'Lecture 2',
        questions: [
          {
            id: 1,
            title: 'Photosynthesis energy conversion',
            prompt: 'Which of the following best describes how plants convert light energy into chemical energy during photosynthesis?',
            options: [
              {
                id: 'A',
                label: 'A',
                text: 'Light energy is directly converted to glucose through a single chemical reaction',
                isCorrect: false,
                feedback: 'Incorrect — Photosynthesis involves multiple complex reactions, not a single conversion'
              },
              {
                id: 'B',
                label: 'B',
                text: 'Chlorophyll absorbs light, which excites electrons that drive ATP and NADPH production',
                isCorrect: true,
                feedback: 'Correct — This describes the light-dependent reactions of photosynthesis'
              },
              {
                id: 'C',
                label: 'C',
                text: 'Carbon dioxide and water combine spontaneously to form organic compounds',
                isCorrect: false,
                feedback: 'Incorrect — This reaction requires energy input and is not spontaneous'
              },
              {
                id: 'D',
                label: 'D',
                text: 'Oxygen is the primary product that stores the converted energy',
                isCorrect: false,
                feedback: 'Incorrect — Oxygen is a byproduct; glucose stores the energy'
              }
            ],
            status: 'unpublished',
            flagged: false,
            history: [
              {
                by: 'Dr. Smith',
                change: 'Created question',
                ts: '2025-01-15 14:30'
              },
              {
                by: 'Dr. Johnson',
                change: 'Revised prompt text',
                ts: '2025-01-16 09:15'
              }
            ],
            comments: [
              {
                by: 'Dr. Smith',
                text: 'Good question structure, but consider adding more context about the Calvin cycle',
                ts: '2025-01-15 16:45'
              }
            ]
          },
          {
            id: 2,
            title: 'ΔH and Spontaneity',
            prompt: 'Under what conditions is a reaction spontaneous when ΔH is positive?',
            options: [
              {
                id: 'A',
                label: 'A',
                text: 'When ΔS is negative and T is low',
                isCorrect: false,
                feedback: 'Incorrect — Negative ΔS and low T would make ΔG more positive'
              },
              {
                id: 'B',
                label: 'B',
                text: 'When ΔS is positive and T is high',
                isCorrect: true,
                feedback: 'Correct — High temperature can overcome positive ΔH if ΔS is positive'
              },
              {
                id: 'C',
                label: 'C',
                text: 'When ΔG is always positive regardless of temperature',
                isCorrect: false,
                feedback: 'Incorrect — ΔG must be negative for spontaneity'
              },
              {
                id: 'D',
                label: 'D',
                text: 'When the reaction is exothermic',
                isCorrect: false,
                feedback: 'Incorrect — Exothermic reactions have negative ΔH'
              }
            ],
            status: 'ready',
            flagged: false,
            history: [
              {
                by: 'Dr. Johnson',
                change: 'Created question',
                ts: '2025-01-14 11:20'
              },
              {
                by: 'Dr. Smith',
                change: 'Approved for publication',
                ts: '2025-01-16 10:30'
              }
            ],
            comments: [
              {
                by: 'Dr. Johnson',
                text: 'This question tests understanding of Gibbs free energy relationship',
                ts: '2025-01-14 11:25'
              }
            ]
          },
          {
            id: 3,
            title: 'Define Microstate',
            prompt: 'What is a microstate in statistical mechanics?',
            options: [
              {
                id: 'A',
                label: 'A',
                text: 'A specific arrangement of particles with defined positions and momenta',
                isCorrect: true,
                feedback: 'Correct — A microstate is a specific microscopic configuration'
              },
              {
                id: 'B',
                label: 'B',
                text: 'The average energy of all particles in a system',
                isCorrect: false,
                feedback: 'Incorrect — This describes macroscopic properties, not microstates'
              },
              {
                id: 'C',
                label: 'C',
                text: 'A state of matter (solid, liquid, gas)',
                isCorrect: false,
                feedback: 'Incorrect — These are macroscopic phases, not microstates'
              },
              {
                id: 'D',
                label: 'D',
                text: 'The total number of particles in a system',
                isCorrect: false,
                feedback: 'Incorrect — This is a system property, not a microstate'
              }
            ],
            status: 'unpublished',
            flagged: true,
            history: [
              {
                by: 'Dr. Wilson',
                change: 'Created question',
                ts: '2025-01-13 15:40'
              }
            ],
            comments: [
              {
                by: 'Dr. Wilson',
                text: 'Flagged for review - may need clearer distinction between micro and macro states',
                ts: '2025-01-13 15:45'
              }
            ]
          }
        ]
      }
    ];
  }

  parseURL() {
    // Parse URL parameters to get quizId and questionId
    const urlParams = new URLSearchParams(window.location.search);
    const quizId = parseInt(urlParams.get('quizId')) || 1;
    const questionId = parseInt(urlParams.get('questionId')) || 1;
    
    this.state.review.quizId = quizId;
    this.state.review.questionId = questionId;
    
    // Find the current quiz and question
    this.state.review.currentQuiz = this.state.review.quizzes.find(q => q.id === quizId);
    if (this.state.review.currentQuiz) {
      this.state.review.currentQuestion = this.state.review.currentQuiz.questions.find(q => q.id === questionId);
      if (!this.state.review.currentQuestion) {
        // If question not found, use the first one
        this.state.review.currentQuestion = this.state.review.currentQuiz.questions[0];
        this.state.review.questionId = this.state.review.currentQuestion.id;
      }
    }
  }

  initializeEventListeners() {
    // Back button
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.handleBack());
    }

    // Publish button
    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
      publishBtn.addEventListener('click', () => this.handlePublish());
    }

    // Question actions
    const editBtn = document.getElementById('edit-btn');
    const flagBtn = document.getElementById('flag-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const approveBtn = document.getElementById('approve-btn');

    if (editBtn) editBtn.addEventListener('click', () => this.handleEdit());
    if (flagBtn) flagBtn.addEventListener('click', () => this.handleFlag());
    if (deleteBtn) deleteBtn.addEventListener('click', () => this.handleDelete());
    if (approveBtn) approveBtn.addEventListener('click', () => this.handleApprove());

    // Sidebar controls
    const sortUpBtn = document.getElementById('sort-up');
    const sortDownBtn = document.getElementById('sort-down');
    const overflowBtn = document.getElementById('overflow-btn');

    if (sortUpBtn) sortUpBtn.addEventListener('click', () => this.handleSort('asc'));
    if (sortDownBtn) sortDownBtn.addEventListener('click', () => this.handleSort('desc'));
    if (overflowBtn) overflowBtn.addEventListener('click', () => this.toggleOverflowMenu());

    // Comment input
    const commentInput = document.getElementById('comment-input');
    const addCommentBtn = document.getElementById('add-comment-btn');

    if (commentInput) {
      commentInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAddComment();
      });
    }
    if (addCommentBtn) {
      addCommentBtn.addEventListener('click', () => this.handleAddComment());
    }

    // Modal events
    this.initializeModalEvents();

    // Close overflow menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.overflow-menu')) {
        this.hideOverflowMenu();
      }
    });
  }

  initializeModalEvents() {
    const confirmModal = document.getElementById('confirm-modal');
    const unsavedModal = document.getElementById('unsaved-modal');
    
    if (confirmModal) {
      const closeBtn = document.getElementById('modal-close');
      const cancelBtn = document.getElementById('modal-cancel');
      const confirmBtn = document.getElementById('modal-confirm');

      if (closeBtn) closeBtn.addEventListener('click', () => this.hideModal('confirm'));
      if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideModal('confirm'));
      if (confirmBtn) confirmBtn.addEventListener('click', () => this.confirmModalAction());
    }

    if (unsavedModal) {
      const closeBtn = document.getElementById('unsaved-modal-close');
      const discardBtn = document.getElementById('unsaved-discard');
      const stayBtn = document.getElementById('unsaved-stay');

      if (closeBtn) closeBtn.addEventListener('click', () => this.hideModal('unsaved'));
      if (discardBtn) discardBtn.addEventListener('click', () => this.handleDiscardChanges());
      if (stayBtn) stayBtn.addEventListener('click', () => this.hideModal('unsaved'));
    }

    // Close modals on outside click
    [confirmModal, unsavedModal].forEach(modal => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            this.hideModal(modal.id === 'confirm-modal' ? 'confirm' : 'unsaved');
          }
        });
      }
    });
  }

  renderAll() {
    this.renderQuestionCard();
    this.renderEditHistory();
    this.renderComments();
    this.renderQuestionsList();
    this.updatePublishButton();
    this.updateQuestionFlags();
  }

  renderQuestionCard() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    const titleElement = document.getElementById('question-title');
    const promptElement = document.getElementById('question-prompt');
    const optionsElement = document.getElementById('question-options');

    if (titleElement) {
      if (this.state.review.editMode) {
        titleElement.innerHTML = `
          <input type="text" value="${question.title}" class="edit-title-input">
          <div class="edit-actions">
            <button class="save-btn" onclick="window.questionReviewPage.saveEdit('title')">Save</button>
            <button class="cancel-btn" onclick="window.questionReviewPage.cancelEdit()">Cancel</button>
          </div>
        `;
        titleElement.classList.add('editing');
      } else {
        titleElement.textContent = question.title;
        titleElement.classList.remove('editing');
      }
    }

    if (promptElement) {
      if (this.state.review.editMode) {
        promptElement.innerHTML = `
          <textarea class="edit-prompt-input">${question.prompt}</textarea>
        `;
        promptElement.classList.add('editing');
      } else {
        promptElement.textContent = question.prompt;
        promptElement.classList.remove('editing');
      }
    }

    if (optionsElement) {
      optionsElement.innerHTML = question.options.map(option => `
        <div class="option-block ${option.isCorrect ? 'correct' : ''} ${this.state.review.editMode ? 'editing' : ''}">
          <span class="option-label">${option.label}.</span>
          ${this.state.review.editMode ? 
            `<textarea class="edit-option-input">${option.text}</textarea>` :
            `<div class="option-text">${option.text}</div>`
          }
          <div class="option-feedback">${option.feedback}</div>
          ${option.isCorrect ? '<span class="correct-chip">Correct</span>' : ''}
        </div>
      `).join('');
    }
  }

  renderEditHistory() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    const historyElement = document.getElementById('edit-history');
    if (historyElement) {
      historyElement.innerHTML = question.history.map(item => `
        <div class="history-item">
          <div class="history-details">
            <span class="history-author">${item.by}</span>
            <span class="history-change">${item.change}</span>
          </div>
          <div class="history-timestamp">${item.ts}</div>
        </div>
      `).join('');
    }
  }

  renderComments() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    const commentsElement = document.getElementById('comments-list');
    if (commentsElement) {
      commentsElement.innerHTML = question.comments.map(comment => `
        <div class="comment-item">
          <div class="comment-header">
            <span class="comment-author">${comment.by}</span>
            <span class="comment-timestamp">${comment.ts}</span>
          </div>
          <div class="comment-text">${comment.text}</div>
        </div>
      `).join('');
    }
  }

  renderQuestionsList() {
    const quiz = this.state.review.currentQuiz;
    if (!quiz) return;

    const questionsListElement = document.getElementById('questions-list');
    if (questionsListElement) {
      questionsListElement.innerHTML = quiz.questions.map(question => `
        <div class="question-list-item ${question.id === this.state.review.questionId ? 'selected' : ''}" 
             onclick="window.questionReviewPage.selectQuestion(${question.id})">
          <div class="question-list-title">${question.title}</div>
          <div class="question-list-status">
            <span class="status-chip status-${question.status} ${question.flagged ? 'status-flagged' : ''}">
              ${question.flagged ? 'Flagged' : question.status}
            </span>
          </div>
        </div>
      `).join('');
    }
  }

  updatePublishButton() {
    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
      const question = this.state.review.currentQuestion;
      const isReady = question && question.status === 'ready';
      publishBtn.disabled = !isReady;
    }
  }

  updateQuestionFlags() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    const flagsElement = document.getElementById('question-flags');
    if (flagsElement) {
      if (question.flagged) {
        flagsElement.innerHTML = '<span class="flagged-chip">Flagged</span>';
      } else {
        flagsElement.innerHTML = '';
      }
    }
  }

  selectQuestion(questionId) {
    if (this.state.review.editMode && this.state.review.unsavedChanges) {
      this.showUnsavedModal(() => this.navigateToQuestion(questionId));
      return;
    }

    this.navigateToQuestion(questionId);
  }

  navigateToQuestion(questionId) {
    this.state.review.questionId = questionId;
    this.state.review.currentQuestion = this.state.review.currentQuiz.questions.find(q => q.id === questionId);
    this.state.review.editMode = false;
    this.state.review.unsavedChanges = false;
    
    // Update URL without page reload
    const url = new URL(window.location);
    url.searchParams.set('questionId', questionId);
    window.history.pushState({}, '', url);
    
    this.renderAll();
  }

  handleEdit() {
    if (this.state.review.editMode) {
      this.saveEdit();
    } else {
      this.state.review.editMode = true;
      this.renderQuestionCard();
      this.updateEditButton();
    }
  }

  saveEdit() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    // Save title
    const titleInput = document.querySelector('.edit-title-input');
    if (titleInput) {
      question.title = titleInput.value.trim();
    }

    // Save prompt
    const promptInput = document.querySelector('.edit-prompt-input');
    if (promptInput) {
      question.prompt = promptInput.value.trim();
    }

    // Save options
    const optionInputs = document.querySelectorAll('.edit-option-input');
    optionInputs.forEach((input, index) => {
      if (question.options[index]) {
        question.options[index].text = input.value.trim();
      }
    });

    this.state.review.editMode = false;
    this.state.review.unsavedChanges = false;
    this.renderQuestionCard();
    this.updateEditButton();
    this.renderQuestionsList();
    this.showNotification('Question updated successfully', 'success');
  }

  cancelEdit() {
    this.state.review.editMode = false;
    this.state.review.unsavedChanges = false;
    this.renderQuestionCard();
    this.updateEditButton();
  }

  updateEditButton() {
    const editBtn = document.getElementById('edit-btn');
    if (editBtn) {
      if (this.state.review.editMode) {
        editBtn.innerHTML = '<i class="fas fa-save"></i> Save';
        editBtn.classList.add('saving');
      } else {
        editBtn.innerHTML = '<i class="fas fa-pencil"></i> Edit';
        editBtn.classList.remove('saving');
      }
    }
  }

  handleFlag() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    question.flagged = !question.flagged;
    this.updateQuestionFlags();
    this.renderQuestionsList();
    
    const message = question.flagged ? 'Question flagged' : 'Question unflagged';
    this.showNotification(message, 'success');
  }

  handleDelete() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    this.showModal(
      'Delete Question',
      `Are you sure you want to delete "${question.title}"? This action cannot be undone.`,
      () => this.confirmDelete()
    );
  }

  confirmDelete() {
    const quiz = this.state.review.currentQuiz;
    const question = this.state.review.currentQuestion;
    if (!quiz || !question) return;

    const questionIndex = quiz.questions.findIndex(q => q.id === question.id);
    if (questionIndex > -1) {
      quiz.questions.splice(questionIndex, 1);
      
      if (quiz.questions.length === 0) {
        // No questions left, go back to quiz list
        this.handleBack();
        return;
      }

      // Navigate to next question (or previous if last)
      let nextQuestionId;
      if (questionIndex >= quiz.questions.length) {
        nextQuestionId = quiz.questions[questionIndex - 1].id;
      } else {
        nextQuestionId = quiz.questions[questionIndex].id;
      }

      this.navigateToQuestion(nextQuestionId);
      this.showNotification('Question deleted', 'success');
    }
  }

  handleApprove() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    if (question.status === 'unpublished') {
      question.status = 'ready';
      this.showNotification('Question approved', 'success');
    } else if (question.status === 'ready') {
      question.status = 'unpublished';
      this.showNotification('Approval removed', 'success');
    }

    this.renderQuestionsList();
    this.updatePublishButton();
  }

  handlePublish() {
    const question = this.state.review.currentQuestion;
    if (!question || question.status !== 'ready') return;

    this.showModal(
      'Publish Question',
      'Publish this question now?',
      () => this.confirmPublish()
    );
  }

  confirmPublish() {
    const question = this.state.review.currentQuestion;
    if (!question) return;

    question.status = 'published';
    this.renderQuestionsList();
    this.updatePublishButton();
    this.showNotification('Question published', 'success');
  }

  handleSort(direction) {
    const quiz = this.state.review.currentQuiz;
    if (!quiz) return;

    // Update sort buttons
    const sortUpBtn = document.getElementById('sort-up');
    const sortDownBtn = document.getElementById('sort-down');

    if (sortUpBtn) sortUpBtn.classList.toggle('active', direction === 'asc');
    if (sortDownBtn) sortDownBtn.classList.toggle('active', direction === 'desc');

    // Sort questions
    quiz.questions.sort((a, b) => {
      if (direction === 'asc') {
        return a.title.localeCompare(b.title);
      } else {
        return b.title.localeCompare(a.title);
      }
    });

    this.renderQuestionsList();
  }

  toggleOverflowMenu() {
    const dropdown = document.getElementById('overflow-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('show');
    }
  }

  hideOverflowMenu() {
    const dropdown = document.getElementById('overflow-dropdown');
    if (dropdown) {
      dropdown.classList.remove('show');
    }
  }

  handleAddComment() {
    const commentInput = document.getElementById('comment-input');
    const commentText = commentInput.value.trim();
    
    if (!commentText) return;

    const question = this.state.review.currentQuestion;
    if (!question) return;

    const newComment = {
      by: 'Current User',
      text: commentText,
      ts: new Date().toLocaleString()
    };

    question.comments.push(newComment);
    commentInput.value = '';
    
    this.renderComments();
    this.showNotification('Comment added', 'success');
  }

  handleBack() {
    if (this.state.review.editMode && this.state.review.unsavedChanges) {
      this.showUnsavedModal(() => this.navigateBack());
      return;
    }

    this.navigateBack();
  }

  navigateBack() {
    // Navigate back to question bank review tab
    window.location.href = 'question-bank.html?tab=review';
  }

  showUnsavedModal(onDiscard) {
    this.pendingDiscardAction = onDiscard;
    this.showModal('unsaved');
  }

  handleDiscardChanges() {
    if (this.pendingDiscardAction) {
      this.pendingDiscardAction();
      this.pendingDiscardAction = null;
    }
    this.hideModal('unsaved');
  }

  showModal(type) {
    let modalId, title, message;
    
    if (type === 'confirm') {
      modalId = 'confirm-modal';
      title = this.pendingModalTitle || 'Confirm Action';
      message = this.pendingModalMessage || 'Are you sure you want to proceed?';
    } else if (type === 'unsaved') {
      modalId = 'unsaved-modal';
      title = 'Unsaved Changes';
      message = 'You have unsaved changes. Do you want to discard them?';
    }

    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  hideModal(type) {
    let modalId;
    
    if (type === 'confirm') {
      modalId = 'confirm-modal';
    } else if (type === 'unsaved') {
      modalId = 'unsaved-modal';
    }

    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'none';
    }
  }

  confirmModalAction() {
    if (this.pendingModalAction) {
      this.pendingModalAction();
      this.pendingModalAction = null;
    }
    this.hideModal('confirm');
  }

  showNotification(message, type = 'info') {
    console.log(`${type.toUpperCase()}: ${message}`);
    
    // Announce to screen readers
    const liveRegion = document.getElementById('live-region');
    if (liveRegion) {
      liveRegion.textContent = message;
    }
    
    // Create a simple notification
    const notification = document.createElement('div');
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
        type === 'success'
          ? '#27ae60'
          : type === 'warning'
          ? '#f39c12'
          : '#3498db'
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
document.addEventListener('DOMContentLoaded', () => {
  window.questionReviewPage = new QuestionReviewPage();
});

// Export for use in other files
window.QuestionReviewPage = QuestionReviewPage; 