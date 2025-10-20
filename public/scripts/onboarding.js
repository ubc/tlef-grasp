// Onboarding JavaScript functionality
class OnboardingManager {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 3;
    this.courseData = {};
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupTabSwitching();
    this.updateProgressIndicator();
  }

  setupEventListeners() {
    // Course selection form
    const courseSelectionForm = document.getElementById(
      "course-selection-form"
    );
    if (courseSelectionForm) {
      courseSelectionForm.addEventListener("submit", (e) =>
        this.handleCourseSelection(e)
      );
    }

    // Course structure form
    const courseStructureForm = document.getElementById(
      "course-structure-form"
    );
    if (courseStructureForm) {
      courseStructureForm.addEventListener("submit", (e) =>
        this.handleCourseStructure(e)
      );
    }

    // Course details form
    const courseDetailsForm = document.getElementById("course-details-form");
    if (courseDetailsForm) {
      courseDetailsForm.addEventListener("submit", (e) =>
        this.handleCourseDetails(e)
      );
    }

    // Course name dropdown change
    const courseNameSelect = document.getElementById("course-name");
    if (courseNameSelect) {
      courseNameSelect.addEventListener("change", (e) =>
        this.handleCourseNameChange(e)
      );
    }
  }

  setupTabSwitching() {
    const tabButtons = document.querySelectorAll(".tab-button");
    const loginTab = document.getElementById("login-tab");
    const setupTab = document.getElementById("setup-tab");

    console.log("Setting up tab switching...");
    console.log("Login tab:", loginTab);
    console.log("Setup tab:", setupTab);

    // Ensure setup tab is visible by default and step 1 is active
    if (setupTab) {
      setupTab.style.display = "block";
      setupTab.classList.add("active");
      // Make sure step 1 is active
      const step1 = document.getElementById("step-1");
      if (step1) {
        step1.classList.add("active");
      }
    }
    if (loginTab) {
      loginTab.style.display = "none";
      loginTab.classList.remove("active");
    }

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.getAttribute("data-tab");
        console.log("Tab clicked:", tab);

        // Update active tab button
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");

        // Show/hide appropriate content
        if (tab === "login") {
          console.log("Switching to login tab");
          if (loginTab) {
            loginTab.style.display = "block";
            loginTab.style.visibility = "visible";
            loginTab.classList.add("active");
            console.log("Login tab display set to block, visibility visible");
            console.log("Login tab element:", loginTab);
            console.log(
              "Login tab computed style:",
              window.getComputedStyle(loginTab).display
            );
            this.loadExistingCourses();
          }
          if (setupTab) {
            setupTab.style.display = "none";
            setupTab.style.visibility = "hidden";
            setupTab.classList.remove("active");
            console.log("Setup tab display set to none, visibility hidden");
          }
        } else {
          console.log("Switching to setup tab");
          if (loginTab) {
            loginTab.style.display = "none";
            loginTab.style.visibility = "hidden";
            loginTab.classList.remove("active");
            console.log("Login tab display set to none, visibility hidden");
          }
          if (setupTab) {
            setupTab.style.display = "block";
            setupTab.style.visibility = "visible";
            setupTab.classList.add("active");
            console.log("Setup tab display set to block, visibility visible");
            // Ensure step 1 is active when switching to setup tab
            const step1 = document.getElementById("step-1");
            if (step1) {
              step1.classList.add("active");
            }
          }
        }
      });
    });
  }

  setupCourseSelection() {
    // This method sets up course selection for the login tab
    // Courses will be loaded when the login tab is activated
  }

  async loadExistingCourses() {
    const loadingElement = document.getElementById("loading-courses");
    const coursesListElement = document.getElementById("courses-list");
    const noCoursesElement = document.getElementById("no-courses-message");

    try {
      // Show loading state
      if (loadingElement) loadingElement.style.display = "flex";
      if (coursesListElement) coursesListElement.style.display = "none";
      if (noCoursesElement) noCoursesElement.style.display = "none";

      // Fetch courses from API
      const response = await fetch("/api/courses");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.courses && data.courses.length > 0) {
        this.displayCourses(data.courses);
      } else {
        this.showNoCoursesMessage();
      }
    } catch (error) {
      console.error("Error loading courses:", error);
      this.showNoCoursesMessage();
    } finally {
      if (loadingElement) loadingElement.style.display = "none";
    }
  }

  displayCourses(courses) {
    const coursesListElement = document.getElementById("courses-list");
    const noCoursesElement = document.getElementById("no-courses-message");

    if (!coursesListElement) return;

    // Clear existing content
    coursesListElement.innerHTML = "";

    // Create course items
    courses.forEach((course) => {
      const courseItem = document.createElement("div");
      courseItem.className = "course-item";
      courseItem.dataset.courseId = course.id;

      courseItem.innerHTML = `
        <div class="course-icon">
          <i class="fas fa-graduation-cap"></i>
        </div>
        <div class="course-info">
          <div class="course-name">${course.name}</div>
          <div class="course-details">
            <span><i class="fas fa-user"></i> ${course.instructor}</span>
            <span><i class="fas fa-calendar"></i> ${course.semester}</span>
            <span><i class="fas fa-users"></i> ${course.students} students</span>
          </div>
        </div>
        <div class="course-actions">
          <button class="access-btn" onclick="accessCourseDashboard('${course.id}')" title="Access Dashboard">
            <i class="fas fa-arrow-right"></i>
            <span>Access</span>
          </button>
        </div>
      `;

      coursesListElement.appendChild(courseItem);
    });

    // Show courses list
    coursesListElement.style.display = "flex";
    if (noCoursesElement) noCoursesElement.style.display = "none";
  }

  showNoCoursesMessage() {
    const coursesListElement = document.getElementById("courses-list");
    const noCoursesElement = document.getElementById("no-courses-message");

    if (coursesListElement) coursesListElement.style.display = "none";
    if (noCoursesElement) noCoursesElement.style.display = "block";
  }

  async accessCourseDashboard(courseId) {
    try {
      // Show loading state
      const button = event.target.closest(".access-btn");
      const originalText = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Accessing...';
      button.disabled = true;

      // Get course details
      const response = await fetch(`/api/courses/${courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.course) {
        // Store course profile in session storage
        const profile = {
          instructorName: data.course.instructor,
          courseId: data.course.id,
          courseName: data.course.name,
          courseCode: data.course.code,
          loginTime: new Date().toISOString(),
        };
        sessionStorage.setItem("courseProfile", JSON.stringify(profile));

        // Mark user as onboarded to prevent redirect back to onboarding
        sessionStorage.setItem("onboarded", "true");

        // Redirect to dashboard
        window.location.href = "/dashboard.html";
      } else {
        throw new Error("Course not found");
      }
    } catch (error) {
      console.error("Error accessing course dashboard:", error);
      this.showError("Failed to access dashboard. Please try again.");

      // Reset button state
      const button = event.target.closest(".access-btn");
      button.innerHTML = originalText;
      button.disabled = false;
    }
  }

  handleCourseSelection(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const courseName = formData.get("courseName");
    const customCourseCode = formData.get("customCourseCode");
    const customCourseTitle = formData.get("customCourseTitle");

    if (!courseName) {
      this.showError("Please select or create a course");
      return;
    }

    if (courseName === "custom") {
      if (!customCourseCode || !customCourseTitle) {
        this.showError("Please provide both course code and title");
        return;
      }
      this.courseData.courseCode = customCourseCode;
      this.courseData.courseTitle = customCourseTitle;
      this.courseData.courseName = `${customCourseCode} - ${customCourseTitle}`;
    } else {
      this.courseData.courseName = courseName;
      const [code, title] = courseName.split(" - ");
      this.courseData.courseCode = code;
      this.courseData.courseTitle = title;
    }

    this.updateSelectedCourseDisplay();
    this.goToStep(2);
  }

  handleCourseStructure(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const courseWeeks = parseInt(formData.get("courseWeeks"));
    const lecturesPerWeek = parseInt(formData.get("lecturesPerWeek"));
    const courseCredits = parseInt(formData.get("courseCredits"));

    if (!courseWeeks || !lecturesPerWeek || !courseCredits) {
      this.showError("Please fill in all required fields");
      return;
    }

    this.courseData.courseWeeks = courseWeeks;
    this.courseData.lecturesPerWeek = lecturesPerWeek;
    this.courseData.courseCredits = courseCredits;

    this.goToStep(3);
  }

  async handleCourseDetails(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const instructorName = formData.get("instructorName");
    const semester = formData.get("semester");
    const expectedStudents = parseInt(formData.get("expectedStudents"));
    const courseDescription = formData.get("courseDescription");

    if (!instructorName || !semester || !expectedStudents) {
      this.showError("Please fill in all required fields");
      return;
    }

    this.courseData.instructorName = instructorName;
    this.courseData.semester = semester;
    this.courseData.expectedStudents = expectedStudents;
    this.courseData.courseDescription = courseDescription || "";
    this.courseData.status = "active";
    this.courseData.createdAt = new Date().toISOString();

    // Show loading state
    this.showLoading(true);

    try {
      // Save course profile to backend
      await this.saveCourseProfile();

      // Show completion step
      this.showCompletion();
    } catch (error) {
      console.error("Error saving course profile:", error);
      this.showError("Failed to save course profile. Please try again.");
    } finally {
      this.showLoading(false);
    }
  }

  handleCourseNameChange(e) {
    const selectedValue = e.target.value;
    const customCourseGroup = document.getElementById("custom-course-group");
    const customCourseNameGroup = document.getElementById(
      "custom-course-name-group"
    );

    if (selectedValue === "custom") {
      customCourseGroup.style.display = "block";
      customCourseNameGroup.style.display = "block";
    } else {
      customCourseGroup.style.display = "none";
      customCourseNameGroup.style.display = "none";
    }
  }

  async saveCourseProfile() {
    try {
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.courseData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log("Course profile saved successfully:", result);
      return result;
    } catch (error) {
      console.error("Error saving course profile:", error);
      throw error;
    }
  }

  goToStep(stepNumber) {
    // Hide current step
    const currentStepElement = document.querySelector(".step-content.active");
    if (currentStepElement) {
      currentStepElement.classList.remove("active");
    }

    // Show target step
    const targetStepElement = document.getElementById(`step-${stepNumber}`);
    if (targetStepElement) {
      targetStepElement.classList.add("active");
    }

    this.currentStep = stepNumber;
    this.updateProgressIndicator();
  }

  updateProgressIndicator() {
    const progressSteps = document.querySelectorAll(".progress-step");

    progressSteps.forEach((step, index) => {
      const stepNumber = index + 1;
      step.classList.remove("active", "completed");

      if (stepNumber === this.currentStep) {
        step.classList.add("active");
      } else if (stepNumber < this.currentStep) {
        step.classList.add("completed");
      }
    });
  }

  updateSelectedCourseDisplay() {
    const displayElement = document.getElementById("selected-course-display");
    if (displayElement && this.courseData.courseName) {
      displayElement.textContent = this.courseData.courseName;
    }
  }

  showCompletion() {
    // Hide current step
    const currentStepElement = document.querySelector(".step-content.active");
    if (currentStepElement) {
      currentStepElement.classList.remove("active");
    }

    // Show completion step
    const completionElement = document.getElementById("step-complete");
    if (completionElement) {
      completionElement.classList.add("active");
      completionElement.classList.add("success-animation");
    }

    // Mark session as onboarded
    sessionStorage.setItem("onboarded", "true");
    sessionStorage.setItem("courseProfile", JSON.stringify(this.courseData));
  }

  showLoading(show) {
    const forms = document.querySelectorAll(".onboarding-form");
    const buttons = document.querySelectorAll(".continue-btn");

    forms.forEach((form) => {
      if (show) {
        form.classList.add("loading");
      } else {
        form.classList.remove("loading");
      }
    });

    buttons.forEach((button) => {
      if (show) {
        button.classList.add("loading");
      } else {
        button.classList.remove("loading");
      }
    });
  }

  showError(message) {
    // Remove existing error messages
    const existingError = document.querySelector(".error-message");
    if (existingError) {
      existingError.remove();
    }

    // Create error message element
    const errorElement = document.createElement("div");
    errorElement.className = "error-message";
    errorElement.style.cssText = `
            background: #fee;
            color: #c33;
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid #fcc;
            font-size: 14px;
            text-align: center;
        `;
    errorElement.textContent = message;

    // Insert error message at the top of the current form
    const currentForm = document.querySelector(
      ".step-content.active .onboarding-form"
    );
    if (currentForm) {
      currentForm.insertBefore(errorElement, currentForm.firstChild);
    }

    // Auto-remove error after 5 seconds
    setTimeout(() => {
      if (errorElement.parentNode) {
        errorElement.remove();
      }
    }, 5000);
  }
}

// Global functions for button clicks
function goToStep(stepNumber) {
  if (window.onboardingManager) {
    window.onboardingManager.goToStep(stepNumber);
  }
}

function redirectToDashboard() {
  window.location.href = "/dashboard";
}

// Initialize onboarding when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.onboardingManager = new OnboardingManager();
});

// Check if user has already been onboarded
function checkOnboardingStatus() {
  const isOnboarded = sessionStorage.getItem("onboarded");
  const courseProfile = sessionStorage.getItem("courseProfile");
  const currentPath = window.location.pathname;

  // If user is already onboarded and trying to access onboarding page, redirect to dashboard
  if (isOnboarded === "true" && currentPath === "/onboarding") {
    window.location.href = "/dashboard";
    return;
  }

  // If user has a course profile (logged in via existing course) and trying to access onboarding, redirect to dashboard
  if (courseProfile && currentPath === "/onboarding") {
    window.location.href = "/dashboard";
    return;
  }

  // If user hasn't been onboarded and not on onboarding page, redirect to onboarding
  // Exclude certain pages that don't require onboarding
  const publicPages = ["/onboarding", "/", "/index.html"];
  if (
    isOnboarded !== "true" &&
    !courseProfile &&
    !publicPages.includes(currentPath)
  ) {
    window.location.href = "/onboarding";
    return;
  }
}

// Global functions for HTML onclick handlers
function accessCourseDashboard(courseId) {
  if (window.onboardingManager) {
    window.onboardingManager.accessCourseDashboard(courseId);
  }
}

function switchToSetupTab() {
  const setupButton = document.querySelector('[data-tab="setup"]');
  if (setupButton) {
    setupButton.click();
  }
}

// Initialize onboarding when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.onboardingManager = new OnboardingManager();
});

// Run onboarding check when page loads
document.addEventListener("DOMContentLoaded", checkOnboardingStatus);
