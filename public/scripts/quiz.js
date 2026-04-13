// GRASP Quiz JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Initialize quiz functionality
  initializeQuiz();
});

let quizState = {
  currentView: 'list', // 'list' or 'quiz'
  quizzes: [],
  currentQuiz: null,
  currentQuestionIndex: 0,
  answers: {},
  feedback: {}, // Store feedback for each question
  userId: null,
  userRole: null,
  courseId: null,
  completedQuizIds: [], // Added to track completions based on scores
  startTime: null,
  timerInterval: null
};

async function initializeQuiz() {
  // Initialize shared navigation
  new window.GRASPNavigation();

  // Load user info first
  await loadUserInfo();

  // Check for URL parameters to auto-start quiz
  const urlParams = new URLSearchParams(window.location.search);
  const quizId = urlParams.get("quiz");

  if (quizId) {
    // Hide list container immediately and show quiz container
    document.getElementById("quizListContainer").style.display = "none";
    document.getElementById("quizContainer").style.display = "block";
    quizState.currentView = 'quiz';

    // Auto-start the quiz if quiz ID is in URL
    await startQuiz(quizId);
  } else {
    // Otherwise, show quiz list
    loadQuizList();
  }

  // Set up event listeners
  setupEventListeners();
}

async function loadUserInfo() {
  try {
    const response = await fetch('/api/current-user');
    const data = await response.json();
    if (data.success && data.user) {
      quizState.userId = data.user._id || data.user.id;
      quizState.userRole = data.user.role;
    }
  } catch (error) {
    console.error("Error loading user info:", error);
  }
}

async function loadQuizList() {
  try {
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    quizState.courseId = selectedCourse.id;

    if (!quizState.courseId) {
      showEmptyState("No course selected. Please select a course first.");
      return;
    }

    // Update course name display
    document.getElementById("courseNameDisplay").textContent = selectedCourse.name || "Unknown Course";

    // Fetch quizzes, achievements, and completion scores in parallel
    const [quizzesResponse, achievementsResponse, scoresResponse] = await Promise.all([
      fetch(`/api/quiz/course/${quizState.courseId}`),
      fetch(`/api/achievement/my?courseId=${quizState.courseId}`),
      fetch(`/api/quiz/my-scores?courseId=${quizState.courseId}`)
    ]);

    const quizzesData = await quizzesResponse.json();
    let userAchievements = [];

    if (achievementsResponse.ok) {
      const achievementsData = await achievementsResponse.json();
      if (achievementsData.success && achievementsData.data) {
        userAchievements = achievementsData.data;
      }
    }
    if (scoresResponse.ok) {
      const scoresData = await scoresResponse.json();
      if (scoresData.success && scoresData.completedQuizIds) {
        quizState.completedQuizIds = scoresData.completedQuizIds;
      }
    }
    if (quizzesData.success && quizzesData.quizzes) {
      // Filter to only show published quizzes and check dates
      const now = new Date();
      const publishedQuizzes = quizzesData.quizzes.filter(quiz => {
        if (quiz.published !== true) return false;
        if (quiz.releaseDate && new Date(quiz.releaseDate) > now) return false;
        if (quiz.expireDate && new Date(quiz.expireDate) < now) return false;
        return true;
      });

      if (publishedQuizzes.length === 0) {
        showEmptyState("No published quizzes available for this course.");
      } else {
        // Fetch question counts for each quiz and attach achievements
        const quizzesWithDetails = await Promise.all(
          publishedQuizzes.map(async (quiz) => {
            const quizId = quiz._id ? (quiz._id.toString ? quiz._id.toString() : String(quiz._id)) : String(quiz.id || "");
            let questionCount = 0;
            let phase1Count = 0;
            let phase2Count = 0;
            let phase3Count = 0;

            try {
              // Get approved questions count (for students)
              const questionsResponse = await fetch(`/api/quiz/${quizId}/questions?approvedOnly=true`);
              if (questionsResponse.ok) {
                const questionsData = await questionsResponse.json();
                if (questionsData.success && questionsData.questions) {
                  questionCount = questionsData.questions.length;
                  
                  // Calculate breakdown
                  const questions = questionsData.questions;
                  phase1Count = questions.filter(q => q.phase === 1).length;
                  phase2Count = questions.filter(q => q.phase === 2).length;
                  phase3Count = questions.filter(q => q.phase === 3).length;
                }
              }
            } catch (error) {
              console.error(`Error fetching question count for quiz ${quizId}:`, error);
            }

            // Find achievements for this quiz
            const quizAchievements = userAchievements.filter(a => {
              const achievementQuizId = a.quizId?.toString ? a.quizId.toString() : String(a.quizId || "");
              return achievementQuizId === quizId;
            });

            return {
              ...quiz,
              questionCount: questionCount,
              phase1Count: phase1Count || 0,
              phase2Count: phase2Count || 0,
              phase3Count: phase3Count || 0,
              achievements: quizAchievements
            };
          })
        );

        quizState.quizzes = quizzesWithDetails;
        renderQuizList();
      }
    } else {
      showEmptyState("Failed to load quizzes.");
    }
  } catch (error) {
    console.error("Error loading quiz list:", error);
    showEmptyState("Error loading quizzes. Please try again.");
  }
}

