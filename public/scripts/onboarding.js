// Onboarding JavaScript functionality

// Constants for DOM selectors and identifiers
const SELECTORS = {
  loginTab: 'login-tab',
  setupTab: 'setup-tab',
  tabButton: '.tab-button',
  stepContent: '.step-content',
  progressStep: '.progress-step',
  courseSelectionForm: 'course-selection-form',
  courseStructureForm: 'course-structure-form',
  courseDetailsForm: 'course-details-form',
  loadingCourses: 'loading-courses',
  coursesList: 'courses-list',
  noCoursesMessage: 'no-courses-message',
  customCourseGroup: 'custom-course-group',
  customCourseNameGroup: 'custom-course-name-group',
  selectedCourseDisplay: 'selected-course-display',
  stepComplete: 'step-complete',
};

const TAB_NAMES = {
  login: 'login',
  setup: 'setup',
};

const API_ENDPOINTS = {
  currentUser: '/api/current-user',
  myCourses: '/api/courses/my-courses',
  newCourse: '/api/courses/new',
};

const STORAGE_KEYS = {
  selectedCourse: 'grasp-selected-course',
};

/**
 * Manages tab switching functionality
 */
class TabManager {
  constructor(onTabChange) {
    this.elements = {
      loginTab: document.getElementById(SELECTORS.loginTab),
      setupTab: document.getElementById(SELECTORS.setupTab),
      tabButtons: document.querySelectorAll(SELECTORS.tabButton),
    };
    this.onTabChange = onTabChange;
    this.currentTab = null;
  }

  /**
   * Initialize tab event listeners
   * @param {Function} canAccessTab - Callback to check if tab is accessible
   */
  setupListeners(canAccessTab) {
    this.elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        
        if (!canAccessTab(tab)) {
          return;
        }

        this.switchTo(tab);
      });
    });
  }

  /**
   * Switch to a specific tab
   * @param {string} tabName - The tab to switch to ('login' or 'setup')
   */
  switchTo(tabName) {
    if (this.currentTab === tabName) return;

    const { loginTab, setupTab, tabButtons } = this.elements;

    // Update button states
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab visibility
    if (tabName === TAB_NAMES.login) {
      this.hideTab(setupTab);
      this.showTab(loginTab);
    } else {
      this.hideTab(loginTab);
      this.showTab(setupTab);
    }

    this.currentTab = tabName;
    
    if (this.onTabChange) {
      this.onTabChange(tabName);
    }
  }

  /**
   * Show a tab element
   * @param {HTMLElement} tab 
   */
  showTab(tab) {
    if (tab) {
      tab.style.display = 'block';
      tab.classList.add('active');
    }
  }

  /**
   * Hide a tab element
   * @param {HTMLElement} tab 
   */
  hideTab(tab) {
    if (tab) {
      tab.style.display = 'none';
      tab.classList.remove('active');
    }
  }

  /**
   * Hide a specific tab button
   * @param {string} tabName 
   */
  hideTabButton(tabName) {
    const button = document.querySelector(`${SELECTORS.tabButton}[data-tab="${tabName}"]`);
    if (button) {
      button.style.display = 'none';
    }
  }

  /**
   * Ensure step 1 is active when showing setup tab
   */
  activateStep1() {
    const step1 = document.getElementById('step-1');
    if (step1) {
      step1.classList.add('active');
    }
  }
}

/**
 * Main onboarding manager class
 */
class OnboardingManager {
  constructor() {
    this.currentStep = 1;
    this.courseData = {};
    this.courses = null;
    this.isFaculty = false;
    
    this.cacheElements();
    this.tabManager = new TabManager((tab) => this.handleTabChange(tab));
    this.init();
  }

  /**
   * Cache frequently accessed DOM elements
   */
  cacheElements() {
    this.elements = {
      courseSelectionForm: document.getElementById(SELECTORS.courseSelectionForm),
      courseStructureForm: document.getElementById(SELECTORS.courseStructureForm),
      courseDetailsForm: document.getElementById(SELECTORS.courseDetailsForm),
      loadingCourses: document.getElementById(SELECTORS.loadingCourses),
      coursesList: document.getElementById(SELECTORS.coursesList),
      noCoursesMessage: document.getElementById(SELECTORS.noCoursesMessage),
      customCourseGroup: document.getElementById(SELECTORS.customCourseGroup),
      customCourseNameGroup: document.getElementById(SELECTORS.customCourseNameGroup),
      selectedCourseDisplay: document.getElementById(SELECTORS.selectedCourseDisplay),
    };
  }

