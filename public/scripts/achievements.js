// Achievements Page JavaScript

let achievements = [];
let filteredAchievements = [];
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

  // Load achievements (initially empty)
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
        
        <button class="view-details-button" onclick="viewAchievementDetails('${achievement.id}')">
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
    filteredAchievements = [...achievements];
  } else {
    filteredAchievements = achievements.filter(
      (achievement) => achievement.status === currentFilter
    );
  }

  loadAchievements();
}

function updateStats() {
  const earnedCount = achievements.filter((a) => a.status === "earned").length;
  const totalCount = achievements.length;
  const percentage =
    totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

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
  const achievement = achievements.find((a) => a.id === achievementId);
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

// Function to add achievements (called when user completes actions)
function addAchievement(achievement) {
  achievements.push(achievement);
  filteredAchievements = [...achievements];
  loadAchievements();
  updateStats();
}

// Export functions for potential use by other scripts
window.Achievements = {
  viewAchievementDetails,
  clearFilters,
  applyFilter,
  addAchievement,
};
