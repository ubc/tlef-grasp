// GRASP Quiz Summary JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Initialize quiz summary functionality
  initializeQuizSummary();
});

function initializeQuizSummary() {
  // Initialize shared navigation
  new window.GRASPNavigation();

  // Initialize quiz summary-specific functionality
  initializeQuizSummaryContent();

  // Initialize interactive elements
  initializeInteractiveElements();

  // Load quiz summary data
  loadQuizSummaryData();
}

function initializeQuizSummaryContent() {
  // Quiz summary-specific initialization logic
  console.log("Initializing quiz summary content...");

  // Set page title
  document.title = "Quiz Summary - GRASP";

  // Get quiz parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  window.quizSummaryState = {
    quizId: urlParams.get("quiz") || "CS101-Lecture3",
    sessionId: urlParams.get("session") || `session_${Date.now()}`,
    currentQuestionIndex: 0,
    quizSummary: null,
  };

  console.log(
    `Quiz ID: ${window.quizSummaryState.quizId}, Session ID: ${window.quizSummaryState.sessionId}`
  );
}

function initializeInteractiveElements() {
  // Question indicators
  const questionIndicators = document.querySelectorAll(".question-indicator");
  questionIndicators.forEach((indicator, index) => {
    indicator.addEventListener("click", () => {
      goToQuestion(index);
    });
  });

  // Navigation buttons
  const prevButton = document.getElementById("prevQuestionButton");
  const nextButton = document.getElementById("nextQuestionButton");

  if (prevButton) {
    prevButton.addEventListener("click", goToPreviousQuestion);
  }

  if (nextButton) {
    nextButton.addEventListener("click", goToNextQuestion);
  }

  // Keyboard navigation
  document.addEventListener("keydown", handleKeyboardNavigation);
}

function loadQuizSummaryData() {
  // Load quiz summary data from API
  console.log("Loading quiz summary data...");

  fetch(`/api/student/quizzes/${window.quizSummaryState.quizId}/results`)
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // Initialize quiz summary state
        window.quizSummaryState.quizSummary = data.data;
        window.quizSummaryState.currentQuestionIndex = 0;

        // Render quiz summary
        renderQuizSummary();
      } else {
        throw new Error(data.message);
      }
    })
    .catch((error) => {
      console.error("Error loading quiz summary data:", error);
      showNotification("Failed to load quiz summary", "error");

      // Show error state
      const container = document.querySelector(".quiz-summary-container");
      if (container) {
        container.innerHTML = `
          <div class="error-state">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Unable to Load Quiz Summary</h3>
            <p>There was an error loading the quiz summary. Please try refreshing the page or contact support if the problem persists.</p>
            <button id="retryErrorButton" class="retry-button">
              Return to Dashboard
            </button>
          </div>
        `;

        const retryButton = document.getElementById("retryErrorButton");
        if (retryButton) {
          retryButton.addEventListener("click", () => {
            window.location.href = '/student-dashboard';
          });
        }
      }
    });
}

function renderQuizSummary() {
  // Update score display
  document.getElementById(
    "scoreFraction"
  ).textContent = `${window.quizSummaryState.quizSummary.correctAnswers}/${window.quizSummaryState.quizSummary.totalQuestions}`;
  document.getElementById(
    "scorePercentage"
  ).textContent = `${window.quizSummaryState.quizSummary.score}% Score`;

  // Update summary details
  const completedDate =
    new Date(
      window.quizSummaryState.quizSummary.completedAt
    ).toLocaleDateString("en-CA") +
    " " +
    new Date(window.quizSummaryState.quizSummary.completedAt)
      .toLocaleTimeString("en-US", { hour12: false })
      .substring(0, 5);
  document.getElementById("completedDate").textContent = completedDate;
  document.getElementById("attemptNumber").textContent = "#1"; // This would come from the API

  // Generate question indicators
  generateQuestionIndicators();

  // Show first question
  showQuestion(0);
}

