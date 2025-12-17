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

function initializeDashboardContent() {
  // Dashboard-specific initialization logic
  console.log("Initializing dashboard content...");
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
      window.location.href = "/question-bank.html?tab=review";
      break;
    case "quizzes":
      // Navigate to quiz page
      window.location.href = "/quiz";
      break;
    case "questions":
      // Navigate to question generation page
      window.location.href = "/question-bank.html";
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

// Export functions for potential external use
window.GRASPDashboard = {
  handleQuickStartAction,
};
