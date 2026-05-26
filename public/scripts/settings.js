// GRASP Settings JavaScript
document.addEventListener("DOMContentLoaded", function () {
    initializeSettings();
});

async function initializeSettings() {
    try {
        // Initialize shared navigation
        if (window.GRASPNavigation) {
            new window.GRASPNavigation();
        }

        // Tab Switching Logic
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab');
                
                // Update buttons
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update content
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    if (content.id === tabId) {
                        content.classList.add('active');
                    }
                });
            });
        });

        // Load Settings
        await loadSettings();

        // Save Settings Event
        const saveBtn = document.getElementById('save-all-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveSettings);
        }

        // Reset Bloom Defaults
        const resetBloomBtn = document.getElementById('reset-bloom-defaults');
        if (resetBloomBtn) {
            resetBloomBtn.addEventListener('click', () => {
                const defaults = {
                    Remember:  "fill-in-the-blank",
                    Understand: "multiple-choice",
                    Apply:      "multiple-choice",
                    Analyze:    "multiple-choice",
                    Evaluate:   "calculation",
                    Create:     "open-ended",
                };
                document.querySelectorAll('.bloom-select').forEach(select => {
                    const level = select.getAttribute('data-bloom');
                    if (defaults[level]) select.value = defaults[level];
                });
                showToast("Bloom defaults restored — click Save All Changes to apply.", "info");
            });
        }

    } catch (error) {
        console.error("Error initializing settings:", error);
        showToast("Error initializing settings", "error");
    }
}

async function loadSettings() {
    try {
        const selectedCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
        const courseId = selectedCourse.id;

        if (!courseId) {
            showToast("No course selected. Please select a course first.", "warning");
            return;
        }

        const response = await fetch(`/api/courses/${courseId}/settings`);
        const data = await response.json();

        if (data.success && data.settings) {
            const settings = data.settings;

            // Populate Prompt Tab
            if (settings.prompts) {
                document.getElementById('prompt-question-generation').value = settings.prompts.questionGeneration || '';
                document.getElementById('prompt-objective-auto').value = settings.prompts.objectiveGenerationAuto || '';
                document.getElementById('prompt-objective-manual').value = settings.prompts.objectiveGenerationManual || '';
            }

            // Populate Bloom type preferences
            if (settings.bloomTypePreferences) {
                populateBloomSelects(settings.bloomTypePreferences);
            }
        }
    } catch (error) {
        console.error("Error loading settings:", error);
        showToast("Error loading settings", "error");
    }
}

function populateBloomSelects(bloomTypePreferences) {
    document.querySelectorAll('.bloom-select').forEach(select => {
        const level = select.getAttribute('data-bloom');
        const prefs = bloomTypePreferences[level];
        if (prefs && prefs.length > 0) {
            select.value = prefs[0];
        }
    });
}

function readBloomSelects() {
    // Secondary types (all options after the primary) are preserved from the defaults
    // so changing the primary doesn't discard the fallback order.
    const defaults = {
        Remember:  ["fill-in-the-blank", "multiple-choice"],
        Understand: ["multiple-choice", "fill-in-the-blank"],
        Apply:      ["multiple-choice", "fill-in-the-blank"],
        Analyze:    ["multiple-choice", "fill-in-the-blank"],
        Evaluate:   ["calculation", "multiple-choice"],
        Create:     ["open-ended", "multiple-choice"],
    };
    const result = {};
    document.querySelectorAll('.bloom-select').forEach(select => {
        const level = select.getAttribute('data-bloom');
        const primary = select.value;
        // Build array: primary first, then the defaults minus primary to keep fallbacks
        const rest = (defaults[level] || []).filter(t => t !== primary);
        result[level] = [primary, ...rest];
    });
    return result;
}

async function saveSettings() {
    const saveBtn = document.getElementById('save-all-settings');
    const originalText = saveBtn.innerHTML;
    
    try {
        const selectedCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
        const courseId = selectedCourse.id;

        if (!courseId) {
            showToast("No course selected. Please select a course first.", "error");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        const settingsData = {
            prompts: {
                questionGeneration: document.getElementById('prompt-question-generation').value,
                objectiveGenerationAuto: document.getElementById('prompt-objective-auto').value,
                objectiveGenerationManual: document.getElementById('prompt-objective-manual').value
            },
            bloomTypePreferences: readBloomSelects(),
        };

        const response = await fetch(`/api/courses/${courseId}/settings`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settingsData)
        });

        const data = await response.json();

        if (data.success) {
            showToast("Settings saved successfully", "success");
        } else {
            throw new Error(data.error || "Failed to save settings");
        }
    } catch (error) {
        console.error("Error saving settings:", error);
        showToast(error.message || "Error saving settings", "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

// Helper for UI notifications (assuming toast system exists in style.css or elsewhere)
function showToast(message, type = "info") {
    // Check if there's an existing toast container or create one
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const iconMap = {
        success: '<i class="fas fa-check-circle"></i>',
        error: '<i class="fas fa-exclamation-circle"></i>',
        info: '<i class="fas fa-info-circle"></i>',
        warning: '<i class="fas fa-exclamation-triangle"></i>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${iconMap[type] || iconMap.info} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// Export for potentials
window.GRASPSettings = {
    loadSettings,
    saveSettings
};
  