  async init() {
    await this.loadUserInfo();
    this.setupEventListeners();
    this.tabManager.setupListeners((tab) => this.canAccessTab(tab));
    this.updateProgressIndicator();
    this.updateUIForUserRole();
    await this.determineInitialTab();
  }

  /**
   * Check if user can access a specific tab
   * @param {string} tab 
   * @returns {boolean}
   */
  canAccessTab(tab) {
    if (tab === TAB_NAMES.setup && !this.isFaculty) {
      return false;
    }
    return true;
  }

  /**
   * Handle tab change events
   * @param {string} tab 
   */
  handleTabChange(tab) {
    if (tab === TAB_NAMES.login) {
      this.loadExistingCourses(this.courses);
    } else {
      this.tabManager.activateStep1();
    }
  }

  async loadUserInfo() {
    try {
      const response = await fetch(API_ENDPOINTS.currentUser);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.isFaculty = data.user.isFaculty || false;
        }
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  }

  updateUIForUserRole() {
    if (this.isFaculty) return;

    // Hide setup tab button for staff
    this.tabManager.hideTabButton(TAB_NAMES.setup);

    // Hide custom course input groups for staff
    const { customCourseGroup, customCourseNameGroup, noCoursesMessage } = this.elements;
    
    if (customCourseGroup) {
      customCourseGroup.style.display = 'none';
    }
    if (customCourseNameGroup) {
      customCourseNameGroup.style.display = 'none';
    }

    // Update no-courses message for staff
    if (noCoursesMessage) {
      const createButton = noCoursesMessage.querySelector('button');
      if (createButton) {
        createButton.style.display = 'none';
      }
      const messageText = noCoursesMessage.querySelector('p');
      if (messageText) {
        messageText.textContent = "You don't have any courses set up yet. Please contact a faculty member to add you to a course.";
      }
    }
  }

  setupEventListeners() {
    const { courseSelectionForm, courseStructureForm, courseDetailsForm } = this.elements;

    if (courseSelectionForm) {
      courseSelectionForm.addEventListener('submit', (e) => this.handleCourseSelection(e));
    }

    if (courseStructureForm) {
      courseStructureForm.addEventListener('submit', (e) => this.handleCourseStructure(e));
    }

    if (courseDetailsForm) {
      courseDetailsForm.addEventListener('submit', (e) => this.handleCourseDetails(e));
    }

    // Event delegation for course access buttons
    const coursesListElement = this.elements.coursesList;
    if (coursesListElement) {
      coursesListElement.addEventListener('click', (e) => {
        const accessBtn = e.target.closest('.access-btn');
        if (accessBtn) {
          this.accessCourseDashboard(accessBtn);
        }
      });
    }
  }

  async determineInitialTab() {
    try {
      const response = await fetch(API_ENDPOINTS.myCourses);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const hasCourses = data.success && data.courses && data.courses.length > 0;
      
      // Store courses in state to avoid duplicate API calls
      this.courses = data.success && data.courses ? data.courses : [];
      
      // Staff users or faculty with courses -> login tab
      // Faculty without courses -> setup tab
      const shouldShowLoginTab = !this.isFaculty || hasCourses;
      const initialTab = shouldShowLoginTab ? TAB_NAMES.login : TAB_NAMES.setup;
      
      this.tabManager.switchTo(initialTab);
      
      if (initialTab === TAB_NAMES.setup) {
        this.tabManager.activateStep1();
      }
    } catch (error) {
      console.error('Error checking for existing courses:', error);
      // Default to login tab for staff, setup for faculty
      const fallbackTab = this.isFaculty ? TAB_NAMES.setup : TAB_NAMES.login;
      this.tabManager.switchTo(fallbackTab);
      
      if (fallbackTab === TAB_NAMES.login) {
        this.loadExistingCourses(null);
      }
    }
  }

