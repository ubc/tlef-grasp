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
            // Always reload courses when switching to login tab to get latest data
            // This ensures newly created courses appear immediately
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
    // Load courses when login tab is activated
    const loginTabButton = document.querySelector('[data-tab="login"]');
    if (loginTabButton) {
      loginTabButton.addEventListener('click', () => {
        // Load courses when login tab is clicked
        this.loadExistingCourses();
      });
    }
    
    // Also load courses if login tab is already active on page load
    const loginTab = document.getElementById("login-tab");
    if (loginTab && loginTab.style.display !== "none") {
      this.loadExistingCourses();
    }
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

      // First, try to fetch courses from API
      let courses = [];
      try {
        const response = await fetch("/api/courses");
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.courses && data.courses.length > 0) {
            courses = data.courses;
            
            // Update localStorage backup with server data
            try {
              localStorage.setItem('savedCourses', JSON.stringify(courses));
            } catch (e) {
              console.warn('Could not update localStorage backup:', e);
            }
          }
        }
      } catch (apiError) {
        console.warn("API fetch failed, trying localStorage backup:", apiError);
      }
      
      // If API returned no courses, try localStorage backup
      if (courses.length === 0) {
        try {
          const savedCourses = JSON.parse(localStorage.getItem('savedCourses') || '[]');
          if (savedCourses.length > 0) {
            courses = savedCourses;
            console.log(`Loaded ${courses.length} course(s) from localStorage backup`);
            
            // Try to restore courses to server
            this.restoreCoursesToServer(courses);
          }
        } catch (localError) {
          console.error("Error loading from localStorage:", localError);
        }
      }

      if (courses.length > 0) {
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
  
  async restoreCoursesToServer(courses) {
    // Try to restore courses to server if they're missing
    // This helps when server restarts and loses in-memory data
    try {
      for (const course of courses) {
        // Check if course exists on server
        const checkResponse = await fetch(`/api/courses/${course.id}`);
        if (!checkResponse.ok) {
          // Course doesn't exist on server, try to restore it
          console.log(`Restoring course ${course.id} to server...`);
          const restoreResponse = await fetch("/api/courses", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              courseCode: course.code,
              courseTitle: course.name,
              courseName: course.fullName,
              instructorName: course.instructor,
              semester: course.semester,
              expectedStudents: course.students,
              courseDescription: course.description || "",
              courseWeeks: course.weeks || null,
              lecturesPerWeek: course.lecturesPerWeek || null,
              courseCredits: course.credits || null,
              status: course.status || "active",
            }),
          });
          
          if (restoreResponse.ok) {
            console.log(`Course ${course.id} restored to server`);
          }
        }
      }
    } catch (error) {
      console.error("Error restoring courses to server:", error);
      // Don't throw - this is a background operation
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

      // Use fullName if available, otherwise construct from code and name
      const courseDisplayName = course.fullName || course.name || `${course.code} - ${course.name || ''}`;
      const instructorName = course.instructor || "N/A";
      const semester = course.semester || "N/A";
      const studentCount = course.students || 0;

      courseItem.innerHTML = `
        <div class="course-icon">
          <i class="fas fa-graduation-cap"></i>
        </div>
        <div class="course-info">
          <div class="course-name">${courseDisplayName}</div>
          <div class="course-details">
            <span><i class="fas fa-user"></i> ${instructorName}</span>
            <span><i class="fas fa-calendar"></i> ${semester}</span>
            <span><i class="fas fa-users"></i> ${studentCount} students</span>
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
        // Store course profile in both localStorage and sessionStorage for persistence
        const profile = {
          instructorName: data.course.instructor,
          courseId: data.course.id,
          courseName: data.course.fullName || data.course.name || `${data.course.code} - ${data.course.name}`,
          courseCode: data.course.code,
          courseTitle: data.course.name,
          semester: data.course.semester,
          expectedStudents: data.course.students,
          loginTime: new Date().toISOString(),
        };
        
        // Store in localStorage for persistence across reloads
        localStorage.setItem("courseProfile", JSON.stringify(profile));
        localStorage.setItem("onboarded", "true");
        
        // Also store in sessionStorage for backward compatibility
        sessionStorage.setItem("courseProfile", JSON.stringify(profile));
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
      this.courseData.courseCode = customCourseCode.trim();
      this.courseData.courseTitle = customCourseTitle.trim();
      this.courseData.courseName = `${customCourseCode.trim()} - ${customCourseTitle.trim()}`;
    } else {
      // Handle preset courses - split by " - " to get code and title
      this.courseData.courseName = courseName;
      const parts = courseName.split(" - ");
      
      if (parts.length >= 2) {
        this.courseData.courseCode = parts[0].trim();
        this.courseData.courseTitle = parts.slice(1).join(" - ").trim(); // Join in case title contains " - "
      } else {
        // Fallback: if no " - " found, try to extract code from beginning
        const codeMatch = courseName.match(/^([A-Z]+\s*\d+)/);
        if (codeMatch) {
          this.courseData.courseCode = codeMatch[1].trim();
          this.courseData.courseTitle = courseName.replace(codeMatch[1], "").trim();
        } else {
          // Last resort: use course name as both code and title
          this.courseData.courseCode = courseName;
          this.courseData.courseTitle = courseName;
        }
      }
    }

    // Validate that we have both code and title
    if (!this.courseData.courseCode || !this.courseData.courseTitle) {
      console.error("Failed to parse course:", {
        courseName,
        courseCode: this.courseData.courseCode,
        courseTitle: this.courseData.courseTitle,
      });
      this.showError("Failed to parse course information. Please try again or create a custom course.");
      return;
    }

    console.log("Course selected:", {
      courseName: this.courseData.courseName,
      courseCode: this.courseData.courseCode,
      courseTitle: this.courseData.courseTitle,
    });

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

    // Preserve course code and title when moving to next step
    if (!this.courseData.courseCode || !this.courseData.courseTitle) {
      console.error("Course code or title missing in step 2:", this.courseData);
      this.showError("Course information is missing. Please go back and select a course again.");
      return;
    }

    this.courseData.courseWeeks = courseWeeks;
    this.courseData.lecturesPerWeek = lecturesPerWeek;
    this.courseData.courseCredits = courseCredits;

    console.log("Moving to step 3 with course data:", {
      courseCode: this.courseData.courseCode,
      courseTitle: this.courseData.courseTitle,
      courseName: this.courseData.courseName,
    });

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

    // Verify course code and title are still present before saving
    if (!this.courseData.courseCode || !this.courseData.courseTitle) {
      console.error("Course code or title missing in step 3:", this.courseData);
      this.showError("Course information is missing. Please go back to step 1 and select a course again.");
      return;
    }

    this.courseData.instructorName = instructorName;
    this.courseData.semester = semester;
    this.courseData.expectedStudents = expectedStudents;
    this.courseData.courseDescription = courseDescription || "";
    this.courseData.status = "active";
    this.courseData.createdAt = new Date().toISOString();

    // Ensure courseName is set if it's missing
    if (!this.courseData.courseName) {
      this.courseData.courseName = `${this.courseData.courseCode} - ${this.courseData.courseTitle}`;
    }

    console.log("Saving course with data:", {
      courseCode: this.courseData.courseCode,
      courseTitle: this.courseData.courseTitle,
      courseName: this.courseData.courseName,
      instructorName: this.courseData.instructorName,
      semester: this.courseData.semester,
    });

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
      // Ensure all required fields are present
      if (!this.courseData.courseCode || !this.courseData.courseTitle) {
        throw new Error("Missing course code or title. Please go back and select a course.");
      }

      // Prepare the request body with all required fields
      const requestBody = {
        courseCode: this.courseData.courseCode,
        courseTitle: this.courseData.courseTitle,
        courseName: this.courseData.courseName || `${this.courseData.courseCode} - ${this.courseData.courseTitle}`,
        instructorName: this.courseData.instructorName,
        semester: this.courseData.semester,
        expectedStudents: this.courseData.expectedStudents,
        courseDescription: this.courseData.courseDescription || "",
        courseWeeks: this.courseData.courseWeeks || null,
        lecturesPerWeek: this.courseData.lecturesPerWeek || null,
        courseCredits: this.courseData.courseCredits || null,
        status: this.courseData.status || "active",
      };

      console.log("Saving course profile with data:", requestBody);

      const response = await fetch("/api/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
        console.error("Error response:", errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log("Course profile saved successfully:", result);
      
      // Store the course ID and full course data from the response
      if (result.course && result.course.id) {
        this.courseData.courseId = result.course.id;
        // Store the full course object for later use
        this.courseData.savedCourse = result.course;
      }
      
      // Store course in localStorage as backup (persists across server restarts)
      try {
        const savedCourses = JSON.parse(localStorage.getItem('savedCourses') || '[]');
        // Check if course already exists in localStorage
        const existingIndex = savedCourses.findIndex(c => c.id === result.course.id);
        if (existingIndex >= 0) {
          savedCourses[existingIndex] = result.course;
        } else {
          savedCourses.push(result.course);
        }
        localStorage.setItem('savedCourses', JSON.stringify(savedCourses));
        console.log('Course saved to localStorage backup');
      } catch (error) {
        console.error('Error saving course to localStorage:', error);
      }
      
      // After successful save, always refresh courses list in login tab
      // This ensures the newly created course appears immediately
      // We refresh even if login tab is not visible, so it's ready when user switches to it
      setTimeout(() => {
        this.loadExistingCourses();
        console.log("Courses list refreshed after saving new course");
      }, 300);
      
      // Also mark that we should refresh when login tab is opened
      this.refreshCoursesList = true;
      
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

    // Mark as onboarded - use localStorage for persistence across reloads
    localStorage.setItem("onboarded", "true");
    localStorage.setItem("courseProfile", JSON.stringify(this.courseData));
    // Also save to sessionStorage for backward compatibility
    sessionStorage.setItem("onboarded", "true");
    sessionStorage.setItem("courseProfile", JSON.stringify(this.courseData));

    // Refresh the courses list in the login tab so the newly created course appears
    // This will be called when the user switches to the login tab
    this.refreshCoursesList = true;
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
  // Redirect to dashboard after course creation
  window.location.href = "/dashboard.html";
}

// Initialize onboarding when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.onboardingManager = new OnboardingManager();
});

// Check if user has already been onboarded
function checkOnboardingStatus() {
  // Check both localStorage (persistent) and sessionStorage (for backward compatibility)
  const isOnboarded = localStorage.getItem("onboarded") || sessionStorage.getItem("onboarded");
  const courseProfile = localStorage.getItem("courseProfile") || sessionStorage.getItem("courseProfile");
  const currentPath = window.location.pathname;

  // Only redirect if truly onboarded AND has course profile (to avoid loops)
  // The onboarding-check.js will handle most redirects, so we're more conservative here
  if (isOnboarded === "true" && courseProfile && (currentPath === "/onboarding" || currentPath === "/onboarding.html")) {
    console.log("Onboarding: User already onboarded with profile, redirecting to dashboard");
    // Use a small delay to avoid conflicts with onboarding-check.js
    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 300);
    return;
  }

  // Don't redirect from other pages here - let onboarding-check.js handle it
  // This prevents conflicts and redirect loops
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
// Note: checkOnboardingStatus is now handled by onboarding-check.js
// We don't call it here to avoid redirect loops
// The onboarding-check.js script will handle redirects appropriately
