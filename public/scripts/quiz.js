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
  quizData: null,
  userId: null,
  courseId: null
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

    // Fetch quizzes and achievements in parallel
    const [quizzesResponse, achievementsResponse] = await Promise.all([
      fetch(`/api/quiz/course/${quizState.courseId}`),
      fetch(`/api/achievement/my?courseId=${quizState.courseId}`)
    ]);
    
    const quizzesData = await quizzesResponse.json();
    let userAchievements = [];
    
    if (achievementsResponse.ok) {
      const achievementsData = await achievementsResponse.json();
      if (achievementsData.success && achievementsData.data) {
        userAchievements = achievementsData.data;
      }
    }

    if (quizzesData.success && quizzesData.quizzes) {
      // Filter to only show published quizzes
      const publishedQuizzes = quizzesData.quizzes.filter(quiz => quiz.published === true);
      
      if (publishedQuizzes.length === 0) {
        showEmptyState("No published quizzes available for this course.");
      } else {
        // Fetch question counts for each quiz and attach achievements
        const quizzesWithDetails = await Promise.all(
          publishedQuizzes.map(async (quiz) => {
            const quizId = quiz._id ? (quiz._id.toString ? quiz._id.toString() : String(quiz._id)) : String(quiz.id || "");
            let questionCount = 0;
            
            try {
              // Get approved questions count (for students)
              const questionsResponse = await fetch(`/api/quiz/${quizId}/questions?approvedOnly=true`);
              if (questionsResponse.ok) {
                const questionsData = await questionsResponse.json();
                if (questionsData.success && questionsData.questions) {
                  questionCount = questionsData.questions.length;
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

  quizState.quizzes.forEach(quiz => {
    const quizCard = createQuizCard(quiz);
    quizGrid.appendChild(quizCard);
  });

  document.getElementById("quizGrid").style.display = "grid";
  document.getElementById("emptyState").style.display = "none";
}

function createQuizCard(quiz) {
  const card = document.createElement("div");
  card.className = "quiz-card";
  
  const quizId = quiz._id ? (quiz._id.toString ? quiz._id.toString() : String(quiz._id)) : String(quiz.id || "");
  
  // Check for achievements
  const achievements = quiz.achievements || [];
  const hasCompleted = achievements.some(a => a.type === 'quiz_completed');
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
          <i class="fas fa-calendar"></i>
          Created: ${quiz.createdAt ? new Date(quiz.createdAt).toLocaleDateString() : "Unknown"}
        </span>
        <span class="quiz-question-count">
          <i class="fas fa-question-circle"></i>
          ${quiz.questionCount || 0} Question${(quiz.questionCount || 0) !== 1 ? 's' : ''}
        </span>
      </div>
      ${achievements.length > 0 ? `
        <div class="quiz-card-achievements-detail">
          ${hasCompleted ? `<span class="achievement-detail completed"><i class="fas fa-check-circle"></i> Completed</span>` : ''}
          ${hasPerfect ? `<span class="achievement-detail perfect"><i class="fas fa-star"></i> Perfect Score</span>` : ''}
        </div>
      ` : ''}
    </div>
    <div class="quiz-card-actions">
      <button class="start-quiz-button" onclick="window.quizApp.startQuiz('${quizId}')">
        <i class="fas fa-play"></i>
        ${hasCompleted ? 'Retake Quiz' : 'Start Quiz'}
      </button>
    </div>
  `;

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

    // Load quiz questions
    const response = await fetch(`/api/student/quizzes/${quizId}/questions`);
    const data = await response.json();

    if (data.success && data.data) {
      quizState.currentQuiz = quizId;
      quizState.quizData = data.data;
      quizState.currentQuestionIndex = 0;
      quizState.answers = {};
      quizState.feedback = {};

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
      throw new Error(data.message || "Failed to load quiz");
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
  if (!quizState.currentQuiz || !quizState.quizData) {
    console.error("Cannot restart: No quiz loaded");
    return;
  }

  // Reset quiz state but keep the quiz data
  quizState.currentQuestionIndex = 0;
  quizState.answers = {};
  quizState.feedback = {};

  // Hide completion section and show quiz content
  document.getElementById("completionSection").style.display = "none";
  document.querySelector(".quiz-content").style.display = "block";
  document.querySelector(".quiz-navigation").style.display = "flex";

  // Show first question
  showQuestion(0);
}

function renderQuiz() {
  // Update quiz header
  document.getElementById("quizTitle").textContent = quizState.quizData.title || "Quiz";
  document.getElementById("quizCourse").textContent = quizState.quizData.course || "Course";
  document.getElementById("totalQuestions").textContent = quizState.quizData.questions.length;

  // Generate question indicators
  generateQuestionIndicators();
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
  const questionTextElement = document.getElementById("questionText");
  questionTextElement.innerHTML = escapeHtml(question.question || "Question text not available");
  document.getElementById("currentQuestion").textContent = questionIndex + 1;

  // Update progress bar
  const progress = ((questionIndex + 1) / quizState.quizData.questions.length) * 100;
  document.getElementById("progressFill").style.width = `${progress}%`;

  // Update answer options
  renderAnswerOptions(question, questionIndex);

    // Show feedback if answer was already selected (check by question ID)
    const questionId = question.id;
    if (quizState.feedback[questionId]) {
      showFeedback(questionIndex, questionId, quizState.answers[questionId], question.correctAnswer);
    } else {
      hideFeedback();
    }

    // Render LaTeX after content is updated
    renderKatex();

    // Update navigation buttons
  document.getElementById("prevButton").disabled = questionIndex === 0;
  document.getElementById("nextButton").textContent = questionIndex === quizState.quizData.questions.length - 1 ? "Finish" : "Next";
  document.getElementById("nextButton").innerHTML = questionIndex === quizState.quizData.questions.length - 1 
    ? "Finish <i class=\"fas fa-check\"></i>" 
    : "Next <i class=\"fas fa-chevron-right\"></i>";

  // Update question indicators
  updateQuestionIndicators();
}

function renderAnswerOptions(question, questionIndex) {
  const answerOptions = document.getElementById("answerOptions");
  answerOptions.innerHTML = "";

  const optionKeys = ['A', 'B', 'C', 'D'];
  const questionId = question.id;
  const selectedAnswer = quizState.answers[questionId];

  optionKeys.forEach(optionKey => {
    const optionText = question.options[optionKey] || "";
    if (!optionText) return; // Skip empty options

    const optionDiv = document.createElement("div");
    optionDiv.className = "answer-option";
    optionDiv.dataset.option = optionKey;
    
    // Add selected class if this option was selected
    if (selectedAnswer === optionKey) {
      optionDiv.classList.add("selected");
    }

    // Add correct/incorrect classes if feedback exists (check by question ID)
    if (quizState.feedback[questionId]) {
      if (optionKey === question.correctAnswer) {
        optionDiv.classList.add("correct");
      } else if (selectedAnswer === optionKey && selectedAnswer !== question.correctAnswer) {
        optionDiv.classList.add("incorrect");
      }
    }

    // Escape HTML and use innerHTML to support LaTeX rendering
    const escapedOptionText = escapeHtml(optionText);
    optionDiv.innerHTML = `
      <div class="option-letter">${optionKey}</div>
      <div class="option-text">${escapedOptionText}</div>
    `;

    // Only allow selection if not already answered
    if (!quizState.feedback[questionId]) {
      optionDiv.addEventListener("click", () => selectAnswer(optionKey, questionIndex, questionId, question.correctAnswer));
    }

    answerOptions.appendChild(optionDiv);
  });
  
  // Render LaTeX in options after they're added
  renderKatex();
}

function selectAnswer(selectedOption, questionIndex, questionId, correctAnswer) {
  // Store answer by question ID (not index) to handle shuffled questions
  quizState.answers[questionId] = selectedOption;

  // Show immediate feedback
  showFeedback(questionIndex, questionId, selectedOption, correctAnswer);

  // Update highlighting immediately on all options
  const options = document.querySelectorAll(".answer-option");
  options.forEach(option => {
    const optionKey = option.dataset.option;
    
    // Remove existing classes
    option.classList.remove("selected", "correct", "incorrect");
    
    // Add correct class to the correct answer
    if (optionKey === correctAnswer) {
      option.classList.add("correct");
    }
    
    // Add incorrect class to the selected wrong answer
    if (optionKey === selectedOption && selectedOption !== correctAnswer) {
      option.classList.add("incorrect");
    }
    
    // Disable pointer events
    option.style.pointerEvents = "none";
  });

  // Update question indicators
  updateQuestionIndicators();
}

function showFeedback(questionIndex, questionId, selectedAnswer, correctAnswer) {
  const feedbackSection = document.getElementById("feedbackSection");
  const feedbackMessage = document.getElementById("feedbackMessage");
  const correctAnswerDisplay = document.getElementById("correctAnswerDisplay");
  const correctAnswerText = document.getElementById("correctAnswerText");

  const isCorrect = selectedAnswer === correctAnswer;
  
  // Store feedback by question ID
  quizState.feedback[questionId] = {
    isCorrect: isCorrect,
    selectedAnswer: selectedAnswer,
    correctAnswer: correctAnswer
  };

  // Show feedback message only for correct answers
  if (isCorrect) {
    feedbackMessage.className = "feedback-message feedback-correct";
    feedbackMessage.innerHTML = '<i class="fas fa-check-circle"></i> Correct!';
    feedbackMessage.style.display = "block";
    correctAnswerDisplay.style.display = "none";
    feedbackSection.style.display = "block";
  } else {
    // For incorrect answers, hide the feedback message and just show the correct answer
    feedbackMessage.style.display = "none";
    
    // Show correct answer (with LaTeX support)
    const correctOptionText = quizState.quizData.questions[questionIndex].options[correctAnswer] || correctAnswer;
    correctAnswerText.innerHTML = `${correctAnswer}: ${escapeHtml(correctOptionText)}`;
    correctAnswerDisplay.style.display = "block";
    feedbackSection.style.display = "block";
    
    // Render LaTeX in the feedback section
    renderKatex();
  }
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

async function showCompletion() {
  // Hide quiz content
  document.querySelector(".quiz-content").style.display = "none";
  document.querySelector(".quiz-navigation").style.display = "none";

  // Calculate stats using question IDs
  let correctCount = 0;
  const totalQuestions = quizState.quizData.questions.length;

  quizState.quizData.questions.forEach((question) => {
    const questionId = question.id;
    if (quizState.feedback[questionId] && quizState.feedback[questionId].isCorrect) {
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

  try {
    const response = await fetch(`/api/student/quizzes/${quizState.currentQuiz}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        answers: quizState.answers,
        score: score,
        correctAnswers: correctAnswers,
        totalQuestions: totalQuestions,
        timeSpent: 0,
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
