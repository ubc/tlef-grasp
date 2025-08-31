// Question Generation JavaScript
// State management and functionality for the 5-step question generation process

// Development flag for mock API responses
const DEV_MODE = true;

// Main state object
const state = {
    step: 1,
    course: 'CHEM 121',
    files: [],
    urls: [],
    summary: '',
    objectives: [],
    questions: [],
    exportFormat: 'qti',
    objectiveGroups: [], // New for Step 3
    objectiveToDelete: null // New for Step 3
};

// Step titles for dynamic updates
const stepTitles = {
    1: 'Upload Materials',
    2: 'Review Summary',
    3: 'Create Objectives',
    4: 'Generate Questions',
    5: 'Select Output Format'
};

// Bloom's taxonomy levels
const bloomLevels = [
    'Remember',
    'Understand',
    'Apply',
    'Analyze',
    'Evaluate',
    'Create'
];

// Predefined objectives for the dropdown
const PREDEFINED_OBJECTIVES = [
    {
        metaId: 'enthalpy-spontaneity',
        metaTitle: 'Understand spontaneity limits of enthalpy and internal energy',
        kind: 'meta'
    },
    {
        metaId: 'entropy-state-function',
        metaTitle: 'Understand entropy as a state function',
        kind: 'meta'
    },
    {
        metaId: 'reversible-processes',
        metaTitle: 'Compare reversible and irreversible processes',
        kind: 'meta'
    },
    {
        metaId: 'gibbs-energy',
        metaTitle: 'Understand Gibbs free energy relationships',
        kind: 'meta'
    },
    {
        metaId: 'second-law',
        metaTitle: 'Apply the second law of thermodynamics',
        kind: 'meta'
    },
    {
        metaId: 'expansion-work',
        metaTitle: 'Analyze expansion work processes',
        kind: 'meta'
    },
    {
        metaId: 'isothermal-processes',
        metaTitle: 'Quantify isothermal processes',
        kind: 'meta'
    },
    {
        metaId: 'misconceptions',
        metaTitle: 'Identify and address misconceptions',
        kind: 'meta'
    }
];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeEventListeners();
    updateUI();
});

// ===== NAVIGATION FUNCTIONS =====

function initializeNavigation() {
    // Initialize GRASP navigation
    if (window.GRASPNavigation) {
        new window.GRASPNavigation();
    }
}

function initializeEventListeners() {
    // Course selection
    const courseSelect = document.getElementById('course-select');
    if (courseSelect) {
        courseSelect.addEventListener('change', (e) => {
            state.course = e.target.value;
        });
    }

    // Navigation buttons
    const backBtn = document.getElementById('back-btn');
    const continueBtn = document.getElementById('continue-btn');
    
    if (backBtn) {
        backBtn.addEventListener('click', goToPreviousStep);
    }
    
    if (continueBtn) {
        continueBtn.addEventListener('click', goToNextStep);
    }

    // Step 1: File upload and material tiles
    initializeFileUpload();
    initializeMaterialTiles();
    
    // Step 3: Objectives
    initializeObjectives();
    
    // Step 5: Export format selection
    initializeExportFormat();
}

function goToNextStep() {
    if (state.step === 5) {
        // Final step - handle export
        exportQuestions();
        return;
    }
    
    if (state.step < 5) {
        const currentStep = state.step;
        const nextStep = currentStep + 1;
        
        // Validate current step before proceeding
        if (validateCurrentStep()) {
            state.step = nextStep;
            updateUI();
            
            // Handle step-specific actions
            handleStepTransition(currentStep, nextStep);
        }
    }
}

function goToPreviousStep() {
    if (state.step > 1) {
        state.step = state.step - 1;
        updateUI();
    }
}

function validateCurrentStep() {
    switch (state.step) {
        case 1:
            return state.files.length > 0 || state.urls.length > 0;
        case 2:
            return state.summary.trim().length > 0;
        case 3:
            return state.objectiveGroups.length > 0 && state.objectiveGroups.every(group => 
                group.items.length > 0 && group.items.every(item => item.count >= item.minQuestions)
            );
        case 4:
            return state.questions.length > 0;
        default:
            return true;
    }
}

function handleStepTransition(fromStep, toStep) {
    switch (toStep) {
        case 2:
            generateSummary();
            break;
        case 4:
            generateQuestions();
            break;
        case 5:
            // Final step - no special handling needed
            break;
    }
}

// ===== UI UPDATE FUNCTIONS =====

function updateUI() {
    updateStepper();
    updatePageTitle();
    updateStepContent();
    updateNavigationButtons();
}

function updateStepper() {
    const steps = document.querySelectorAll('.stepper__step');
    
    steps.forEach((step, index) => {
        const stepNumber = index + 1;
        step.classList.remove('stepper__step--active', 'stepper__step--done');
        
        if (stepNumber === state.step) {
            step.classList.add('stepper__step--active');
        } else if (stepNumber < state.step) {
            step.classList.add('stepper__step--done');
        }
    });
}

