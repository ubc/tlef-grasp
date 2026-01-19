// Achievements Page JavaScript

// API endpoints
const API_ENDPOINTS = {
  myAchievements: "/api/achievement/my",
  achievementCounts: "/api/achievement/my/counts",
};

// Achievement type definitions for display
const ACHIEVEMENT_DISPLAY = {
  quiz_completed: {
    icon: "fas fa-check-circle",
    iconType: "completion",
    category: "Quiz Completion",
  },
  quiz_perfect: {
    icon: "fas fa-star",
    iconType: "perfect",
    category: "Perfect Score",
  },
};

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

async function initializeAchievements() {
  console.log("Initializing Achievements page...");

  // Set page title
  document.title = "My Achievements - GRASP";

  // Show loading state
  showLoading();

  // Load achievements from API
  await fetchAchievements();

  // Initialize filter tabs
  initializeFilterTabs();

  // Update stats
  updateStats();
}

function showLoading() {
  const achievementsGrid = document.getElementById("achievementsGrid");
  const noResults = document.getElementById("noResults");
  
  if (achievementsGrid) {
    achievementsGrid.innerHTML = `
      <div class="loading-state" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
        <i class="fas fa-spinner fa-spin" style="font-size: 32px; color: #6366f1;"></i>
        <p style="margin-top: 16px; color: #64748b;">Loading achievements...</p>
      </div>
    `;
    achievementsGrid.style.display = "grid";
  }
  if (noResults) {
    noResults.style.display = "none";
  }
}

async function fetchAchievements() {
  try {
    // Get course ID from session storage if available
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    const courseId = selectedCourse.id;
    
    let url = API_ENDPOINTS.myAchievements;
    if (courseId) {
      url += `?courseId=${courseId}`;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.data) {
      // Transform API data to display format
      achievements = data.data.map(transformAchievement);
      filteredAchievements = [...achievements];
    } else {
      achievements = [];
      filteredAchievements = [];
    }
    
    loadAchievements();
  } catch (error) {
    console.error("Error fetching achievements:", error);
    achievements = [];
    filteredAchievements = [];
    loadAchievements();
  }
}

function transformAchievement(apiAchievement) {
  const displayInfo = ACHIEVEMENT_DISPLAY[apiAchievement.type] || {
    icon: "fas fa-trophy",
    iconType: "default",
    category: "Achievement",
  };
  
  return {
    id: apiAchievement._id?.toString() || apiAchievement.id,
    title: apiAchievement.title || "Achievement",
    description: apiAchievement.description || "",
    icon: apiAchievement.icon || displayInfo.icon,
    iconType: displayInfo.iconType,
    type: apiAchievement.type,
    category: displayInfo.category,
    status: "earned", // All achievements from API are earned
    earnedDate: formatDate(apiAchievement.earnedAt),
    quizName: apiAchievement.quizName || "",
    score: apiAchievement.score,
  };
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
  card.className = `achievement-card earned`;

  const quizInfo = achievement.quizName ? `<div class="achievement-quiz">Quiz: ${escapeHtml(achievement.quizName)}</div>` : "";
  const scoreInfo = achievement.score !== undefined ? `<div class="achievement-score">Score: ${achievement.score}%</div>` : "";

  card.innerHTML = `
    <div class="achievement-header">
      <div class="achievement-icon earned ${achievement.iconType}">
        <i class="${achievement.icon}"></i>
      </div>
      <div class="achievement-info">
        <h3 class="achievement-title">${escapeHtml(achievement.title)}</h3>
        <div class="achievement-status earned">Earned on ${achievement.earnedDate}</div>
      </div>
    </div>
    
    <div class="achievement-description">
      ${escapeHtml(achievement.description)}
    </div>
    
    ${quizInfo}
    ${scoreInfo}
    
    <div class="achievement-category">
      <span class="category-badge ${achievement.iconType}">${achievement.category}</span>
    </div>
  `;

  return card;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
  } else if (currentFilter === "earned") {
    // All achievements from API are earned
    filteredAchievements = [...achievements];
  } else if (currentFilter === "quiz_completed") {
    filteredAchievements = achievements.filter(
      (achievement) => achievement.type === "quiz_completed"
    );
  } else if (currentFilter === "quiz_perfect") {
    filteredAchievements = achievements.filter(
      (achievement) => achievement.type === "quiz_perfect"
    );
  } else {
    filteredAchievements = achievements.filter(
      (achievement) => achievement.type === currentFilter
    );
  }

  loadAchievements();
}

function updateStats() {
  const earnedCount = achievements.length;
  const completedCount = achievements.filter((a) => a.type === "quiz_completed").length;
  const perfectCount = achievements.filter((a) => a.type === "quiz_perfect").length;

  // Update achievement count
  const countElement = document.querySelector(".achievement-count");
  if (countElement) {
    countElement.textContent = `${earnedCount} Achievement${earnedCount !== 1 ? "s" : ""} Earned`;
  }

  // Update individual stat cards if they exist
  const totalStat = document.getElementById("totalAchievements");
  const completedStat = document.getElementById("completedAchievements");
  const perfectStat = document.getElementById("perfectAchievements");

  if (totalStat) totalStat.textContent = earnedCount;
  if (completedStat) completedStat.textContent = completedCount;
  if (perfectStat) perfectStat.textContent = perfectCount;
}

function viewAchievementDetails(achievementId) {
  const achievement = achievements.find((a) => a.id === achievementId);
  if (achievement) {
    console.log(`Viewing details for: ${achievement.title}`);

    // Create a detailed modal or alert for now
    const details = `
Achievement: ${achievement.title}
Status: Earned on ${achievement.earnedDate}
Description: ${achievement.description}
${achievement.quizName ? `Quiz: ${achievement.quizName}` : ""}
${achievement.score !== undefined ? `Score: ${achievement.score}%` : ""}
    `;

    alert(details);
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
  achievements.push(transformAchievement(achievement));
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
  fetchAchievements,
};