function showEmptyState(message) {
  document.getElementById("quizGrid").style.display = "none";
  const emptyState = document.getElementById("emptyState");
  emptyState.querySelector("p").textContent = message;
  emptyState.style.display = "block";
}

function renderQuizList() {
  const quizGrid = document.getElementById("quizGrid");
  quizGrid.innerHTML = "";

  const pendingQuizzes = quizState.quizzes.filter(q => !q.achievements.some(a => a.type === 'quiz_completed'));
  const completedQuizzes = quizState.quizzes.filter(q => q.achievements.some(a => a.type === 'quiz_completed'));

  if (pendingQuizzes.length > 0) {
    const section = document.createElement("div");
    section.className = "quiz-section";
    section.innerHTML = `
      <h2 class="section-title">Pending Quizzes</h2>
      <div class="quiz-subgrid"></div>
    `;
    const subgrid = section.querySelector(".quiz-subgrid");
    pendingQuizzes.forEach(quiz => {
      subgrid.appendChild(createQuizCard(quiz));
    });
    quizGrid.appendChild(section);
  }

  if (completedQuizzes.length > 0) {
    const section = document.createElement("div");
    section.className = "quiz-section";
    section.innerHTML = `
      <h2 class="section-title">Completed Quizzes</h2>
      <div class="quiz-subgrid"></div>
    `;
    const subgrid = section.querySelector(".quiz-subgrid");
    completedQuizzes.forEach(quiz => {
      subgrid.appendChild(createQuizCard(quiz));
    });
    quizGrid.appendChild(section);
  }

  document.getElementById("quizGrid").style.display = "block";
  document.getElementById("emptyState").style.display = "none";
}