function updatePageTitle() {
    const title = document.querySelector('.content-header__title');
    if (title) {
        title.textContent = stepTitles[state.step];
    }
}

function updateStepContent() {
    const panels = document.querySelectorAll('.step-panel');
    
    panels.forEach(panel => {
        panel.classList.remove('step-panel--active');
        if (parseInt(panel.dataset.step) === state.step) {
            panel.classList.add('step-panel--active');
        }
    });
}

function updateNavigationButtons() {
    const backBtn = document.getElementById('back-btn');
    const continueBtn = document.getElementById('continue-btn');
    
    if (backBtn) {
        backBtn.disabled = state.step === 1;
    }
    
    if (continueBtn) {
        if (state.step === 5) {
            continueBtn.textContent = 'Export';
        } else {
            continueBtn.textContent = 'Continue';
        }
    }
}

// ===== STEP 1: FILE UPLOAD FUNCTIONS =====

function initializeFileUpload() {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');
    const chooseFileBtn = document.getElementById('choose-file-btn');
    
    if (dropArea) {
        // Drag and drop events
        dropArea.addEventListener('dragover', handleDragOver);
        dropArea.addEventListener('dragleave', handleDragLeave);
        dropArea.addEventListener('drop', handleDrop);
        
        // Click to choose file
        if (chooseFileBtn) {
            chooseFileBtn.addEventListener('click', () => {
                fileInput.click();
            });
        }
        
        if (fileInput) {
            fileInput.addEventListener('change', handleFileSelect);
        }
    }
}

function handleDragOver(e) {
    e.preventDefault();
    const dropArea = document.getElementById('drop-area');
    dropArea.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    const dropArea = document.getElementById('drop-area');
    dropArea.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    const dropArea = document.getElementById('drop-area');
    dropArea.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    addFiles(files);
}

function addFiles(files) {
    files.forEach(file => {
        const fileObj = {
            id: Date.now() + Math.random(),
            name: file.name,
            size: formatFileSize(file.size),
            type: file.type,
            file: file
        };
        
        state.files.push(fileObj);
    });
    
    renderFileList();
    announceToScreenReader(`${files.length} file(s) added`);
}

function removeFile(fileId) {
    const index = state.files.findIndex(f => f.id === fileId);
    if (index > -1) {
        const removedFile = state.files[index];
        state.files.splice(index, 1);
        renderFileList();
        announceToScreenReader(`Removed ${removedFile.name}`);
    }
}

function renderFileList() {
    const fileList = document.getElementById('file-list');
    if (!fileList) return;
    
    fileList.innerHTML = '';
    
    // Render files
    state.files.forEach(file => {
        const fileItem = createFileItem(file);
        fileList.appendChild(fileItem);
    });
    
    // Render URLs
    state.urls.forEach(url => {
        const urlItem = createUrlItem(url);
        fileList.appendChild(urlItem);
    });
}

function createFileItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';
    
    const icon = getFileIcon(file.type);
    
    item.innerHTML = `
        <div class="file-item__info">
            <i class="${icon} file-item__icon"></i>
            <div class="file-item__details">
                <div class="file-item__name">${file.name}</div>
                <div class="file-item__size">${file.size}</div>
            </div>
        </div>
        <button type="button" class="file-item__remove" onclick="removeFile(${file.id})">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    return item;
}

function createUrlItem(url) {
    const item = document.createElement('div');
    item.className = 'file-item';
    
    item.innerHTML = `
        <div class="file-item__info">
            <i class="fas fa-link file-item__icon"></i>
            <div class="file-item__details">
                <div class="file-item__name">${url.url}</div>
                <div class="file-item__size">URL</div>
            </div>
        </div>
        <button type="button" class="file-item__remove" onclick="removeUrl(${url.id})">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    return item;
}

