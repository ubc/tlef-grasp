// GRASP Navigation Component
// Shared navigation functionality for all GRASP pages

// Role constants (must match server-side)
const USER_ROLES = {
  FACULTY: 'faculty',
  STAFF: 'staff',
  STUDENT: 'student',
};

class GRASPNavigation {
  constructor() {
    this.currentPage = this.detectCurrentPage();
    this.userRole = null;
    this.isFaculty = false;
    this.isStaff = false;
    this.isStudent = false;
    this.hasCourse = false;
    this.init();
  }

  detectCurrentPage() {
    const path = window.location.pathname;
    if (path.includes("quiz-summary")) return "quiz-summary";
    if (path.includes("student-dashboard")) return "student-dashboard";
    if (path.includes("quiz")) return "my-quizzes";
    if (path.includes("course-materials")) return "course-materials";
    if (path.includes("achievements")) return "achievements";
    if (path.includes("dashboard")) return "dashboard";
    if (path.includes("question-bank") || path.includes("question-review"))
      return "question-bank";
    if (path.includes("question-generation")) return "question-generation";
    if (path.includes("settings")) return "settings";
    if (path.includes("users")) return "users";
    return "dashboard"; // default
  }

  async init() {
    await this.loadUserInfo();
    this.createNavigation();
    this.initializeNavigation();
    this.initializeSearch();
    this.initializeUserControls();
    this.initializeRoleSwitch();
    this.initializeSignOut();
    this.setActiveNavigationItem();
    this.loadCourseSelector();
  }

  async loadUserInfo() {
    try {
      const response = await fetch('/api/current-user');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.userRole = data.user.role || USER_ROLES.STUDENT;
          this.isFaculty = data.user.isFaculty || false;
          this.isStaff = data.user.isStaff || false;
          this.isStudent = data.user.isStudent || false;
          
          // Store role in localStorage for quick access
          localStorage.setItem('grasp-user-role', this.userRole);
          
          // Check if user has a course
          await this.checkCourseAccess();
          
          // If user is a student and tries to access instructor pages, redirect
          if (this.isStudent && this.isInstructorOnlyPage()) {
            window.location.href = '/student-dashboard';
            return;
          }
          
          // If student has no course and tries to access pages requiring course, redirect to dashboard
          if (this.isStudent && !this.hasCourse && this.requiresCourse()) {
            window.location.href = '/student-dashboard';
            return;
          }
        }
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  }
  
