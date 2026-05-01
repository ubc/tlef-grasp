// GRASP Settings JavaScript
let defaultPrompts = {};

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
        await loadEnrollmentCode();
        await loadDefaultPrompts();

        // Reset Buttons Logic
        const resetBtns = document.querySelectorAll('.reset-btn');
        resetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const promptKey = btn.getAttribute('data-prompt');
                if (defaultPrompts[promptKey]) {
                    const textarea = btn.closest('.form-group').querySelector('textarea');
                    if (textarea) {
                        if (confirm('Reset this prompt to the system default? unsaved changes to this prompt will be lost.')) {
                            textarea.value = defaultPrompts[promptKey];
                            showToast('Prompt reset to default', 'info');
                        }
                    }
                }
            });
        });

        // Save Settings Event
        const saveBtn = document.getElementById('save-all-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveSettings);
        }

        const copyBtn = document.getElementById('copy-enrollment-code');
        if (copyBtn) {
            copyBtn.addEventListener('click', copyEnrollmentCode);
        }
        const regenBtn = document.getElementById('regenerate-enrollment-code');
        if (regenBtn) {
            regenBtn.addEventListener('click', regenerateEnrollmentCode);
        }

    } catch (error) {
        console.error("Error initializing settings:", error);
        showToast("Error initializing settings", "error");
    }
}

async function loadEnrollmentCode() {
    const input = document.getElementById('enrollment-code-display');
    if (!input) return;

    try {
        const selectedCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
        const courseId = selectedCourse.id;
        if (!courseId) {
            input.placeholder = 'No course selected';
            return;
        }

        const response = await fetch(`/api/courses/${courseId}/enrollment-code`);
        const data = await response.json();

        if (response.ok && data.success && data.enrollmentCode) {
            input.value = data.enrollmentCode;
        } else {
            throw new Error(data.error || 'Failed to load enrollment code');
        }
    } catch (error) {
        console.error('Error loading enrollment code:', error);
        input.placeholder = 'Could not load code';
        showToast(error.message || 'Could not load enrollment code', 'error');
    }
}

function copyEnrollmentCode() {
    const input = document.getElementById('enrollment-code-display');
    if (!input || !input.value) {
        showToast('No code to copy', 'warning');
        return;
    }
    navigator.clipboard.writeText(input.value).then(() => {
        showToast('Code copied to clipboard', 'success');
    }).catch(() => {
        input.select();
        document.execCommand('copy');
        showToast('Code copied', 'success');
    });
}

async function regenerateEnrollmentCode() {
    const btn = document.getElementById('regenerate-enrollment-code');
    const input = document.getElementById('enrollment-code-display');
    if (!btn || !confirm('Regenerate the enrollment code? The old code will stop working for new enrollments.')) {
        return;
    }

    try {
        const selectedCourse = JSON.parse(sessionStorage.getItem('grasp-selected-course') || '{}');
        const courseId = selectedCourse.id;
        if (!courseId) {
            showToast('No course selected', 'error');
            return;
        }

        btn.disabled = true;
        const response = await fetch(`/api/courses/${courseId}/regenerate-enrollment-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await response.json();

        if (response.ok && data.success && data.enrollmentCode) {
            if (input) input.value = data.enrollmentCode;
            showToast(data.message || 'Enrollment code regenerated', 'success');
        } else {
            throw new Error(data.error || 'Failed to regenerate');
        }
    } catch (error) {
        console.error('Regenerate enrollment code:', error);
        showToast(error.message || 'Failed to regenerate code', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function loadDefaultPrompts() {
    try {
        const response = await fetch('/api/courses/defaults/settings');
        const data = await response.json();
        if (data.success && data.defaults && data.defaults.prompts) {
            defaultPrompts = data.defaults.prompts;
        }
    } catch (error) {
        console.error('Error loading default prompts:', error);
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
        }
    } catch (error) {
        console.error("Error loading settings:", error);
        showToast("Error loading settings", "error");
    }
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
            }
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
  