function getFileIcon(type) {
    if (type.includes('pdf')) return 'fas fa-file-pdf';
    if (type.includes('text')) return 'fas fa-file-alt';
    if (type.includes('word')) return 'fas fa-file-word';
    return 'fas fa-file';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ===== MATERIAL TILES FUNCTIONS =====

function initializeMaterialTiles() {
    const tiles = document.querySelectorAll('.material-tile');
    
    tiles.forEach(tile => {
        tile.addEventListener('click', () => {
            const type = tile.dataset.type;
            handleMaterialTileClick(type);
        });
    });
    
    // Modal event listeners
    initializeModals();
}

function handleMaterialTileClick(type) {
    switch (type) {
        case 'text':
            openTextModal();
            break;
        case 'pdf':
            // PDF is handled by file upload
            document.getElementById('file-input').click();
            break;
        case 'url':
            openUrlModal();
            break;
        case 'panopto':
            alert('Panopto integration coming soon!');
            break;
    }
}

function initializeModals() {
    // Text modal
    const textModal = document.getElementById('text-modal');
    const textModalClose = document.getElementById('text-modal-close');
    const textModalCancel = document.getElementById('text-modal-cancel');
    const textModalSave = document.getElementById('text-modal-save');
    
    if (textModalClose) {
        textModalClose.addEventListener('click', closeTextModal);
    }
    if (textModalCancel) {
        textModalCancel.addEventListener('click', closeTextModal);
    }
    if (textModalSave) {
        textModalSave.addEventListener('click', saveTextContent);
    }
    
    // URL modal
    const urlModal = document.getElementById('url-modal');
    const urlModalClose = document.getElementById('url-modal-close');
    const urlModalCancel = document.getElementById('url-modal-cancel');
    const urlModalSave = document.getElementById('url-modal-save');
    
    if (urlModalClose) {
        urlModalClose.addEventListener('click', closeUrlModal);
    }
    if (urlModalCancel) {
        urlModalCancel.addEventListener('click', closeUrlModal);
    }
    if (urlModalSave) {
        urlModalSave.addEventListener('click', saveUrlContent);
    }
}

function openTextModal() {
    const modal = document.getElementById('text-modal');
    modal.classList.add('modal--active');
    document.getElementById('text-content').focus();
}

function closeTextModal() {
    const modal = document.getElementById('text-modal');
    modal.classList.remove('modal--active');
    document.getElementById('text-content').value = '';
}

function saveTextContent() {
    const textContent = document.getElementById('text-content').value.trim();
    if (textContent) {
        const textFile = {
            id: Date.now() + Math.random(),
            name: 'Text Content',
            size: formatFileSize(new Blob([textContent]).size),
            type: 'text/plain',
            content: textContent
        };
        
        state.files.push(textFile);
        renderFileList();
        closeTextModal();
        announceToScreenReader('Text content added');
    }
}

function openUrlModal() {
    const modal = document.getElementById('url-modal');
    modal.classList.add('modal--active');
    document.getElementById('url-input').focus();
}

function closeUrlModal() {
    const modal = document.getElementById('url-modal');
    modal.classList.remove('modal--active');
    document.getElementById('url-input').value = '';
}

function saveUrlContent() {
    const urlContent = document.getElementById('url-input').value.trim();
    if (urlContent) {
        const urlObj = {
            id: Date.now() + Math.random(),
            url: urlContent
        };
        
        state.urls.push(urlObj);
        renderFileList();
        closeUrlModal();
        announceToScreenReader('URL added');
    }
}

function removeUrl(urlId) {
    const index = state.urls.findIndex(u => u.id === urlId);
    if (index > -1) {
        const removedUrl = state.urls[index];
        state.urls.splice(index, 1);
        renderFileList();
        announceToScreenReader(`Removed ${removedUrl.url}`);
    }
}

// ===== STEP 2: SUMMARY FUNCTIONS =====

async function generateSummary() {
    const summaryLoading = document.getElementById('summary-loading');
    const summaryText = document.getElementById('summary-text');
    
    if (summaryLoading) summaryLoading.style.display = 'block';
    if (summaryText) summaryText.style.display = 'none';
    
    try {
        // Prepare content for summary
        const content = prepareContentForSummary();
        
        // Call API
        const response = await fetch('/api/questions/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: content })
        });
        
        if (response.ok) {
            const data = await response.json();
            state.summary = data.summary;
        } else {
            throw new Error('Failed to generate summary');
        }
    } catch (error) {
        console.error('Summary generation failed:', error);
        if (DEV_MODE) {
            // Mock response for development
            state.summary = `This is a mock summary of the uploaded content. It would normally be generated by the AI based on the materials provided. The content appears to cover fundamental concepts that would be suitable for creating educational questions.`;
        } else {
            state.summary = 'Failed to generate summary. Please try again.';
        }
    }
    
    if (summaryLoading) summaryLoading.style.display = 'none';
    if (summaryText) summaryText.style.display = 'block';
    
    const summaryEditor = document.getElementById('summary-editor');
    if (summaryEditor) {
        summaryEditor.value = state.summary;
        summaryEditor.addEventListener('input', (e) => {
            state.summary = e.target.value;
        });
    }
}

function prepareContentForSummary() {
    let content = '';
    
    // Add file contents
    state.files.forEach(file => {
        if (file.content) {
            content += file.content + '\n\n';
        }
    });
    
    // Add URLs
    state.urls.forEach(url => {
        content += `URL: ${url.url}\n\n`;
    });
    
    return content;
}

// ===== STEP 3: OBJECTIVES FUNCTIONS =====

