// App State Manager - Saves and restores state across all pages
// Comprehensive state persistence for the entire GRASP application

class AppStateManager {
  constructor() {
    this.stateKeys = {
      dashboard: 'grasp-dashboard-state',
      questionGeneration: 'grasp-question-generation-state',
      questionBank: 'grasp-question-bank-state',
      courseMaterials: 'grasp-course-materials-state',
      settings: 'grasp-settings-state',
      userProfile: 'grasp-user-profile-state',
      questionReview: 'grasp-question-review-state',
      onboarding: 'grasp-onboarding-state',
    };
    
    this.autoSaveInterval = 30000; // 30 seconds
    this.autoSaveTimer = null;
    this.init();
  }

  init() {
    // Auto-save on page unload
    window.addEventListener('beforeunload', () => {
      this.saveAllStates();
    });

    // Auto-save periodically
    this.startAutoSave();

    // Save on visibility change (tab switch)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveAllStates();
      }
    });
  }

  startAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      this.saveAllStates();
    }, this.autoSaveInterval);
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // Get state for a specific page
  getState(page, defaultState = {}) {
    try {
      const key = this.stateKeys[page] || `grasp-${page}-state`;
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check if state is too old (older than 7 days)
        if (parsed.timestamp && Date.now() - parsed.timestamp > 7 * 24 * 60 * 60 * 1000) {
          console.log(`State for ${page} is too old, clearing`);
          this.clearState(page);
          return defaultState;
        }
        return parsed.data || defaultState;
      }
    } catch (error) {
      console.error(`Error loading state for ${page}:`, error);
    }
    return defaultState;
  }

  // Save state for a specific page
  saveState(page, state) {
    try {
      const key = this.stateKeys[page] || `grasp-${page}-state`;
      const stateData = {
        data: state,
        timestamp: Date.now(),
        page: page,
      };
      localStorage.setItem(key, JSON.stringify(stateData));
      console.log(`State saved for ${page}`);
    } catch (error) {
      console.error(`Error saving state for ${page}:`, error);
      // If quota exceeded, try to clear old states
      if (error.name === 'QuotaExceededError') {
        this.clearOldStates();
        // Retry once
        try {
          localStorage.setItem(key, JSON.stringify(stateData));
        } catch (retryError) {
          console.error('Retry failed:', retryError);
        }
      }
    }
  }

  // Clear state for a specific page
  clearState(page) {
    try {
      const key = this.stateKeys[page] || `grasp-${page}-state`;
      localStorage.removeItem(key);
      console.log(`State cleared for ${page}`);
    } catch (error) {
      console.error(`Error clearing state for ${page}:`, error);
    }
  }

  // Save all states (called by pages that manage their own state)
  saveAllStates() {
    // Save dashboard state
    if (window.GRASPDashboard && window.GRASPDashboard.getState) {
      const dashboardState = window.GRASPDashboard.getState();
      if (dashboardState) {
        this.saveState('dashboard', dashboardState);
      }
    }

    // Save question generation state
    if (window.state && typeof window.state === 'object') {
      this.saveState('questionGeneration', window.state);
    }

    // Save question bank state
    if (window.questionBankPage && window.questionBankPage.state) {
      this.saveState('questionBank', window.questionBankPage.state);
    }

    // Save settings state
    if (window.settingsState) {
      this.saveState('settings', window.settingsState);
    }

    // Save user profile state
    if (window.userProfileState) {
      this.saveState('userProfile', window.userProfileState);
    }

    // Save course materials state
    if (window.courseMaterialsState) {
      this.saveState('courseMaterials', window.courseMaterialsState);
    }

    // Save question review state
    if (window.questionReviewPage && window.questionReviewPage.state) {
      this.saveState('questionReview', window.questionReviewPage.state);
    }
  }

  // Restore state for a specific page
  restoreState(page, callback) {
    const state = this.getState(page);
    if (callback && typeof callback === 'function') {
      callback(state);
    }
    return state;
  }

  // Clear old states (older than 7 days)
  clearOldStates() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    Object.values(this.stateKeys).forEach((key) => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.timestamp && now - parsed.timestamp > maxAge) {
            localStorage.removeItem(key);
            console.log(`Cleared old state: ${key}`);
          }
        }
      } catch (error) {
        // If parsing fails, remove it
        localStorage.removeItem(key);
      }
    });
  }

  // Export all states (for backup)
  exportStates() {
    const allStates = {};
    Object.entries(this.stateKeys).forEach(([page, key]) => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          allStates[page] = JSON.parse(saved);
        }
      } catch (error) {
        console.error(`Error exporting state for ${page}:`, error);
      }
    });
    return allStates;
  }

  // Import states (for restore)
  importStates(states) {
    Object.entries(states).forEach(([page, stateData]) => {
      try {
        const key = this.stateKeys[page] || `grasp-${page}-state`;
        localStorage.setItem(key, JSON.stringify(stateData));
        console.log(`Imported state for ${page}`);
      } catch (error) {
        console.error(`Error importing state for ${page}:`, error);
      }
    });
  }
}

// Global instance
window.AppStateManager = new AppStateManager();

// Auto-save on various events
document.addEventListener('DOMContentLoaded', () => {
  // Save state after page loads
  setTimeout(() => {
    window.AppStateManager.saveAllStates();
  }, 2000);
});

// Save on form changes
document.addEventListener('change', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
    // Debounce saves
    clearTimeout(window.appStateSaveTimer);
    window.appStateSaveTimer = setTimeout(() => {
      window.AppStateManager.saveAllStates();
    }, 1000);
  }
});

// Save on input
document.addEventListener('input', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    clearTimeout(window.appStateInputTimer);
    window.appStateInputTimer = setTimeout(() => {
      window.AppStateManager.saveAllStates();
    }, 2000);
  }
});

