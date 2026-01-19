// GRASP Student Dashboard JavaScript

// Constants
const SELECTORS = {
  welcomeMessage: 'welcome-message',
  currentDate: 'current-date',
  noCourseWelcome: 'no-course-welcome-message',
  noCourseDate: 'no-course-date',
  calendarHeader: '.calendar-header h4',
  calendarDays: '.calendar-days',
  quickStartCards: '.quick-start-card',
  noCourseState: 'noCourseState',
  dashboardContent: 'dashboardContent',
  courseNameDisplay: 'courseNameDisplay',
  quizCount: 'quizCount',
  completedCount: 'completedCount',
};

const API_ENDPOINTS = {
  currentUser: '/api/current-user',
  studentCourses: '/api/student/courses',
  quizzesByCourse: (courseId) => `/api/quiz/course/${courseId}`,
};

const ROUTES = {
  quizzes: '/quiz',
  achievements: '/achievements',
  help: '#', // Placeholder for help page
};

const QUICK_ACTIONS = {
  quizzes: ROUTES.quizzes,
  achievements: ROUTES.achievements,
  progress: ROUTES.achievements,
  help: ROUTES.help,
};

const STORAGE_KEYS = {
  selectedCourse: 'grasp-selected-course',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Calendar component for displaying a monthly calendar view
 */
class Calendar {
  constructor(headerSelector, daysSelector) {
    this.headerElement = document.querySelector(headerSelector);
    this.daysElement = document.querySelector(daysSelector);
  }

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

  renderHeader(month, year) {
    this.headerElement.textContent = `${MONTH_NAMES[month]} ${year}`;
  }

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

  addPreviousMonthDays(daysInPrevMonth, startOffset) {
    for (let i = startOffset - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      this.createDayElement(day, 'other-month');
    }
  }

  addCurrentMonthDays(daysInMonth, highlightDate) {
    for (let day = 1; day <= daysInMonth; day++) {
      const className = day === highlightDate ? 'current-day' : '';
      this.createDayElement(day, className);
    }
  }

  addNextMonthDays() {
    const totalCells = this.daysElement.children.length;
    const remainingCells = 42 - totalCells; // 6 rows × 7 days

    for (let day = 1; day <= remainingCells; day++) {
      this.createDayElement(day, 'other-month');
    }
  }

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
 * Main Student Dashboard Manager
 */
class StudentDashboardManager {
  constructor() {
    console.log('[StudentDashboard] Constructor called');
    this.calendar = new Calendar(SELECTORS.calendarHeader, SELECTORS.calendarDays);
    this.elements = {
      welcomeMessage: document.getElementById(SELECTORS.welcomeMessage),
      currentDate: document.getElementById(SELECTORS.currentDate),
      noCourseWelcome: document.getElementById(SELECTORS.noCourseWelcome),
      noCourseDate: document.getElementById(SELECTORS.noCourseDate),
      quickStartCards: document.querySelectorAll(SELECTORS.quickStartCards),
      noCourseState: document.getElementById(SELECTORS.noCourseState),
      dashboardContent: document.getElementById(SELECTORS.dashboardContent),
      courseNameDisplay: document.getElementById(SELECTORS.courseNameDisplay),
      quizCount: document.getElementById(SELECTORS.quizCount),
      completedCount: document.getElementById(SELECTORS.completedCount),
    };
    this.hasCourse = false;
    this.selectedCourse = null;
    
    // Debug: log all elements
    console.log('[StudentDashboard] Elements cached:', Object.keys(this.elements).map(k => `${k}: ${!!this.elements[k]}`).join(', '));
  }

  async init() {
    try {
      console.log('[StudentDashboard] Initializing...');
      console.log('[StudentDashboard] Elements:', {
        noCourseState: !!this.elements.noCourseState,
        dashboardContent: !!this.elements.dashboardContent,
      });
      
      this.initNavigation();
      await this.loadUserData();
      
      // Always update dates (both for course and no-course states)
      this.updateCurrentDate();
      this.updateNoCourseDate();
      
      await this.checkCourseAccess();
      
      console.log('[StudentDashboard] After checkCourseAccess, hasCourse:', this.hasCourse);
      
      if (this.hasCourse) {
        this.calendar.render();
        this.setupQuickStartCards();
        await this.loadCourseStats();
      }
      
      console.log('[StudentDashboard] Initialization complete');
    } catch (error) {
      console.error('[StudentDashboard] Error initializing:', error);
    }
  }

  initNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }

  async checkCourseAccess() {
    try {
      // Always verify course access from API (don't trust session storage alone)
      // This ensures removed students lose access immediately
      console.log('[StudentDashboard] Verifying course access from API...');
      const response = await fetch(API_ENDPOINTS.studentCourses);
      console.log('[StudentDashboard] API response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('[StudentDashboard] API data:', data);
        
        if (data.success && data.courses && data.courses.length > 0) {
          // Student has courses - check if currently selected course is still valid
          const sessionCourse = this.getSelectedCourse();
          let courseToUse = null;
          
          // Check if session course is still in the list of valid courses
          if (sessionCourse && sessionCourse.id) {
            const stillValid = data.courses.some(c => 
              (c._id === sessionCourse.id) || (c.id === sessionCourse.id)
            );
            if (stillValid) {
              courseToUse = sessionCourse;
              console.log('[StudentDashboard] Session course still valid:', courseToUse);
            } else {
              console.log('[StudentDashboard] Session course no longer valid, clearing...');
              sessionStorage.removeItem(STORAGE_KEYS.selectedCourse);
            }
          }
          
          // If no valid session course, use the first available course
          if (!courseToUse) {
            const firstCourse = data.courses[0];
            courseToUse = {
              id: firstCourse._id || firstCourse.id,
              name: firstCourse.name || firstCourse.courseName || 'Unknown Course',
            };
            console.log('[StudentDashboard] Using first available course:', courseToUse);
            sessionStorage.setItem(STORAGE_KEYS.selectedCourse, JSON.stringify(courseToUse));
          }
          
          this.hasCourse = true;
          this.selectedCourse = courseToUse;
          this.showDashboard();
          this.updateCourseDisplay(courseToUse);
          return;
        }
      }

      // No courses found - clear any stale session data
      console.log('[StudentDashboard] No courses found, clearing session and showing no-course state');
      sessionStorage.removeItem(STORAGE_KEYS.selectedCourse);
      this.hasCourse = false;
      this.showNoCourseState();
    } catch (error) {
      console.error('[StudentDashboard] Error checking course access:', error);
      // On error, clear session and show no-course state for safety
      sessionStorage.removeItem(STORAGE_KEYS.selectedCourse);
      this.hasCourse = false;
      this.showNoCourseState();
    }
  }

  getSelectedCourse() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.selectedCourse) || '{}');
    } catch {
      return {};
    }
  }

  showDashboard() {
    console.log('[StudentDashboard] showDashboard called');
    const { noCourseState, dashboardContent } = this.elements;
    console.log('[StudentDashboard] Elements found:', { noCourseState: !!noCourseState, dashboardContent: !!dashboardContent });
    if (noCourseState) {
      noCourseState.style.display = 'none';
      console.log('[StudentDashboard] noCourseState hidden');
    }
    if (dashboardContent) {
      dashboardContent.style.display = 'flex';
      console.log('[StudentDashboard] dashboardContent shown');
    }
  }

  showNoCourseState() {
    console.log('[StudentDashboard] showNoCourseState called');
    const { noCourseState, dashboardContent } = this.elements;
    if (noCourseState) noCourseState.style.display = 'flex';
    if (dashboardContent) dashboardContent.style.display = 'none';
  }

  updateCourseDisplay(course) {
    const { courseNameDisplay } = this.elements;
    if (courseNameDisplay && course.name) {
      courseNameDisplay.innerHTML = `
        <i class="fas fa-book"></i>
        <span>${this.escapeHtml(course.name)}</span>
      `;
    }
  }

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

  updateWelcomeMessage(userName) {
    const { welcomeMessage, noCourseWelcome } = this.elements;
    const greeting = userName ? `Hello, ${userName}` : 'Hello, Student';
    
    if (welcomeMessage) {
      welcomeMessage.textContent = greeting;
    }
    if (noCourseWelcome) {
      noCourseWelcome.textContent = greeting;
    }
    
    // Also update the date in no course state
    this.updateNoCourseDate();
  }
  
  updateNoCourseDate() {
    const { noCourseDate } = this.elements;
    if (noCourseDate) {
      const now = new Date();
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      noCourseDate.textContent = now.toLocaleDateString('en-US', options);
    }
  }

  updateCurrentDate() {
    const { currentDate } = this.elements;
    if (currentDate) {
      const now = new Date();
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      currentDate.textContent = now.toLocaleDateString('en-US', options);
    }
  }

  setupQuickStartCards() {
    this.elements.quickStartCards.forEach((card) => {
      card.addEventListener('click', () => {
        const action = card.getAttribute('data-action');
        this.handleQuickStartAction(action);
      });
    });
  }

  handleQuickStartAction(action) {
    const route = QUICK_ACTIONS[action];
    if (route && route !== '#') {
      window.location.href = route;
    } else if (action === 'help') {
      this.showNotification('Help documentation coming soon!', 'info');
    }
  }

  async loadCourseStats() {
    const selectedCourse = this.getSelectedCourse();
    if (!selectedCourse?.id) return;

    try {
      const response = await fetch(API_ENDPOINTS.quizzesByCourse(selectedCourse.id));
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.quizzes) {
        // Count published quizzes
        const publishedQuizzes = data.quizzes.filter(q => q.published === true);
        const quizCount = publishedQuizzes.length;
        
        // For now, completed count is 0 - would need to fetch student's quiz attempts
        const completedCount = 0;

        this.updateCourseStats(quizCount, completedCount);
      }
    } catch (error) {
      console.error('Error loading course stats:', error);
    }
  }

  updateCourseStats(quizCount, completedCount) {
    const { quizCount: quizEl, completedCount: completedEl } = this.elements;
    if (quizEl) quizEl.textContent = quizCount;
    if (completedEl) completedEl.textContent = completedCount;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
    `;

    switch (type) {
      case 'success':
        notification.style.backgroundColor = '#27ae60';
        break;
      case 'error':
        notification.style.backgroundColor = '#e74c3c';
        break;
      case 'warning':
        notification.style.backgroundColor = '#f39c12';
        break;
      default:
        notification.style.backgroundColor = '#3498db';
    }

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new StudentDashboardManager();
  dashboard.init();

  // Export for potential external use
  window.GRASPStudentDashboard = {
    showNotification: (msg, type) => dashboard.showNotification(msg, type),
  };
});

// Note: CSS animations for notifications are defined in navigation.js
