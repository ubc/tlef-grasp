// GRASP Quiz JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Initialize quiz functionality
  initializeQuiz();
});

function initializeQuiz() {
  // Initialize shared navigation
  new window.GRASPNavigation();

  // Initialize quiz-specific functionality
  initializeQuizContent();

  // Initialize interactive elements
  initializeInteractiveElements();

  // Load quiz data
  loadQuizData();
}

function initializeQuizContent() {
  // Quiz-specific initialization logic
  console.log("Initializing quiz content...");

  // Set page title
  document.title = "Quiz - GRASP";

  // Get quiz parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  window.quizState = {
    quizId: urlParams.get("quiz") || "CS101-Lecture3",
    sessionId: urlParams.get("session") || `session_${Date.now()}`,
    currentQuestionIndex: 0,
    answers: {},
    startTime: Date.now(),
    timerInterval: null,
    quizData: null,
  };

  console.log(
    `Quiz ID: ${window.quizState.quizId}, Session ID: ${window.quizState.sessionId}`
  );
}

function initializeInteractiveElements() {
  // Answer options
  const answerOptions = document.querySelectorAll(".answer-option");
  answerOptions.forEach((option) => {
    option.addEventListener("click", function () {
      selectAnswer(this);
    });
  });

  // Navigation buttons
  const prevButton = document.getElementById("prevButton");
  const nextButton = document.getElementById("nextButton");

  if (prevButton) {
    prevButton.addEventListener("click", goToPreviousQuestion);
  }

  if (nextButton) {
    nextButton.addEventListener("click", goToNextQuestion);
  }

  // Submit button
  const submitButton = document.getElementById("submitButton");
  if (submitButton) {
    submitButton.addEventListener("click", showSubmitModal);
  }

  // Modal controls
  const modalOverlay = document.getElementById("modalOverlay");
  const modalClose = document.getElementById("modalClose");
  const cancelSubmit = document.getElementById("cancelSubmit");
  const confirmSubmit = document.getElementById("confirmSubmit");

  if (modalClose) {
    modalClose.addEventListener("click", hideSubmitModal);
  }

  if (cancelSubmit) {
    cancelSubmit.addEventListener("click", hideSubmitModal);
  }

  if (confirmSubmit) {
    confirmSubmit.addEventListener("click", submitQuiz);
  }

  // Close modal when clicking overlay
  if (modalOverlay) {
    modalOverlay.addEventListener("click", function (e) {
      if (e.target === modalOverlay) {
        hideSubmitModal();
      }
    });
  }

  // Keyboard navigation
  document.addEventListener("keydown", handleKeyboardNavigation);
}

function loadQuizData() {
  // Load quiz data from API
  console.log("Loading quiz data...");

  fetch(`/api/student/quizzes/${window.quizState.quizId}/questions`)
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        // Initialize quiz state
        window.quizState.quizData = data.data;
        window.quizState.currentQuestionIndex = 0;
        window.quizState.answers = {};
        window.quizState.startTime = Date.now();
        window.quizState.timerInterval = null;

        // Render quiz
        renderQuiz();

        // Start timer
        startTimer();
      } else {
        throw new Error(data.message);
      }
    })
    .catch((error) => {
      console.error("Error loading quiz data:", error);
      showNotification("Failed to load quiz data", "error");

      // Show error state
      const quizContainer = document.querySelector(".quiz-container");
      if (quizContainer) {
        quizContainer.innerHTML = `
          <div class="error-state">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Unable to Load Quiz</h3>
            <p>There was an error loading the quiz. Please try refreshing the page or contact support if the problem persists.</p>
            <button onclick="window.location.href='/student-dashboard'" class="retry-button">
              Return to Dashboard
            </button>
          </div>
        `;
      }
    });
}

function renderQuiz() {
  // Update quiz header
  document.getElementById("quizTitle").textContent =
    window.quizState.quizData.title;
  document.getElementById("quizCourse").textContent =
    window.quizState.quizData.course;
  document.getElementById(
    "quizDuration"
  ).textContent = `${window.quizState.quizData.duration} minutes`;
  document.getElementById("totalQuestions").textContent =
    window.quizState.quizData.questions.length;

  // Generate question indicators
  generateQuestionIndicators();

  // Show first question
  showQuestion(0);
}

