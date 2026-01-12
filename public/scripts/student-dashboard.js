// GRASP Student Dashboard JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Initialize student dashboard functionality
  initializeStudentDashboard();
});

function initializeStudentDashboard() {
  // Initialize shared navigation
  new window.GRASPNavigation();

  // Initialize student-specific functionality
  initializeStudentContent();

  // Initialize interactive elements
  initializeInteractiveElements();

  // Initialize filters and search
  initializeFilters();

  // Load quiz data
  loadQuizData();
}

function initializeStudentContent() {
  // Student-specific initialization logic
  console.log("Initializing student dashboard content...");

  // Set page title
  document.title = "My Quizzes - GRASP Student Dashboard";
}

function initializeInteractiveElements() {
  // Quiz cards
  const quizCards = document.querySelectorAll(".quiz-card");
  quizCards.forEach((card) => {
    card.addEventListener("click", function (e) {
      // Don't trigger if clicking on button
      if (e.target.classList.contains("quiz-button")) {
        return;
      }

      const quizTitle = this.querySelector("h3").textContent;
      console.log(`Quiz card clicked: ${quizTitle}`);
      // You could open a quiz preview modal here
    });
  });

  // Quiz buttons
  const quizButtons = document.querySelectorAll(".quiz-button");
  quizButtons.forEach((button) => {
    button.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevent card click event
      const action = this.textContent.trim();
      const quizCard = this.closest(".quiz-card");
      const quizTitle = quizCard.querySelector("h3").textContent;

      handleQuizAction(action, quizTitle);
    });
  });
}

function initializeFilters() {
  // Course filter
  const courseFilter = document.getElementById("courseFilter");
  if (courseFilter) {
    courseFilter.addEventListener("change", function () {
      const selectedCourse = this.value;
      filterQuizzes("course", selectedCourse);
    });
  }

  // Objective filter
  const objectiveFilter = document.getElementById("objectiveFilter");
  if (objectiveFilter) {
    objectiveFilter.addEventListener("change", function () {
      const selectedObjective = this.value;
      filterQuizzes("objective", selectedObjective);
    });
  }

  // Week filter
  const weekFilter = document.getElementById("weekFilter");
  if (weekFilter) {
    weekFilter.addEventListener("change", function () {
      const selectedWeek = this.value;
      filterQuizzes("week", selectedWeek);
    });
  }

  // Search functionality
  const quizSearch = document.getElementById("quizSearch");
  if (quizSearch) {
    quizSearch.addEventListener("input", function () {
      const searchTerm = this.value.toLowerCase();
      searchQuizzes(searchTerm);
    });
  }
}

function filterQuizzes(filterType, filterValue) {
  const quizCards = document.querySelectorAll(".quiz-card");

  quizCards.forEach((card) => {
    const cardValue = card.getAttribute(`data-${filterType}`);
    const shouldShow = filterValue === "all" || cardValue === filterValue;

    if (shouldShow) {
      card.style.display = "block";
      card.style.animation = "fadeInUp 0.3s ease-out";
    } else {
      card.style.display = "none";
    }
  });

  // Update visible count
  updateVisibleCount();
}

function searchQuizzes(searchTerm) {
  const quizCards = document.querySelectorAll(".quiz-card");

  quizCards.forEach((card) => {
    const quizTitle = card.querySelector("h3").textContent.toLowerCase();
    const shouldShow = quizTitle.includes(searchTerm);

    if (shouldShow) {
      card.style.display = "block";
      card.style.animation = "fadeInUp 0.3s ease-out";
    } else {
      card.style.display = "none";
    }
  });

  // Update visible count
  updateVisibleCount();
}

function updateVisibleCount() {
  const visibleCards = document.querySelectorAll(
    ".quiz-card[style*='block'], .quiz-card:not([style*='none'])"
  );
  console.log(`Showing ${visibleCards.length} quiz cards`);
}

function handleQuizAction(action, quizTitle) {
  console.log(`Quiz action: ${action} for ${quizTitle}`);

  switch (action.toLowerCase()) {
    case "start":
      startQuiz(quizTitle);
      break;
    case "continue":
      continueQuiz(quizTitle);
      break;
    case "review":
      reviewQuiz(quizTitle);
      break;
    default:
      console.log(`Unknown action: ${action}`);
  }
}

