// GRASP Dashboard JavaScript - Dynamic Data Loading
document.addEventListener("DOMContentLoaded", function () {
    // Initialize settings functionality
    initializeSettings();
  });
  
  async function initializeSettings() {
    try {
      // Initialize shared navigation
      new window.GRASPNavigation();
    } catch (error) {
      console.error("Error initializing settings:", error);
    }
  }

  // Export functions for potential external use
  window.GRASPSettings = {
  };
  