function generateQuestionIndicators() {
  const indicatorsContainer = document.getElementById("questionIndicators");
  indicatorsContainer.innerHTML = "";

  window.quizState.quizData.questions.forEach((_, index) => {
    const indicator = document.createElement("div");
    indicator.className = "question-indicator";
    indicator.addEventListener("click", () => goToQuestion(index));
    indicatorsContainer.appendChild(indicator);
  });
}

function showQuestion(questionIndex) {
  const question = window.quizState.quizData.questions[questionIndex];

  // Update question number and text
  document.getElementById("questionNumber").textContent = `Question ${
    questionIndex + 1
  }`;
  document.getElementById("questionText").textContent = question.question;
  document.getElementById("currentQuestion").textContent = questionIndex + 1;

  // Update progress bar
  const progress =
    ((questionIndex + 1) / window.quizState.quizData.questions.length) * 100;
  document.getElementById("progressFill").style.width = `${progress}%`;

  // Update answer options
  const answerOptions = document.getElementById("answerOptions");
  answerOptions.innerHTML = "";

  question.options.forEach((option) => {
    const optionElement = document.createElement("div");
    optionElement.className = "answer-option";
    optionElement.setAttribute("data-option", option.letter);

    optionElement.innerHTML = `
      <div class="option-letter">${option.letter}</div>
      <div class="option-text">${option.text}</div>
    `;

    optionElement.addEventListener("click", function () {
      selectAnswer(this);
    });

    answerOptions.appendChild(optionElement);
  });

  // Update question indicators
  updateQuestionIndicators();

  // Update navigation buttons
  updateNavigationButtons();

  // Check if this is the last question
  if (questionIndex === window.quizState.quizData.questions.length - 1) {
    showSubmitSection();
  } else {
    hideSubmitSection();
  }

  // Always update submit section if it's visible (for answered count)
  const submitSection = document.getElementById("submitSection");
  if (submitSection && submitSection.style.display !== "none") {
    updateSubmitSection();
  }

  // Restore previous answer if exists
  if (window.quizState.answers[questionIndex]) {
    const selectedOption = document.querySelector(
      `[data-option="${window.quizState.answers[questionIndex]}"]`
    );
    if (selectedOption) {
      selectedOption.classList.add("selected");
    }
  }
}

function selectAnswer(optionElement) {
  // Remove selection from all options
  const allOptions = document.querySelectorAll(".answer-option");
  allOptions.forEach((option) => option.classList.remove("selected"));

  // Add selection to clicked option
  optionElement.classList.add("selected");

  // Store answer
  const selectedOption = optionElement.getAttribute("data-option");
  window.quizState.answers[window.quizState.currentQuestionIndex] =
    selectedOption;

  // Update question indicators
  updateQuestionIndicators();

  // Update submit section if visible
  const submitSection = document.getElementById("submitSection");
  if (submitSection && submitSection.style.display !== "none") {
    updateSubmitSection();
  }

  // Enable next button
  const nextButton = document.getElementById("nextButton");
  if (nextButton) {
    nextButton.disabled = false;
  }
}

function updateQuestionIndicators() {
  const indicators = document.querySelectorAll(".question-indicator");

  indicators.forEach((indicator, index) => {
    indicator.classList.remove("current", "answered");

    if (index === window.quizState.currentQuestionIndex) {
      indicator.classList.add("current");
    } else if (window.quizState.answers[index]) {
      indicator.classList.add("answered");
    }
  });
}

function updateNavigationButtons() {
  const prevButton = document.getElementById("prevButton");
  const nextButton = document.getElementById("nextButton");

  // Previous button
  if (prevButton) {
    prevButton.disabled = window.quizState.currentQuestionIndex === 0;
  }

  // Next button
  if (nextButton) {
    nextButton.disabled =
      window.quizState.currentQuestionIndex ===
      window.quizState.quizData.questions.length - 1;
  }
}

function goToPreviousQuestion() {
  if (window.quizState.currentQuestionIndex > 0) {
    window.quizState.currentQuestionIndex--;
    showQuestion(window.quizState.currentQuestionIndex);
  }
}

function goToNextQuestion() {
  if (
    window.quizState.currentQuestionIndex <
    window.quizState.quizData.questions.length - 1
  ) {
    window.quizState.currentQuestionIndex++;
    showQuestion(window.quizState.currentQuestionIndex);
  }
}

function goToQuestion(questionIndex) {
  if (
    questionIndex >= 0 &&
    questionIndex < window.quizState.quizData.questions.length
  ) {
    window.quizState.currentQuestionIndex = questionIndex;
    showQuestion(window.quizState.currentQuestionIndex);
  }
}

