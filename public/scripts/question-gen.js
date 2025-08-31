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
    exportFormat: 'qti'
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
            return state.objectives.length > 0;
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

function initializeObjectives() {
    const addObjectiveBtn = document.getElementById('add-objective-btn');
    if (addObjectiveBtn) {
        addObjectiveBtn.addEventListener('click', addObjective);
    }
}

function addObjective() {
    const objective = {
        id: Date.now() + Math.random(),
        text: '',
        bloomLevel: 'Remember'
    };
    
    state.objectives.push(objective);
    renderObjectives();
}

function removeObjective(objectiveId) {
    const index = state.objectives.findIndex(o => o.id === objectiveId);
    if (index > -1) {
        state.objectives.splice(index, 1);
        renderObjectives();
    }
}

function updateObjective(objectiveId, field, value) {
    const objective = state.objectives.find(o => o.id === objectiveId);
    if (objective) {
        objective[field] = value;
    }
}

function renderObjectives() {
    const objectivesList = document.getElementById('objectives-list');
    if (!objectivesList) return;
    
    objectivesList.innerHTML = '';
    
    state.objectives.forEach(objective => {
        const objectiveItem = createObjectiveItem(objective);
        objectivesList.appendChild(objectiveItem);
    });
}

function createObjectiveItem(objective) {
    const item = document.createElement('div');
    item.className = 'objective-item';
    
    item.innerHTML = `
        <div class="objective-item__content">
            <textarea 
                class="objective-item__text" 
                placeholder="Enter learning objective..."
                onchange="updateObjective(${objective.id}, 'text', this.value)"
            >${objective.text}</textarea>
        </div>
        <div class="objective-item__controls">
            <select 
                class="objective-item__bloom"
                onchange="updateObjective(${objective.id}, 'bloomLevel', this.value)"
            >
                ${bloomLevels.map(level => 
                    `<option value="${level}" ${objective.bloomLevel === level ? 'selected' : ''}>${level}</option>`
                ).join('')}
            </select>
            <button type="button" class="objective-item__remove" onclick="removeObjective(${objective.id})">
                <i class="fas fa-trash"></i> Remove
            </button>
        </div>
    `;
    
    return item;
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
    state.objectives.forEach(obj => {
        content += `- ${obj.text} (${obj.bloomLevel})\n`;
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
    const item = document.createElement('div');
    item.className = 'question-item';
    
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
                objectives: state.objectives,
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
        objectives: state.objectives,
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
window.updateObjective = updateObjective;
window.removeObjective = removeObjective;
