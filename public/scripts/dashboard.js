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
    
    // Initialize calendar
    initializeCalendar();
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

function initializeCalendar() {
  const calendarHeader = document.querySelector(".calendar-header h4");
  const calendarDays = document.querySelector(".calendar-days");
  
  if (!calendarHeader || !calendarDays) {
    return;
  }
  
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const currentDate = today.getDate();
  
  // Set month and year header
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  calendarHeader.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Get first day of month and number of days
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Adjust for Monday as first day (0 = Monday, 6 = Sunday)
  // JavaScript: 0=Sunday, 1=Monday, ..., 6=Saturday
  // Calendar: 0=Monday, 1=Tuesday, ..., 6=Sunday
  const adjustedStartingDay = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;
  
  // Get previous month's last days
  const prevMonth = new Date(currentYear, currentMonth, 0);
  const daysInPrevMonth = prevMonth.getDate();
  
  // Clear existing calendar days
  calendarDays.innerHTML = "";
  
  // Add previous month's trailing days
  for (let i = adjustedStartingDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dayElement = document.createElement("span");
    dayElement.className = "other-month";
    dayElement.textContent = day;
    calendarDays.appendChild(dayElement);
  }
  
  // Add current month's days
  for (let day = 1; day <= daysInMonth; day++) {
    const dayElement = document.createElement("span");
    
    // Check if this is today
    if (day === currentDate) {
      dayElement.className = "current-day";
    }
    
    dayElement.textContent = day;
    calendarDays.appendChild(dayElement);
  }
  
  // Add next month's leading days to fill the calendar
  const totalCells = calendarDays.children.length;
  const remainingCells = 42 - totalCells; // 6 rows × 7 days = 42 cells
  
  for (let day = 1; day <= remainingCells; day++) {
    const dayElement = document.createElement("span");
    dayElement.className = "other-month";
    dayElement.textContent = day;
    calendarDays.appendChild(dayElement);
  }
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