function generateQuestionIndicators() {
  const indicatorsContainer = document.getElementById("questionIndicators");
  indicatorsContainer.innerHTML = "";

  window.quizSummaryState.quizSummary.questions.forEach((question, index) => {
    const indicator = document.createElement("div");
    indicator.className = "question-indicator";

    if (question.isCorrect) {
      indicator.classList.add("correct");
      indicator.innerHTML = '<i class="fas fa-check"></i>';
    } else {
      indicator.classList.add("incorrect");
      indicator.innerHTML = '<i class="fas fa-times"></i>';
    }

    indicator.addEventListener("click", () => goToQuestion(index));
    indicatorsContainer.appendChild(indicator);
  });
}

function showQuestion(questionIndex) {
  const question = window.quizSummaryState.quizSummary.questions[questionIndex];

  // Update question title
  document.getElementById("questionTitle").textContent = `Question ${questionIndex + 1
    } of ${window.quizSummaryState.quizSummary.totalQuestions}`;

  // Update question text
  document.getElementById("questionText").textContent = question.question;

  // Update status badge
  const statusBadge = document.getElementById("statusBadge");
  statusBadge.textContent = question.isCorrect ? "Correct" : "Incorrect";
  statusBadge.className = `status-badge ${question.isCorrect ? "correct" : "incorrect"
    }`;

  // Update user answer
  document.getElementById("userAnswer").textContent = question.userAnswer;

  // Update feedback
  document.getElementById("feedback").textContent = question.explanation;

  // Update question indicators
  updateQuestionIndicators();

  // Update navigation buttons
  updateNavigationButtons();
}

function updateQuestionIndicators() {
  const indicators = document.querySelectorAll(".question-indicator");

  indicators.forEach((indicator, index) => {
    indicator.classList.remove("current");

    if (index === window.quizSummaryState.currentQuestionIndex) {
      indicator.classList.add("current");
    }
  });
}

function updateNavigationButtons() {
  const prevButton = document.getElementById("prevQuestionButton");
  const nextButton = document.getElementById("nextQuestionButton");

  // Previous button
  if (prevButton) {
    prevButton.disabled = window.quizSummaryState.currentQuestionIndex === 0;
  }

  // Next button
  if (nextButton) {
    nextButton.disabled =
      window.quizSummaryState.currentQuestionIndex ===
      window.quizSummaryState.quizSummary.questions.length - 1;
  }
}

function goToPreviousQuestion() {
  if (window.quizSummaryState.currentQuestionIndex > 0) {
    window.quizSummaryState.currentQuestionIndex--;
    showQuestion(window.quizSummaryState.currentQuestionIndex);
  }
}

function goToNextQuestion() {
  if (
    window.quizSummaryState.currentQuestionIndex <
    window.quizSummaryState.quizSummary.questions.length - 1
  ) {
    window.quizSummaryState.currentQuestionIndex++;
    showQuestion(window.quizSummaryState.currentQuestionIndex);
  }
}

function goToQuestion(questionIndex) {
  if (
    questionIndex >= 0 &&
    questionIndex < window.quizSummaryState.quizSummary.questions.length
  ) {
    window.quizSummaryState.currentQuestionIndex = questionIndex;
    showQuestion(window.quizSummaryState.currentQuestionIndex);
  }
}

function handleKeyboardNavigation(e) {
  // Handle keyboard shortcuts
  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      goToPreviousQuestion();
      break;
    case "ArrowRight":
      e.preventDefault();
      goToNextQuestion();
      break;
    case "Escape":
      e.preventDefault();
      // Return to dashboard
      window.location.href = "/student-dashboard";
      break;
  }
}

function showNotification(message, type = "info") {
  // Use the notification system from navigation.js if available
  if (
    window.GRASPNavigation &&
    window.GRASPNavigation.prototype.showNotification
  ) {
    const nav = new window.GRASPNavigation();
    nav.showNotification(message, type);
  } else {
    // Fallback notification
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
      animation: slideIn 0.3s ease-out;
    `;

    // Set background color based on type
    switch (type) {
      case "success":
        notification.style.backgroundColor = "#27ae60";
        break;
      case "error":
        notification.style.backgroundColor = "#e74c3c";
        break;
      case "warning":
        notification.style.backgroundColor = "#f39c12";
        break;
      default:
        notification.style.backgroundColor = "#3498db";
    }

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = "slideOut 0.3s ease-in";
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

// Export functions for potential external use
window.GRASPQuizSummary = {
  goToNextQuestion,
  goToPreviousQuestion,
  goToQuestion,
  showNotification,
};