function createQuizCard(quiz) {
  const card = document.createElement("div");
  card.className = "quiz-card";

  const quizId = quiz._id ? (quiz._id.toString ? quiz._id.toString() : String(quiz._id)) : String(quiz.id || "");

  // Check for achievements
  const achievements = quiz.achievements || [];
  // NEW: Check completion based on scores table, not achievements
  const hasCompleted = quizState.completedQuizIds.includes(quizId);
  const hasPerfect = achievements.some(a => a.type === 'quiz_perfect');

  // Build achievement badges HTML
  let achievementBadgesHtml = '';
  if (achievements.length > 0) {
    achievementBadgesHtml = `
      <div class="quiz-achievements">
        ${hasCompleted ? `
          <span class="achievement-badge-mini completed" title="Quiz Completed">
            <i class="fas fa-check-circle"></i>
          </span>
        ` : ''}
        ${hasPerfect ? `
          <span class="achievement-badge-mini perfect" title="Perfect Score">
            <i class="fas fa-star"></i>
          </span>
        ` : ''}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="quiz-card-header">
      <h3>${escapeHtml(quiz.name || "Unnamed Quiz")}</h3>
      ${achievementBadgesHtml}
    </div>
    <div class="quiz-card-content">
      <p class="quiz-description">${escapeHtml(quiz.description || "No description available")}</p>
      <div class="quiz-card-meta">
        <span class="quiz-date">
          <i class="fas fa-calendar-alt"></i>
          Released: ${quiz.releaseDate ? new Date(quiz.releaseDate).toLocaleDateString() : "Not set"}
        </span>
        ${quiz.expireDate ? `
        <span class="quiz-date due">
          <i class="fas fa-clock"></i>
          Due: ${new Date(quiz.expireDate).toLocaleDateString()}
        </span>
        ` : ''}
        <div class="quiz-count-breakdown">
          <span class="quiz-count-item quiz" title="New Quiz Questions">
            <i class="fas fa-book"></i>
            ${quiz.phase1Count || 0} New
          </span>
          <span class="quiz-count-item remediation" title="Remediation Questions">
            <i class="fas fa-fire-alt"></i>
            ${quiz.phase2Count || 0} Remediation
          </span>
          <span class="quiz-count-item review" title="Spaced Learning Questions">
            <i class="fas fa-history"></i>
            ${quiz.phase3Count || 0} Review
          </span>
        </div>
      </div>
      ${achievements.length > 0 ? `
        <div class="quiz-card-achievements-detail">
          ${hasCompleted ? `<span class="achievement-detail completed"><i class="fas fa-check-circle"></i> Completed</span>` : ''}
          ${hasPerfect ? `<span class="achievement-detail perfect"><i class="fas fa-star"></i> Perfect Score</span>` : ''}
        </div>
      ` : ''}
    </div>
    <div class="quiz-card-actions">
      <button class="start-quiz-button" ${(!quiz.questionCount || quiz.questionCount === 0) ? 'disabled' : ''}>
        <i class="fas fa-play"></i>
        ${hasCompleted ? 'Retake Quiz' : 'Start Quiz'}
      </button>
    </div>
  `;

  // Add event listener programmatically to avoid CSP violations
  const startButton = card.querySelector(".start-quiz-button");
  if (startButton) {
    startButton.addEventListener("click", () => {
      startQuiz(quizId);
    });
  }

  return card;
}

function setupEventListeners() {
  document.getElementById("backToQuizzes").addEventListener("click", () => {
    showQuizList(); // showQuizList() already calls resetQuizState()
  });

  document.getElementById("backToQuizzesButton").addEventListener("click", () => {
    showQuizList(); // showQuizList() already calls resetQuizState()
  });

  document.getElementById("restartQuizButton").addEventListener("click", () => {
    restartQuiz();
  });

  document.getElementById("prevButton").addEventListener("click", () => {
    if (quizState.currentQuestionIndex > 0) {
      quizState.currentQuestionIndex--;
      showQuestion(quizState.currentQuestionIndex);
    }
  });

  document.getElementById("nextButton").addEventListener("click", () => {
    if (quizState.currentQuestionIndex < quizState.quizData.questions.length - 1) {
      quizState.currentQuestionIndex++;
      showQuestion(quizState.currentQuestionIndex);
    } else {
      // All questions answered, show completion
      showCompletion();
    }
  });
}

async function startQuiz(quizId) {
  try {
    // Immediately switch to quiz view and hide list
    showQuizView();

    // Show loading overlay instead of replacing HTML
    const quizContainer = document.getElementById("quizContainer");
    if (quizContainer) {
      // Create or show loading overlay
      let loadingOverlay = document.getElementById("quizLoadingOverlay");
      if (!loadingOverlay) {
        loadingOverlay = document.createElement("div");
        loadingOverlay.id = "quizLoadingOverlay";
        loadingOverlay.style.cssText = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.95); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000; border-radius: 12px;";
        loadingOverlay.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 48px; margin-bottom: 20px; color: #3498db;"></i><p style="font-size: 18px; color: #7f8c8d;">Loading quiz...</p>';
        quizContainer.style.position = "relative";
        quizContainer.appendChild(loadingOverlay);
      } else {
        loadingOverlay.style.display = "flex";
      }
    }

    // Fetch quiz metadata and questions concurrently
    const [quizResponse, questionsResponse] = await Promise.all([
      fetch(`/api/quiz/${quizId}`),
      fetch(`/api/quiz/${quizId}/questions?approvedOnly=true&_t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
    ]);
    
    const quizData = await quizResponse.json();
    const questionsData = await questionsResponse.json();

    if (quizData.success && questionsData.success) {
      quizState.currentQuiz = quizId;
      quizState.quizData = {
        quizId: quizId,
        title: quizData.quiz ? quizData.quiz.name : "Quiz",
        course: "Course", // Could fetch course name if needed, but placeholder is fine for UI
        duration: quizData.quiz ? quizData.quiz.duration || 0 : 0,
        questions: questionsData.questions
      };
      quizState.currentQuestionIndex = 0;
      quizState.answers = {};
      quizState.feedback = {};
      quizState.startTime = Date.now();
      
      startTimer();

      // Hide loading overlay
      const loadingOverlay = document.getElementById("quizLoadingOverlay");
      if (loadingOverlay) {
        loadingOverlay.style.display = "none";
      }

      // Render quiz
      renderQuiz();
      showQuestion(0);

      // Clear URL parameters to prevent re-loading on refresh
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      throw new Error(questionsData.message || quizData.message || "Failed to load quiz");
    }
  } catch (error) {
    console.error("Error starting quiz:", error);

    // Hide loading overlay on error
    const loadingOverlay = document.getElementById("quizLoadingOverlay");
    if (loadingOverlay) {
      loadingOverlay.style.display = "none";
    }

    alert("Failed to load quiz: " + error.message);
    // Go back to list view on error
    showQuizList();
  }
}

function showQuizView() {
  document.getElementById("quizListContainer").style.display = "none";
  document.getElementById("quizContainer").style.display = "block";
  quizState.currentView = 'quiz';
}

function showQuizList() {
  // Always reset quiz state when going back to list (whether quiz is running or completed)
  resetQuizState();
  document.getElementById("quizListContainer").style.display = "block";
  document.getElementById("quizContainer").style.display = "none";
  quizState.currentView = 'list';
  // Reload quiz list
  loadQuizList();
}

function resetQuizState() {
  // Reset all quiz-related state
  quizState.currentQuiz = null;
  quizState.currentQuestionIndex = 0;
  quizState.answers = {};
  quizState.feedback = {};
  quizState.quizData = null;
  quizState.startTime = null;
  
  stopTimer();

  // Also hide completion section if it's visible
  const completionSection = document.getElementById("completionSection");
  if (completionSection) {
    completionSection.style.display = "none";
  }

  // Show quiz content and navigation in case they were hidden
  const quizContent = document.querySelector(".quiz-content");
  const quizNavigation = document.querySelector(".quiz-navigation");
  if (quizContent) {
    quizContent.style.display = "block";
  }
  if (quizNavigation) {
    quizNavigation.style.display = "flex";
  }
}

function restartQuiz() {
  if (!quizState.currentQuiz) {
    console.error("Cannot restart: No quiz loaded");
    return;
  }

  // Hide completion section and show loading state
  document.getElementById("completionSection").style.display = "none";
  document.querySelector(".quiz-content").style.display = "block";
  document.querySelector(".quiz-navigation").style.display = "flex";
  
  const questionTitleElement = document.getElementById("questionText");
  if (questionTitleElement) {
    questionTitleElement.innerHTML = `<div style="text-align: center; color: #7f8c8d; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Generating personalized questions...</div>`;
  }

  // Re-fetch questions to compute new personalized Bloom levels and User Level metadata
  // Explicitly bust browser cache to ensure we get a freshly generated set of questions from the backend
  fetch(`/api/quiz/${quizState.currentQuiz}/questions?approvedOnly=true&_t=${Date.now()}`, {
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.questions) {
        // Reset quiz state with fresh data, mapping it into the expected quizData schema
        quizState.quizData = {
          quizId: quizState.currentQuiz,
          title: quizState.quizData.title || "Quiz",
          course: quizState.quizData.course || "Course",
          duration: quizState.quizData.duration || 0,
          questions: data.questions
        };

        quizState.currentQuestionIndex = 0;
        quizState.answers = {};
        quizState.feedback = {};
        quizState.startTime = Date.now();
        
        startTimer();
      
        // Render updated quiz
        renderQuiz();
      } else {
        console.error("Failed to load questions for retake");
        alert("Could not start quiz retake. Please try again.");
      }
    })
    .catch(error => {
      console.error("Error fetching quiz questions for retake:", error);
      alert("Error starting quiz retake. Please check your connection.");
    });
}

function renderQuiz() {
  // Update quiz header
  document.getElementById("quizTitle").textContent = quizState.quizData.title || "Quiz";
  document.getElementById("quizCourse").textContent = quizState.quizData.course || "Course";
  document.getElementById("totalQuestions").textContent = quizState.quizData.questions.length;

  // Generate question indicators
  generateQuestionIndicators();
  
  // Actually render the first question payload into the DOM to overwrite the loading spinner
  showQuestion(0);
}

function generateQuestionIndicators() {
  const indicatorsContainer = document.getElementById("questionIndicators");
  indicatorsContainer.innerHTML = "";

  quizState.quizData.questions.forEach((_, index) => {
    const indicator = document.createElement("div");
    indicator.className = "question-indicator";
    indicator.addEventListener("click", () => goToQuestion(index));
    indicatorsContainer.appendChild(indicator);
  });
}

function goToQuestion(index) {
  if (index >= 0 && index < quizState.quizData.questions.length) {
    quizState.currentQuestionIndex = index;
    showQuestion(index);
  }
}

function showQuestion(questionIndex) {
  const question = quizState.quizData.questions[questionIndex];

  // Update question number and text
  document.getElementById("questionNumber").textContent = `Question ${questionIndex + 1}`;
  
  // Use innerHTML for question text to support LaTeX rendering
  const questionTitleElement = document.getElementById("questionText");
  const questionStemElement = document.getElementById("questionStem"); // Assumes this element might exist or we just append
  
  // Retrieve diagnostic metadata attached by getQuizQuestionsForStudent
  const loName = question.learningObjectiveName || question.granularObjectiveName || "General Topic";
  const bloomName = question.bloom || "Unspecified Category";
  const userLevel = question.userLevel || "No Prior History";
  const questionIdStr = question.id || "N/A";

  let completeHTML = `
    <div class="question-title" style="margin-bottom: ${question.stem ? '10px' : '0'};">
      ${parseSmilesTags(escapeHtml(question.question || question.title || "Question text not available"))}
    </div>
  `;

  const isPrivileged = quizState.userRole === "administrator" || quizState.userRole === "faculty";
  
  if (isPrivileged) {
      const diagnosticHTML = `
        <div class="diagnostic-metadata" style="margin-bottom: 15px; padding: 12px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #3498db; font-size: 0.9em; color: #495057; display: flex; flex-direction: column; gap: 6px;">
          <div><strong><i class="fas fa-bullseye" style="width: 16px; text-align: center; color: #3498db;"></i> Objective:</strong> ${escapeHtml(loName)}</div>
          <div><strong><i class="fas fa-brain" style="width: 16px; text-align: center; color: #9b59b6;"></i> Taxonomy:</strong> ${escapeHtml(bloomName)}</div>
        </div>
      `;
      completeHTML = diagnosticHTML + completeHTML;
  }
  
  if (question.stem) {
    completeHTML += `
      <div class="question-stem" style="font-size: 1.1em; font-weight: 500; color: #34495e;">
        ${parseSmilesTags(escapeHtml(question.stem))}
      </div>
    `;
  }
  
  questionTitleElement.innerHTML = completeHTML;
  document.getElementById("currentQuestion").textContent = questionIndex + 1;
  
  // Show question ID for debugging
  const idDisplay = document.getElementById("questionIdDisplay");
  if (idDisplay) {
    idDisplay.textContent = `ID: ${question.id || 'N/A'}`;
  }

  // Update progress bar
  const progress = ((questionIndex + 1) / quizState.quizData.questions.length) * 100;
  document.getElementById("progressFill").style.width = `${progress}%`;

  // Update answer options
  renderAnswerOptions(question, questionIndex);

  // Get question ID for checking answers and feedback
  const questionId = question.id;

  // Show feedback if answer was already selected (check by question ID)
  if (quizState.feedback[questionId]) {
    showFeedback(questionIndex, questionId, quizState.answers[questionId], question.correctAnswer);
  } else {
    hideFeedback();
  }

  // Render LaTeX after content is updated
  renderKatex();
  if (typeof renderSmiles === 'function') renderSmiles();

  // Update navigation buttons
  document.getElementById("prevButton").disabled = questionIndex === 0;
  document.getElementById("nextButton").textContent = questionIndex === quizState.quizData.questions.length - 1 ? "Finish" : "Next";
  document.getElementById("nextButton").innerHTML = questionIndex === quizState.quizData.questions.length - 1
    ? "Finish <i class=\"fas fa-check\"></i>"
    : "Next <i class=\"fas fa-chevron-right\"></i>";

  // Disable next button if current question hasn't been answered
  const hasAnswer = quizState.answers[questionId] !== undefined;
  document.getElementById("nextButton").disabled = !hasAnswer;

  // Update question indicators
  updateQuestionIndicators();
}

function renderAnswerOptions(question, questionIndex) {
  const answerOptions = document.getElementById("answerOptions");
  answerOptions.innerHTML = "";
  const questionId = question.id;
  
  // The backend physically keys the options DB dictionary as A, B, C, D
  const databaseKeys = ['A', 'B', 'C', 'D'];
  const selectedIndex = quizState.answers[questionId]; // 0, 1, 2, or 3

  databaseKeys.forEach((rawDBKey, index) => {
    const optionRaw = question.options[rawDBKey];
    
    // Safely extract the string text from the dictionary object 
    const optionText = typeof optionRaw === 'object' && optionRaw !== null ? (optionRaw.text || "") : (optionRaw || "");
    if (!optionText) return; // Skip empty options

    const optionDiv = document.createElement("div");
    optionDiv.className = "answer-option";
    optionDiv.dataset.index = index;

    // Add selected class if this exact index was selected previously
    if (selectedIndex === index) {
      optionDiv.classList.add("selected");
    }

    // Add correct/incorrect classes if feedback exists (check by question ID)
    if (quizState.feedback[questionId]) {
      const feedbackData = quizState.feedback[questionId];
      if (rawDBKey === feedbackData.correctAnswer) {
        optionDiv.classList.add("correct");
      } else if (selectedIndex === index && !feedbackData.isCorrect) {
        optionDiv.classList.add("incorrect");
      }
    }

    // Escape HTML and use innerHTML to support LaTeX rendering
    optionDiv.innerHTML = `
      <div class="option-letter">${rawDBKey}</div>
      <div class="option-text">${parseSmilesTags(escapeHtml(optionText))}</div>
    `;

    // Only allow clicking if no feedback is shown for this DB question yet
    if (!quizState.feedback[questionId]) {
      optionDiv.addEventListener("click", () => selectAnswer(index, rawDBKey, questionIndex, questionId));
    }

    answerOptions.appendChild(optionDiv);
  });

  // Render LaTeX in options after they're added
  renderKatex();
}

async function selectAnswer(selectedIndex, rawDBKey, questionIndex, questionId) {
  // Disable all options immediately to prevent double-clicks during transit
  const options = document.querySelectorAll(".answer-option");
  options.forEach(option => {
    option.style.pointerEvents = "none";
  });

  try {
    // Validate answer securely on the server using its true index
    const response = await fetch(`/api/quiz/${quizState.currentQuiz}/question/${questionId}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedIndex })
    });
    
    if (!response.ok) throw new Error("Failed to check answer");
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    quizState.answers[questionId] = selectedIndex;
    
    // Store exact server-authoritative feedback payload
    quizState.feedback[questionId] = {
      isCorrect: result.isCorrect,
      selectedAnswer: selectedIndex,
      selectedKey: rawDBKey, // Store the raw A/B/C/D key for tracking
      correctAnswer: result.correctAnswer, // This will be the raw DB 'A', 'B' string
      feedbackText: result.feedback,
      correctOptionText: result.correctOptionText
    };

    // Enable next button now that an answer is selected
    document.getElementById("nextButton").disabled = false;

    // Show immediate feedback
    showFeedback(questionIndex, questionId, selectedIndex, result.correctAnswer);

    // Update highlighting immediately on all options
    options.forEach(option => {
      // Parse the embedded index from the dataset (e.g. 0-3)
      const index = parseInt(option.dataset.index, 10);
      const databaseKeys = ['A', 'B', 'C', 'D'];
      const optionKey = databaseKeys[index]; 

      option.classList.remove("selected", "correct", "incorrect");

      // Add correct class to the correct answer (only if it was returned)
      if (result.correctAnswer && optionKey === result.correctAnswer) {
        option.classList.add("correct");
      }

      // Add incorrect class to the selected wrong answer
      if (index === selectedIndex && !result.isCorrect) {
        option.classList.add("incorrect");
      }
    });

    // Update question indicators
    updateQuestionIndicators();

  } catch (error) {
    console.error("Error evaluating answer:", error);
    // Re-enable clicks so student can try again if the connection failed
    options.forEach(option => {
      option.style.pointerEvents = "auto";
    });
  }
}

function showFeedback(questionIndex, questionId, selectedIndex, correctAnswer) {
  const feedbackSection = document.getElementById("feedbackSection");
  const feedbackMessage = document.getElementById("feedbackMessage");
  const correctAnswerDisplay = document.getElementById("correctAnswerDisplay");
  const correctAnswerText = document.getElementById("correctAnswerText");

  // Retrieve perfectly mapped server feedback
  const feedbackData = quizState.feedback[questionId];
  if (!feedbackData) return;
  
  const isCorrect = feedbackData.isCorrect;
  const feedbackString = feedbackData.feedbackText || "";

  const formattedFeedbackHTML = feedbackString 
    ? `<div style="margin-top: 10px; font-weight: normal; font-size: 0.9em; color: #555;">${escapeHtml(feedbackString)}</div>` 
    : "";

  // Show feedback message only for correct answers
  if (isCorrect) {
    feedbackMessage.className = "feedback-message feedback-correct";
    feedbackMessage.innerHTML = `<i class="fas fa-check-circle"></i> Correct!${formattedFeedbackHTML}`;
    feedbackMessage.style.display = "block";
    correctAnswerDisplay.style.display = "none";
    feedbackSection.style.display = "block";
  } else {
    // For incorrect answers, show both the incorrect badge AND optionally the correct answer
    feedbackMessage.className = "feedback-message feedback-incorrect";
    feedbackMessage.innerHTML = `<i class="fas fa-times-circle"></i> Incorrect.${formattedFeedbackHTML}`;
    feedbackMessage.style.display = "block";

    // Stop displaying the correct answer to the student if they got it wrong
    correctAnswerDisplay.style.display = "none";
    feedbackSection.style.display = "block";
  }
  
  // Render LaTeX in the feedback section
  renderKatex();
}

function hideFeedback() {
  document.getElementById("feedbackSection").style.display = "none";
}

function updateQuestionIndicators() {
  const indicators = document.querySelectorAll(".question-indicator");
  indicators.forEach((indicator, index) => {
    indicator.classList.remove("current", "answered", "correct", "incorrect");

    if (index === quizState.currentQuestionIndex) {
      indicator.classList.add("current");
    }

    // Get question ID for this index
    const question = quizState.quizData.questions[index];
    const questionId = question?.id;

    if (questionId && quizState.answers[questionId]) {
      indicator.classList.add("answered");
      if (quizState.feedback[questionId]) {
        if (quizState.feedback[questionId].isCorrect) {
          indicator.classList.add("correct");
        } else {
          indicator.classList.add("incorrect");
        }
      }
    }
  });
}

function startTimer() {
  stopTimer();
  updateTimerDisplay(); // Initial update
  quizState.timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (quizState.timerInterval) {
    clearInterval(quizState.timerInterval);
    quizState.timerInterval = null;
  }
}

function updateTimerDisplay() {
  if (!quizState.startTime) return;
  
  const timerDisplay = document.getElementById("quizTimerDisplay");
  if (!timerDisplay) return;

  const elapsedMs = Date.now() - quizState.startTime;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  timerDisplay.textContent = formattedTime;
}

async function showCompletion() {
  // Stop the timer
  stopTimer();

  // Hide quiz content
  document.querySelector(".quiz-content").style.display = "none";
  document.querySelector(".quiz-navigation").style.display = "none";

  // Calculate stats using the exact server feedback 
  const totalQuestions = quizState.quizData.questions.length;
  let correctCount = 0;

  // quizState.feedback contains { isCorrect, ... } for every questionId answered
  Object.values(quizState.feedback).forEach(feedbackResult => {
    if (feedbackResult && feedbackResult.isCorrect) {
      correctCount++;
    }
  });

  const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  // Update completion section
  document.getElementById("correctCount").textContent = correctCount;
  document.getElementById("totalCount").textContent = totalQuestions;
  document.getElementById("scorePercentage").textContent = `${score}%`;

  // Submit quiz to backend and get achievements
  const newAchievements = await submitQuizToBackend(score, correctCount, totalQuestions);

  // Show achievements
  displayNewAchievements(newAchievements, score === 100);

  // Show completion section
  document.getElementById("completionSection").style.display = "block";
}

async function submitQuizToBackend(score, correctAnswers, totalQuestions) {
  if (!quizState.currentQuiz) {
    console.warn("Cannot submit quiz: missing quiz ID");
    return [];
  }

  const timeSpent = quizState.startTime ? (Date.now() - quizState.startTime) : 0;

  try {
    const response = await fetch(`/api/student/quizzes/${quizState.currentQuiz}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        answers: quizState.answers,
        feedback: quizState.feedback,
        score: score,
        correctAnswers: correctAnswers,
        totalQuestions: totalQuestions,
        timeSpent: timeSpent,
        sessionId: Date.now().toString()
      })
    });

    const data = await response.json();
    if (data.success && data.data) {
      return data.data.newAchievements || [];
    } else {
      console.error("Failed to submit quiz:", data.message);
      return [];
    }
  } catch (error) {
    console.error("Error submitting quiz:", error);
    return [];
  }
}

