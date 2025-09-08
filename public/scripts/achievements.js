// Achievements Page JavaScript

// Mock achievements data
const mockAchievements = [
  {
    id: 1,
    title: "First Steps",
    icon: "fas fa-trophy",
    iconType: "trophy",
    status: "earned",
    earnedDate: "4/30/2025",
    description: "Complete your first quiz.",
    criteria: "Complete your first quiz.",
  },
  {
    id: 2,
    title: "Perfect Score",
    icon: "fas fa-star",
    iconType: "star",
    status: "locked",
    description: "Score 100% on a quiz.",
    criteria: "Get all answers correct in a quiz.",
  },
  {
    id: 3,
    title: "Streak Starter",
    icon: "fas fa-bolt",
    iconType: "lightning",
    status: "locked",
    description: "Study 3 days in a row.",
    criteria: "Log in and study for 3 consecutive days.",
  },
  {
    id: 4,
    title: "Reader",
    icon: "fas fa-book-open",
    iconType: "book",
    status: "earned",
    earnedDate: "6/1/2025",
    description: "Open 5 materials.",
    criteria: "Open 5 materials.",
  },
  {
    id: 5,
    title: "Objective Master",
    icon: "fas fa-bullseye",
    iconType: "target",
    status: "locked",
    description: "Master an objective.",
    criteria: "Score 80%+ across 3 quizzes for the same objective.",
  },
  {
    id: 6,
    title: "Quiz Veteran",
    icon: "fas fa-scroll",
    iconType: "diploma",
    status: "locked",
    description: "Complete 10 quizzes.",
    criteria: "Finish 10 quizzes.",
  },
  {
    id: 7,
    title: "Early Bird",
    icon: "fas fa-star",
    iconType: "star",
    status: "earned",
    earnedDate: "6/11/2025",
    description: "Study before 8 AM.",
    criteria: "Study before 8 AM.",
  },
  {
    id: 8,
    title: "Night Owl",
    icon: "fas fa-star",
    iconType: "star",
    status: "locked",
    description: "Study after 10 PM.",
    criteria: "Take a quiz or open a material after 10 PM.",
  },
  {
    id: 9,
    title: "Diligent",
    icon: "fas fa-bolt",
    iconType: "lightning",
    status: "locked",
    description: "Attempt a quiz every day for 7 days.",
    criteria: "7-day quiz streak.",
  },
  {
    id: 10,
    title: "Course Explorer",
    icon: "fas fa-book-open",
    iconType: "book",
    status: "earned",
    earnedDate: "6/19/2025",
    description: "Open materials from 2 courses.",
    criteria: "Open materials from 2 courses.",
  },
];

let filteredAchievements = [...mockAchievements];
let currentFilter = "all";

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize achievements
  initializeAchievements();
});

function initializeAchievements() {
  console.log("Initializing Achievements page...");

  // Set page title
  document.title = "My Achievements - GRASP";

  // Load achievements
  loadAchievements();

  // Initialize filter tabs
  initializeFilterTabs();

  // Update stats
  updateStats();
}

function loadAchievements() {
  const achievementsGrid = document.getElementById("achievementsGrid");
  const noResults = document.getElementById("noResults");

  if (filteredAchievements.length === 0) {
    achievementsGrid.style.display = "none";
    noResults.style.display = "flex";
    return;
  }

  achievementsGrid.style.display = "grid";
  noResults.style.display = "none";

  achievementsGrid.innerHTML = "";

  filteredAchievements.forEach((achievement) => {
    const achievementCard = createAchievementCard(achievement);
    achievementsGrid.appendChild(achievementCard);
  });
}

function createAchievementCard(achievement) {
  const card = document.createElement("div");
  card.className = `achievement-card ${achievement.status}`;

  const statusText =
    achievement.status === "earned"
      ? `Earned on ${achievement.earnedDate}`
      : `Locked - ${achievement.criteria}`;

  card.innerHTML = `
        <div class="achievement-header">
            <div class="achievement-icon ${achievement.status} ${achievement.iconType}">
                <i class="${achievement.icon}"></i>
            </div>
            <div class="achievement-info">
                <h3 class="achievement-title">${achievement.title}</h3>
                <div class="achievement-status ${achievement.status}">${statusText}</div>
            </div>
        </div>
        
        <div class="achievement-description">
            ${achievement.description}
        </div>
        
        <button class="view-details-button" onclick="viewAchievementDetails(${achievement.id})">
            View Details
        </button>
    `;

  return card;
}

function initializeFilterTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");

  tabButtons.forEach((button) => {
    button.addEventListener("click", function () {
      // Remove active class from all buttons
      tabButtons.forEach((btn) => btn.classList.remove("active"));

      // Add active class to clicked button
      this.classList.add("active");

      // Update current filter
      currentFilter = this.dataset.filter;

      // Apply filter
      applyFilter();
    });
  });
}

function applyFilter() {
  if (currentFilter === "all") {
    filteredAchievements = [...mockAchievements];
  } else {
    filteredAchievements = mockAchievements.filter(
      (achievement) => achievement.status === currentFilter
    );
  }

  loadAchievements();
}

function updateStats() {
  const earnedCount = mockAchievements.filter(
    (a) => a.status === "earned"
  ).length;
  const totalCount = mockAchievements.length;
  const percentage = Math.round((earnedCount / totalCount) * 100);

  // Update achievement count
  const countElement = document.querySelector(".achievement-count");
  if (countElement) {
    countElement.textContent = `${earnedCount} of ${totalCount} Achievements Earned`;
  }

  // Update progress bar
  const progressFill = document.querySelector(".progress-fill");
  const percentageElement = document.querySelector(".completion-percentage");

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }

  if (percentageElement) {
    percentageElement.textContent = `${percentage}%`;
  }
}

function viewAchievementDetails(achievementId) {
  const achievement = mockAchievements.find((a) => a.id === achievementId);
  if (achievement) {
    console.log(`Viewing details for: ${achievement.title}`);

    // Create a detailed modal or alert for now
    const details = `
Achievement: ${achievement.title}
Status: ${
      achievement.status === "earned"
        ? `Earned on ${achievement.earnedDate}`
        : "Locked"
    }
Description: ${achievement.description}
Criteria: ${achievement.criteria}
        `;

    alert(details);

    // In a real application, this would open a modal or navigate to a details page
    // window.location.href = `achievement-details.html?id=${achievementId}`;
  }
}

function clearFilters() {
  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach((btn) => btn.classList.remove("active"));

  const allButton = document.querySelector('[data-filter="all"]');
  if (allButton) {
    allButton.classList.add("active");
  }

  currentFilter = "all";
  applyFilter();
}

// Export functions for potential use by other scripts
window.Achievements = {
  viewAchievementDetails,
  clearFilters,
  applyFilter,
};
