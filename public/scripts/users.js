// GRASP Users Page JavaScript
class UsersPage {
  constructor() {
    // Get course from sessionStorage
    const selectedCourse = JSON.parse(sessionStorage.getItem("grasp-selected-course") || "{}");
    this.courseId = selectedCourse.id || null;
    this.courseName = selectedCourse.name || "";
    
    this.isFaculty = false;
    this.courseUsers = [];
    
    // Pagination & Filtering state
    this.currentPage = 1;
    this.itemsPerPage = 20;
    this.sectionFilter = "all";
    this.courseSections = [];
    this.filteredUsers = [];

    this.init();
  }

  async init() {
    await this.loadUserInfo();
    this.initializeNavigation();
    this.initializeEventListeners();

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
    
    // Section filter handler
    const sectionFilter = document.getElementById("course-section-filter");
    if (sectionFilter) {
      sectionFilter.addEventListener("change", (e) => {
        this.sectionFilter = e.target.value;
        this.currentPage = 1; // Reset to first page
        this.applyFilters();
      });
    }

    // Pagination handlers
    const prevPageBtn = document.getElementById("prev-page");
    const nextPageBtn = document.getElementById("next-page");
    if (prevPageBtn) {
      prevPageBtn.addEventListener("click", () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderCourseUsers();
        }
      });
    }
    if (nextPageBtn) {
      nextPageBtn.addEventListener("click", () => {
        const maxPage = Math.ceil(this.filteredUsers.length / this.itemsPerPage);
        if (this.currentPage < maxPage) {
          this.currentPage++;
          this.renderCourseUsers();
        }
      });
    }
  }



  async loadData() {
    if (!this.courseId) {
      this.showError("No course selected");
      return;
    }

    // Load course sections
    await this.loadCourseSections();

    // Load course users
    await this.loadCourseUsers();
  }

  async loadCourseSections() {
    try {
      const response = await fetch(`/api/courses/${this.courseId}/sections`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.sections) {
          this.courseSections = data.sections;
          this.populateSectionFilter();
        }
      }
    } catch (error) {
      console.error("Error loading course sections:", error);
    }
  }

  populateSectionFilter() {
    const filterSelect = document.getElementById("course-section-filter");
    if (!filterSelect) return;
    
    // Clear existing options except 'all'
    filterSelect.innerHTML = '<option value="all">All Sections</option>';
    
    this.courseSections.forEach(section => {
      const option = document.createElement("option");
      option.value = section.sectionId;
      option.textContent = section.sectionNumber || section.sectionId;
      filterSelect.appendChild(option);
    });
  }

  applyFilters() {
    if (this.sectionFilter === "all") {
      this.filteredUsers = [...this.courseUsers];
    } else {
      this.filteredUsers = this.courseUsers.filter(user => {
        return user.sections && user.sections.includes(this.sectionFilter);
      });
    }
    this.currentPage = 1;
    this.renderCourseUsers();
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
      } else {
        this.courseUsers = [];
      }
      this.applyFilters();
    } catch (error) {
      console.error("Error loading course users:", error);
      this.showError("Failed to load course users");
      if (emptyElement) emptyElement.style.display = "block";
    } finally {
      if (loadingElement) loadingElement.style.display = "none";
    }
  }



  renderCourseUsers() {
    const listElement = document.getElementById("course-users-list");
    const emptyElement = document.getElementById("course-users-empty");
    const tableWrapper = document.getElementById("course-users-table-wrapper");
    const paginationContainer = document.getElementById("users-pagination");

    if (!listElement) return;

    if (this.filteredUsers.length === 0) {
      if (emptyElement) emptyElement.style.display = "flex";
      if (tableWrapper) tableWrapper.style.display = "none";
      if (paginationContainer) paginationContainer.style.display = "none";
      listElement.innerHTML = "";
      return;
    }

    if (emptyElement) emptyElement.style.display = "none";
    if (tableWrapper) tableWrapper.style.display = "block";
    if (paginationContainer) paginationContainer.style.display = "flex";

    // Pagination logic
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const paginatedUsers = this.filteredUsers.slice(startIndex, endIndex);

    this.updatePaginationUI();

    const usersHTML = paginatedUsers.map(user => {
      const userId = user.userId || user._id || user.user?._id;
      const userIdStr = userId ? (userId.toString ? userId.toString() : String(userId)) : "";
      const displayName = user.displayName || user.user?.displayName || "Unknown User";
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

      // Map sections
      let sectionsHTML = '<span class="text-muted">-</span>';
      if (user.sections && user.sections.length > 0) {
         const sectionBadges = user.sections.map(sectionId => {
             const sectionData = this.courseSections.find(s => s.sectionId === sectionId);
             const sectionName = sectionData ? (sectionData.sectionNumber || sectionId) : sectionId;
             return `<span class="badge badge-section"><i class="fas fa-book"></i> ${this.escapeHtml(sectionName)}</span>`;
         });
         sectionsHTML = `<div class="user-badges-cell">${sectionBadges.join('')}</div>`;
      }

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
          <td>
            <div class="user-badges-cell">
              ${roleBadge}
            </div>
          </td>
          <td>
            ${sectionsHTML}
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

  updatePaginationUI() {
    const pageInfo = document.getElementById("page-info");
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    
    if (!pageInfo || !prevBtn || !nextBtn) return;
    
    const maxPage = Math.ceil(this.filteredUsers.length / this.itemsPerPage) || 1;
    pageInfo.textContent = `Page ${this.currentPage} of ${maxPage}`;
    
    prevBtn.disabled = this.currentPage <= 1;
    nextBtn.disabled = this.currentPage >= maxPage;
    
    // Add opacity for disabled state visually
    prevBtn.style.opacity = this.currentPage <= 1 ? "0.5" : "1";
    nextBtn.style.opacity = this.currentPage >= maxPage ? "0.5" : "1";
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
            // Reload course users
            await this.loadCourseUsers();
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