  async loadExistingCourses(coursesFromState = null) {
    const { loadingCourses, coursesList, noCoursesMessage } = this.elements;

    try {
      // Show loading state only if we need to fetch from API
      if (!coursesFromState) {
        this.setElementVisibility(loadingCourses, true, 'flex');
        this.setElementVisibility(coursesList, false);
        this.setElementVisibility(noCoursesMessage, false);
      }

      let courses = coursesFromState;

      // Only fetch from API if courses not in state
      if (!courses) {
        const response = await fetch(API_ENDPOINTS.myCourses);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        courses = data.success && data.courses ? data.courses : [];
        this.courses = courses;
      }

      if (courses && courses.length > 0) {
        this.displayCourses(courses);
      } else {
        this.showNoCoursesMessage();
      }
    } catch (error) {
      console.error('Error loading courses:', error);
      this.showNoCoursesMessage();
    } finally {
      this.setElementVisibility(loadingCourses, false);
    }
  }

  /**
   * Helper to set element visibility
   * @param {HTMLElement} element 
   * @param {boolean} visible 
   * @param {string} displayType 
   */
  setElementVisibility(element, visible, displayType = 'block') {
    if (element) {
      element.style.display = visible ? displayType : 'none';
    }
  }

  displayCourses(courses) {
    const { coursesList, noCoursesMessage } = this.elements;

    if (!coursesList) return;

    coursesList.innerHTML = courses.map((course) => this.createCourseItemHTML(course)).join('');
    
    this.setElementVisibility(coursesList, true, 'flex');
    this.setElementVisibility(noCoursesMessage, false);
  }

