// GRASP Dashboard JavaScript - Dynamic Data Loading
document.addEventListener("DOMContentLoaded", function () {
  // Initialize dashboard functionality
  initializeDashboard();
});

async function initializeDashboard() {
  try {
    // Initialize shared navigation
    new window.GRASPNavigation();

    // Load user data from onboarding
    await loadUserData();

    // Initialize dashboard-specific functionality
    initializeDashboardContent();

    // Initialize interactive elements
    initializeInteractiveElements();

    // Update current date
    updateCurrentDate();

    // Initialize progress animations
    initializeProgressAnimations();
  } catch (error) {
    console.error("Error initializing dashboard:", error);
  }
}

async function loadUserData() {
  try {
    const response = await fetch("/api/current-user");
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.user) {
        updateWelcomeMessage(data.user.displayName);
      }
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Error loading user data:", error);
  }
}

function updateWelcomeMessage(instructorName) {
  const welcomeElement = document.getElementById("welcome-message");
  if (welcomeElement && instructorName) {
    welcomeElement.textContent = `Hello, ${instructorName}`;
  }
}

function showEmptyStates() {
  // Show empty states for all sections
  // (Generation and Review sections removed)
}

async function initializeDashboardContent() {
  // Dashboard-specific initialization logic
  console.log("Initializing dashboard content...");
  
  // Load flagged questions count
  await loadFlaggedQuestionsCount();
}

function initializeInteractiveElements() {
  // Quick start cards
  const quickStartCards = document.querySelectorAll(".quick-start-card");
  quickStartCards.forEach((card) => {
    card.addEventListener("click", function () {
      const action = this.querySelector("span").textContent;
      handleQuickStartAction(action);
    });
  });
}

function handleQuickStartAction(action) {
  console.log(`Quick start action: ${action}`);

  switch (action.toLowerCase()) {
    case "upload":
      // Navigate to course materials page
      window.location.href = "/course-materials";
      break;
    case "review":
      // Navigate to question review page
      window.location.href = "/question-bank?tab=review";
      break;
    case "quizzes":
      // Navigate to quiz page
      window.location.href = "/quiz";
      break;
    case "questions":
      // Navigate to question generation page
      window.location.href = "/question-bank";
      break;
    default:
      console.log(`Unknown action: ${action}`);
  }
}

function updateCurrentDate() {
  const dateElement = document.getElementById("current-date");
  if (dateElement) {
    const now = new Date();
    const options = { weekday: "long", month: "long", day: "numeric" };
    const formattedDate = now.toLocaleDateString("en-US", options);
    dateElement.textContent = formattedDate;
  }
}

function initializeProgressAnimations() {
  // Animate progress bars on page load
  setTimeout(() => {
    const progressBars = document.querySelectorAll(".progress-fill");

    progressBars.forEach((bar) => {
      const width = bar.style.width;
      bar.style.width = "0%";

      setTimeout(() => {
        bar.style.width = width;
      }, 500);
    });
  }, 1000); // Delay to allow content to load
}

async function loadFlaggedQuestionsCount() {
  try {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    const courseId = selectedCourse.id;

    if (!courseId) {
      // No course selected, hide the section or show 0
      updateFlaggedCount(0);
      return;
    }

    // Fetch questions for the course
    const response = await fetch(`/api/question?courseId=${courseId}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.questions) {
      // Count flagged questions
      const flaggedCount = data.questions.filter(q => q.flagStatus === true).length;
      updateFlaggedCount(flaggedCount);
    } else {
      updateFlaggedCount(0);
    }
  } catch (error) {
    console.error("Error loading flagged questions count:", error);
    updateFlaggedCount(0);
  }
}

function updateFlaggedCount(count) {
  const countElement = document.getElementById("flagged-count");
  const viewButton = document.getElementById("view-flagged-btn");
  const noDataMessage = document.getElementById("no-flagged-data");
  const flaggedList = document.getElementById("flagged-list");

  if (countElement) {
    countElement.textContent = count;
  }

  if (count > 0) {
    // Show button and hide no data message
    if (viewButton) {
      viewButton.style.display = "flex";
    }
    if (noDataMessage) {
      noDataMessage.style.display = "none";
    }
  } else {
    // Hide button and show no data message
    if (viewButton) {
      viewButton.style.display = "none";
    }
    if (noDataMessage) {
      noDataMessage.style.display = "block";
    }
  }

  // Set up button click handler
  if (viewButton && !viewButton.hasAttribute("data-listener-added")) {
    viewButton.setAttribute("data-listener-added", "true");
    viewButton.addEventListener("click", () => {
      // Navigate to question bank with flagged filter enabled
      window.location.href = "/question-bank?tab=overview&flagged=true";
    });
  }
}

// Export functions for potential external use
window.GRASPDashboard = {
  handleQuickStartAction,
  loadFlaggedQuestionsCount,
};