// Initialize Step 3 state
function initializeObjectives() {
    // Initialize with sample data if no groups exist
    if (state.objectiveGroups.length === 0) {
        state.objectiveGroups = [
            {
                id: 1,
                metaId: 'enthalpy-spontaneity',
                title: "Learning Objective 1: Understand spontaneity limits of enthalpy and internal energy",
                isOpen: true,
                items: [
                    {
                        id: 1.1,
                        text: "Recognize that enthalpy (ΔH) alone does not determine spontaneity.",
                        bloom: ["Remember", "Understand"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    },
                    {
                        id: 1.2,
                        text: "Recognize that internal energy (ΔE) alone is insufficient to determine spontaneity.",
                        bloom: ["Remember"],
                        minQuestions: 2,
                        count: 3,
                        mode: 'manual'
                    }
                ]
            },
            {
                id: 2,
                metaId: 'entropy-state-function',
                title: "Learning Objective 2: Understand entropy as a state function",
                isOpen: false,
                items: [
                    {
                        id: 2.1,
                        text: "Distinguish state functions from path functions using entropy examples.",
                        bloom: ["Understand", "Apply"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    },
                    {
                        id: 2.2,
                        text: "Apply the second law to evaluate spontaneity qualitatively.",
                        bloom: ["Apply"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    },
                    {
                        id: 2.3,
                        text: "Compare reversible and irreversible expansion work.",
                        bloom: ["Analyze"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    },
                    {
                        id: 2.4,
                        text: "Quantify entropy changes for isothermal ideal-gas processes.",
                        bloom: ["Apply", "Analyze"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    }
                ]
            },
            {
                id: 3,
                metaId: 'reversible-processes',
                title: "Learning Objective 3: Compare reversible and irreversible processes",
                isOpen: false,
                items: [
                    {
                        id: 3.1,
                        text: "Interpret Gibbs free energy (ΔG) for coupled reactions.",
                        bloom: ["Understand", "Apply"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    },
                    {
                        id: 3.2,
                        text: "Identify common misconceptions about ΔH, ΔE, ΔG, and spontaneity.",
                        bloom: ["Evaluate"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    },
                    {
                        id: 3.3,
                        text: "Compare reversible and irreversible expansion work.",
                        bloom: ["Analyze"],
                        minQuestions: 2,
                        count: 2,
                        mode: 'manual'
                    }
                ]
            }
        ];
    }
    
    // Initialize add objectives button
    const addObjectivesBtn = document.getElementById('add-objectives-btn');
    if (addObjectivesBtn) {
        addObjectivesBtn.addEventListener('click', toggleAddObjectivesDropdown);
    }
    
    // Initialize dropdown functionality
    initializeAddObjectivesDropdown();
    
    // Initialize modals
    initializeModals();
    
    // Render initial state
    renderObjectiveGroups();
}

function initializeAddObjectivesDropdown() {
    const dropdown = document.getElementById('add-objectives-dropdown');
    const searchInput = document.getElementById('objective-search');
    const dropdownOptions = document.getElementById('dropdown-options');
    const createCustomBtn = document.getElementById('create-custom-btn');
    
    // Populate predefined options with new schema
    dropdownOptions.innerHTML = PREDEFINED_OBJECTIVES.map(objective => 
        `<div class="dropdown-option" data-meta-id="${objective.metaId}" data-meta-title="${objective.metaTitle}">${objective.metaTitle}</div>`
    ).join('');
    
    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const options = dropdownOptions.querySelectorAll('.dropdown-option');
            
            options.forEach(option => {
                const text = option.textContent.toLowerCase();
                if (text.includes(searchTerm)) {
                    option.classList.remove('dropdown-option--hidden');
                } else {
                    option.classList.add('dropdown-option--hidden');
                }
            });
        });
    }
    
    // Option selection
    dropdownOptions.addEventListener('click', (e) => {
        if (e.target.classList.contains('dropdown-option')) {
            const metaId = e.target.dataset.metaId;
            const metaTitle = e.target.dataset.metaTitle;
            handleMetaObjectiveSelection(metaId, metaTitle);
            hideAddObjectivesDropdown();
        }
    });
    
    // Create custom objective
    if (createCustomBtn) {
        createCustomBtn.addEventListener('click', () => {
            hideAddObjectivesDropdown();
            showCustomObjectiveModal();
        });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown?.contains(e.target) && !e.target.closest('#add-objectives-btn')) {
            hideAddObjectivesDropdown();
        }
    });
}

function toggleAddObjectivesDropdown() {
    const dropdown = document.getElementById('add-objectives-dropdown');
    const addBtn = document.getElementById('add-objectives-btn');
    
    if (dropdown.style.display === 'none' || !dropdown.style.display) {
        showAddObjectivesDropdown();
    } else {
        hideAddObjectivesDropdown();
    }
}

function showAddObjectivesDropdown() {
    const dropdown = document.getElementById('add-objectives-dropdown');
    const addBtn = document.getElementById('add-objectives-btn');
    
    if (dropdown && addBtn) {
        dropdown.style.display = 'block';
        addBtn.style.position = 'relative';
        
        // Focus search input
        const searchInput = document.getElementById('objective-search');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }
    }
}

function hideAddObjectivesDropdown() {
    const dropdown = document.getElementById('add-objectives-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

function showCustomObjectiveModal() {
    const modal = document.getElementById('custom-objective-modal');
    if (modal) {
        modal.style.display = 'flex';
        const textInput = document.getElementById('custom-objective-text');
        if (textInput) {
            setTimeout(() => textInput.focus(), 100);
        }
    }
}

function hideModal(modal) {
    if (modal) {
        modal.style.display = 'none';
    }
}

function handleMetaObjectiveSelection(metaId, metaTitle) {
    // Check if this meta objective already exists
    const existingGroup = state.objectiveGroups.find(group => group.metaId === metaId);
    
    if (existingGroup) {
        // Group exists - expand it, scroll into view, and focus header
        existingGroup.isOpen = true;
        renderObjectiveGroups();
        
        // Scroll into view and focus
        setTimeout(() => {
            const groupElement = document.querySelector(`[data-group-id="${existingGroup.id}"]`);
            if (groupElement) {
                groupElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const headerElement = groupElement.querySelector('.objective-group__title');
                if (headerElement) {
                    headerElement.focus();
                }
            }
        }, 100);
        
        announceToScreenReader(`Meta objective revealed: ${metaTitle}`);
    } else {
        // Create new meta learning objective group
        const newGroupId = Date.now() + Math.random();
        const newGroupNumber = state.objectiveGroups.length + 1;
        
        const newGroup = {
            id: newGroupId,
            metaId: metaId,
            title: `Learning Objective ${newGroupNumber}: ${metaTitle}`,
            isOpen: true,
            items: []
        };
        
        // Append to the end of the groups array
        state.objectiveGroups.push(newGroup);
        
        // Renumber all groups
        renumberObjectiveGroups();
        
        renderObjectiveGroups();
        
        // Scroll into view and focus
        setTimeout(() => {
            const groupElement = document.querySelector(`[data-group-id="${newGroupId}"]`);
            if (groupElement) {
                groupElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const headerElement = groupElement.querySelector('.objective-group__title');
                if (headerElement) {
                    headerElement.focus();
                }
            }
        }, 100);
        
        announceToScreenReader(`Meta objective added: ${metaTitle}`);
    }
}

function renumberObjectiveGroups() {
    state.objectiveGroups.forEach((group, index) => {
        const groupNumber = index + 1;
        const titleMatch = group.title.match(/^Learning Objective \d+: (.+)$/);
        if (titleMatch) {
            group.title = `Learning Objective ${groupNumber}: ${titleMatch[1]}`;
        }
    });
}

function renderObjectiveGroups() {
    const groupsContainer = document.getElementById('objectives-groups');
    if (!groupsContainer) return;
    
    groupsContainer.innerHTML = '';
    
    state.objectiveGroups.forEach(group => {
        const groupElement = createObjectiveGroup(group);
        groupsContainer.appendChild(groupElement);
    });
}

function createObjectiveGroup(group) {
    const groupElement = document.createElement('div');
    groupElement.className = `objective-group ${group.isOpen ? 'objective-group--expanded' : 'objective-group--collapsed'}`;
    groupElement.setAttribute('data-group-id', group.id);
    
    const itemCount = group.items.length;
    const totalCount = group.items.reduce((sum, item) => sum + item.count, 0);
    const isWarning = totalCount < 5;
    
    const emptyState = itemCount === 0 ? `
        <div class="objective-group__empty">
            <p>No granular objectives yet</p>
        </div>
    ` : '';
    
    groupElement.innerHTML = `
        <div class="objective-group__header" onclick="toggleObjectiveGroup(${group.id})">
            <h3 class="objective-group__title" tabindex="0">${group.title}</h3>
            <div class="objective-group__toggle">
                <span>${itemCount} objectives</span>
                <i class="fas fa-chevron-down"></i>
            </div>
        </div>
        <div class="objective-group__content">
            ${emptyState}
            ${group.items.map(item => createObjectiveItem(item, group.id)).join('')}
            ${itemCount > 0 ? `
                <div class="objective-group__footer ${isWarning ? 'objective-group__footer--warning' : ''}">
                    Total: ${totalCount} Required minimum: 5 (${totalCount >= 5 ? '≥5' : '<5'})
                </div>
            ` : ''}
        </div>
    `;
    
    return groupElement;
}

function createObjectiveItem(item, groupId) {
    const bloomChips = bloomLevels.map(level => {
        const isSelected = item.bloom.includes(level);
        const isDisabled = item.mode === 'auto';
        return `
            <button type="button" 
                class="bloom-chip ${isSelected ? 'bloom-chip--selected' : ''} ${isDisabled ? 'bloom-chip--disabled' : ''}"
                onclick="toggleBloomChip(${groupId}, ${item.id}, '${level}')"
                ${isDisabled ? 'disabled' : ''}
                aria-checked="${isSelected}"
            >
                ${level}
            </button>
        `;
    }).join('');
    
    const bloomModeToggle = item.mode === 'manual' ? `
        <div class="bloom-mode-toggle">
            <button type="button" class="bloom-mode-btn bloom-mode-btn--active">Choose Bloom</button>
            <button type="button" class="bloom-mode-btn bloom-mode-btn--inactive" onclick="setBloomMode(${groupId}, ${item.id}, 'auto')">AI decide later</button>
        </div>
    ` : `
        <div class="bloom-mode-toggle">
            <button type="button" class="bloom-mode-btn bloom-mode-btn--inactive" onclick="setBloomMode(${groupId}, ${item.id}, 'manual')">Choose Bloom</button>
            <button type="button" class="bloom-mode-btn bloom-mode-btn--active">AI decide later</button>
            <span class="auto-pill">Auto (pending)</span>
        </div>
    `;
    
    return `
        <div class="objective-item" data-item-id="${item.id}">
            <button type="button" class="objective-item__delete" onclick="confirmDeleteObjective(${groupId}, ${item.id})" aria-label="Remove objective">
                ×
            </button>
            <div class="objective-item__content">
                <div class="objective-item__text" contenteditable="true" onblur="updateObjectiveText(${groupId}, ${item.id}, this.textContent)">
                    ${item.text}
                </div>
                <div class="objective-item__controls">
                    <div class="objective-item__bloom-chips">
                        ${bloomChips}
                    </div>
                    <div class="objective-item__min">Min: ${item.minQuestions}</div>
                    ${bloomModeToggle}
                </div>
            </div>
            <div class="objective-item__tools">
                <div class="objective-item__stepper">
                    <button type="button" class="stepper-btn" onclick="decrementCount(${groupId}, ${item.id})" ${item.count <= item.minQuestions ? 'disabled' : ''}>
                        –
                    </button>
                    <span class="stepper-value">${item.count}</span>
                    <button type="button" class="stepper-btn" onclick="incrementCount(${groupId}, ${item.id})" ${item.count >= 9 ? 'disabled' : ''}>
                        +
                    </button>
                </div>
                <button type="button" class="objective-item__action-btn" onclick="editObjective(${groupId}, ${item.id})" title="Edit objective">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button type="button" class="objective-item__action-btn objective-item__action-btn--disabled" title="Connect AI later" disabled>
                    <i class="fas fa-sync-alt"></i>
                </button>
            </div>
        </div>
    `;
}

function toggleObjectiveGroup(groupId) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    if (group) {
        group.isOpen = !group.isOpen;
        renderObjectiveGroups();
    }
}

function toggleBloomChip(groupId, itemId, level) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    const item = group?.items.find(i => i.id === itemId);
    
    if (item && item.mode === 'manual') {
        const index = item.bloom.indexOf(level);
        if (index > -1) {
            item.bloom.splice(index, 1);
        } else {
            item.bloom.push(level);
        }
        renderObjectiveGroups();
    }
}

function setBloomMode(groupId, itemId, mode) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    const item = group?.items.find(i => i.id === itemId);
    
    if (item) {
        item.mode = mode;
        if (mode === 'auto') {
            item.bloom = [];
        }
        renderObjectiveGroups();
    }
}

