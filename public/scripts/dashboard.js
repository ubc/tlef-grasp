// GRASP Dashboard JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Initialize dashboard functionality
  initializeDashboard();
});

function initializeDashboard() {
  // Initialize shared navigation
  new GRASPNavigation();

  // Initialize dashboard-specific functionality
  initializeDashboardContent();

  // Initialize interactive elements
  initializeInteractiveElements();

  // Update current date
  updateCurrentDate();

  // Initialize progress animations
  initializeProgressAnimations();
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

  // Generation status cards
  const generationCards = document.querySelectorAll(".generation-card");
  generationCards.forEach((card) => {
    card.addEventListener("click", function () {
      const lectureTitle = this.querySelector("h4").textContent;
      openGenerationDetails(lectureTitle);
    });
  });

  // Flagged questions
  const flaggedItems = document.querySelectorAll(".flagged-item");
  flaggedItems.forEach((item) => {
    item.addEventListener("click", function () {
      const radio = this.querySelector('input[type="radio"]');
      radio.checked = true;

      const title = this.querySelector(".flagged-title").textContent;
      openFlaggedQuestion(title);
    });
  });

  // Course selector
  const courseSelector = document.querySelector(".course-selector");
  if (courseSelector) {
    courseSelector.addEventListener("change", function () {
      const selectedCourse = this.value;
      updateReviewStatus(selectedCourse);
    });
  }
}

function handleQuickStartAction(action) {
  console.log(`Quick start action: ${action}`);

  switch (action.toLowerCase()) {
    case "upload":
      // Handle file upload
      console.log("Opening file upload dialog...");
      break;
    case "review":
      // Handle review action
      console.log("Opening review interface...");
      break;
    case "quizzes":
      // Handle quiz creation
      console.log("Opening quiz builder...");
      break;
    case "questions":
      // Handle question creation
      console.log("Opening question builder...");
      break;
    default:
      console.log(`Unknown action: ${action}`);
  }
}

function openGenerationDetails(lectureTitle) {
  console.log(`Opening generation details for: ${lectureTitle}`);
  // You could open a modal or navigate to a detailed view
}

function openFlaggedQuestion(title) {
  console.log(`Opening flagged question: ${title}`);
  // You could open a modal or navigate to the question
}

function updateReviewStatus(course) {
  console.log(`Updating review status for course: ${course}`);

  // Simulate loading different review data
  const progressCircle = document.querySelector(".progress-circle");
  const progressText = document.querySelector(".progress-text");

  if (progressCircle && progressText) {
    // Simulate different progress values for different courses
    let progress = 68; // Default for CHEM 121

    if (course === "CHEM 123") {
      progress = 45; // Different progress for CHEM 123
    }

    // Update the circular progress
    progressText.textContent = `${progress}%`;

    // Update the conic gradient
    const degrees = (progress / 100) * 360;
    progressCircle.style.background = `conic-gradient(#3498db 0deg ${degrees}deg, #e9ecef ${degrees}deg 360deg)`;
  }
}

function updateCurrentDate() {
  const dateElement = document.querySelector(".welcome-section .date");
  if (dateElement) {
    const now = new Date();
    const options = { weekday: "long", month: "long", day: "numeric" };
    const formattedDate = now.toLocaleDateString("en-US", options);
    dateElement.textContent = formattedDate;
  }
}

function initializeProgressAnimations() {
  // Animate progress bars on page load
  const progressBars = document.querySelectorAll(".progress-fill");

  progressBars.forEach((bar) => {
    const width = bar.style.width;
    bar.style.width = "0%";

    setTimeout(() => {
      bar.style.width = width;
    }, 500);
  });
}

// Export functions for potential external use
window.GRASPDashboard = {
  updateReviewStatus,
  handleQuickStartAction,
};
