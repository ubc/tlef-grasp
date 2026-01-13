// Onboarding JavaScript functionality
class OnboardingManager {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 3;
    this.courseData = {};
    this.courses = null;
    this.isFaculty = false;
    this.init();
  }

  async init() {
    await this.loadUserInfo();
    this.setupEventListeners();
    this.setupTabSwitching();
    this.updateProgressIndicator();
    this.updateUIForUserRole();
    await this.checkAndSetDefaultTab();
  }

  async loadUserInfo() {
    try {
      const response = await fetch("/api/current-user");
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          // Use isFaculty from API response (includes administrator check)
          this.isFaculty = data.user.isFaculty || false;
        }
      }
    } catch (error) {
      console.error("Error loading user info:", error);
    }
  }

  updateUIForUserRole() {
    // Hide "New Course Setup" tab for staff
    const setupTabButton = document.querySelector('.tab-button[data-tab="setup"]');
    if (setupTabButton && !this.isFaculty) {
      setupTabButton.style.display = 'none';
    }

    // Hide custom course input groups for staff
    const customCourseGroup = document.getElementById("custom-course-group");
    const customCourseNameGroup = document.getElementById("custom-course-name-group");
    if (customCourseGroup && !this.isFaculty) {
      customCourseGroup.style.display = 'none';
    }
    if (customCourseNameGroup && !this.isFaculty) {
      customCourseNameGroup.style.display = 'none';
    }

    // Update no-courses message for staff
    const noCoursesMessage = document.getElementById("no-courses-message");
    if (noCoursesMessage && !this.isFaculty) {
      const createButton = noCoursesMessage.querySelector('button');
      if (createButton) {
        createButton.style.display = 'none';
      }
      const messageText = noCoursesMessage.querySelector('p');
      if (messageText) {
        messageText.textContent = "You don't have any courses set up yet. Please contact a faculty member to add you to a course.";
      }
    }

    // Note: Tab visibility is now handled by checkAndSetDefaultTab() which runs after this
    // This method just hides UI elements, not the tab switching logic
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

  }

  setupTabSwitching() {
    const tabButtons = document.querySelectorAll(".tab-button");
    const loginTab = document.getElementById("login-tab");
    const setupTab = document.getElementById("setup-tab");

    console.log("Setting up tab switching...");
    console.log("Login tab:", loginTab);
    console.log("Setup tab:", setupTab);

    // Default state: setup tab for faculty, login tab for staff
    // This will be overridden by checkAndSetDefaultTab() if user has courses
    if (!this.isFaculty) {
      // Staff: show login tab by default (they can't create courses)
      if (loginTab) {
        loginTab.style.display = "block";
        loginTab.style.visibility = "visible";
        loginTab.classList.add("active");
      }
      if (setupTab) {
        setupTab.style.display = "none";
        setupTab.classList.remove("active");
      }
      // Update tab buttons
      tabButtons.forEach((btn) => {
        if (btn.getAttribute("data-tab") === "login") {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    } else {
      // Faculty: show setup tab by default (will be changed if they have courses)
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
    }

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.getAttribute("data-tab");
        console.log("Tab clicked:", tab);

        // Prevent staff from accessing setup tab
        if (tab === "setup" && !this.isFaculty) {
          console.warn("Staff users cannot access course setup");
          return;
        }

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
            // Use courses from state if available, otherwise fetch from API
            this.loadExistingCourses(this.courses);
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

  async checkAndSetDefaultTab() {
    try {
      // Check if user has existing courses
      const response = await fetch("/api/courses/my-courses");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Determine which tab to show based on user role and course availability
      const hasCourses = data.success && data.courses && data.courses.length > 0;
      
      // Store courses in state (even if empty array) to avoid duplicate API call
      this.courses = data.success && data.courses ? data.courses : [];
      
      // Logic:
      // 1. Staff users -> always show login tab (they can't create courses)
      // 2. Faculty with courses -> show login tab (existing behavior)
      // 3. Faculty without courses -> show setup tab (default for faculty)
      const shouldShowLoginTab = !this.isFaculty || hasCourses;
      
      if (shouldShowLoginTab) {
        // Switch to login tab
        const tabButtons = document.querySelectorAll(".tab-button");
        const loginButton = document.querySelector('[data-tab="login"]');
        const loginTab = document.getElementById("login-tab");
        const setupTab = document.getElementById("setup-tab");
        
        // Update active tab button
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        if (loginButton) loginButton.classList.add("active");
        
        // Show/hide appropriate content
        if (loginTab) {
          loginTab.style.display = "block";
          loginTab.style.visibility = "visible";
          loginTab.classList.add("active");
        }
        if (setupTab) {
          setupTab.style.display = "none";
          setupTab.style.visibility = "hidden";
          setupTab.classList.remove("active");
        }
        
        // Load courses into the login tab using the courses we already fetched
        // Pass the courses array (even if empty) to avoid duplicate API call
        this.loadExistingCourses(this.courses);
      }
      // If faculty without courses, setup tab is already shown by setupTabSwitching()
    } catch (error) {
      console.error("Error checking for existing courses:", error);
      // On error, default based on user role:
      // Staff -> login tab, Faculty -> setup tab
      if (!this.isFaculty) {
        const tabButtons = document.querySelectorAll(".tab-button");
        const loginButton = document.querySelector('[data-tab="login"]');
        const loginTab = document.getElementById("login-tab");
        const setupTab = document.getElementById("setup-tab");
        
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        if (loginButton) loginButton.classList.add("active");
        if (loginTab) {
          loginTab.style.display = "block";
          loginTab.style.visibility = "visible";
          loginTab.classList.add("active");
        }
        if (setupTab) {
          setupTab.style.display = "none";
          setupTab.classList.remove("active");
        }
        
        // Load courses (will show "no courses" message if fetch fails)
        this.loadExistingCourses(null);
      }
    }
  }

  setupCourseSelection() {
    // This method sets up course selection for the login tab
    // Courses will be loaded when the login tab is activated
  }

  async loadExistingCourses(coursesFromState = null) {
    const loadingElement = document.getElementById("loading-courses");
    const coursesListElement = document.getElementById("courses-list");
    const noCoursesElement = document.getElementById("no-courses-message");

    try {
      // Show loading state only if we need to fetch from API
      if (!coursesFromState) {
        if (loadingElement) loadingElement.style.display = "flex";
        if (coursesListElement) coursesListElement.style.display = "none";
        if (noCoursesElement) noCoursesElement.style.display = "none";
      }

      let courses = coursesFromState;

      // Only fetch from API if courses not in state
      if (!courses) {
        const response = await fetch("/api/courses/my-courses");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        courses = data.success && data.courses ? data.courses : [];
        // Store in state for future use
        this.courses = courses;
      }

      if (courses && courses.length > 0) {
        this.displayCourses(courses);
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
      courseItem.dataset.courseId = course._id;

      courseItem.innerHTML = `
        <div class="course-icon">
          <i class="fas fa-graduation-cap"></i>
        </div>
        <div class="course-info">
          <div class="course-name">${course.courseName}</div>
          <div class="course-details">
            <span><i class="fas fa-user"></i> ${course.instructorName}</span>
            <span><i class="fas fa-calendar"></i> ${course.semester}</span>
            <span><i class="fas fa-users"></i> ${course.expectedStudents} students</span>
          </div>
        </div>
        <div class="course-actions">
          <button class="access-btn" data-course-id="${course._id}" data-course-name="${course.courseName}" onclick="accessCourseDashboard(this)" title="Access Dashboard">
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

  async accessCourseDashboard(buttonElement) {
    try {
      // Show loading state
      const button = buttonElement || event.target.closest(".access-btn");
      const originalText = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Accessing...';
      button.disabled = true;

      // Get course data from data attributes
      const courseId = button.dataset.courseId;
      const courseName = button.dataset.courseName;
      
      console.log("Accessing course:", { id: courseId, name: courseName });
      sessionStorage.setItem("grasp-selected-course", JSON.stringify({id: courseId, name: courseName}));

      window.location.href = "/dashboard";
    } catch (error) {
      console.error("Error accessing course dashboard:", error);
      this.showError("Failed to access dashboard. Please try again.");

      // Reset button state
      if (button) {
        button.innerHTML = originalText;
        button.disabled = false;
      }
    }
  }

  handleCourseSelection(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const customCourseCode = formData.get("customCourseCode");
    const customCourseName = formData.get("customCourseName");

    // Staff cannot create new courses
    if (!this.isFaculty) {
      this.showError("Only faculty can create new courses");
      return;
    }

    if (!customCourseCode || !customCourseName) {
      this.showError("Please provide both course code and name");
      return;
    }

    this.courseData.courseCode = customCourseCode.trim();
    this.courseData.courseName = customCourseName.trim();

    // Validate that we have both code and name
    if (!this.courseData.courseCode || !this.courseData.courseName) {
      this.showError("Please provide both course code and name");
      return;
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

    if (!instructorName || !semester || isNaN(expectedStudents) || expectedStudents <= 0) {
      this.showError("Please fill in all required fields with valid values");
      return;
    }

    // Validate that all required fields from previous steps are present
    if (!this.courseData.courseCode || !this.courseData.courseName) {
      this.showError("Course code and name are missing. Please go back to step 1 and select a course.");
      return;
    }

    this.courseData.instructorName = instructorName.trim();
    this.courseData.semester = semester.trim();
    this.courseData.expectedStudents = expectedStudents;
    this.courseData.courseDescription = courseDescription || "";
    this.courseData.status = "active";
    this.courseData.createdAt = new Date().toISOString();

    // Validate all required fields one more time before sending
    const requiredFields = {
      courseCode: this.courseData.courseCode,
      courseName: this.courseData.courseName,
      instructorName: this.courseData.instructorName,
      semester: this.courseData.semester,
      expectedStudents: this.courseData.expectedStudents,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value || (key === 'expectedStudents' && (isNaN(value) || value <= 0)))
      .map(([key]) => key);

    if (missingFields.length > 0) {
      this.showError(`Missing or invalid required fields: ${missingFields.join(", ")}`);
      return;
    }

    // Show loading state
    this.showLoading(true);

    try {
      // Save course profile to backend
      await this.saveCourseProfile();

      // Show completion step
      this.showCompletion();
    } catch (error) {
      console.error("Error saving course profile:", error);
      const errorMessage = error.message || "Failed to save course profile. Please try again.";
      this.showError(errorMessage);
    } finally {
      this.showLoading(false);
    }
  }


  async saveCourseProfile() {
    try {
      // Staff cannot create new courses
      if (!this.isFaculty) {
        this.showError("Only faculty can create new courses");
        return;
      }

      // Log the data being sent for debugging
      console.log("Saving course profile with data:", this.courseData);

      const response = await fetch("/api/courses/new", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.courseData),
      });

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          console.error("Backend error response:", errorData);
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log("Course profile saved successfully:", result);

      sessionStorage.setItem("grasp-selected-course", JSON.stringify({id: result.course._id, name: result.course.courseName}));
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

// Global functions for HTML onclick handlers
function accessCourseDashboard(buttonElement) {
  if (window.onboardingManager) {
    window.onboardingManager.accessCourseDashboard(buttonElement);
  }
}

function switchToSetupTab() {
  // Check if user is faculty before allowing tab switch
  // This is a fallback - the tab should already be hidden for staff
  const setupButton = document.querySelector('[data-tab="setup"]');
  if (setupButton && setupButton.style.display !== 'none') {
    setupButton.click();
  } else {
    console.warn("Course creation is not available for staff users");
  }
}

// Initialize onboarding when DOM is loaded (only once)
document.addEventListener("DOMContentLoaded", () => {
  if (!window.onboardingManager) {
    window.onboardingManager = new OnboardingManager();
  }
});