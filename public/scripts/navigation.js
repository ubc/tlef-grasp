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
    return "dashboard"; // default
  }

  init() {
    this.createNavigation();
    this.initializeNavigation();
    this.initializeSearch();
    this.initializeUserControls();
    this.initializeRoleSwitch();
    this.setActiveNavigationItem();
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
    
    // Add loading class to prevent flash
    document.body.classList.add("navigation-loading");

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
          <div class="user-control" id="user-profile-btn" title="User Profile">
            <i class="fas fa-user"></i>
          </div>
          <div class="user-control" id="settings-btn" title="Settings">
            <i class="fas fa-cog"></i>
          </div>
          <div class="user-control" id="notifications-btn" title="Notifications">
            <i class="fas fa-bell"></i>
            <span class="notification-badge">9</span>
          </div>
        </div>

        <!-- Search Bar -->
        <div class="search-section">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input type="text" placeholder="${
              this.currentRole === "student" ? "Q Search..." : "Search for..."
            }">
          </div>
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
    
    // Remove loading class after navigation is fully rendered
    // Use requestAnimationFrame for smoother transitions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.remove("navigation-loading");
        // Also ensure main content is visible
        const mainContent = document.querySelector(".main-content");
        if (mainContent) {
          mainContent.style.opacity = "1";
        }
      });
    });
  }

  getNavigationMenu() {
    if (this.currentRole === "student") {
      return `
        <li class="nav-item" data-page="my-quizzes">
          <i class="fas fa-list-check"></i>
          <span><a href="student-dashboard.html" style="text-decoration: none; color: inherit;">My Quizzes</a></span>
        </li>
        <li class="nav-item" data-page="course-materials">
          <i class="fas fa-book"></i>
          <span><a href="course-materials.html" style="text-decoration: none; color: inherit;">Course Materials</a></span>
        </li>
        <li class="nav-item" data-page="achievements">
          <i class="fas fa-trophy"></i>
          <span><a href="achievements.html" style="text-decoration: none; color: inherit;">Achievements</a></span>
        </li>
        <li class="nav-item" data-page="settings">
          <i class="fas fa-cog"></i>
          <span><a href="settings.html" style="text-decoration: none; color: inherit;">Settings</a></span>
        </li>
      `;
    } else {
      return `
        <li class="nav-item" data-page="dashboard">
          <i class="fas fa-home"></i>
          <span><a href="dashboard.html" style="text-decoration: none; color: inherit;">Dashboard</a></span>
        </li>
        <li class="nav-item" data-page="question-bank">
          <i class="fas fa-book"></i>
          <span><a href="question-bank.html" style="text-decoration: none; color: inherit;">Question Bank</a></span>
        </li>
        <li class="nav-item" data-page="question-generation">
          <i class="fas fa-puzzle-piece"></i>
          <span><a href="question-generation.html" style="text-decoration: none; color: inherit;">Question Generation</a></span>
        </li>
        <li class="nav-item" data-page="course-materials">
          <i class="fas fa-folder"></i>
          <span>Course Materials</span>
        </li>
        <li class="nav-item" data-page="user-profile">
          <i class="fas fa-user"></i>
          <span><a href="user-profile.html" style="text-decoration: none; color: inherit;">User Profile</a></span>
        </li>
        <li class="nav-item" data-page="settings">
          <i class="fas fa-cog"></i>
          <span><a href="settings.html" style="text-decoration: none; color: inherit;">Settings</a></span>
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

      /* Search Section */
      .search-section {
        padding: 0 25px 25px 25px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 25px;
      }

      .search-box {
        position: relative;
        display: flex;
        align-items: center;
      }

      .search-box i {
        position: absolute;
        left: 15px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 16px;
      }

      .search-box input {
        width: 100%;
        padding: 12px 15px 12px 45px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        transition: all 0.3s ease;
      }

      .search-box input::placeholder {
        color: rgba(255, 255, 255, 0.6);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      }

      .search-box input:focus {
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
        padding: 15px 20px;
        margin-bottom: 8px;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        font-size: 15px;
        font-weight: 500;
        letter-spacing: -0.2px;
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
        transition: opacity 0.3s ease-in-out;
        opacity: 1;
      }
      
      /* Prevent flash during navigation */
      body.navigation-loading .main-content {
        opacity: 0;
        pointer-events: none;
      }
      
      body.navigation-loading .sidebar {
        opacity: 0;
      }
      
      .sidebar {
        transition: opacity 0.3s ease-in-out;
        opacity: 1;
      }

      /* Page transition styles - smoother transitions */
      body.page-transitioning .main-content {
        opacity: 0.7;
        transition: opacity 0.2s ease-in-out;
      }
      
      /* Ensure content wrapper is ready */
      .content-wrapper {
        opacity: 1;
        transition: opacity 0.2s ease-in-out;
      }
      
      body.navigation-loading .content-wrapper {
        opacity: 0;
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

  initializeNavigation() {
    const navItems = document.querySelectorAll(".nav-item");

    navItems.forEach((item) => {
      // Skip if already initialized
      if (item.dataset.navInitialized === 'true') {
        return;
      }
      item.dataset.navInitialized = 'true';

      // Find the link inside the nav item
      const link = item.querySelector("a");
      
      if (link) {
        // Handle clicks on the entire nav item or the link
        const handleNavClick = (e) => {
          // Prevent multiple rapid clicks
          if (item.dataset.navProcessing === 'true') {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          item.dataset.navProcessing = 'true';
          
          // Add smooth transition for link navigation
          document.body.classList.add("page-transitioning");
          
          // Remove active class from all items
          navItems.forEach((nav) => nav.classList.remove("active"));
          
          // Add active class to clicked item
          item.classList.add("active");
          
          // Save state before navigation
          if (window.AppStateManager) {
            window.AppStateManager.saveAllStates();
          }
          
          // Re-enable after navigation starts
          setTimeout(() => {
            item.dataset.navProcessing = 'false';
          }, 500);
        };
        
        // Use ButtonUtils if available, otherwise use standard handler
        if (window.ButtonUtils) {
          window.ButtonUtils.safeAddEventListener(item, "click", (e) => {
            // If clicking directly on the link, let it handle navigation
            if (e.target === link || e.target.closest("a") === link) {
              handleNavClick(e);
              return; // Let the link navigate naturally
            }
            
            // If clicking elsewhere on the nav item, trigger the link
            e.preventDefault();
            e.stopPropagation();
            handleNavClick(e);
            link.click(); // Programmatically click the link
          });
        } else {
          // Fallback to standard handler
          item.addEventListener("click", (e) => {
            if (e.target === link || e.target.closest("a") === link) {
              handleNavClick(e);
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            handleNavClick(e);
            link.click();
          });
        }
      } else {
        // For nav items without links (like Course Materials), just update active state
        if (window.ButtonUtils) {
          window.ButtonUtils.safeAddEventListener(item, "click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Remove active class from all items
            navItems.forEach((nav) => nav.classList.remove("active"));
            
            // Add active class to clicked item
            item.classList.add("active");
            
            // Handle navigation
            const navText = item.querySelector("span")?.textContent;
            console.log(`Navigating to: ${navText}`);
            
            // Update page title based on navigation
            this.updatePageTitle(navText);
          });
        } else {
          item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            navItems.forEach((nav) => nav.classList.remove("active"));
            item.classList.add("active");
            
            const navText = item.querySelector("span")?.textContent;
            console.log(`Navigating to: ${navText}`);
            this.updatePageTitle(navText);
          });
        }
      }
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
      window.location.href = "student-dashboard.html";
    } else {
      // Navigate to instructor dashboard
      window.location.href = "dashboard.html";
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
    this.handlePageTransition("user-profile.html");
  }

  openSettings() {
    this.handlePageTransition("settings.html");
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
