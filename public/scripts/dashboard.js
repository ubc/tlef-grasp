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

    // Load course data
    await loadCourseData();

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
        updateWelcomeMessage(data.user.firstName + " " + data.user.lastName);
      }
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Error loading user data:", error);
  }
}

async function loadCourseData() {
  try {
    const response = await fetch("/api/courses");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.courses.length > 0) {
      // Update course selector
      updateCourseSelector(data.courses);

      // Update generation status
      updateGenerationStatus(data.courses);

      // Update review status with first course
      if (data.courses.length > 0) {
        updateReviewStatus(data.courses[0].code);
      }
    } else {
      // No courses available - show empty states
      showEmptyStates();
    }
  } catch (error) {
    console.error("Error loading course data:", error);
    showEmptyStates();
  }
}

function updateWelcomeMessage(instructorName) {
  const welcomeElement = document.getElementById("welcome-message");
  if (welcomeElement && instructorName) {
    welcomeElement.textContent = `Hello, ${instructorName}`;
  }
}

function updateCourseSelector(courses) {
  const courseSelector = document.getElementById("course-selector");
  if (courseSelector) {
    // Clear existing options except the first one
    courseSelector.innerHTML = '<option value="">Select a course...</option>';

    // Add course options
    courses.forEach((course) => {
      const option = document.createElement("option");
      option.value = course.courseCode;
      option.textContent = `${course.courseName}`;

      if ( course.courseCode === sessionStorage.getItem("grasp-selected-course-code") ) {
        option.selected = true;
      }
      courseSelector.appendChild(option);
    });
  }
}

function updateGenerationStatus(courses) {
  const generationCardsContainer = document.getElementById("generation-cards");
  const noDataMessage = document.getElementById("no-generation-data");

  if (!generationCardsContainer) return;

  // Clear existing content
  generationCardsContainer.innerHTML = "";

  // Check if any courses have materials
  const coursesWithMaterials = courses.filter(
    (course) => course.materials && course.materials.length > 0
  );

  if (coursesWithMaterials.length === 0) {
    noDataMessage.style.display = "block";
    generationCardsContainer.appendChild(noDataMessage);
  } else {
    noDataMessage.style.display = "none";

    // Display generation status for each course with materials
    coursesWithMaterials.forEach((course) => {
      course.materials.forEach((material) => {
        const generationCard = createGenerationCard(course, material);
        generationCardsContainer.appendChild(generationCard);
      });
    });
  }
}

function createGenerationCard(course, material) {
  const card = document.createElement("div");
  card.className = "generation-card";

  // Calculate progress based on question sets
  const totalQuestions = course.questionSets
    ? course.questionSets.reduce((sum, qs) => sum + qs.questions, 0)
    : 0;
  const progress = Math.min(totalQuestions * 10, 100); // Simple progress calculation

  card.innerHTML = `
    <h4>${course.code} - ${material.title}</h4>
    <p>${totalQuestions} Questions Generated</p>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${progress}%"></div>
    </div>
  `;

  // Add click event
  card.addEventListener("click", () => {
    openGenerationDetails(course.code, material.title);
  });

  return card;
}

function updateReviewStatus(courseCode) {
  const reviewProgressContainer = document.getElementById("review-progress");
  const noReviewData = document.getElementById("no-review-data");

  if (!reviewProgressContainer) return;

  // Clear existing content
  reviewProgressContainer.innerHTML = "";

  if (!courseCode) {
    noReviewData.style.display = "block";
    reviewProgressContainer.appendChild(noReviewData);
    return;
  }

  // Fetch course details to get review data
  fetch(`/api/courses/${courseCode.toLowerCase().replace(/\s+/g, "")}`)
    .then((response) => response.json())
    .then((data) => {
      if (data.success && data.course) {
        const course = data.course;
        const reviewData = calculateReviewProgress(course);

        noReviewData.style.display = "none";

        const progressHTML = `
          <div class="circular-progress">
            <div class="progress-circle" style="background: conic-gradient(#3498db 0deg ${
              reviewData.progress * 3.6
            }deg, #e9ecef ${reviewData.progress * 3.6}deg 360deg)">
              <span class="progress-text">${reviewData.progress}%</span>
            </div>
          </div>
          <div class="progress-legend">
            <div class="legend-item">
              <span class="legend-color in-progress"></span>
              <span>In progress (${reviewData.inProgress})</span>
            </div>
            <div class="legend-item">
              <span class="legend-color reviewed"></span>
              <span>Reviewed (${reviewData.reviewed})</span>
            </div>
          </div>
        `;

        reviewProgressContainer.innerHTML = progressHTML;
      } else {
        noReviewData.style.display = "block";
        reviewProgressContainer.appendChild(noReviewData);
      }
    })
    .catch((error) => {
      console.error("Error fetching course details:", error);
      noReviewData.style.display = "block";
      reviewProgressContainer.appendChild(noReviewData);
    });
}

function calculateReviewProgress(course) {
  if (!course.questionSets || course.questionSets.length === 0) {
    return { progress: 0, reviewed: 0, inProgress: 0 };
  }

  const totalSets = course.questionSets.length;
  const reviewedSets = course.questionSets.filter(
    (qs) => qs.status === "reviewed"
  ).length;
  const inProgressSets = course.questionSets.filter(
    (qs) => qs.status === "generated"
  ).length;

  const progress =
    totalSets > 0 ? Math.round((reviewedSets / totalSets) * 100) : 0;

  return {
    progress,
    reviewed: reviewedSets,
    inProgress: inProgressSets,
  };
}

function showEmptyStates() {
  // Show empty states for all sections
  const noGenerationData = document.getElementById("no-generation-data");
  const noReviewData = document.getElementById("no-review-data");

  if (noGenerationData) {
    noGenerationData.style.display = "block";
  }

  if (noReviewData) {
    noReviewData.style.display = "block";
  }
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

  // Course selector
  const courseSelector = document.getElementById("course-selector");
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
      // Navigate to course materials page
      window.location.href = "/course-materials";
      break;
    case "review":
      // Navigate to question review page
      window.location.href = "/question-review";
      break;
    case "quizzes":
      // Navigate to quiz page
      window.location.href = "/quiz";
      break;
    case "questions":
      // Navigate to question generation page
      window.location.href = "/question-generation";
      break;
    default:
      console.log(`Unknown action: ${action}`);
  }
}

function openGenerationDetails(courseCode, materialTitle) {
  console.log(
    `Opening generation details for: ${courseCode} - ${materialTitle}`
  );
  // You could open a modal or navigate to a detailed view
  window.location.href = "/question-generation";
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
  updateReviewStatus,
  handleQuickStartAction,
  loadCourseData,
  updateGenerationStatus,
};
