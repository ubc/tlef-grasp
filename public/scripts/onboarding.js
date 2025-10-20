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
  const currentPath = window.location.pathname;

  // If user is already onboarded and trying to access onboarding page, redirect to dashboard
  if (isOnboarded === "true" && currentPath === "/onboarding") {
    window.location.href = "/dashboard";
    return;
  }

  // If user hasn't been onboarded and not on onboarding page, redirect to onboarding
  // Exclude certain pages that don't require onboarding
  const publicPages = ["/onboarding", "/", "/index.html"];
  if (isOnboarded !== "true" && !publicPages.includes(currentPath)) {
    window.location.href = "/onboarding";
    return;
  }
}

// Run onboarding check when page loads
document.addEventListener("DOMContentLoaded", checkOnboardingStatus);