function showSubmitSection() {
  const submitSection = document.getElementById("submitSection");
  if (submitSection) {
    submitSection.style.display = "flex";
    updateSubmitSection();
  }
}

function updateSubmitSection() {
  // Update answered count
  const answeredCount = Object.keys(window.quizState.answers).length;
  document.getElementById("answeredCount").textContent = answeredCount;
  document.getElementById("totalCount").textContent =
    window.quizState.quizData.questions.length;
}

function hideSubmitSection() {
  const submitSection = document.getElementById("submitSection");
  if (submitSection) {
    submitSection.style.display = "none";
  }
}

function startTimer() {
  window.quizState.timerInterval = setInterval(() => {
    updateTimer();
  }, 1000);
}

function updateTimer() {
  const elapsed = Date.now() - window.quizState.startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  const timeString = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  const timerElement = document.getElementById("timer");
  if (timerElement) {
    timerElement.textContent = timeString;
  }

  // Check if time limit exceeded
  const timeLimitMs = window.quizState.quizData.duration * 60 * 1000;
  if (elapsed >= timeLimitMs) {
    timeUp();
  }
}

function timeUp() {
  clearInterval(window.quizState.timerInterval);

  // Show time up notification
  showNotification(
    "Time's up! Your quiz will be submitted automatically.",
    "warning"
  );

  // Auto-submit after 3 seconds
  setTimeout(() => {
    submitQuiz();
  }, 3000);
}

function showSubmitModal() {
  const modalOverlay = document.getElementById("modalOverlay");
  const answeredCount = Object.keys(window.quizState.answers).length;
  const timeSpent = document.getElementById("timer").textContent;

  // Update modal content
  document.getElementById("modalAnsweredCount").textContent = answeredCount;
  document.getElementById("modalTimeSpent").textContent = timeSpent;

  // Show modal
  if (modalOverlay) {
    modalOverlay.style.display = "flex";
  }
}

function hideSubmitModal() {
  const modalOverlay = document.getElementById("modalOverlay");
  if (modalOverlay) {
    modalOverlay.style.display = "none";
  }
}

function submitQuiz() {
  console.log("Submitting quiz...");

  // Clear timer
  clearInterval(window.quizState.timerInterval);

  // Show loading state
  showLoadingState();

  // Prepare submission data
  const submissionData = {
    quizId: window.quizState.quizId,
    sessionId: window.quizState.sessionId,
    answers: window.quizState.answers,
    timeSpent: Date.now() - window.quizState.startTime,
    submittedAt: new Date().toISOString(),
  };

  // Submit to the API
  fetch(`/api/student/quizzes/${window.quizState.quizId}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(submissionData),
  })
    .then((response) => response.json())
    .then((data) => {
      hideLoadingState();
      hideSubmitModal();

      if (data.success) {
        showNotification("Quiz submitted successfully!", "success");

        // Redirect to quiz summary page after 2 seconds
        setTimeout(() => {
          window.location.href = `/quiz-summary?quiz=${window.quizState.quizId}&session=${window.quizState.sessionId}`;
        }, 2000);
      } else {
        throw new Error(data.message);
      }
    })
    .catch((error) => {
      hideLoadingState();
      console.error("Error submitting quiz:", error);
      showNotification(`Failed to submit quiz: ${error.message}`, "error");
    });
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
    case "1":
    case "2":
    case "3":
    case "4":
      e.preventDefault();
      const optionIndex = parseInt(e.key) - 1;
      const options = document.querySelectorAll(".answer-option");
      if (options[optionIndex]) {
        selectAnswer(options[optionIndex]);
      }
      break;
    case "Enter":
      e.preventDefault();
      const nextButton = document.getElementById("nextButton");
      if (nextButton && !nextButton.disabled) {
        goToNextQuestion();
      } else {
        showSubmitModal();
      }
      break;
    case "Escape":
      e.preventDefault();
      hideSubmitModal();
      break;
  }
}

function showLoadingState() {
  const quizContainer = document.querySelector(".quiz-container");
  if (quizContainer) {
    quizContainer.classList.add("loading");
  }
}

function hideLoadingState() {
  const quizContainer = document.querySelector(".quiz-container");
  if (quizContainer) {
    quizContainer.classList.remove("loading");
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
window.GRASPQuiz = {
  goToNextQuestion,
  goToPreviousQuestion,
  goToQuestion,
  selectAnswer,
  submitQuiz,
  showNotification,
};
