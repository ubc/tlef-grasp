// GRASP Users Page JavaScript
class UsersPage {
  constructor() {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    this.courseId = selectedCourse.id || null;
    this.courseName = selectedCourse.name || "";
    
    this.isFaculty = false;
    this.courseUsers = [];
    this.availableUsers = [];
    this.filteredUsers = [];
    
    // Filter state
    this.searchTerm = "";
    this.roleFilter = "all";
    
    this.init();
  }

  async init() {
    await this.loadUserInfo();
    this.initializeNavigation();
    this.initializeEventListeners();
    this.updateUIForUserRole();
    await this.loadData();
  }

  async loadUserInfo() {
    try {
      const response = await fetch("/api/current-user");
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.isFaculty = data.user.isFaculty || false;
        }
      }
    } catch (error) {
      console.error("Error loading user info:", error);
    }
  }

  initializeNavigation() {
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
  }

  initializeEventListeners() {
    // Modal close handlers
    const modalClose = document.getElementById("modal-close");
    const modalCancel = document.getElementById("modal-cancel");
    const modal = document.getElementById("confirm-modal");

    if (modalClose) {
      modalClose.addEventListener("click", () => this.hideModal());
    }
    if (modalCancel) {
      modalCancel.addEventListener("click", () => this.hideModal());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          this.hideModal();
        }
      });
    }
    
    // Search and filter handlers
    const searchInput = document.getElementById("user-search");
    const roleFilter = document.getElementById("role-filter");
    
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.applyFilters();
      });
    }
    
    if (roleFilter) {
      roleFilter.addEventListener("change", (e) => {
        this.roleFilter = e.target.value;
        this.applyFilters();
      });
    }
  }

  updateUIForUserRole() {
    const availableUsersSection = document.getElementById("available-users-section");
    
    if (availableUsersSection) {
      availableUsersSection.style.display = this.isFaculty ? "block" : "none";
    }
  }

  async loadData() {
    if (!this.courseId) {
      this.showError("No course selected");
      return;
    }

    // Load course users
    await this.loadCourseUsers();

    // Load available users (only for faculty)
    if (this.isFaculty) {
      await this.loadAvailableUsers();
    }
  }

  async loadCourseUsers() {
    const loadingElement = document.getElementById("course-users-loading");
    const listElement = document.getElementById("course-users-list");
    const emptyElement = document.getElementById("course-users-empty");

    try {
      if (loadingElement) loadingElement.style.display = "flex";
      if (listElement) listElement.innerHTML = "";
      if (emptyElement) emptyElement.style.display = "none";

      const response = await fetch(`/api/users/course/${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.users) {
        this.courseUsers = data.users;
        this.renderCourseUsers();
      } else {
        this.courseUsers = [];
        this.renderCourseUsers();
      }
    } catch (error) {
      console.error("Error loading course users:", error);
      this.showError("Failed to load course users");
      if (emptyElement) emptyElement.style.display = "block";
    } finally {
      if (loadingElement) loadingElement.style.display = "none";
    }
  }

  async loadAvailableUsers() {
    const loadingElement = document.getElementById("available-users-loading");
    const listElement = document.getElementById("available-users-list");
    const emptyElement = document.getElementById("available-users-empty");

    try {
      if (loadingElement) loadingElement.style.display = "flex";
      if (listElement) listElement.innerHTML = "";
      if (emptyElement) emptyElement.style.display = "none";

      const response = await fetch(`/api/users/all/not-in-course/${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.users) {
        this.availableUsers = data.users;
        this.applyFilters();
      } else {
        this.availableUsers = [];
        this.applyFilters();
      }
    } catch (error) {
      console.error("Error loading available users:", error);
      this.showError("Failed to load available users");
      if (emptyElement) emptyElement.style.display = "block";
    } finally {
      if (loadingElement) loadingElement.style.display = "none";
    }
  }
  
  applyFilters() {
    // Start with all available users
    let filtered = [...this.availableUsers];
    
    // Apply role filter
    if (this.roleFilter !== "all") {
      filtered = filtered.filter(user => {
        const userRole = this.getUserRole(user);
        return userRole === this.roleFilter;
      });
    }
    
    // Apply search filter
    if (this.searchTerm) {
      filtered = filtered.filter(user => {
        const name = (user.displayName || "").toLowerCase();
        const email = (user.email || "").toLowerCase();
        return name.includes(this.searchTerm) || email.includes(this.searchTerm);
      });
    }
    
    this.filteredUsers = filtered;
    this.renderAvailableUsers();
    this.updateResultsCount();
  }
  
  getUserRole(user) {
    // Check if role is already set (from API)
    if (user.role) {
      return user.role;
    }
    
    // Determine from affiliation
    const affiliation = user.affiliation || "";
    const affiliations = Array.isArray(affiliation)
      ? affiliation
      : String(affiliation).split(',').map(a => a.trim());
    
    if (affiliations.includes('faculty')) {
      return 'faculty';
    } else if (affiliations.includes('staff')) {
      return 'staff';
    } else if (affiliations.includes('student') || affiliations.includes('affiliate')) {
      return 'student';
    }
    return 'unknown';
  }
  
  updateResultsCount() {
    const countElement = document.getElementById("filtered-count");
    if (countElement) {
      countElement.textContent = this.filteredUsers.length;
    }
  }

  renderCourseUsers() {
    const listElement = document.getElementById("course-users-list");
    const emptyElement = document.getElementById("course-users-empty");
    const tableWrapper = document.getElementById("course-users-table-wrapper");

    if (!listElement) return;

    if (this.courseUsers.length === 0) {
      if (emptyElement) emptyElement.style.display = "block";
      if (tableWrapper) tableWrapper.style.display = "none";
      listElement.innerHTML = "";
      return;
    }

    if (emptyElement) emptyElement.style.display = "none";
    if (tableWrapper) tableWrapper.style.display = "block";

    const usersHTML = this.courseUsers.map(user => {
      const userId = user.userId || user._id || user.user?._id;
      const userIdStr = userId ? (userId.toString ? userId.toString() : String(userId)) : "";
      const displayName = user.displayName || user.user?.displayName || "Unknown User";
      const email = user.email || user.user?.email || "";
      const affiliation = user.affiliation || user.user?.affiliation || "";
      
      // Determine user role based on affiliation
      const affiliations = Array.isArray(affiliation)
        ? affiliation
        : String(affiliation || '').split(',').map(a => a.trim());
      const isUserFaculty = affiliations.includes('faculty');
      const isUserStaff = affiliations.includes('staff') && !isUserFaculty;
      const isUserStudent = (affiliations.includes('student') || affiliations.includes('affiliate')) && !isUserFaculty && !isUserStaff;
      
      // Check if this is the current user
      const isCurrentUser = userIdStr === String(window.currentUserId || "");

      let roleBadge = '';
      if (isUserFaculty) {
        roleBadge = '<span class="badge badge-faculty"><i class="fas fa-graduation-cap"></i> Faculty</span>';
      } else if (isUserStaff) {
        roleBadge = '<span class="badge badge-staff"><i class="fas fa-user-tie"></i> Staff</span>';
      } else if (isUserStudent) {
        roleBadge = '<span class="badge badge-student"><i class="fas fa-user-graduate"></i> Student</span>';
      }

      const currentUserBadge = isCurrentUser ? '<span class="badge badge-current"><i class="fas fa-user-circle"></i> You</span>' : '';

      return `
        <tr data-user-id="${userIdStr}">
          <td>
            <div class="user-name-cell">
              <div class="user-avatar-small">
                <i class="fas fa-user"></i>
              </div>
              <span class="user-name">${this.escapeHtml(displayName)}</span>
              ${currentUserBadge}
            </div>
          </td>
          <td class="user-email-cell">${this.escapeHtml(email)}</td>
          <td>
            <div class="user-badges-cell">
              ${roleBadge}
            </div>
          </td>
          <td class="actions-cell">
            ${this.isFaculty && !isCurrentUser ? `
              <button class="btn btn-danger btn-sm" onclick="window.usersPage.removeUser('${userIdStr}')" title="Remove from course">
                <i class="fas fa-user-minus"></i>
                Remove
              </button>
            ` : '<span class="text-muted">-</span>'}
          </td>
        </tr>
      `;
    }).join("");

    listElement.innerHTML = usersHTML;
  }

  renderAvailableUsers() {
    const listElement = document.getElementById("available-users-list");
    const emptyElement = document.getElementById("available-users-empty");
    const tableWrapper = document.getElementById("available-users-table-wrapper");

    if (!listElement) return;

    if (this.filteredUsers.length === 0) {
      if (emptyElement) emptyElement.style.display = "block";
      if (tableWrapper) tableWrapper.style.display = "none";
      listElement.innerHTML = "";
      return;
    }

    if (emptyElement) emptyElement.style.display = "none";
    if (tableWrapper) tableWrapper.style.display = "block";

    const usersHTML = this.filteredUsers.map(user => {
      const userId = user._id;
      const userIdStr = userId ? (userId.toString ? userId.toString() : String(userId)) : "";
      const displayName = user.displayName || "Unknown User";
      const email = user.email || "";
      const role = this.getUserRole(user);

      let roleBadge = '';
      if (role === 'faculty') {
        roleBadge = '<span class="badge badge-faculty"><i class="fas fa-graduation-cap"></i> Faculty</span>';
      } else if (role === 'staff') {
        roleBadge = '<span class="badge badge-staff"><i class="fas fa-user-tie"></i> Staff</span>';
      } else if (role === 'student') {
        roleBadge = '<span class="badge badge-student"><i class="fas fa-user-graduate"></i> Student</span>';
      }

      return `
        <tr data-user-id="${userIdStr}">
          <td>
            <div class="user-name-cell">
              <div class="user-avatar-small">
                <i class="fas fa-user"></i>
              </div>
              <span class="user-name">${this.escapeHtml(displayName)}</span>
            </div>
          </td>
          <td class="user-email-cell">${this.escapeHtml(email)}</td>
          <td>
            <div class="user-badges-cell">
              ${roleBadge}
            </div>
          </td>
          <td class="actions-cell">
            <button class="btn btn-primary btn-sm" onclick="window.usersPage.addUser('${userIdStr}')" title="Add to course">
              <i class="fas fa-user-plus"></i>
              Add
            </button>
          </td>
        </tr>
      `;
    }).join("");

    listElement.innerHTML = usersHTML;
  }

  async addUser(userId) {
    if (!this.isFaculty) {
      this.showError("Only faculty can add users to courses");
      return;
    }

    try {
      const response = await fetch(`/api/users/course/${this.courseId}/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add user");
      }

      const data = await response.json();
      if (data.success) {
        this.showSuccess("User added to course successfully");
        // Reload all lists
        await Promise.all([
          this.loadCourseUsers(),
          this.loadAvailableUsers()
        ]);
      }
    } catch (error) {
      console.error("Error adding user:", error);
      this.showError(error.message || "Failed to add user to course");
    }
  }

  async removeUser(userId) {
    if (!this.isFaculty) {
      this.showError("Only faculty can remove users from courses");
      return;
    }

    const user = this.courseUsers.find(u => {
      const uId = u.userId || u._id || u.user?._id;
      return String(uId) === String(userId);
    });

    const userName = user ? (user.displayName || user.user?.displayName || "this user") : "this user";

    this.showModal(
      "Remove User from Course",
      `Are you sure you want to remove ${userName} from this course?`,
      async () => {
        try {
          const response = await fetch(`/api/users/course/${this.courseId}/remove/${userId}`, {
            method: "DELETE",
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to remove user");
          }

          const data = await response.json();
          if (data.success) {
            this.showSuccess("User removed from course successfully");
            // Reload all lists
            await Promise.all([
              this.loadCourseUsers(),
              this.loadAvailableUsers()
            ]);
          }
        } catch (error) {
          console.error("Error removing user:", error);
          this.showError(error.message || "Failed to remove user from course");
        }
      }
    );
  }

  showModal(title, message, onConfirm) {
    const modal = document.getElementById("confirm-modal");
    const modalTitle = document.getElementById("modal-title");
    const modalMessage = document.getElementById("modal-message");
    const modalConfirm = document.getElementById("modal-confirm");

    if (modal && modalTitle && modalMessage && modalConfirm) {
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      
      // Remove existing event listeners by cloning
      const newConfirm = modalConfirm.cloneNode(true);
      modalConfirm.parentNode.replaceChild(newConfirm, modalConfirm);
      
      newConfirm.addEventListener("click", () => {
        this.hideModal();
        if (onConfirm) onConfirm();
      });

      modal.style.display = "flex";
    }
  }

  hideModal() {
    const modal = document.getElementById("confirm-modal");
    if (modal) {
      modal.style.display = "none";
    }
  }

  showSuccess(message) {
    // Simple notification - you can enhance this with a toast library
    alert(message);
  }

  showError(message) {
    // Simple notification - you can enhance this with a toast library
    alert("Error: " + message);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the page when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  // Get current user ID for comparison
  try {
    const response = await fetch("/api/current-user");
    const data = await response.json();
    if (data.success && data.user) {
      window.currentUserId = data.user._id || data.user.id;
    }
  } catch (error) {
    console.error("Error fetching current user:", error);
  }

  window.usersPage = new UsersPage();
});
