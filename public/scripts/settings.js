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

    } catch (error) {
        console.error("Error initializing settings:", error);
        showToast("Error initializing settings", "error");
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();

        if (data.success && data.settings) {
            const settings = data.settings;
            
            // Populate General Tab
            if (settings.general) {
                document.getElementById('app-name').value = settings.general.appName || '';
            }

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
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        const settingsData = {
            general: {
                appName: document.getElementById('app-name').value
            },
            prompts: {
                questionGeneration: document.getElementById('prompt-question-generation').value,
                objectiveGenerationAuto: document.getElementById('prompt-objective-auto').value,
                objectiveGenerationManual: document.getElementById('prompt-objective-manual').value
            }
        };

        const response = await fetch('/api/settings', {
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
  