  async checkCourseAccess() {
    // For students, always verify course access from API (ensures removed students lose access immediately)
    if (this.isStudent) {
      try {
        const response = await fetch('/api/student/courses');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.courses && data.courses.length > 0) {
            // Student has courses - verify session course is still valid
            const sessionCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
            
            if (sessionCourse && sessionCourse.id) {
              const stillValid = data.courses.some(c => 
                (c._id === sessionCourse.id) || (c.id === sessionCourse.id)
              );
              if (stillValid) {
                this.hasCourse = true;
                return;
              }
              // Session course no longer valid, clear it
              sessionStorage.removeItem('grasp-selected-course');
            }
            
            // Use the first available course
            const firstCourse = data.courses[0];
            const courseData = {
              id: firstCourse._id || firstCourse.id,
              name: firstCourse.name || firstCourse.courseName || 'Unknown Course',
            };
            sessionStorage.setItem('grasp-selected-course', JSON.stringify(courseData));
            this.hasCourse = true;
            return;
          }
        }
        // No courses found - clear stale session data
        sessionStorage.removeItem('grasp-selected-course');
        this.hasCourse = false;
      } catch (error) {
        console.error('Error checking student courses:', error);
        sessionStorage.removeItem('grasp-selected-course');
        this.hasCourse = false;
      }
    } else {
      // For faculty/staff, check session storage first, then assume access
      try {
        const selectedCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
        if (selectedCourse && selectedCourse.id) {
          this.hasCourse = true;
          return;
        }
      } catch {
        // Ignore parse errors
      }
      // For faculty/staff, assume they have course access even without session
      this.hasCourse = true;
    }
  }
  
  requiresCourse() {
    // Pages that require a course to be selected
    const courseRequiredPages = ['my-quizzes', 'achievements', 'quiz-summary'];
    return courseRequiredPages.includes(this.currentPage);
  }

  isInstructorOnlyPage() {
    const instructorPages = ['dashboard', 'question-bank', 'question-generation', 'course-materials', 'users'];
    return instructorPages.includes(this.currentPage);
  }

  canSwitchRoles() {
    // Only faculty and staff can switch between instructor/student views
    return this.isFaculty || this.isStaff;
  }

  createNavigation() {
    // Check if navigation already exists
    if (document.querySelector(".sidebar")) {
      return; // Navigation already exists
    }

    // Create the navigation structure
    const appContainer = document.querySelector(".app-container");
    if (!appContainer) {
      console.error("App container not found");
      return;
    }

    // Determine current role view
    // Students can ONLY see student view, faculty/staff can switch between views
    if (this.isStudent) {
      this.currentRole = 'student';
      localStorage.setItem('grasp-current-role', 'student');
    } else {
      // Faculty and staff can switch views, get from localStorage or default to instructor
      this.currentRole = localStorage.getItem("grasp-current-role") || "instructor";
    }

    // Create sidebar with consistent styling
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar";

    sidebar.innerHTML = `
      <nav class="sidebar-nav">
        <!-- Logo Section -->
        <div class="logo-section">
          <div class="logo">
            <i class="fas fa-graduation-cap"></i>
            <span>GRASP</span>
          </div>
        </div>

        <!-- User Controls -->
        <div class="user-controls">
          <div class="user-control">
            <i class="fas fa-user"></i>
          </div>
          <div class="user-control">
            <i class="fas fa-cog"></i>
          </div>
          <div class="user-control">
            <i class="fas fa-bell"></i>
            <span class="notification-badge">9</span>
          </div>
        </div>

        <!-- Current Course Display -->
        <div class="course-selection-section">
          <div class="current-course-display" id="currentCourseDisplay">
            <label style="margin-bottom: 8px; display: block; font-size: 12px; color: rgba(255, 255, 255, 0.7);">Current Course:</label>
            <select class="course-dropdown" id="courseDropdown" style="display: none;">
              <option value="">Select a course...</option>
            </select>
            <div class="current-course-name" id="currentCourseName">Loading...</div>
          </div>
        </div>

        <!-- Navigation Menu -->
        <ul class="nav-menu">
          ${this.getNavigationMenu()}
        </ul>

        <!-- Role Switch Section -->
        <div class="role-switch-section">
          ${this.getRoleSwitchButton()}
          <div class="current-role" id="currentRole">
            ${this.getCurrentRoleDisplay()}
          </div>
          <button class="sign-out-button" id="signOutButton">
            <i class="fas fa-sign-out-alt"></i>
            <span>Sign Out</span>
          </button>
        </div>
      </nav>
    `;

    // Insert sidebar at the beginning of the app container
    appContainer.insertBefore(sidebar, appContainer.firstChild);

    // Add consistent navigation styles
    this.addNavigationStyles();
  }

  getNavigationMenu() {
    // Student view (either actual student or instructor previewing student view)
    if (this.currentRole === 'student') {
      // If student has no course, only show Dashboard
      if (this.isStudent && !this.hasCourse) {
        return `
          <li class="nav-item" data-page="student-dashboard">
            <a href="/student-dashboard" style="text-decoration: none; color: inherit;">
              <i class="fas fa-home"></i>
              <span>Dashboard</span>
            </a>
          </li>
        `;
      }
      
      // Student with course - show full menu
      return `
        <li class="nav-item" data-page="student-dashboard">
          <a href="/student-dashboard" style="text-decoration: none; color: inherit;">
            <i class="fas fa-home"></i>
            <span>Dashboard</span>
          </a>
        </li>
        <li class="nav-item" data-page="my-quizzes">
          <a href="/quiz" style="text-decoration: none; color: inherit;">
            <i class="fas fa-list-check"></i>
            <span>My Quizzes</span>
          </a>
        </li>
        <li class="nav-item" data-page="achievements">
          <a href="/achievements" style="text-decoration: none; color: inherit;">
            <i class="fas fa-trophy"></i>
            <span>Achievements</span>
          </a>
        </li>
      `;
    }
    
    // Instructor view - base menu for staff
    let menu = `
      <li class="nav-item" data-page="dashboard">
        <a href="/dashboard" style="text-decoration: none; color: inherit;">
          <i class="fas fa-home"></i>
          <span>Dashboard</span>
        </a>
      </li>
      <li class="nav-item" data-page="question-bank">
        <a href="/question-bank" style="text-decoration: none; color: inherit;">
          <i class="fas fa-book"></i>
          <span>Question Bank</span>
        </a>
      </li>
      <li class="nav-item" data-page="question-generation">
        <a href="/question-generation" style="text-decoration: none; color: inherit;">
          <i class="fas fa-puzzle-piece"></i>
          <span>Question Generation</span>
        </a>
      </li>
      <li class="nav-item" data-page="course-materials">
        <a href="/course-materials" style="text-decoration: none; color: inherit;">
          <i class="fas fa-folder"></i>
          <span>Course Materials</span>
        </a>
      </li>
    `;
    
    // Users management - faculty only
    if (this.isFaculty) {
      menu += `
        <li class="nav-item" data-page="users">
          <a href="/users" style="text-decoration: none; color: inherit;">
            <i class="fas fa-users"></i>
            <span>Users</span>
          </a>
        </li>
      `;
    }
    
    menu += `
      <li class="nav-item" data-page="settings">
        <a href="/settings" style="text-decoration: none; color: inherit;">
          <i class="fas fa-cog"></i>
          <span>Settings</span>
        </a>
      </li>
    `;
    
    return menu;
  }

  getRoleSwitchButton() {
    // Only show role switch button for faculty and staff
    if (this.isStudent) {
      return ''; // Students can't switch roles
    }
    
    return `
      <button class="role-switch-button" id="roleSwitchButton">
        <i class="fas fa-exchange-alt"></i>
        <span>Switch View</span>
      </button>
    `;
  }

  getCurrentRoleDisplay() {
    const viewingRole = this.currentRole === 'instructor' ? 'Instructor' : 'Student';
    const actualRole = this.getUserRoleLabel();
    
    if (this.isStudent) {
      return `<span>Role: <strong>Student</strong></span>`;
    }
    
    return `<span>Viewing: <strong>${viewingRole}</strong></span>`;
  }

  getUserRoleLabel() {
    if (this.isFaculty) return 'Faculty';
    if (this.isStaff) return 'Staff';
    return 'Student';
  }

  addNavigationStyles() {
    // Create and inject consistent navigation styles
    const navStyles = document.createElement("style");
    navStyles.textContent = `
      /* Consistent Navigation Styles */
      .sidebar {
        width: 280px;
        background: linear-gradient(180deg, #2c3e50 0%, #34495e 100%);
        color: white;
        height: 100vh;
        position: fixed;
        left: 0;
        top: 0;
        overflow-y: auto;
        box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
        z-index: 1000;
      }

      .sidebar-nav {
        padding: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      /* Logo Section */
      .logo-section {
        padding: 30px 25px 25px 25px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 20px;
      }

      .logo {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: -0.5px;
      }

      .logo i {
        font-size: 28px;
        color: #3498db;
      }

      .logo span {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        font-weight: 700;
        letter-spacing: -0.5px;
      }

      /* User Controls */
      .user-controls {
        display: flex;
        justify-content: center;
        gap: 15px;
        padding: 0 25px 25px 25px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 25px;
      }

      .user-control {
        width: 45px;
        height: 45px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
      }

      .user-control:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: translateY(-2px);
      }

      .user-control i {
        font-size: 18px;
        color: rgba(255, 255, 255, 0.9);
      }

      .notification-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        background: #e74c3c;
        color: white;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      }

      /* Course Selection Section */
      .course-selection-section {
        padding: 0 25px 25px 25px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 25px;
      }

      .current-course-display {
        width: 100%;
      }

      .current-course-name {
        padding: 0;
        color: white;
        font-size: 18px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        word-wrap: break-word;
      }

      .course-dropdown {
        width: 100%;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        cursor: pointer;
        transition: all 0.3s ease;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='white' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        padding-right: 35px;
      }

      .course-dropdown:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.3);
      }

      .course-dropdown:focus {
        outline: none;
        border-color: #3498db;
        box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3);
      }

      .course-dropdown option {
        background: #2c3e50;
        color: white;
        padding: 10px;
      }

      /* Navigation Menu */
      .nav-menu {
        list-style: none;
        padding: 0 25px 25px 25px;
        margin: 0;
        flex: 1;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: 15px;
        margin-bottom: 8px;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        font-size: 15px;
        font-weight: 500;
        letter-spacing: -0.2px;

        a {
          padding: 15px 20px;
          display: block;
          width: 100%;
        }
      }

      .nav-item:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: translateX(5px);
      }

      .nav-item.active {
        background: #3498db;
        box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);
      }

      .nav-item i {
        font-size: 18px;
        width: 20px;
        text-align: center;
        color: rgba(255, 255, 255, 0.8);
      }

      .nav-item.active i {
        color: white;
      }

      .nav-item span {
        flex: 1;
        color: rgba(255, 255, 255, 0.9);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        font-weight: 500;
        letter-spacing: -0.2px;
      }

      .nav-item.active span {
        color: white;
        font-weight: 600;
      }

      /* Role Switch Section */
      .role-switch-section {
        padding: 25px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        margin-top: auto;
      }

      .role-switch-button {
        width: 100%;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .role-switch-button:hover {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }

      .role-switch-button i {
        font-size: 16px;
      }

      .current-role {
        text-align: center;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      }

      .current-role strong {
        color: rgba(255, 255, 255, 0.9);
        font-weight: 600;
      }

      /* Sign Out Button */
      .sign-out-button {
        width: 100%;
        padding: 12px 16px;
        background: rgba(231, 76, 60, 0.2);
        border: 1px solid rgba(231, 76, 60, 0.4);
        border-radius: 8px;
        color: #e74c3c;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 15px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      }

      .sign-out-button:hover {
        background: rgba(231, 76, 60, 0.3);
        border-color: rgba(231, 76, 60, 0.6);
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(231, 76, 60, 0.2);
      }

      .sign-out-button i {
        font-size: 16px;
      }

      /* Main content adjustment for sidebar */
      .main-content {
        margin-left: 280px;
        min-height: 100vh;
        background-color: #f5f5f5;
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .sidebar {
          width: 100%;
          height: auto;
          position: relative;
        }
        
        .main-content {
          margin-left: 0;
        }
      }
    `;

    document.head.appendChild(navStyles);
  }

  async loadCourseSelector() {
    const currentCourseName = document.getElementById("currentCourseName");
    const courseDropdown = document.getElementById("courseDropdown");
    
    try {
      // Fetch courses based on user role
      const apiEndpoint = this.isStudent ? '/api/student/courses' : '/api/courses/my-courses';
      const response = await fetch(apiEndpoint);
      
      if (!response.ok) {
        throw new Error('Failed to fetch courses');
      }
      
      const data = await response.json();
      const courses = data.courses || [];
      
      // Get currently selected course from session
      const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
      
      if (courses.length > 1) {
        // Multiple courses - show dropdown
        if (courseDropdown) {
          courseDropdown.innerHTML = '<option value="">Select a course...</option>';
          courses.forEach(course => {
            const courseId = course._id || course.id;
            const courseName = course.name || course.courseName || 'Unknown Course';
            const option = document.createElement('option');
            option.value = courseId;
            option.textContent = courseName;
            if (selectedCourse && (selectedCourse.id === courseId)) {
              option.selected = true;
            }
            courseDropdown.appendChild(option);
          });
          
          courseDropdown.style.display = 'block';
          if (currentCourseName) {
            currentCourseName.style.display = 'none';
          }
          
          // Add change event listener
          courseDropdown.addEventListener('change', (e) => {
            this.handleCourseChange(e.target.value, courses);
          });
        }
      } else if (courses.length === 1) {
        // Single course - just display the name
        const course = courses[0];
        const courseId = course._id || course.id;
        const courseName = course.name || course.courseName || 'Unknown Course';
        
        // Save to session if not already saved
        if (!selectedCourse || !selectedCourse.id) {
          sessionStorage.setItem("grasp-selected-course", JSON.stringify({
            id: courseId,
            name: courseName
          }));
        }
        
        if (currentCourseName) {
          currentCourseName.textContent = courseName;
          currentCourseName.style.display = 'block';
        }
        if (courseDropdown) {
          courseDropdown.style.display = 'none';
        }
      } else {
        // No courses
        if (currentCourseName) {
          currentCourseName.textContent = "No course available";
          currentCourseName.style.color = "rgba(255, 255, 255, 0.5)";
          currentCourseName.style.fontStyle = "italic";
          currentCourseName.style.display = 'block';
        }
        if (courseDropdown) {
          courseDropdown.style.display = 'none';
        }
      }
    } catch (error) {
      console.error("Error loading courses:", error);
      if (currentCourseName) {
        currentCourseName.textContent = "Error loading courses";
        currentCourseName.style.color = "rgba(255, 255, 255, 0.5)";
        currentCourseName.style.display = 'block';
      }
      if (courseDropdown) {
        courseDropdown.style.display = 'none';
      }
    }
  }
  
  handleCourseChange(courseId, courses) {
    if (!courseId) return;
    
    const selectedCourse = courses.find(c => (c._id || c.id) === courseId);
    if (selectedCourse) {
      const courseData = {
        id: selectedCourse._id || selectedCourse.id,
        name: selectedCourse.name || selectedCourse.courseName || 'Unknown Course'
      };
      sessionStorage.setItem("grasp-selected-course", JSON.stringify(courseData));
      
      // Reload the page to reflect the course change
      window.location.reload();
    }
  }

  initializeNavigation() {
    const navItems = document.querySelectorAll(".nav-item");

    navItems.forEach((item) => {
      item.addEventListener("click", (e) => {
        // Don't handle clicks on links (let them navigate naturally)
        if (e.target.tagName === "A" || e.target.closest("a")) {
          return;
        }
        // Handle navigation
        const navText = item.querySelector("span").textContent;
        // Update page title based on navigation
        this.updatePageTitle(navText);
      });
    });
  }

  initializeSearch() {
    const searchInput = document.querySelector(".search-box input");

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase();

        if (searchTerm.length > 0) {
          this.performSearch(searchTerm);
        }
      });

      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const searchTerm = e.target.value;
          if (searchTerm.trim()) {
            this.performSearch(searchTerm);
          }
        }
      });
    }
  }

  initializeUserControls() {
    const userControls = document.querySelectorAll(".user-control");

    userControls.forEach((control) => {
      control.addEventListener("click", () => {
        const icon = control.querySelector("i");
        if (icon.classList.contains("fa-user")) {
          this.openUserProfile();
        } else if (icon.classList.contains("fa-cog")) {
          this.openSettings();
        } else if (icon.classList.contains("fa-bell")) {
          this.openNotifications();
        }
      });
    });
  }

  initializeRoleSwitch() {
    const roleSwitchButton = document.getElementById('roleSwitchButton');
    const currentRoleElement = document.getElementById('currentRole');

    // For students, force student view
    if (this.isStudent) {
      this.currentRole = 'student';
      localStorage.setItem('grasp-current-role', 'student');
      this.updateRoleDisplay();
      return;
    }

    if (roleSwitchButton && currentRoleElement) {
      // Get current role from localStorage or default to instructor
      this.currentRole = localStorage.getItem('grasp-current-role') || 'instructor';
      this.updateRoleDisplay();

      roleSwitchButton.addEventListener('click', () => {
        this.switchRole();
      });
    }
  }

  initializeSignOut() {
    const signOutButton = document.getElementById("signOutButton");
    if (signOutButton) {
      signOutButton.addEventListener("click", () => {
        this.handleSignOut();
      });
    }
  }

  handleSignOut() {
    // Clear selected course from sessionStorage
    sessionStorage.removeItem("grasp-selected-course");
    
    // Redirect to onboarding page
    window.location.href = "/onboarding";
  }

  switchRole() {
    // Toggle between instructor and student
    this.currentRole =
      this.currentRole === "instructor" ? "student" : "instructor";

    // Save to localStorage
    localStorage.setItem("grasp-current-role", this.currentRole);

    // Update display
    this.updateRoleDisplay();

    // Navigate to appropriate dashboard
    this.navigateToRoleDashboard();

    // Show notification
    this.showNotification(`Switched to ${this.currentRole} view`, "success");
  }

  updateRoleDisplay() {
    const currentRoleElement = document.getElementById('currentRole');
    if (currentRoleElement) {
      if (this.isStudent) {
        currentRoleElement.innerHTML = `<span>Role: <strong>Student</strong></span>`;
      } else {
        const roleText = this.currentRole === 'instructor' ? 'Instructor' : 'Student';
        currentRoleElement.innerHTML = `<span>Viewing: <strong>${roleText}</strong></span>`;
      }
    }
  }

  navigateToRoleDashboard() {
    if (this.currentRole === "student") {
      // Navigate to student dashboard
      window.location.href = "/student-dashboard";
    } else {
      // Navigate to instructor dashboard
      window.location.href = "/dashboard";
    }
  }

  setActiveNavigationItem() {
    const navItems = document.querySelectorAll(".nav-item");

    navItems.forEach((item) => {
      const page = item.getAttribute("data-page");
      if (page === this.currentPage) {
        item.classList.add("active");
      }
    });

    // Set appropriate page title based on current page
    this.updatePageTitle();
  }

  updatePageTitle(navText = null) {
    if (navText) {
      // Update title based on navigation text
      document.title = `${navText} - GRASP`;
    } else {
      // Set title based on current page
      switch (this.currentPage) {
        case "dashboard":
          document.title = "Dashboard - GRASP";
          break;
        case "question-bank":
          document.title = "Question Bank - GRASP";
          break;
        case "question-generation":
          document.title = "Question Generation - GRASP";
          break;
        case "settings":
          document.title = "Settings - GRASP";
          break;
        default:
          document.title = "GRASP";
      }
    }
  }

  performSearch(searchTerm) {
    // Search functionality placeholder
    // Could search through questions, course materials, users, etc.
  }

  openUserProfile() {
    // Navigate to user profile page or open modal
  }

  openSettings() {
    // Navigate to settings page
    window.location.href = '/settings';
  }

  openNotifications() {
    // Open notifications panel or modal
  }

  // Utility method to show notifications
  showNotification(message, type = "info") {
    // Create notification element
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    // Add styles
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

    // Set background color based on type
    switch (type) {
      case "success":
        notification.style.backgroundColor = "#27ae60";
        break;
      case "error":
        notification.style.backgroundColor = "#e74c3c";
        break;
      case "warning":
        notification.style.backgroundColor = "#f39c12";
        break;
      default:
        notification.style.backgroundColor = "#3498db";
    }

    // Add to page
    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = "slideOut 0.3s ease-in";
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }
}

// Add CSS animations for notifications
const notificationStyles = document.createElement("style");
notificationStyles.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(notificationStyles);

// Export for use in other files
window.GRASPNavigation = GRASPNavigation;
