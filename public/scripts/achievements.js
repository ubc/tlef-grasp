// Achievements Page JavaScript

let achievements = [];
let filteredAchievements = [];
let currentFilter = "all";
let achievementState = null;

// Achievement definitions
const ACHIEVEMENT_DEFINITIONS = [
  {
    id: "first-day-finisher",
    title: "First Day Finisher",
    description: "Complete a quiz on the first day it becomes available. Show your dedication by staying ahead of the curve!",
    criteria: "Complete a quiz on its release day",
    icon: "fas fa-calendar-check",
    iconType: "lightning",
    category: "timing",
    rarity: "common",
  },
  {
    id: "mistake-reviewer",
    title: "Mistake Reviewer",
    description: "Review your mistakes after completing a quiz. Learning from errors is the key to improvement!",
    criteria: "Review mistakes from a completed quiz",
    icon: "fas fa-search",
    iconType: "book",
    category: "learning",
    rarity: "common",
  },
  {
    id: "weekly-revisitor",
    title: "Weekly Revisitor",
    description: "Revisit past quizzes once a week. Consistent review helps reinforce your learning!",
    criteria: "Revisit a past quiz within 7 days",
    icon: "fas fa-redo",
    iconType: "target",
    category: "consistency",
    rarity: "uncommon",
  },
  {
    id: "perfect-score",
    title: "Perfect Score",
    description: "Achieve a perfect 100% score on any quiz. Excellence is the goal!",
    criteria: "Score 100% on a quiz",
    icon: "fas fa-star",
    iconType: "star",
    category: "performance",
    rarity: "rare",
  },
  {
    id: "early-bird",
    title: "Early Bird",
    description: "Complete quizzes before their due date. Stay organized and avoid last-minute stress!",
    criteria: "Complete 3 quizzes before their due date",
    icon: "fas fa-clock",
    iconType: "lightning",
    category: "timing",
    rarity: "common",
  },
  {
    id: "consistent-learner",
    title: "Consistent Learner",
    description: "Complete quizzes for 5 consecutive weeks. Build a strong study habit!",
    criteria: "Complete quizzes for 5 consecutive weeks",
    icon: "fas fa-calendar-alt",
    iconType: "diploma",
    category: "consistency",
    rarity: "uncommon",
  },
  {
    id: "speed-demon",
    title: "Speed Demon",
    description: "Complete a quiz in less than half the time limit. Quick thinking and thorough preparation!",
    criteria: "Complete a quiz in less than 50% of the time limit",
    icon: "fas fa-bolt",
    iconType: "lightning",
    category: "performance",
    rarity: "rare",
  },
  {
    id: "improvement-master",
    title: "Improvement Master",
    description: "Improve your score on a retake by 20% or more. Growth mindset in action!",
    criteria: "Improve score by 20%+ on a quiz retake",
    icon: "fas fa-chart-line",
    iconType: "target",
    category: "learning",
    rarity: "uncommon",
  },
  {
    id: "dedicated-student",
    title: "Dedicated Student",
    description: "Complete 10 quizzes total. Your commitment to learning is admirable!",
    criteria: "Complete 10 quizzes",
    icon: "fas fa-graduation-cap",
    iconType: "diploma",
    category: "milestone",
    rarity: "common",
  },
  {
    id: "review-champion",
    title: "Review Champion",
    description: "Review mistakes from 5 different quizzes. You understand the value of reflection!",
    criteria: "Review mistakes from 5 different quizzes",
    icon: "fas fa-trophy",
    iconType: "trophy",
    category: "learning",
    rarity: "uncommon",
  },
  {
    id: "week-warrior",
    title: "Week Warrior",
    description: "Complete all quizzes for a single week. Maximum effort, maximum results!",
    criteria: "Complete all available quizzes in one week",
    icon: "fas fa-fire",
    iconType: "star",
    category: "milestone",
    rarity: "rare",
  },
  {
    id: "comeback-king",
    title: "Comeback King",
    description: "Retake a quiz and improve your score. Persistence pays off!",
    criteria: "Retake a quiz and improve your score",
    icon: "fas fa-arrow-up",
    iconType: "target",
    category: "learning",
    rarity: "common",
  },
];

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize state persistence
  initializeStatePersistence();

  // Initialize achievements
  initializeAchievements();
});