function updateObjectiveText(groupId, itemId, text) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    const item = group?.items.find(i => i.id === itemId);
    
    if (item) {
        item.text = text;
    }
}

function incrementCount(groupId, itemId) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    const item = group?.items.find(i => i.id === itemId);
    
    if (item && item.count < 9) {
        item.count++;
        renderObjectiveGroups();
        announceToScreenReader(`Count increased to ${item.count}`);
    }
}

function decrementCount(groupId, itemId) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    const item = group?.items.find(i => i.id === itemId);
    
    if (item && item.count > item.minQuestions) {
        item.count--;
        renderObjectiveGroups();
        announceToScreenReader(`Count decreased to ${item.count}`);
    }
}

function editObjective(groupId, itemId) {
    const itemElement = document.querySelector(`[data-item-id="${itemId}"] .objective-item__text`);
    if (itemElement) {
        itemElement.focus();
        itemElement.classList.add('objective-item__text--editing');
        
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(itemElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function confirmDeleteObjective(groupId, itemId) {
    state.objectiveToDelete = { groupId, itemId };
    const modal = document.getElementById('delete-confirmation-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function deleteObjective(groupId, itemId) {
    const group = state.objectiveGroups.find(g => g.id === groupId);
    if (group) {
        const index = group.items.findIndex(i => i.id === itemId);
        if (index > -1) {
            const removedItem = group.items[index];
            group.items.splice(index, 1);
            
            // If group becomes empty, remove it and renumber
            if (group.items.length === 0) {
                const groupIndex = state.objectiveGroups.findIndex(g => g.id === groupId);
                if (groupIndex > -1) {
                    state.objectiveGroups.splice(groupIndex, 1);
                    renumberObjectiveGroups();
                }
            }
            
            renderObjectiveGroups();
            announceToScreenReader(`Removed objective: ${removedItem.text}`);
        }
    }
}

function initializeModals() {
    // Custom objective modal
    const customModal = document.getElementById('custom-objective-modal');
    const customModalClose = document.getElementById('custom-modal-close');
    const customModalCancel = document.getElementById('custom-modal-cancel');
    const customModalSave = document.getElementById('custom-modal-save');
    
    if (customModalClose) {
        customModalClose.addEventListener('click', () => hideModal(customModal));
    }
    if (customModalCancel) {
        customModalCancel.addEventListener('click', () => hideModal(customModal));
    }
    if (customModalSave) {
        customModalSave.addEventListener('click', () => {
            const textInput = document.getElementById('custom-objective-text');
            if (textInput && textInput.value.trim()) {
                // Create custom meta objective
                const customMetaId = 'custom-' + Date.now();
                const customMetaTitle = textInput.value.trim();
                handleMetaObjectiveSelection(customMetaId, customMetaTitle);
                textInput.value = '';
                hideModal(customModal);
            }
        });
    }
    
    // Delete confirmation modal
    const deleteModal = document.getElementById('delete-confirmation-modal');
    const deleteModalClose = document.getElementById('delete-modal-close');
    const deleteModalCancel = document.getElementById('delete-modal-cancel');
    const deleteModalConfirm = document.getElementById('delete-modal-confirm');
    
    if (deleteModalClose) {
        deleteModalClose.addEventListener('click', () => hideModal(deleteModal));
    }
    if (deleteModalCancel) {
        deleteModalCancel.addEventListener('click', () => hideModal(deleteModal));
    }
    if (deleteModalConfirm) {
        deleteModalConfirm.addEventListener('click', () => {
            if (state.objectiveToDelete) {
                deleteObjective(state.objectiveToDelete.groupId, state.objectiveToDelete.itemId);
                state.objectiveToDelete = null;
                hideModal(deleteModal);
            }
        });
    }
}

// ===== STEP 5: EXPORT FORMAT FUNCTIONS =====

function initializeExportFormat() {
    const exportOptions = document.querySelectorAll('input[name="export-format"]');
    
    exportOptions.forEach(option => {
        option.addEventListener('change', (e) => {
            state.exportFormat = e.target.value;
        });
    });
}

// ===== STEP 4: QUESTIONS FUNCTIONS =====

async function generateQuestions() {
    const questionsLoading = document.getElementById('questions-loading');
    const questionsList = document.getElementById('questions-list');
    
    if (questionsLoading) questionsLoading.style.display = 'block';
    if (questionsList) questionsList.style.display = 'none';
    
    try {
        // Prepare content for question generation
        const content = prepareContentForQuestions();
        
        // Call API
        const response = await fetch('/api/questions/generate-questions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: content })
        });
        
        if (response.ok) {
            const data = await response.json();
            state.questions = data.questions;
        } else {
            throw new Error('Failed to generate questions');
        }
    } catch (error) {
        console.error('Question generation failed:', error);
        if (DEV_MODE) {
            // Mock response for development
            state.questions = [
                {
                    id: 1,
                    text: 'What is the primary function of a catalyst in a chemical reaction?',
                    type: 'multiple-choice',
                    options: [
                        'To increase the activation energy',
                        'To decrease the activation energy',
                        'To change the equilibrium constant',
                        'To increase the temperature'
                    ],
                    correctAnswer: 1,
                    bloomLevel: 'Understand',
                    difficulty: 'Medium'
                },
                {
                    id: 2,
                    text: 'Which of the following best describes an exothermic reaction?',
                    type: 'multiple-choice',
                    options: [
                        'A reaction that absorbs heat from the surroundings',
                        'A reaction that releases heat to the surroundings',
                        'A reaction that requires continuous heating',
                        'A reaction that occurs only at high temperatures'
                    ],
                    correctAnswer: 1,
                    bloomLevel: 'Remember',
                    difficulty: 'Easy'
                }
            ];
        } else {
            state.questions = [];
        }
    }
    
    if (questionsLoading) questionsLoading.style.display = 'none';
    if (questionsList) questionsList.style.display = 'block';
    
    renderQuestions();
}

function prepareContentForQuestions() {
    let content = `Summary: ${state.summary}\n\n`;
    content += `Objectives:\n`;
    state.objectiveGroups.forEach(group => {
        group.items.forEach(item => {
            content += `- ${item.text} (${item.bloom.join(', ')}) Min: ${item.minQuestions}, Count: ${item.count}\n`;
        });
    });
    content += `\nGenerate multiple choice questions based on this content.`;
    
    return content;
}

function renderQuestions() {
    const questionsList = document.getElementById('questions-list');
    if (!questionsList) return;
    
    questionsList.innerHTML = '';
    
    state.questions.forEach(question => {
        const questionItem = createQuestionItem(question);
        questionsList.appendChild(questionItem);
    });
}

function createQuestionItem(question) {
    const options = question.options.map((option, index) => {
        const isCorrect = index === question.correctAnswer;
        return `<li class="question-item__option ${isCorrect ? 'question-item__option--correct' : ''}">${option}</li>`;
    }).join('');
    
    item.innerHTML = `
        <div class="question-item__header">
            <div class="question-item__metadata">
                <span>Bloom: ${question.bloomLevel}</span>
                <span>Difficulty: ${question.difficulty}</span>
                <span>Type: ${question.type}</span>
            </div>
        </div>
        <div class="question-item__text">${question.text}</div>
        <ul class="question-item__options">
            ${options}
        </ul>
    `;
    
    return item;
}

// ===== STEP 5: EXPORT FUNCTIONS =====

async function exportQuestions() {
    const format = state.exportFormat;
    
    try {
        const response = await fetch(`/api/questions/export?format=${format}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                course: state.course,
                summary: state.summary,
                objectives: state.objectiveGroups, // Export the full objectiveGroups array
                questions: state.questions
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            downloadFile(blob, `questions-${state.course}-${format}.${getFileExtension(format)}`);
        } else {
            throw new Error('Export failed');
        }
    } catch (error) {
        console.error('Export failed:', error);
        if (DEV_MODE) {
            // Mock export for development
            const mockData = createMockExportData();
            const blob = new Blob([mockData], { type: getMimeType(format) });
            downloadFile(blob, `questions-${state.course}-${format}.${getFileExtension(format)}`);
        } else {
            alert('Export failed. Please try again.');
        }
    }
}

function createMockExportData() {
    const format = state.exportFormat;
    
    switch (format) {
        case 'csv':
            return createMockCSV();
        case 'json':
            return createMockJSON();
        case 'qti':
        default:
            return createMockQTI();
    }
}

function createMockCSV() {
    let csv = 'Question,Option A,Option B,Option C,Option D,Correct Answer,Bloom Level,Difficulty\n';
    state.questions.forEach(q => {
        csv += `"${q.text}","${q.options[0]}","${q.options[1]}","${q.options[2]}","${q.options[3]}","${q.options[q.correctAnswer]}","${q.bloomLevel}","${q.difficulty}"\n`;
    });
    return csv;
}

function createMockJSON() {
    return JSON.stringify({
        course: state.course,
        summary: state.summary,
        objectives: state.objectiveGroups, // Export the full objectiveGroups array
        questions: state.questions
    }, null, 2);
}

function createMockQTI() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="GRASP_QUESTIONS" title="${state.course} Questions">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>qmd_timelimit</fieldlabel>
        <fieldentry>PT30M</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
  </assessment>
</questestinterop>`;
}

function getFileExtension(format) {
    switch (format) {
        case 'csv': return 'csv';
        case 'json': return 'json';
        case 'qti': return 'xml';
        default: return 'txt';
    }
}

function getMimeType(format) {
    switch (format) {
        case 'csv': return 'text/csv';
        case 'json': return 'application/json';
        case 'qti': return 'application/xml';
        default: return 'text/plain';
    }
}

function downloadFile(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// ===== UTILITY FUNCTIONS =====

function announceToScreenReader(message) {
    const srAnnouncements = document.getElementById('sr-announcements');
    if (srAnnouncements) {
        srAnnouncements.textContent = message;
        // Clear after a short delay
        setTimeout(() => {
            srAnnouncements.textContent = '';
        }, 1000);
    }
}

// Export functions for global access
window.removeFile = removeFile;
window.removeUrl = removeUrl;
window.toggleObjectiveGroup = toggleObjectiveGroup;
window.toggleBloomChip = toggleBloomChip;
window.setBloomMode = setBloomMode;
window.updateObjectiveText = updateObjectiveText;
window.incrementCount = incrementCount;
window.decrementCount = decrementCount;
window.editObjective = editObjective;
window.confirmDeleteObjective = confirmDeleteObjective;
