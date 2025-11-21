// Settings Page JavaScript

document.addEventListener("DOMContentLoaded", () => {
  // Initialize shared navigation
  new window.GRASPNavigation();

  // Initialize settings page
  initializeSettings();
});

function initializeSettings() {
  loadSettings();
  setupFormHandlers();
  setupDangerZone();
}

// Load saved settings from localStorage
function loadSettings() {
  try {
    // Load profile settings
    const profile = JSON.parse(localStorage.getItem("grasp-profile") || "{}");
    if (profile.instructorName) {
      document.getElementById("instructor-name").value = profile.instructorName;
    }
    if (profile.email) {
      document.getElementById("email").value = profile.email;
    }
    if (profile.department) {
      document.getElementById("department").value = profile.department;
    }

    // Load course preferences
    const coursePrefs = JSON.parse(
      localStorage.getItem("grasp-course-preferences") || "{}"
    );
    if (coursePrefs.defaultSemester) {
      document.getElementById("default-semester").value =
        coursePrefs.defaultSemester;
    }
    if (coursePrefs.defaultCredits) {
      document.getElementById("default-credits").value =
        coursePrefs.defaultCredits;
    }
    if (coursePrefs.autoSave !== undefined) {
      document.getElementById("auto-save").checked = coursePrefs.autoSave;
    }

    // Load notification settings
    const notifications = JSON.parse(
      localStorage.getItem("grasp-notifications") || "{}"
    );
    document.getElementById("email-notifications").checked =
      notifications.emailNotifications !== false;
    document.getElementById("question-ready").checked =
      notifications.questionReady !== false;
    document.getElementById("material-processed").checked =
      notifications.materialProcessed !== false;
    document.getElementById("quiz-reminders").checked =
      notifications.quizReminders === true;

    // Load display settings
    const display = JSON.parse(localStorage.getItem("grasp-display") || "{}");
    if (display.theme) {
      document.getElementById("theme").value = display.theme;
    }
    if (display.itemsPerPage) {
      document.getElementById("items-per-page").value = display.itemsPerPage;
    }
    if (display.compactView !== undefined) {
      document.getElementById("compact-view").checked = display.compactView;
    }

    // Load advanced settings
    const advanced = JSON.parse(
      localStorage.getItem("grasp-advanced") || "{}"
    );
    if (advanced.ollamaUrl) {
      document.getElementById("ollama-url").value = advanced.ollamaUrl;
    }
    if (advanced.ollamaModel) {
      document.getElementById("ollama-model").value = advanced.ollamaModel;
    }
    if (advanced.debugMode !== undefined) {
      document.getElementById("debug-mode").checked = advanced.debugMode;
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// Setup form submission handlers
function setupFormHandlers() {
  // Profile form
  document
    .getElementById("profile-form")
    .addEventListener("submit", handleProfileSubmit);

  // Course preferences form
  document
    .getElementById("course-preferences-form")
    .addEventListener("submit", handleCoursePreferencesSubmit);

  // Notification form
  document
    .getElementById("notification-form")
    .addEventListener("submit", handleNotificationSubmit);

  // Display form
  document
    .getElementById("display-form")
    .addEventListener("submit", handleDisplaySubmit);

  // Advanced form
  document
    .getElementById("advanced-form")
    .addEventListener("submit", handleAdvancedSubmit);
}

// Handle profile form submission
function handleProfileSubmit(e) {
  e.preventDefault();

  const profile = {
    instructorName: document.getElementById("instructor-name").value,
    email: document.getElementById("email").value,
    department: document.getElementById("department").value,
  };

  localStorage.setItem("grasp-profile", JSON.stringify(profile));
  showMessage("Profile settings saved successfully!", "success");
}

// Handle course preferences form submission
function handleCoursePreferencesSubmit(e) {
  e.preventDefault();

  const preferences = {
    defaultSemester: document.getElementById("default-semester").value,
    defaultCredits: document.getElementById("default-credits").value,
    autoSave: document.getElementById("auto-save").checked,
  };

  localStorage.setItem(
    "grasp-course-preferences",
    JSON.stringify(preferences)
  );
  showMessage("Course preferences saved successfully!", "success");
}

// Handle notification form submission
function handleNotificationSubmit(e) {
  e.preventDefault();

  const notifications = {
    emailNotifications: document.getElementById("email-notifications").checked,
    questionReady: document.getElementById("question-ready").checked,
    materialProcessed: document.getElementById("material-processed").checked,
    quizReminders: document.getElementById("quiz-reminders").checked,
  };

  localStorage.setItem("grasp-notifications", JSON.stringify(notifications));
  showMessage("Notification settings saved successfully!", "success");
}

// Handle display form submission
function handleDisplaySubmit(e) {
  e.preventDefault();

  const display = {
    theme: document.getElementById("theme").value,
    itemsPerPage: document.getElementById("items-per-page").value,
    compactView: document.getElementById("compact-view").checked,
  };

  localStorage.setItem("grasp-display", JSON.stringify(display));
  showMessage("Display settings saved successfully!", "success");

  // Apply theme if changed
  if (display.theme === "dark") {
    document.body.classList.add("dark-theme");
  } else {
    document.body.classList.remove("dark-theme");
  }
}

// Handle advanced form submission
function handleAdvancedSubmit(e) {
  e.preventDefault();

  const advanced = {
    ollamaUrl: document.getElementById("ollama-url").value,
    ollamaModel: document.getElementById("ollama-model").value,
    debugMode: document.getElementById("debug-mode").checked,
  };

  localStorage.setItem("grasp-advanced", JSON.stringify(advanced));
  showMessage("Advanced settings saved successfully!", "success");
}

// Setup danger zone actions
function setupDangerZone() {
  document
    .getElementById("clear-data-btn")
    .addEventListener("click", handleClearData);
  document
    .getElementById("reset-settings-btn")
    .addEventListener("click", handleResetSettings);
}

// Handle clear all data
function handleClearData() {
  if (
    !confirm(
      "Are you sure you want to clear all course data? This action cannot be undone!"
    )
  ) {
    return;
  }

  if (
    !confirm(
      "This will permanently delete all your course data, materials, and questions. Are you absolutely sure?"
    )
  ) {
    return;
  }

  // Clear course-related data from localStorage
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith("grasp-course") ||
        key.startsWith("courseProfile") ||
        key === "onboarded")
    ) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));

  showMessage("All course data has been cleared.", "success");

  // Redirect to onboarding after a delay
  setTimeout(() => {
    window.location.href = "/onboarding";
  }, 2000);
}