function initializeStatePersistence() {
  // Load achievement state from localStorage
  const savedState = localStorage.getItem("achievementState");
  if (savedState) {
    try {
      achievementState = JSON.parse(savedState);
    } catch (e) {
      console.error("Error loading achievement state:", e);
      achievementState = createDefaultState();
    }
  } else {
    achievementState = createDefaultState();
  }

  // Auto-save state periodically
  setInterval(() => {
    saveAchievementState();
  }, 30000); // Save every 30 seconds

  // Save on page unload
  window.addEventListener("beforeunload", () => {
    saveAchievementState();
  });
}

function createDefaultState() {
  return {
    quizCompletions: [], // { quizId, completedAt, score, timeSpent, completedOnReleaseDay }
    mistakeReviews: [], // { quizId, reviewedAt }
    quizRevisits: [], // { quizId, revisitedAt }
    weeklyCompletions: {}, // { week: [quizIds] }
    quizRetakes: [], // { quizId, firstScore, secondScore, improved }
    lastUpdated: new Date().toISOString(),
  };
}

function saveAchievementState() {
  if (achievementState) {
    achievementState.lastUpdated = new Date().toISOString();
    localStorage.setItem("achievementState", JSON.stringify(achievementState));
  }
}

function initializeAchievements() {
  console.log("Initializing Achievements page...");

  // Set page title
  document.title = "My Achievements - GRASP";

  // Initialize all achievements
  achievements = ACHIEVEMENT_DEFINITIONS.map((def) => {
    const earned = checkAchievementEarned(def.id);
    return {
      ...def,
      status: earned ? "earned" : "locked",
      earnedDate: earned ? getAchievementEarnedDate(def.id) : null,
      progress: getAchievementProgress(def.id),
    };
  });

  // Apply initial filter
  applyFilter();

  // Initialize filter tabs
  initializeFilterTabs();

  // Update stats
  updateStats();
}

function checkAchievementEarned(achievementId) {
  if (!achievementState) return false;

  switch (achievementId) {
    case "first-day-finisher":
      return achievementState.quizCompletions.some(
        (q) => q.completedOnReleaseDay === true
      );

    case "mistake-reviewer":
      return achievementState.mistakeReviews.length > 0;

    case "weekly-revisitor":
      // Check if any quiz was revisited within 7 days of completion
      return achievementState.quizRevisits.some((revisit) => {
        const completion = achievementState.quizCompletions.find(
          (c) => c.quizId === revisit.quizId
        );
        if (!completion) return false;
        const daysDiff =
          (new Date(revisit.revisitedAt) - new Date(completion.completedAt)) /
          (1000 * 60 * 60 * 24);
        return daysDiff >= 1 && daysDiff <= 7;
      });

    case "perfect-score":
      return achievementState.quizCompletions.some((q) => q.score === 100);

    case "early-bird":
      // Count quizzes completed before due date (simplified: completed early)
      const earlyCompletions = achievementState.quizCompletions.filter(
        (q) => q.completedEarly === true
      );
      return earlyCompletions.length >= 3;

    case "consistent-learner":
      // Check for 5 consecutive weeks with completions
      const weeks = Object.keys(achievementState.weeklyCompletions).sort();
      let consecutiveWeeks = 0;
      let maxConsecutive = 0;
      for (let i = 0; i < weeks.length; i++) {
        if (
          achievementState.weeklyCompletions[weeks[i]].length > 0
        ) {
          consecutiveWeeks++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveWeeks);
        } else {
          consecutiveWeeks = 0;
        }
      }
      return maxConsecutive >= 5;

    case "speed-demon":
      return achievementState.quizCompletions.some(
        (q) => q.completedInHalfTime === true
      );

    case "improvement-master":
      return achievementState.quizRetakes.some((r) => r.improved >= 20);

    case "dedicated-student":
      return achievementState.quizCompletions.length >= 10;

    case "review-champion":
      const uniqueQuizReviews = new Set(
        achievementState.mistakeReviews.map((r) => r.quizId)
      );
      return uniqueQuizReviews.size >= 5;

    case "week-warrior":
      // Check if any week has all available quizzes completed
      return Object.values(achievementState.weeklyCompletions).some(
        (quizIds) => quizIds.length >= 3 // Assuming at least 3 quizzes per week
      );

    case "comeback-king":
      return achievementState.quizRetakes.some((r) => r.secondScore > r.firstScore);

    default:
      return false;
  }
}

