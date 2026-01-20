// GRASP Dashboard JavaScript - Dynamic Data Loading

// Constants
const SELECTORS = {
  welcomeMessage: 'welcome-message',
  currentDate: 'current-date',
  calendarHeader: '.calendar-header h4',
  calendarDays: '.calendar-days',
  quickStartCards: '.quick-start-card',
  flaggedCount: 'flagged-count',
  viewFlaggedBtn: 'view-flagged-btn',
  noFlaggedData: 'no-flagged-data',
};

const API_ENDPOINTS = {
  currentUser: '/api/current-user',
  questions: '/api/question',
};

const ROUTES = {
  courseMaterials: '/course-materials',
  questionBank: '/question-bank',
  questionBankReview: '/question-bank?tab=review',
  questionBankFlagged: '/question-bank?tab=overview&flagged=true',
  quiz: '/quiz',
  users: '/users',
};

const QUICK_ACTIONS = {
  upload: ROUTES.courseMaterials,
  review: ROUTES.questionBankReview,
  questions: ROUTES.questionBank,
  users: ROUTES.users,
};

const STORAGE_KEYS = {
  selectedCourse: 'grasp-selected-course',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Calendar component for displaying and managing a monthly calendar view
 */
class Calendar {
  constructor(headerSelector, daysSelector) {
    this.headerElement = document.querySelector(headerSelector);
    this.daysElement = document.querySelector(daysSelector);
  }

  /**
   * Initialize the calendar with the current month
   */
  render() {
    if (!this.headerElement || !this.daysElement) {
    return;
  }
  
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const currentDate = today.getDate();
  
    this.renderHeader(currentMonth, currentYear);
    this.renderDays(currentYear, currentMonth, currentDate);
  }

  /**
   * Render the calendar header with month and year
   */
  renderHeader(month, year) {
    this.headerElement.textContent = `${MONTH_NAMES[month]} ${year}`;
  }

  /**
   * Render all calendar days including previous/next month padding
   */
  renderDays(year, month, highlightDate) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  
    // Adjust starting day for Monday-first calendar
    const startingDayOfWeek = firstDay.getDay();
  const adjustedStartingDay = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;
  
  // Get previous month's last days
    const prevMonthLastDay = new Date(year, month, 0);
    const daysInPrevMonth = prevMonthLastDay.getDate();
  
    // Clear and rebuild calendar
    this.daysElement.innerHTML = '';
  
  // Add previous month's trailing days
    this.addPreviousMonthDays(daysInPrevMonth, adjustedStartingDay);

    // Add current month's days
    this.addCurrentMonthDays(daysInMonth, highlightDate);

    // Add next month's leading days
    this.addNextMonthDays();
  }

  /**
   * Add days from the previous month to fill the first week
   */
  addPreviousMonthDays(daysInPrevMonth, startOffset) {
    for (let i = startOffset - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
      this.createDayElement(day, 'other-month');
    }
  }
  
  /**
   * Add days for the current month
   */
  addCurrentMonthDays(daysInMonth, highlightDate) {
  for (let day = 1; day <= daysInMonth; day++) {
      const className = day === highlightDate ? 'current-day' : '';
      this.createDayElement(day, className);
    }
  }
  
  /**
   * Add days from the next month to fill remaining cells
   */
  addNextMonthDays() {
    const totalCells = this.daysElement.children.length;
    const remainingCells = 42 - totalCells; // 6 rows × 7 days
  
  for (let day = 1; day <= remainingCells; day++) {
      this.createDayElement(day, 'other-month');
    }
  }

  /**
   * Create and append a day element
   */
  createDayElement(day, className = '') {
    const dayElement = document.createElement('span');
    if (className) {
      dayElement.className = className;
    }
    dayElement.textContent = day;
    this.daysElement.appendChild(dayElement);
  }
}

/**
 * Manages the flagged questions section of the dashboard
 */
class FlaggedQuestionsManager {
  constructor() {
    this.elements = {
      count: document.getElementById(SELECTORS.flaggedCount),
      viewButton: document.getElementById(SELECTORS.viewFlaggedBtn),
      noDataMessage: document.getElementById(SELECTORS.noFlaggedData),
    };
    this.listenerAttached = false;
  }