// Handle reset settings
function handleResetSettings() {
  if (
    !confirm(
      "Are you sure you want to reset all settings to their default values?"
    )
  ) {
    return;
  }

  // Clear all settings
  localStorage.removeItem("grasp-profile");
  localStorage.removeItem("grasp-course-preferences");
  localStorage.removeItem("grasp-notifications");
  localStorage.removeItem("grasp-display");
  localStorage.removeItem("grasp-advanced");

  // Reload the page to show default values
  window.location.reload();
}

// Show success/error message
function showMessage(message, type = "success") {
  // Remove existing messages
  const existingMessage = document.querySelector(".message");
  if (existingMessage) {
    existingMessage.remove();
  }

  // Create message element
  const messageEl = document.createElement("div");
  messageEl.className = `message ${type}`;
  messageEl.innerHTML = `
    <i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i>
    <span>${message}</span>
  `;

  // Insert at the top of the settings container
  const settingsContainer = document.querySelector(".settings-container");
  if (settingsContainer) {
    settingsContainer.insertBefore(messageEl, settingsContainer.firstChild);
  }

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageEl.parentNode) {
      messageEl.style.opacity = "0";
      messageEl.style.transition = "opacity 0.3s ease";
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.remove();
        }
      }, 300);
    }
  }, 5000);
}