function getAchievementEarnedDate(achievementId) {
  if (!achievementState) return null;

  // For simplicity, return the date of the most recent relevant action
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * 30); // Mock date
  const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getAchievementProgress(achievementId) {
  if (!achievementState) return 0;

  switch (achievementId) {
    case "early-bird":
      const earlyCount = achievementState.quizCompletions.filter(
        (q) => q.completedEarly === true
      ).length;
      return Math.min(100, Math.round((earlyCount / 3) * 100));

    case "consistent-learner":
      const weeks = Object.keys(achievementState.weeklyCompletions).sort();
      let consecutiveWeeks = 0;
      let maxConsecutive = 0;
      for (let i = 0; i < weeks.length; i++) {
        if (
          achievementState.weeklyCompletions[weeks[i]].length > 0
        ) {
          consecutiveWeeks++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveWeeks);
        } else {
          consecutiveWeeks = 0;
        }
      }
      return Math.min(100, Math.round((maxConsecutive / 5) * 100));

    case "dedicated-student":
      return Math.min(100, Math.round((achievementState.quizCompletions.length / 10) * 100));

    case "review-champion":
      const uniqueQuizReviews = new Set(
        achievementState.mistakeReviews.map((r) => r.quizId)
      );
      return Math.min(100, Math.round((uniqueQuizReviews.size / 5) * 100));

    default:
      return checkAchievementEarned(achievementId) ? 100 : 0;
  }
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

  const progressBar =
    achievement.progress > 0 && achievement.progress < 100
      ? `<div class="achievement-progress">
          <div class="progress-bar-mini">
            <div class="progress-fill-mini" style="width: ${achievement.progress}%"></div>
          </div>
          <span class="progress-text">${achievement.progress}%</span>
        </div>`
      : "";

  const rarityBadge = achievement.rarity
    ? `<span class="rarity-badge rarity-${achievement.rarity}">${achievement.rarity}</span>`
    : "";

  card.innerHTML = `
        <div class="achievement-header">
            <div class="achievement-icon ${achievement.status} ${achievement.iconType}">
                <i class="${achievement.icon}"></i>
            </div>
            <div class="achievement-info">
                <div class="achievement-title-row">
                    <h3 class="achievement-title">${achievement.title}</h3>
                    ${rarityBadge}
                </div>
                <div class="achievement-status ${achievement.status}">${statusText}</div>
            </div>
        </div>
        
        <div class="achievement-description">
            ${achievement.description}
        </div>
        
        ${progressBar}
        
        <button class="view-details-button" data-achievement-id="${achievement.id}">
            ${achievement.status === "earned" ? "View Details" : "Learn More"}
        </button>
    `;

  // Add click handler for button
  const button = card.querySelector(".view-details-button");
  if (button) {
    button.addEventListener("click", () => {
      viewAchievementDetails(achievement.id);
    });
  }

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
  updateStats();
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

    // Create a modal for details
    const modal = document.createElement("div");
    modal.className = "achievement-modal";
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <button class="modal-close" aria-label="Close">&times;</button>
        <div class="modal-header">
          <div class="achievement-icon ${achievement.status} ${achievement.iconType}">
            <i class="${achievement.icon}"></i>
          </div>
          <div>
            <h2>${achievement.title}</h2>
            <p class="modal-status ${achievement.status}">
              ${achievement.status === "earned" ? `Earned on ${achievement.earnedDate}` : "Locked"}
            </p>
          </div>
        </div>
        <div class="modal-body">
          <p class="modal-description">${achievement.description}</p>
          <div class="modal-criteria">
            <strong>Criteria:</strong> ${achievement.criteria}
          </div>
          ${achievement.progress > 0 && achievement.progress < 100
            ? `<div class="modal-progress">
                <strong>Progress:</strong> ${achievement.progress}%
                <div class="progress-bar-mini">
                  <div class="progress-fill-mini" style="width: ${achievement.progress}%"></div>
                </div>
              </div>`
            : ""}
        </div>
        <div class="modal-footer">
          <button class="modal-button" onclick="this.closest('.achievement-modal').remove()">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on overlay click
    modal.querySelector(".modal-overlay").addEventListener("click", () => {
      modal.remove();
    });

    // Close on close button
    modal.querySelector(".modal-close").addEventListener("click", () => {
      modal.remove();
    });
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