  /**
   * Generate HTML for a course item
   * @param {Object} course 
   * @returns {string}
   */
  createCourseItemHTML(course) {
    const escapedName = this.escapeHTML(course.courseName);
    const escapedInstructor = this.escapeHTML(course.instructorName);
    const escapedSemester = this.escapeHTML(course.semester);
    
    return `
      <div class="course-item" data-course-id="${course._id}">
        <div class="course-icon">
          <i class="fas fa-graduation-cap"></i>
        </div>
        <div class="course-info">
          <div class="course-name">${escapedName}</div>
          <div class="course-details">
            <span><i class="fas fa-user"></i> ${escapedInstructor}</span>
            <span><i class="fas fa-calendar"></i> ${escapedSemester}</span>
            <span><i class="fas fa-users"></i> ${course.expectedStudents} students</span>
          </div>
        </div>
        <div class="course-actions">
          <button class="access-btn" data-course-id="${course._id}" data-course-name="${escapedName}" title="Access Dashboard">
            <i class="fas fa-arrow-right"></i>
            <span>Access</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str 
   * @returns {string}
   */
  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showNoCoursesMessage() {
    const { coursesList, noCoursesMessage } = this.elements;
    this.setElementVisibility(coursesList, false);
    this.setElementVisibility(noCoursesMessage, true);
  }

  accessCourseDashboard(buttonElement) {
    try {
      const courseId = buttonElement.dataset.courseId;
      const courseName = buttonElement.dataset.courseName;
      
      sessionStorage.setItem(
        STORAGE_KEYS.selectedCourse,
        JSON.stringify({ id: courseId, name: courseName })
      );

      window.location.href = '/dashboard';
    } catch (error) {
      console.error('Error accessing course dashboard:', error);
      this.showError('Failed to access dashboard. Please try again.');
    }
  }

  handleCourseSelection(e) {
    e.preventDefault();

    if (!this.isFaculty) {
      this.showError('Only faculty can create new courses');
      return;
    }

    const formData = new FormData(e.target);
    const customCourseCode = formData.get('customCourseCode')?.trim();
    const customCourseName = formData.get('customCourseName')?.trim();

    if (!customCourseCode || !customCourseName) {
      this.showError('Please provide both course code and name');
      return;
    }

    this.courseData.courseCode = customCourseCode;
    this.courseData.courseName = customCourseName;

    this.updateSelectedCourseDisplay();
    this.goToStep(2);
  }

  handleCourseStructure(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const courseWeeks = parseInt(formData.get('courseWeeks'), 10);
    const lecturesPerWeek = parseInt(formData.get('lecturesPerWeek'), 10);
    const courseCredits = parseInt(formData.get('courseCredits'), 10);

    if (!courseWeeks || !lecturesPerWeek || !courseCredits) {
      this.showError('Please fill in all required fields');
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
    const instructorName = formData.get('instructorName')?.trim();
    const semester = formData.get('semester')?.trim();
    const expectedStudents = parseInt(formData.get('expectedStudents'), 10);
    const courseDescription = formData.get('courseDescription') || '';

    if (!instructorName || !semester || isNaN(expectedStudents) || expectedStudents <= 0) {
      this.showError('Please fill in all required fields with valid values');
      return;
    }

    if (!this.courseData.courseCode || !this.courseData.courseName) {
      this.showError('Course code and name are missing. Please go back to step 1 and select a course.');
      return;
    }

    Object.assign(this.courseData, {
      instructorName,
      semester,
      expectedStudents,
      courseDescription,
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    const validationError = this.validateCourseData();
    if (validationError) {
      this.showError(validationError);
      return;
    }

    this.showLoading(true);

    try {
      await this.saveCourseProfile();
      this.showCompletion();
    } catch (error) {
      console.error('Error saving course profile:', error);
      this.showError(error.message || 'Failed to save course profile. Please try again.');
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * Validate course data before submission
   * @returns {string|null} Error message or null if valid
   */
  validateCourseData() {
    const requiredFields = ['courseCode', 'courseName', 'instructorName', 'semester', 'expectedStudents'];
    const missingFields = requiredFields.filter((field) => {
      const value = this.courseData[field];
      if (field === 'expectedStudents') {
        return isNaN(value) || value <= 0;
      }
      return !value;
    });

    if (missingFields.length > 0) {
      return `Missing or invalid required fields: ${missingFields.join(', ')}`;
    }
    return null;
  }

  async saveCourseProfile() {
    if (!this.isFaculty) {
      throw new Error('Only faculty can create new courses');
    }

    const response = await fetch(API_ENDPOINTS.newCourse, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.courseData),
    });

    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();

    sessionStorage.setItem(
      STORAGE_KEYS.selectedCourse,
      JSON.stringify({ id: result.course._id, name: result.course.courseName })
    );

    return result;
  }

  goToStep(stepNumber) {
    const currentStepElement = document.querySelector(`${SELECTORS.stepContent}.active`);
    if (currentStepElement) {
      currentStepElement.classList.remove('active');
    }

    const targetStepElement = document.getElementById(`step-${stepNumber}`);
    if (targetStepElement) {
      targetStepElement.classList.add('active');
    }

    this.currentStep = stepNumber;
    this.updateProgressIndicator();
  }

  updateProgressIndicator() {
    const progressSteps = document.querySelectorAll(SELECTORS.progressStep);

    progressSteps.forEach((step, index) => {
      const stepNumber = index + 1;
      step.classList.remove('active', 'completed');

      if (stepNumber === this.currentStep) {
        step.classList.add('active');
      } else if (stepNumber < this.currentStep) {
        step.classList.add('completed');
      }
    });
  }

  updateSelectedCourseDisplay() {
    const { selectedCourseDisplay } = this.elements;
    if (selectedCourseDisplay && this.courseData.courseName) {
      selectedCourseDisplay.textContent = this.courseData.courseName;
    }
  }

  showCompletion() {
    const currentStepElement = document.querySelector(`${SELECTORS.stepContent}.active`);
    if (currentStepElement) {
      currentStepElement.classList.remove('active');
    }

    const completionElement = document.getElementById(SELECTORS.stepComplete);
    if (completionElement) {
      completionElement.classList.add('active', 'success-animation');
    }
  }

  showLoading(show) {
    const forms = document.querySelectorAll('.onboarding-form');
    const buttons = document.querySelectorAll('.continue-btn');

    const method = show ? 'add' : 'remove';
    forms.forEach((form) => form.classList[method]('loading'));
    buttons.forEach((button) => button.classList[method]('loading'));
  }

  showError(message) {
    // Remove existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
      existingError.remove();
    }

    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;

    const currentForm = document.querySelector(`${SELECTORS.stepContent}.active .onboarding-form`);
    if (currentForm) {
      currentForm.insertBefore(errorElement, currentForm.firstChild);
    }

    // Auto-remove error after 5 seconds
    setTimeout(() => {
      errorElement.remove();
    }, 5000);
  }
}

// Global functions for button clicks (keeping minimal global API)
function goToStep(stepNumber) {
  window.onboardingManager?.goToStep(stepNumber);
}

function redirectToDashboard() {
  window.location.href = '/dashboard';
}

function switchToSetupTab() {
  const setupButton = document.querySelector(`${SELECTORS.tabButton}[data-tab="${TAB_NAMES.setup}"]`);
  if (setupButton && setupButton.style.display !== 'none') {
    setupButton.click();
  }
}

// Initialize onboarding when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  if (!window.onboardingManager) {
    window.onboardingManager = new OnboardingManager();
  }
});
