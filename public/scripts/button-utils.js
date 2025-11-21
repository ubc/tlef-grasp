// Button Utilities - Prevents multiple clicks and handles button states
// This utility ensures buttons work properly across the entire app

class ButtonUtils {
  constructor() {
    this.clickHandlers = new Map();
    this.debounceTimers = new Map();
  }

  // Safely attach event listener, preventing duplicates
  safeAddEventListener(element, event, handler, options = {}) {
    if (!element) return;

    const key = `${element.id || element.className || 'element'}_${event}`;
    
    // Remove existing listener if it exists
    if (this.clickHandlers.has(key)) {
      const { handler: oldHandler, options: oldOptions } = this.clickHandlers.get(key);
      element.removeEventListener(event, oldHandler, oldOptions);
    }

    // Add new listener
    element.addEventListener(event, handler, options);
    this.clickHandlers.set(key, { handler, options });
  }

  // Debounced click handler - prevents rapid multiple clicks
  debouncedClick(element, handler, delay = 300) {
    if (!element) return;

    const key = element.id || element.className || 'element';
    
    this.safeAddEventListener(element, 'click', (e) => {
      // Prevent if button is disabled
      if (element.disabled || element.classList.contains('disabled')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Clear existing timer
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }

      // Set new timer
      const timer = setTimeout(() => {
        handler(e);
        this.debounceTimers.delete(key);
      }, delay);

      this.debounceTimers.set(key, timer);
    });
  }

  // Handle async button actions with loading state
  async handleAsyncButton(button, asyncFn, options = {}) {
    if (!button) return;

    const {
      loadingText = 'Loading...',
      loadingClass = 'loading',
      disableOnClick = true,
      preventDefault = true,
    } = options;

    // Prevent if already processing
    if (button.disabled || button.classList.contains(loadingClass)) {
      return;
    }

    const originalText = button.innerHTML;
    const originalDisabled = button.disabled;

    try {
      // Set loading state
      if (disableOnClick) {
        button.disabled = true;
      }
      button.classList.add(loadingClass);
      if (loadingText) {
        button.innerHTML = loadingText;
      }

      // Execute async function
      await asyncFn();
    } catch (error) {
      console.error('Button action error:', error);
      throw error;
    } finally {
      // Restore original state
      button.disabled = originalDisabled;
      button.classList.remove(loadingClass);
      button.innerHTML = originalText;
    }
  }

  // Prevent double-click on buttons
  preventDoubleClick(button, handler, options = {}) {
    if (!button) return;

    const { preventDefault = true } = options;
    let isProcessing = false;

    this.safeAddEventListener(button, 'click', async (e) => {
      if (preventDefault) {
        e.preventDefault();
      }
      e.stopPropagation();

      if (isProcessing) {
        console.log('Button click ignored - already processing');
        return;
      }

      isProcessing = true;
      button.disabled = true;

      try {
        await handler(e);
      } catch (error) {
        console.error('Button handler error:', error);
      } finally {
        // Re-enable after a short delay
        setTimeout(() => {
          isProcessing = false;
          button.disabled = false;
        }, 500);
      }
    });
  }

  // Initialize all buttons on a page with proper handlers
  initializeButtons(container = document) {
    // Find all buttons that need special handling
    const buttons = container.querySelectorAll('button, .btn, [role="button"]');
    
    buttons.forEach((button) => {
      // Skip if already initialized
      if (button.dataset.buttonInitialized === 'true') {
        return;
      }

      // Mark as initialized
      button.dataset.buttonInitialized = 'true';

      // Add click handler that prevents double-clicks
      const originalOnClick = button.onclick;
      if (originalOnClick) {
        this.preventDoubleClick(button, originalOnClick);
        button.onclick = null; // Remove inline handler
      }
    });
  }
}

// Global instance
window.ButtonUtils = new ButtonUtils();

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.ButtonUtils.initializeButtons();
});

// Re-initialize after dynamic content is added
if (window.MutationObserver) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          window.ButtonUtils.initializeButtons(node);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