// Function to record quiz completion (called from quiz submission)
function recordQuizCompletion(quizId, score, timeSpent, timeLimit, completedOnReleaseDay = false, completedEarly = false) {
  if (!achievementState) {
    achievementState = createDefaultState();
  }

  const completion = {
    quizId,
    completedAt: new Date().toISOString(),
    score,
    timeSpent,
    completedOnReleaseDay,
    completedEarly,
    completedInHalfTime: timeSpent < timeLimit * 0.5,
  };

  achievementState.quizCompletions.push(completion);

  // Track weekly completions
  const week = getWeekNumber(new Date());
  if (!achievementState.weeklyCompletions[week]) {
    achievementState.weeklyCompletions[week] = [];
  }
  achievementState.weeklyCompletions[week].push(quizId);

  saveAchievementState();
  checkAndUpdateAchievements();
}

// Function to record mistake review
function recordMistakeReview(quizId) {
  if (!achievementState) {
    achievementState = createDefaultState();
  }

  const review = {
    quizId,
    reviewedAt: new Date().toISOString(),
  };

  achievementState.mistakeReviews.push(review);
  saveAchievementState();
  checkAndUpdateAchievements();
}

// Function to record quiz revisit
function recordQuizRevisit(quizId) {
  if (!achievementState) {
    achievementState = createDefaultState();
  }

  const revisit = {
    quizId,
    revisitedAt: new Date().toISOString(),
  };

  achievementState.quizRevisits.push(revisit);
  saveAchievementState();
  checkAndUpdateAchievements();
}

// Function to record quiz retake
function recordQuizRetake(quizId, firstScore, secondScore) {
  if (!achievementState) {
    achievementState = createDefaultState();
  }

  const retake = {
    quizId,
    firstScore,
    secondScore,
    improved: secondScore - firstScore,
    retakenAt: new Date().toISOString(),
  };

  achievementState.quizRetakes.push(retake);
  saveAchievementState();
  checkAndUpdateAchievements();
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function checkAndUpdateAchievements() {
  // Re-check all achievements
  achievements = achievements.map((achievement) => {
    const earned = checkAchievementEarned(achievement.id);
    if (earned && achievement.status === "locked") {
      // New achievement earned!
      achievement.status = "earned";
      achievement.earnedDate = getAchievementEarnedDate(achievement.id);
      showAchievementNotification(achievement);
    }
    achievement.progress = getAchievementProgress(achievement.id);
    return achievement;
  });

  // Update display
  applyFilter();
  updateStats();
}

function showAchievementNotification(achievement) {
  // Create a notification toast
  const notification = document.createElement("div");
  notification.className = "achievement-notification";
  notification.innerHTML = `
    <div class="notification-content">
      <div class="achievement-icon earned ${achievement.iconType}">
        <i class="${achievement.icon}"></i>
      </div>
      <div class="notification-text">
        <h4>Achievement Unlocked!</h4>
        <p>${achievement.title}</p>
      </div>
    </div>
  `;

  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.classList.add("show");
  }, 100);

  // Remove after 5 seconds
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 5000);
}

// Export functions for use by other scripts
window.Achievements = {
  viewAchievementDetails,
  clearFilters,
  applyFilter,
  recordQuizCompletion,
  recordMistakeReview,
  recordQuizRevisit,
  recordQuizRetake,
  checkAndUpdateAchievements,
};
