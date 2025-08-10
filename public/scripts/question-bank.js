// Question Bank Page JavaScript
// Handles interactions and functionality for the question bank page

class QuestionBankPage {
  constructor() {
    this.init();
  }

  init() {
    this.initializeNavigation();
    this.initializeTabs();
    this.initializeCheckboxes();
    this.initializeRadioButtons();
    this.initializeFilters();
    this.initializeSearch();
    this.initializeActionButtons();
  }

  initializeNavigation() {
    // Initialize navigation if available
    if (window.GRASPNavigation) {
      new GRASPNavigation();
    }
  }

  initializeTabs() {
    const tabButtons = document.querySelectorAll(".tab-button");

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        // Remove active class from all tabs
        tabButtons.forEach((btn) => btn.classList.remove("active"));

        // Add active class to clicked tab
        button.classList.add("active");

        // Handle tab switching
        const tabName = button.getAttribute("data-tab");
        this.switchTab(tabName);
      });
    });
  }

  switchTab(tabName) {
    console.log(`Switching to ${tabName} tab`);

    // Update page title
    if (tabName === "overview") {
      document.title = "Overview - Question Bank - GRASP";
    } else if (tabName === "review") {
      document.title = "Review - Question Bank - GRASP";
      // Here you could load review-specific content
      this.loadReviewContent();
    }

    // You can add more tab-specific logic here
    // For example, showing different panels or loading different data
  }

  loadReviewContent() {
    // This would load review-specific content when switching to the Review tab
    // For now, we'll just log the action
    console.log("Loading review content...");

    // You could:
    // - Show different panels
    // - Load different data
    // - Change the layout
    // - etc.
  }

  initializeCheckboxes() {
    const questionCheckboxes = document.querySelectorAll(
      '.question-item input[type="checkbox"]'
    );

    questionCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", (e) => {
        const questionItem = e.target.closest(".question-item");
        const questionText = questionItem.querySelector("label").textContent;

        if (e.target.checked) {
          console.log(`Selected question: ${questionText}`);
          questionItem.style.backgroundColor = "#e3f2fd";
        } else {
          console.log(`Deselected question: ${questionText}`);
          questionItem.style.backgroundColor = "";
        }

        this.updateBulkActions();
      });
    });
  }

  initializeRadioButtons() {
    const historyRadios = document.querySelectorAll(
      '.history-item input[type="radio"]'
    );

    historyRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        const historyItem = e.target.closest(".history-item");
        const historyText =
          historyItem.querySelector(".history-text").textContent;
        const historyTime =
          historyItem.querySelector(".history-time").textContent;

        console.log(`Selected history: ${historyText} at ${historyTime}`);

        // You could load details for the selected history item here
        this.loadHistoryDetails(historyText, historyTime);
      });
    });
  }

  loadHistoryDetails(text, time) {
    // This would load details for the selected history item
    console.log(`Loading details for: ${text} (${time})`);

    // You could:
    // - Show a modal with details
    // - Update other panels
    // - Load related questions
    // - etc.
  }

  initializeFilters() {
    const learningObjectivesFilter = document.querySelector(".filter-select");
    const weekFilter = document.querySelector(".filter-select:last-of-type");

    if (learningObjectivesFilter) {
      learningObjectivesFilter.addEventListener("change", (e) => {
        const selectedObjective = e.target.value;
        console.log(`Filtering by learning objective: ${selectedObjective}`);
        this.applyFilters();
      });
    }

    if (weekFilter) {
      weekFilter.addEventListener("change", (e) => {
        const selectedWeek = e.target.value;
        console.log(`Filtering by week: ${selectedWeek}`);
        this.applyFilters();
      });
    }
  }

  applyFilters() {
    // This would apply the selected filters to the question list
    console.log("Applying filters...");

    // You could:
    // - Filter the question list
    // - Update the objectives table
    // - Show/hide questions based on criteria
    // - etc.
  }

  initializeSearch() {
    const searchInput = document.querySelector(".search-box input");
    const searchDropdown = document.querySelector(".search-box i:last-child");

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase();
        this.performSearch(searchTerm);
      });

      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const searchTerm = e.target.value.trim();
          if (searchTerm) {
            this.performSearch(searchTerm);
          }
        }
      });
    }

    if (searchDropdown) {
      searchDropdown.addEventListener("click", () => {
        this.toggleSearchOptions();
      });
    }
  }

  performSearch(searchTerm) {
    if (searchTerm.length === 0) {
      // Show all questions if search is empty
      this.showAllQuestions();
      return;
    }

    console.log(`Searching for: ${searchTerm}`);

    // Filter questions based on search term
    const questionItems = document.querySelectorAll(".question-item");

    questionItems.forEach((item) => {
      const questionText = item
        .querySelector("label")
        .textContent.toLowerCase();
      const shouldShow = questionText.includes(searchTerm);

      item.style.display = shouldShow ? "flex" : "none";
    });

    // You could also search through:
    // - Learning objectives
    // - Bloom's levels
    // - Question content
    // - etc.
  }

  showAllQuestions() {
    const questionItems = document.querySelectorAll(".question-item");
    questionItems.forEach((item) => {
      item.style.display = "flex";
    });
  }

  toggleSearchOptions() {
    console.log("Toggle search options");
    // This could show advanced search options or filters
  }

  initializeActionButtons() {
    const editBtn = document.querySelector('.action-btn[title="Edit"]');
    const selectAllBtn = document.querySelector(
      '.action-btn[title="Select All"]'
    );
    const flagBtn = document.querySelector('.action-btn[title="Flag"]');
    const deleteBtn = document.querySelector('.action-btn[title="Delete"]');

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        this.handleEdit();
      });
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        this.handleSelectAll();
      });
    }

    if (flagBtn) {
      flagBtn.addEventListener("click", () => {
        this.handleFlag();
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        this.handleDelete();
      });
    }
  }

  handleEdit() {
    console.log("Edit button clicked");
    // This could:
    // - Enable edit mode
    // - Show edit forms
    // - Open edit modal
    // - etc.
  }

  handleSelectAll() {
    const questionCheckboxes = document.querySelectorAll(
      '.question-item input[type="checkbox"]'
    );
    const allChecked = Array.from(questionCheckboxes).every((cb) => cb.checked);

    questionCheckboxes.forEach((checkbox) => {
      checkbox.checked = !allChecked;

      // Trigger change event to update UI
      const event = new Event("change");
      checkbox.dispatchEvent(event);
    });

    console.log(
      allChecked ? "Deselected all questions" : "Selected all questions"
    );
  }

  handleFlag() {
    const selectedQuestions = this.getSelectedQuestions();

    if (selectedQuestions.length === 0) {
      this.showNotification("Please select questions to flag", "warning");
      return;
    }

    console.log(`Flagging ${selectedQuestions.length} questions`);
    this.showNotification(
      `${selectedQuestions.length} questions flagged`,
      "success"
    );

    // You could:
    // - Mark questions as flagged in the database
    // - Update the UI to show flagged status
    // - Send notifications
    // - etc.
  }

  handleDelete() {
    const selectedQuestions = this.getSelectedQuestions();

    if (selectedQuestions.length === 0) {
      this.showNotification("Please select questions to delete", "warning");
      return;
    }

    const confirmDelete = confirm(
      `Are you sure you want to delete ${selectedQuestions.length} questions? This action cannot be undone.`
    );

    if (confirmDelete) {
      console.log(`Deleting ${selectedQuestions.length} questions`);
      this.showNotification(
        `${selectedQuestions.length} questions deleted`,
        "success"
      );

      // You could:
      // - Remove questions from the database
      // - Update the UI
      // - Log the action
      // - etc.
    }
  }

  getSelectedQuestions() {
    const selectedCheckboxes = document.querySelectorAll(
      '.question-item input[type="checkbox"]:checked'
    );
    return Array.from(selectedCheckboxes).map((cb) => {
      const questionItem = cb.closest(".question-item");
      return {
        id: cb.id,
        text: questionItem.querySelector("label").textContent,
      };
    });
  }

  updateBulkActions() {
    const selectedQuestions = this.getSelectedQuestions();
    const hasSelection = selectedQuestions.length > 0;

    // Update action buttons based on selection
    const actionButtons = document.querySelectorAll(".action-btn");
    actionButtons.forEach((btn) => {
      if (btn.title === "Flag" || btn.title === "Delete") {
        btn.style.opacity = hasSelection ? "1" : "0.5";
        btn.style.cursor = hasSelection ? "pointer" : "not-allowed";
      }
    });

    // Update select all button text
    const selectAllBtn = document.querySelector(
      '.action-btn[title="Select All"]'
    );
    if (selectAllBtn) {
      const allCheckboxes = document.querySelectorAll(
        '.question-item input[type="checkbox"]'
      );
      const allChecked = Array.from(allCheckboxes).every((cb) => cb.checked);

      if (allChecked) {
        selectAllBtn.innerHTML = '<i class="fas fa-minus-square"></i>';
        selectAllBtn.title = "Deselect All";
      } else {
        selectAllBtn.innerHTML = '<i class="fas fa-check"></i>';
        selectAllBtn.title = "Select All";
      }
    }
  }

  showNotification(message, type = "info") {
    // Use the notification system from navigation.js if available
    if (
      window.GRASPNavigation &&
      window.GRASPNavigation.prototype.showNotification
    ) {
      window.GRASPNavigation.prototype.showNotification.call(
        this,
        message,
        type
      );
    } else {
      // Fallback notification
      console.log(`${type.toUpperCase()}: ${message}`);

      // Create a simple notification
      const notification = document.createElement("div");
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
        background-color: ${
          type === "success"
            ? "#27ae60"
            : type === "warning"
            ? "#f39c12"
            : "#3498db"
        };
        animation: slideIn 0.3s ease-out;
      `;

      document.body.appendChild(notification);

      setTimeout(() => {
        notification.remove();
      }, 3000);
    }
  }
}

// Initialize the page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new QuestionBankPage();
});

// Export for use in other files
window.QuestionBankPage = QuestionBankPage;
