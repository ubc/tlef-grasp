// GRASP Navigation Component
// Shared navigation functionality for all GRASP pages

class GRASPNavigation {
  constructor() {
    this.currentPage = this.detectCurrentPage();
    this.init();
  }

  detectCurrentPage() {
    const path = window.location.pathname;
    if (path.includes("quiz-summary")) return "quiz-summary";
    if (path.includes("quiz")) return "quiz";
    if (path.includes("student-dashboard")) return "my-quizzes";
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

  init() {
    this.createNavigation();
    this.initializeNavigation();
    this.initializeSearch();
    this.initializeUserControls();
    this.initializeRoleSwitch();
    this.setActiveNavigationItem();
    this.loadCourseSelector();
  }

  createNavigation() {
    // Check if navigation already exists
    if (document.querySelector(".sidebar")) {
      console.log("Sidebar already exists, skipping creation");
      return; // Navigation already exists
    }

    // Create the navigation structure
    const appContainer = document.querySelector(".app-container");
    if (!appContainer) {
      console.error("App container not found");
      return;
    }

    console.log("Creating sidebar navigation...");

    // Get current role
    this.currentRole =
      localStorage.getItem("grasp-current-role") || "instructor";

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

        <!-- Course Selection Dropdown -->
        <div class="course-selection-section">
          <label style="margin-bottom: 10px; display: block;" for="course-selector">Current Course:</label>
          <select class="course-selector" id="course-selector">
          </select>
        </div>

        <!-- Navigation Menu -->
        <ul class="nav-menu">
          ${this.getNavigationMenu()}
        </ul>

        <!-- Role Switch Section -->
        <div class="role-switch-section">
          <button class="role-switch-button" id="roleSwitchButton">
            <i class="fas fa-exchange-alt"></i>
            <span>Instructors/Students</span>
          </button>
          <div class="current-role" id="currentRole">
            <span>Viewing: <strong>${
              this.currentRole === "instructor" ? "Instructor" : "Student"
            }</strong></span>
          </div>
        </div>
      </nav>
    `;

    // Insert sidebar at the beginning of the app container
    appContainer.insertBefore(sidebar, appContainer.firstChild);

    console.log("Sidebar created and inserted:", sidebar);

    // Add consistent navigation styles
    this.addNavigationStyles();
  }

  getNavigationMenu() {
    if (this.currentRole === "student") {
      return `
        <li class="nav-item" data-page="my-quizzes">
          <a href="/student-dashboard" style="text-decoration: none; color: inherit;">
            <i class="fas fa-list-check"></i>
            <span>My Quizzes</span>
          </a>
        </li>
        <li class="nav-item" data-page="course-materials">
          <a href="/course-materials" style="text-decoration: none; color: inherit;">
            <i class="fas fa-book"></i>
            <span>Course Materials</span>
          </a>
        </li>
        <li class="nav-item" data-page="achievements">
          <a href="/achievements" style="text-decoration: none; color: inherit;">
            <i class="fas fa-trophy"></i>
            <span>Achievements</span>
          </a>
        </li>
        <li class="nav-item" data-page="settings">
          <a href="/settings" style="text-decoration: none; color: inherit;">
            <i class="fas fa-cog"></i>
            <span>Settings</span>
          </a>
        </li>
      `;
    } else {
      return `
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
        <li class="nav-item" data-page="users">
          <a href="/users" style="text-decoration: none; color: inherit;">
            <i class="fas fa-users"></i>
            <span>Users</span>
          </a>
        </li>
        <li class="nav-item" data-page="settings">
          <a href="/settings" style="text-decoration: none; color: inherit;">
            <i class="fas fa-cog"></i>
            <span>Settings</span>
          </a>
        </li>
      `;
    }
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

      .course-selection-section select {
        width: 100%;
        padding: 5px 10px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        transition: all 0.3s ease;
      }

      .course-selection-section select:focus {
        outline: none;
        border-color: #3498db;
        background: rgba(255, 255, 255, 0.15);
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
    const courseSelector = document.getElementById("course-selector");
    
    const courses = await fetch("/api/courses/my-courses");
    const data = await courses.json();

    if (data.success && data.courses.length > 0) {
      data.courses.forEach((course) => {
        const option = document.createElement("option");
        option.value = course._id;
        option.textContent = `${course.courseName}`;
        if (course._id === JSON.parse(sessionStorage.getItem("grasp-selected-course")).id) {
          option.selected = true;
        }
        courseSelector.appendChild(option);
      }); 
    }
    
    // Attach click event to course selector, update selected course in session storage and refresh page upon change.
    courseSelector.addEventListener("change", (e) => {
      const courseId = e.target.value;
      const courseName = data.courses.find((course) => course._id === courseId).courseName;
      sessionStorage.setItem("grasp-selected-course", JSON.stringify({id: courseId, name: courseName}));
      window.location.href = window.location.pathname;
    });
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
        console.log(`Navigating to: ${navText}`);

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
    const roleSwitchButton = document.getElementById("roleSwitchButton");
    const currentRoleElement = document.getElementById("currentRole");

    if (roleSwitchButton && currentRoleElement) {
      // Get current role from localStorage or default to instructor
      this.currentRole =
        localStorage.getItem("grasp-current-role") || "instructor";
      this.updateRoleDisplay();

      roleSwitchButton.addEventListener("click", () => {
        this.switchRole();
      });
    }
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
    const currentRoleElement = document.getElementById("currentRole");
    if (currentRoleElement) {
      const roleText =
        this.currentRole === "instructor" ? "Instructor" : "Student";
      currentRoleElement.innerHTML = `<span>Viewing: <strong>${roleText}</strong></span>`;
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
    console.log(`Searching for: ${searchTerm}`);
    // This is where you would implement actual search logic
    // For now, we'll just log the search term

    // You could search through:
    // - Questions
    // - Course materials
    // - Users
    // - etc.
  }

  openUserProfile() {
    console.log("Opening user profile...");
    // Navigate to user profile page or open modal
  }

  openSettings() {
    console.log("Opening settings...");
    // Navigate to settings page or open modal
  }

  openNotifications() {
    console.log("Opening notifications...");
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