  /**
   * Load and display flagged questions count
   */
  async load() {
    try {
      const selectedCourse = this.getSelectedCourse();

      if (!selectedCourse?.id) {
        this.updateDisplay(0);
      return;
    }

      const response = await fetch(`${API_ENDPOINTS.questions}?courseId=${selectedCourse.id}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
      const flaggedCount = this.countFlaggedQuestions(data);
      this.updateDisplay(flaggedCount);
    } catch (error) {
      console.error('Error loading flagged questions count:', error);
      this.updateDisplay(0);
    }
  }

  /**
   * Get selected course from session storage
   */
  getSelectedCourse() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.selectedCourse) || '{}');
    } catch {
      return {};
    }
  }

  /**
   * Count flagged questions from API response
   */
  countFlaggedQuestions(data) {
    if (data.success && data.questions) {
      return data.questions.filter((q) => q.flagStatus === true).length;
    }
    return 0;
  }

  /**
   * Update the UI based on flagged count
   */
  updateDisplay(count) {
    const { count: countEl, viewButton, noDataMessage } = this.elements;

    if (countEl) {
      countEl.textContent = count;
  }

    const hasFlagged = count > 0;
    
    if (viewButton) {
      viewButton.style.display = hasFlagged ? 'flex' : 'none';
    }
    if (noDataMessage) {
      noDataMessage.style.display = hasFlagged ? 'none' : 'block';
    }

    this.attachButtonListener();
  }

  /**
   * Attach click listener to view button (only once)
   */
  attachButtonListener() {
    const { viewButton } = this.elements;
    
    if (viewButton && !this.listenerAttached) {
      this.listenerAttached = true;
      viewButton.addEventListener('click', () => {
        window.location.href = ROUTES.questionBankFlagged;
      });
    }
  }
}

/**
 * Main dashboard manager class
 */
class DashboardManager {
  constructor() {
    this.calendar = new Calendar(SELECTORS.calendarHeader, SELECTORS.calendarDays);
    this.flaggedQuestions = new FlaggedQuestionsManager();
    this.elements = {
      welcomeMessage: document.getElementById(SELECTORS.welcomeMessage),
      currentDate: document.getElementById(SELECTORS.currentDate),
      quickStartCards: document.querySelectorAll(SELECTORS.quickStartCards),
    };
  }

  /**
   * Initialize the dashboard
   */
  async init() {
    try {
      // Check user role first and redirect students - stop initialization if redirect happens
      const redirected = await this.checkUserRole();
      if (redirected) {
        return; // Stop initialization if student was redirected
      }
      
      this.initNavigation();
      await this.loadUserData();
      this.updateCurrentDate();
      this.calendar.render();
      this.setupQuickStartCards();
      await this.flaggedQuestions.load();
    } catch (error) {
      console.error('Error initializing dashboard:', error);
    }
  }

  /**
   * Check user role and redirect students (or faculty/staff viewing as students) to student dashboard
   * This prevents students and faculty/staff in student view from seeing the faculty dashboard
   */
  async checkUserRole() {
    try {
      // First check localStorage for current view mode (for faculty/staff role switching)
      const currentViewRole = localStorage.getItem('grasp-current-role');
      if (currentViewRole === 'student') {
        window.location.href = '/student-dashboard';
        return true; // Indicate redirect happened
      }

      // Then check actual user role from API
      const response = await fetch(API_ENDPOINTS.currentUser);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          // If user is a student, redirect to student dashboard immediately
          if (data.user.isStudent || data.user.role === 'student') {
            window.location.href = '/student-dashboard';
            return true; // Indicate redirect happened
          }
        }
      }
    } catch (error) {
      console.error('Error checking user role:', error);
    }
    return false; // No redirect needed
  }

  /**
   * Initialize shared navigation component
   */
  initNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }

  /**
   * Load current user data and update welcome message
   */
  async loadUserData() {
    try {
      const response = await fetch(API_ENDPOINTS.currentUser);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.user) {
        this.updateWelcomeMessage(data.user.displayName);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  }

  /**
   * Update the welcome message with instructor name
   */
  updateWelcomeMessage(instructorName) {
    const { welcomeMessage } = this.elements;
    if (welcomeMessage && instructorName) {
      welcomeMessage.textContent = `Hello, ${instructorName}`;
    }
  }

  /**
   * Update the current date display
   */
  updateCurrentDate() {
    const { currentDate } = this.elements;
    if (currentDate) {
      const now = new Date();
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      currentDate.textContent = now.toLocaleDateString('en-US', options);
    }
  }

  /**
   * Setup click handlers for quick start cards
   */
  setupQuickStartCards() {
    this.elements.quickStartCards.forEach((card) => {
      card.addEventListener('click', () => {
        const actionText = card.querySelector('span')?.textContent?.toLowerCase();
        this.handleQuickStartAction(actionText);
      });
    });
  }

  /**
   * Handle quick start card click actions
   */
  handleQuickStartAction(action) {
    const route = QUICK_ACTIONS[action];
    if (route) {
      window.location.href = route;
    }
  }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new DashboardManager();
  dashboard.init();

  // Export for potential external use
window.GRASPDashboard = {
    handleQuickStartAction: (action) => dashboard.handleQuickStartAction(action),
    loadFlaggedQuestionsCount: () => dashboard.flaggedQuestions.load(),
};
});