function startQuiz(quizId) {
  console.log(`Starting quiz: ${quizId}`);

  // Show loading state
  showLoadingState();

  // Call API to start quiz
  fetch(`/api/student/quizzes/${quizId}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      hideLoadingState();

      if (data.success) {
        showNotification(`Starting quiz: ${quizId}`, "success");

        // Navigate to the quiz page
        setTimeout(() => {
          window.location.href = `/quiz?quiz=${quizId}&session=${data.data.sessionId}`;
        }, 1000);
      } else {
        throw new Error(data.message);
      }
    })
    .catch((error) => {
      hideLoadingState();
      console.error("Error starting quiz:", error);
      showNotification(`Failed to start quiz: ${error.message}`, "error");
    });
}

function continueQuiz(quizTitle) {
  console.log(`Continuing quiz: ${quizTitle}`);

  showLoadingState();

  setTimeout(() => {
    hideLoadingState();
    showNotification(`Resuming quiz: ${quizTitle}`, "info");

    // You could redirect to the quiz page with resume state:
    // window.location.href = `quiz.html?quiz=${encodeURIComponent(quizTitle)}&resume=true`;
  }, 1000);
}

function reviewQuiz(quizId) {
  console.log(`Reviewing quiz: ${quizId}`);

  showLoadingState();

  // Call API to get quiz results
  fetch(`/api/student/quizzes/${quizId}/results`)
    .then((response) => response.json())
    .then((data) => {
      hideLoadingState();

      if (data.success) {
        showNotification(`Opening quiz review: ${quizId}`, "info");

        // In a real application, you would navigate to the review page
        // window.location.href = `quiz-review.html?quiz=${quizId}`;

        // For now, you could open a modal with the results
        console.log("Quiz results:", data.data);
      } else {
        throw new Error(data.message);
      }
    })
    .catch((error) => {
      hideLoadingState();
      console.error("Error fetching quiz results:", error);
      showNotification(`Failed to load quiz review: ${error.message}`, "error");
    });
}

function loadQuizData() {
  // Load quiz data from API
  console.log("Loading quiz data...");

  fetch("/api/student/quizzes")
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        renderQuizCards(data.data);
      } else {
        throw new Error(data.message);
      }
    })
    .catch((error) => {
      console.error("Error loading quiz data:", error);
      showNotification("Failed to load quiz data", "error");

      // Show empty state on error
      const quizGrid = document.getElementById("quizGrid");
      quizGrid.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <h3>Unable to Load Quizzes</h3>
          <p>There was an error loading your quizzes. Please try refreshing the page or contact support if the problem persists.</p>
        </div>
      `;
    });
}

function renderQuizCards(quizData) {
  const quizGrid = document.getElementById("quizGrid");

  if (!quizData || quizData.length === 0) {
    quizGrid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-question-circle"></i>
        <h3>No Quizzes Available</h3>
        <p>There are currently no quizzes available for you. Check back later or contact your instructor.</p>
      </div>
    `;
    return;
  }

  // Clear existing cards
  quizGrid.innerHTML = "";

  // Render quiz cards
  quizData.forEach((quiz, index) => {
    const quizCard = createQuizCard(quiz, index);
    quizGrid.appendChild(quizCard);
  });

  // Re-initialize interactive elements for new cards
  initializeInteractiveElements();
}

function createQuizCard(quiz, index) {
  const card = document.createElement("div");
  card.className = "quiz-card";
  card.setAttribute("data-course", quiz.course);
  card.setAttribute("data-objective", quiz.objective);
  card.setAttribute("data-week", quiz.week);
  card.style.animationDelay = `${index * 0.1}s`;

  const statusClass =
    quiz.completion === 100
      ? "completed"
      : quiz.completion > 0
      ? "partial"
      : "";

  card.innerHTML = `
    <div class="quiz-header">
      <h3>${quiz.title}</h3>
      <div class="quiz-status">
        <span class="attempt-status ${statusClass}">${
    quiz.completion
  }% attempted</span>
      </div>
    </div>
    <div class="quiz-content">
      <div class="quiz-info">
        <div class="info-item">
          <i class="fas fa-calendar"></i>
          <span>Due: ${quiz.dueDate}</span>
        </div>
        <div class="info-item">
          <i class="fas fa-clock"></i>
          <span>Time Limit: ${quiz.timeLimit}</span>
        </div>
        <div class="info-item">
          <i class="fas fa-question-circle"></i>
          <span>${quiz.questionCount} Questions</span>
        </div>
      </div>
    </div>
    <div class="quiz-actions">
      <button class="quiz-button ${
        quiz.completion === 100 ? "review-button" : "start-button"
      }" 
              onclick="${
                quiz.completion === 100 ? "reviewQuiz" : "startQuiz"
              }('${quiz.id}')">
        ${
          quiz.completion === 100
            ? "Review"
            : quiz.completion > 0
            ? "Continue"
            : "Start"
        }
      </button>
    </div>
  `;

  return card;
}

function showLoadingState() {
  const quizGrid = document.getElementById("quizGrid");
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "loading-state";
  loadingDiv.innerHTML = `
    <div class="loading-spinner"></div>
  `;

  quizGrid.appendChild(loadingDiv);
}

function hideLoadingState() {
  const loadingState = document.querySelector(".loading-state");
  if (loadingState) {
    loadingState.remove();
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
window.GRASPStudentDashboard = {
  startQuiz,
  continueQuiz,
  reviewQuiz,
  filterQuizzes,
  searchQuizzes,
  showNotification,
};
