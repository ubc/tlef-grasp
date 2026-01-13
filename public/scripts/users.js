// GRASP Users Page JavaScript
class UsersPage {
  constructor() {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    this.courseId = selectedCourse.id || null;
    this.courseName = selectedCourse.name || "";
    
    this.isFaculty = false;
    this.courseUsers = [];
    this.availableStaff = [];
    
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
          // Use isFaculty from API response (includes administrator check)
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
  }

  updateUIForUserRole() {
    // Show available staff section only for faculty
    const availableStaffSection = document.getElementById("available-staff-section");
    if (availableStaffSection) {
      availableStaffSection.style.display = this.isFaculty ? "block" : "none";
    }
  }

  async loadData() {
    if (!this.courseId) {
      this.showError("No course selected");
      return;
    }

    // Update course name display
    const courseNameDisplay = document.getElementById("course-name-display");
    if (courseNameDisplay) {
      courseNameDisplay.textContent = this.courseName || "Unknown Course";
    }

    // Load course users
    await this.loadCourseUsers();

    // Load available staff (only for faculty)
    if (this.isFaculty) {
      await this.loadAvailableStaff();
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

  async loadAvailableStaff() {
    const loadingElement = document.getElementById("staff-loading");
    const listElement = document.getElementById("available-staff-list");
    const emptyElement = document.getElementById("staff-empty");

    try {
      if (loadingElement) loadingElement.style.display = "flex";
      if (listElement) listElement.innerHTML = "";
      if (emptyElement) emptyElement.style.display = "none";

      const response = await fetch(`/api/users/staff/not-in-course/${this.courseId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.users) {
        this.availableStaff = data.users;
        this.renderAvailableStaff();
      } else {
        this.availableStaff = [];
        this.renderAvailableStaff();
      }
    } catch (error) {
      console.error("Error loading available staff:", error);
      this.showError("Failed to load available staff");
      if (emptyElement) emptyElement.style.display = "block";
    } finally {
      if (loadingElement) loadingElement.style.display = "none";
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
      
      // Check if user is faculty
      const affiliations = Array.isArray(affiliation)
        ? affiliation
        : String(affiliation || '').split(',').map(a => a.trim());
      const isUserFaculty = affiliations.includes('faculty');
      const isUserStaff = affiliations.includes('staff') && !isUserFaculty;
      
      // Check if this is the current user
      const isCurrentUser = userIdStr === String(window.currentUserId || "");

      let roleBadge = '';
      if (isUserFaculty) {
        roleBadge = '<span class="badge badge-faculty"><i class="fas fa-graduation-cap"></i> Faculty</span>';
      } else if (isUserStaff) {
        roleBadge = '<span class="badge badge-staff"><i class="fas fa-user-tie"></i> Staff</span>';
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

  renderAvailableStaff() {
    const listElement = document.getElementById("available-staff-list");
    const emptyElement = document.getElementById("staff-empty");
    const tableWrapper = document.getElementById("staff-table-wrapper");

    if (!listElement) return;

    if (this.availableStaff.length === 0) {
      if (emptyElement) emptyElement.style.display = "block";
      if (tableWrapper) tableWrapper.style.display = "none";
      listElement.innerHTML = "";
      return;
    }

    if (emptyElement) emptyElement.style.display = "none";
    if (tableWrapper) tableWrapper.style.display = "block";

    const staffHTML = this.availableStaff.map(user => {
      const userId = user._id;
      const userIdStr = userId ? (userId.toString ? userId.toString() : String(userId)) : "";
      const displayName = user.displayName || "Unknown User";
      const email = user.email || "";

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
              <span class="badge badge-staff"><i class="fas fa-user-tie"></i> Staff</span>
            </div>
          </td>
          <td class="actions-cell">
            <button class="btn btn-primary btn-sm" onclick="window.usersPage.addUser('${userIdStr}')" title="Add to course">
              <i class="fas fa-user-plus"></i>
              Add to Course
            </button>
          </td>
        </tr>
      `;
    }).join("");

    listElement.innerHTML = staffHTML;
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
        // Reload both lists
        await this.loadCourseUsers();
        await this.loadAvailableStaff();
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
            // Reload both lists
            await this.loadCourseUsers();
            await this.loadAvailableStaff();
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
      // Store user ID globally for comparison
      // Note: The user object from session might have _id as string
      window.currentUserId = data.user._id || data.user.id;
    }
  } catch (error) {
    console.error("Error fetching current user:", error);
  }

  window.usersPage = new UsersPage();
});