function displayNewAchievements(achievements, isPerfectScore) {
  const achievementBadge = document.getElementById("achievementBadge");

  if (!achievements || achievements.length === 0) {
    // No new achievements, but still show perfect score badge if applicable
    if (isPerfectScore) {
      achievementBadge.style.display = "block";
      achievementBadge.innerHTML = `
        <i class="fas fa-star"></i>
        <span>Perfect Score!</span>
      `;
    } else {
      achievementBadge.style.display = "none";
    }
    return;
  }

  // Display new achievements
  achievementBadge.style.display = "block";

  if (achievements.length === 1) {
    const achievement = achievements[0];
    achievementBadge.innerHTML = `
      <i class="${achievement.icon || 'fas fa-trophy'}"></i>
      <span>${escapeHtml(achievement.title)}</span>
    `;
  } else {
    // Multiple achievements
    achievementBadge.innerHTML = `
      <i class="fas fa-trophy"></i>
      <span>${achievements.length} New Achievements!</span>
    `;
  }

  // Show achievement notification
  showAchievementNotification(achievements);
}

function showAchievementNotification(achievements) {
  if (!achievements || achievements.length === 0) return;

  // Create notification container if it doesn't exist
  let notificationContainer = document.getElementById("achievementNotifications");
  if (!notificationContainer) {
    notificationContainer = document.createElement("div");
    notificationContainer.id = "achievementNotifications";
    notificationContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(notificationContainer);
  }

  achievements.forEach((achievement, index) => {
    setTimeout(() => {
      const notification = document.createElement("div");
      notification.className = "achievement-notification";
      notification.style.cssText = `
        background: linear-gradient(135deg, #2ecc71, #27ae60);
        color: white;
        padding: 15px 20px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        gap: 12px;
        animation: slideInRight 0.5s ease, fadeOut 0.5s ease 4.5s forwards;
        max-width: 350px;
      `;

      // Different colors for different achievement types
      if (achievement.type === 'quiz_perfect') {
        notification.style.background = "linear-gradient(135deg, #f1c40f, #f39c12)";
      }

      notification.innerHTML = `
        <i class="${achievement.icon || 'fas fa-trophy'}" style="font-size: 24px;"></i>
        <div>
          <div style="font-weight: 600; font-size: 14px;">Achievement Unlocked!</div>
          <div style="font-size: 16px; font-weight: 700;">${escapeHtml(achievement.title)}</div>
          <div style="font-size: 12px; opacity: 0.9;">${escapeHtml(achievement.description)}</div>
        </div>
      `;

      notificationContainer.appendChild(notification);

      // Remove notification after 5 seconds
      setTimeout(() => {
        notification.remove();
      }, 5000);
    }, index * 500); // Stagger notifications
  });

  // Add animation styles if not already present
  if (!document.getElementById("achievementAnimationStyles")) {
    const style = document.createElement("style");
    style.id = "achievementAnimationStyles";
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes fadeOut {
        from {
          opacity: 1;
        }
        to {
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Render LaTeX using KaTeX
function renderKatex() {
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement(document.body, {
      delimiters: [
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true }
      ],
      throwOnError: false // prevents crashing on bad LaTeX
    });
  }
}

// Export functions for use in HTML
window.quizApp = {
  startQuiz: startQuiz
};
