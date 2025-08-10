// GRASP Question Generation JavaScript

// Store event listener function references for proper removal
let handleDragOver,
  handleDrop,
  handleDragEnter,
  handleDragLeave,
  triggerFileInput;

document.addEventListener("DOMContentLoaded", function () {
  // Initialize question generation functionality
  initializeQuestionGeneration();
});

function initializeQuestionGeneration() {
  // Initialize shared navigation
  new GRASPNavigation();

  // Initialize question generation specific functionality
  initializeQuestionGenerationContent();

  // Initialize interactive elements
  initializeInteractiveElements();

  // Initialize file upload functionality
  initializeFileUpload();
}

function initializeQuestionGenerationContent() {
  // Question generation specific initialization logic
  console.log("Initializing question generation content...");
}

function initializeInteractiveElements() {
  // Upload option cards
  const uploadOptions = document.querySelectorAll(".upload-option");
  uploadOptions.forEach((option) => {
    option.addEventListener("click", function () {
      handleUploadOptionClick(this);
    });
  });

  // Course selector
  const courseSelector = document.querySelector(".course-selector");
  if (courseSelector) {
    courseSelector.addEventListener("change", function () {
      const selectedCourse = this.value;
      handleCourseChange(selectedCourse);
    });
  }

  // Proceed button
  const proceedBtn = document.querySelector(".proceed-btn");
  if (proceedBtn) {
    proceedBtn.addEventListener("click", function () {
      handleProceedClick();
    });
  }

  // Choose file button
  const chooseFileBtn = document.querySelector(".choose-file-btn");
  if (chooseFileBtn) {
    chooseFileBtn.addEventListener("click", function () {
      triggerFileInput();
    });
  }
}

function handleUploadOptionClick(optionElement) {
  // Remove active class from all options
  const allOptions = document.querySelectorAll(".upload-option");
  allOptions.forEach((opt) => opt.classList.remove("active"));

  // Add active class to clicked option
  optionElement.classList.add("active");

  // Get the selected upload type
  const uploadType = optionElement.querySelector("span").textContent;
  console.log(`Selected upload type: ${uploadType}`);

  // Update the file upload area based on selection
  updateFileUploadArea(uploadType);

  // Show notification
  showNotification(`${uploadType} upload type selected`, "info");
}

function handleCourseChange(selectedCourse) {
  console.log(`Course changed to: ${selectedCourse}`);

  // You could update the upload options or other content based on course
  // For example, show different file types for different courses

  // Update any course-specific UI elements
  updateCourseSpecificContent(selectedCourse);
}

function handleProceedClick() {
  const selectedUploadType = document.querySelector(".upload-option.active");
  const selectedCourse =
    document.querySelector("#course-dropdown")?.value || "PSYC 101";
  const selectedQuestionType = document.querySelector(
    'input[name="question-type"]:checked'
  )?.value;
  const selectedQuizOutput = document.querySelector(
    'input[name="quiz-output"]:checked'
  )?.value;

  if (!selectedQuestionType) {
    showNotification("Please select a question type first", "warning");
    return;
  }

  if (!selectedQuizOutput) {
    showNotification("Please select a quiz output format first", "warning");
    return;
  }

  console.log(
    `Proceeding with ${selectedQuestionType} questions in ${selectedQuizOutput} format for ${selectedCourse}`
  );

  // Simulate processing
  showLoadingState();

  // You would typically send the data to your backend here
  setTimeout(() => {
    hideLoadingState();
    showNotification(
      `Question generation initiated for ${selectedCourse}!`,
      "success"
    );

    // Navigate to next step or show additional options
    showNextStep(selectedQuestionType, selectedCourse, selectedQuizOutput);
  }, 2000);
}

function updateFileUploadArea(uploadType) {
  const fileUploadArea = document.querySelector(".file-upload-area");
  const uploadContent = fileUploadArea.querySelector(".upload-content");

  // Update the upload area based on the selected type
  switch (uploadType.toLowerCase()) {
    case "text":
      uploadContent.innerHTML = `
        <i class="fas fa-file-alt"></i>
        <p>Paste text or upload text file</p>
        <button class="choose-file-btn">Choose File</button>
        <textarea placeholder="Or paste your text here..." class="text-input"></textarea>
      `;
      break;
    case "pdf":
      uploadContent.innerHTML = `
        <i class="fas fa-file-pdf"></i>
        <p>Upload PDF file</p>
        <button class="choose-file-btn">Choose PDF</button>
      `;
      break;
    case "url":
      uploadContent.innerHTML = `
        <i class="fas fa-link"></i>
        <p>Enter URL</p>
        <input type="url" placeholder="https://..." class="url-input">
        <button class="choose-file-btn">Submit URL</button>
      `;
      break;
    case "panopto":
      uploadContent.innerHTML = `
        <i class="fas fa-video"></i>
        <p>Enter Panopto URL</p>
        <input type="url" placeholder="https://panopto..." class="panopto-input">
        <button class="choose-file-btn">Submit Panopto URL</button>
      `;
      break;
    default:
      uploadContent.innerHTML = `
        <i class="fas fa-cloud-upload-alt"></i>
        <p>Drag and drop or choose file</p>
        <button class="choose-file-btn">Choose File</button>
      `;
  }

  // Re-initialize event listeners for new elements
  initializeNewElements();
}

function updateCourseSpecificContent(course) {
  // You could update content based on the selected course
  // For example, show different upload options or validation rules

  console.log(`Updating content for course: ${course}`);

  // Example: Update content based on psychology course
  if (course === "PSYC 101") {
    // PSYC 101 specific logic - Introduction to Psychology
    console.log(
      "PSYC 101 - Introduction to Psychology - Sensation and Perception Module"
    );

    // You could update the learning objectives or other content here
    // For now, we'll just log the action
  } else if (course === "PSYC 201") {
    // PSYC 201 specific logic - Research Methods
    console.log("PSYC 201 - Research Methods in Psychology");
  } else if (course === "PSYC 301") {
    // PSYC 301 specific logic - Cognitive Psychology
    console.log(
      "PSYC 301 - Cognitive Psychology - Advanced Perception Studies"
    );
  }
}

function showLoadingState() {
  const proceedBtn = document.querySelector(".proceed-btn");
  if (proceedBtn) {
    proceedBtn.textContent = "Processing...";
    proceedBtn.disabled = true;
    proceedBtn.style.opacity = "0.7";
  }
}

function hideLoadingState() {
  const proceedBtn = document.querySelector(".proceed-btn");
  if (proceedBtn) {
    proceedBtn.textContent = "Proceed";
    proceedBtn.disabled = false;
    proceedBtn.style.opacity = "1";
  }
}

function showNextStep(questionType, course, quizOutput) {
  // This would typically navigate to the next step in the question generation process
  console.log(
    `Showing next step for ${questionType} questions in ${quizOutput} format for ${course}`
  );

  // Show a success message with the selected options
  const message = `Successfully configured question generation for ${course}:
    • Question Type: ${questionType}
    • Output Format: ${quizOutput}
    • Learning Objectives: Sensation and Perception focused
    
    Redirecting to question preview...`;

  showNotification(message, "success");

  // You could show a modal, navigate to a new page, or update the current page
  // For now, we'll just log the action and show a notification
  setTimeout(() => {
    showNotification("Redirecting to question preview page...", "info");
  }, 2000);
}

function initializeFileUpload() {
  const fileUploadArea = document.querySelector(".file-upload-area");

  if (fileUploadArea) {
    // Drag and drop functionality
    handleDragOver = function (e) {
      e.preventDefault();
      this.classList.add("dragover");
    };
    fileUploadArea.addEventListener("dragover", handleDragOver);

    handleDrop = function (e) {
      e.preventDefault();
      this.classList.remove("dragover");

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFileDrop(files);
      }
    };
    fileUploadArea.addEventListener("drop", handleDrop);

    handleDragEnter = function (e) {
      e.preventDefault();
      this.classList.add("dragover");
    };
    fileUploadArea.addEventListener("dragenter", handleDragEnter);

    handleDragLeave = function (e) {
      e.preventDefault();
      this.classList.remove("dragover");
    };
    fileUploadArea.addEventListener("dragleave", handleDragLeave);

    // Click to upload
    triggerFileInput = function () {
      // Create a hidden file input
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "*/*";
      fileInput.style.display = "none";

      fileInput.addEventListener("change", function (e) {
        const files = e.target.files;
        if (files.length > 0) {
          handleFileDrop(files);
        }
      });

      document.body.appendChild(fileInput);
      fileInput.click();
      document.body.removeChild(fileInput);
    };
    fileUploadArea.addEventListener("click", triggerFileInput);
  }
}

function handleFileDrop(files) {
  console.log(`Files dropped: ${files.length}`);

  // Process the dropped files
  Array.from(files).forEach((file) => {
    console.log(`Processing file: ${file.name} (${file.type})`);

    // You would typically upload the file to your backend here
    // For now, we'll just show a success message

    showNotification(`File "${file.name}" uploaded successfully!`, "success");
  });

  // Update the upload area to show files
  updateUploadAreaWithFiles(files);
}

function updateUploadAreaWithFiles(files) {
  const fileUploadArea = document.querySelector(".file-upload-area");
  const uploadContent = fileUploadArea.querySelector(".upload-content");

  fileUploadArea.classList.add("has-files");

  // Remove file upload event listeners immediately to prevent interference
  removeFileUploadEventListeners();

  // Add styles for the file upload success display
  addFileUploadSuccessStyles();

  // Show file upload success without proceed button
  uploadContent.innerHTML = `
    <div class="file-upload-success">
      <i class="fas fa-check-circle success-icon"></i>
      <h3>File Uploaded Successfully!</h3>
      <div class="file-info">
        <i class="fas fa-file"></i>
        <span>${files[0].name}</span>
        <small>${(files[0].size / 1024 / 1024).toFixed(2)} MB</small>
      </div>
    </div>
  `;

  // Enable the external proceed button and add event listener
  const externalProceedBtn = document.querySelector(".proceed-btn");
  if (externalProceedBtn) {
    console.log("Enabling proceed button...");
    externalProceedBtn.disabled = false;
    externalProceedBtn.style.opacity = "1";
    externalProceedBtn.style.cursor = "pointer";

    // Remove any existing event listeners and add new one
    externalProceedBtn.replaceWith(externalProceedBtn.cloneNode(true));
    const newProceedBtn = document.querySelector(".proceed-btn");
    newProceedBtn.addEventListener("click", function () {
      console.log("Proceed button clicked!");
      showQuestionConfigurationScreen(files);
    });
    console.log("Proceed button enabled and event listener added");
  }
}

function addFileUploadSuccessStyles() {
  // Check if styles already exist
  if (document.querySelector("#file-upload-success-styles")) {
    return;
  }

  const styles = document.createElement("style");
  styles.id = "file-upload-success-styles";
  styles.textContent = `
    .file-upload-success {
      text-align: center;
      margin: 20px 0;
      padding: 30px;
      background: linear-gradient(135deg, #e8f5e8 0%, #d4edda 100%);
      border-radius: 12px;
      border: 1px solid #c3e6cb;
      box-shadow: 0 4px 15px rgba(40, 167, 69, 0.2);
    }

    .success-icon {
      font-size: 48px;
      color: #28a745;
      margin-bottom: 15px;
    }

    .file-upload-success h3 {
      color: #155724;
      margin: 0 0 20px 0;
      font-size: 24px;
      font-weight: 600;
    }

    .file-info {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #155724;
      font-size: 16px;
      background: rgba(255, 255, 255, 0.7);
      padding: 15px;
      border-radius: 8px;
      border: 1px solid rgba(195, 230, 203, 0.5);
    }

    .file-info i {
      font-size: 20px;
      color: #28a745;
    }

    .file-info span {
      font-weight: 500;
    }

    .file-info small {
      color: #6c757d;
      font-size: 14px;
    }
  `;

  document.head.appendChild(styles);
}

function showQuestionConfigurationScreen(files) {
  const fileUploadArea = document.querySelector(".file-upload-area");
  const proceedSection = document.querySelector(".proceed-section");

  // Hide the proceed button since we're moving to the next screen
  if (proceedSection) {
    proceedSection.style.display = "none";
  }

  // Replace the file upload area with the question configuration interface
  fileUploadArea.innerHTML = `
    <div class="question-config-interface">
      <div class="config-header">
        <h2>Configure Question Generation</h2>
        <div class="file-summary">
          <i class="fas fa-file"></i>
          <span>${files[0].name}</span>
          <small>${(files[0].size / 1024 / 1024).toFixed(2)} MB</small>
        </div>
      </div>
      
      <div class="config-sections">
        <div class="config-section question-types-section">
          <h4>Question Types</h4>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="question-type" value="multiple-choice">
              <span class="radio-custom"></span>
              Multiple Choice
            </label>
            <label class="radio-option">
              <input type="radio" name="question-type" value="fill-blank">
              <span class="radio-custom"></span>
              Fill in the Blank
            </label>
            <label class="radio-option">
              <input type="radio" name="question-type" value="calculation">
              <span class="radio-custom"></span>
              Calculation
            </label>
            <label class="radio-option">
              <input type="radio" name="question-type" value="essay">
              <span class="radio-custom"></span>
              Essay (open-ended)
            </label>
          </div>
        </div>
        
        <div class="config-section quiz-outputs-section">
          <h4>Quiz Outputs</h4>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="quiz-output" value="canvas-single">
              <span class="radio-custom"></span>
              Canvas (Single Quiz)
            </label>
            <label class="radio-option">
              <input type="radio" name="quiz-output" value="canvas-scheduled">
              <span class="radio-custom"></span>
              Canvas (with scheduled review)
            </label>
            <label class="radio-option">
              <input type="radio" name="quiz-output" value="h5p">
              <span class="radio-custom"></span>
              H5P (Single Elements)
            </label>
          </div>
        </div>
      </div>
      
      <div class="learning-objectives-section">
        <h4>Learning Objectives</h4>
        <button class="generate-los-btn">Generated LOs from source</button>
        <div class="learning-objectives-content">
          <div class="lo-item">
            <strong>LO 1:</strong> Explain the basic principles of sensation and perception, including the role of sensory receptors and neural pathways in processing environmental stimuli.
          </div>
          <div class="lo-item">
            <strong>LO 2:</strong> Analyze how attention and expectation influence perceptual experiences, demonstrating understanding of top-down vs. bottom-up processing.
          </div>
          <div class="lo-item">
            <strong>LO 3:</strong> Compare and contrast the major theories of visual perception, including Gestalt principles, feature detection, and constructivist approaches.
          </div>
          <div class="lo-item">
            <strong>LO 4:</strong> Evaluate the role of experience and learning in shaping perceptual abilities, with specific reference to perceptual learning and adaptation.
          </div>
          <div class="lo-item">
            <strong>LO 5:</strong> Apply knowledge of sensation and perception to real-world scenarios, such as eyewitness testimony, advertising, and human-computer interaction.
          </div>
        </div>
      </div>
      
      <div class="action-buttons">
        <button class="proceed-to-los-btn">Proceed</button>
      </div>
    </div>
  `;

  // Add styles for the question configuration interface
  addQuestionConfigStyles();

  // Initialize event listeners for the question configuration interface
  initializeQuestionConfigElements();
}

function removeFileUploadEventListeners() {
  const fileUploadArea = document.querySelector(".file-upload-area");

  if (
    fileUploadArea &&
    handleDragOver &&
    handleDrop &&
    handleDragEnter &&
    handleDragLeave &&
    triggerFileInput
  ) {
    console.log("Removing file upload event listeners...");

    // Remove drag and drop event listeners using stored function references
    fileUploadArea.removeEventListener("dragover", handleDragOver);
    fileUploadArea.removeEventListener("drop", handleDrop);
    fileUploadArea.removeEventListener("dragenter", handleDragEnter);
    fileUploadArea.removeEventListener("dragleave", handleDragLeave);

    // Remove click event listener for file input
    fileUploadArea.removeEventListener("click", triggerFileInput);

    // Remove the file input element if it exists
    const existingFileInput =
      fileUploadArea.querySelector('input[type="file"]');
    if (existingFileInput) {
      existingFileInput.remove();
    }

    console.log("File upload event listeners removed successfully");
  } else {
    console.log(
      "Some event listener functions are not defined, cannot remove listeners"
    );
  }
}

function showNotification(message, type = "info") {
  // Simple notification system - you could enhance this with a proper notification library
  console.log(`${type.toUpperCase()}: ${message}`);

  // Create a simple notification element
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Style the notification
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;

  // Set background color based on type
  switch (type) {
    case "success":
      notification.style.background = "#28a745";
      break;
    case "warning":
      notification.style.background = "#ffc107";
      notification.style.color = "#212529";
      break;
    case "error":
      notification.style.background = "#dc3545";
      break;
    default:
      notification.style.background = "#17a2b8";
  }

  document.body.appendChild(notification);

  // Remove notification after 3 seconds
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Add CSS animations for notifications
const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

function toggleLOSection(element) {
  const loSection = element.closest(".lo-section");
  if (loSection) {
    const loContent = loSection.querySelector(".lo-content");
    const toggleIcon = element.querySelector(".toggle-icon");

    if (loContent) {
      loContent.style.display =
        loContent.style.display === "none" ? "block" : "none";
      toggleIcon.textContent = toggleIcon.textContent === "+" ? "-" : "+";
    }
  }
}

function addLearningObjectivesStyles() {
  // Check if styles already exist
  if (document.querySelector("#learning-objectives-styles")) {
    return;
  }

  const styles = document.createElement("style");
  styles.id = "learning-objectives-styles";
  styles.textContent = `
    .learning-objectives-screen {
      padding: 20px;
      background-color: #f8f9fa;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .lo-header {
      text-align: center;
      margin-bottom: 30px;
    }

    .lo-header h2 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 28px;
    }

    .lo-header p {
      color: #7f8c8d;
      font-size: 16px;
    }

    .lo-container {
      margin-bottom: 30px;
    }

    .lo-section {
      background: white;
      border-radius: 8px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .lo-title {
      padding: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ecf0f1;
      transition: background-color 0.2s ease;
      flex-wrap: wrap;
      gap: 10px;
    }

    .lo-title:hover {
      background: #d5dbdb;
    }

    .lo-number {
      font-weight: 600;
      color: #2c3e50;
      font-size: 16px;
      min-width: 150px;
    }

    .lo-text {
      flex: 1;
      color: #34495e;
      font-size: 14px;
      line-height: 1.4;
    }

    .bloom-levels {
      background: #3498db;
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    .toggle-icon {
      color: #7f8c8d;
      font-size: 18px;
      transition: transform 0.2s ease;
    }

    .lo-content {
      padding: 20px;
      border-top: 1px solid #ecf0f1;
    }

    .question-section {
      margin-bottom: 25px;
    }

    .question-section h4 {
      color: #2c3e50;
      margin-bottom: 15px;
      font-size: 16px;
      font-weight: 600;
    }

    .question-item {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #3498db;
    }

    .question-text {
      margin-bottom: 15px;
      font-size: 15px;
      line-height: 1.5;
      color: #2c3e50;
    }

    .question-options {
      margin-bottom: 15px;
    }

    .option {
      padding: 8px 12px;
      margin-bottom: 8px;
      background: white;
      border-radius: 6px;
      border: 1px solid #e9ecef;
      font-size: 14px;
      color: #495057;
    }

    .option.correct {
      background: #d4edda;
      border-color: #c3e6cb;
      color: #155724;
    }

    .question-answer {
      margin-bottom: 15px;
      padding: 10px;
      background: #e8f5e8;
      border-radius: 6px;
      color: #155724;
      font-size: 14px;
    }

    .edit-question-btn {
      background: #6c757d;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.2s ease;
    }

    .edit-question-btn:hover {
      background: #5a6268;
    }

    .add-questions-section {
      text-align: right;
    }

    .add-questions-btn {
      background: #007bff;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      transition: background-color 0.2s ease;
    }

    .add-questions-btn:hover {
      background: #0056b3;
    }

    .add-questions-btn i {
      margin-left: 8px;
    }

    /* Collapsed state */
    .lo-section.collapsed .lo-content {
      display: none;
    }

    .lo-section.collapsed .toggle-icon {
      transform: rotate(0deg);
    }

    .lo-section.expanded .toggle-icon {
      transform: rotate(180deg);
    }
  `;

  document.head.appendChild(styles);
}

function initializeLearningObjectivesElements() {
  // Event listeners for the learning objectives interface
  const editQuestionBtns = document.querySelectorAll(".edit-question-btn");
  editQuestionBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      console.log("Edit question button clicked");
      showNotification("Opening question editor...", "info");
      // This would typically open a question editor modal or form
    });
  });

  const addQuestionsBtn = document.querySelector(".add-questions-btn");
  if (addQuestionsBtn) {
    addQuestionsBtn.addEventListener("click", function () {
      console.log("Add questions button clicked");
      showNotification("Opening question creation form...", "info");
      // This would typically open a form to create new questions
    });
  }

  // Make toggleLOSection function globally available
  window.toggleLOSection = toggleLOSection;
}

function addQuestionConfigStyles() {
  // Check if styles already exist
  if (document.querySelector("#question-config-styles")) {
    return;
  }

  const styles = document.createElement("style");
  styles.id = "question-config-styles";
  styles.textContent = `
    .question-config-interface {
      padding: 20px;
      background-color: #f8f9fa;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .config-header {
      text-align: center;
      margin-bottom: 30px;
    }

    .config-header h2 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 28px;
    }

    .config-header p {
      color: #7f8c8d;
      font-size: 16px;
    }

    .file-summary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-top: 15px;
      color: #555;
      font-size: 14px;
    }

    .file-summary i {
      color: #3498db;
    }

    .config-sections {
      margin-bottom: 30px;
    }

    .config-section h4 {
      color: #2c3e50;
      margin-bottom: 15px;
      font-size: 18px;
      font-weight: 600;
    }

    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .radio-option {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 10px 15px;
      border-radius: 8px;
      background: #ecf0f1;
      transition: background-color 0.2s ease;
    }

    .radio-option:hover {
      background: #d5dbdb;
    }

    .radio-option input[type="radio"] {
      display: none; /* Hide the default radio button */
    }

    .radio-custom {
      width: 20px;
      height: 20px;
      border: 2px solid #3498db;
      border-radius: 50%;
      margin-right: 10px;
      position: relative;
      flex-shrink: 0;
    }

    .radio-option input[type="radio"]:checked + .radio-custom {
      background: #3498db;
      border-color: #3498db;
    }

    .radio-option input[type="radio"]:checked + .radio-custom::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: white;
    }

    .learning-objectives-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ecf0f1;
    }

    .learning-objectives-section h4 {
      color: #2c3e50;
      margin-bottom: 15px;
      font-size: 18px;
      font-weight: 600;
    }

    .generate-los-btn {
      background: #007bff;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      transition: background-color 0.2s ease;
    }

    .generate-los-btn:hover {
      background: #0056b3;
    }

    .learning-objectives-content {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 15px;
      border: 1px solid #e9ecef;
    }

    .lo-item {
      margin-bottom: 10px;
      padding: 10px 15px;
      background: #ecf0f1;
      border-radius: 6px;
      border-left: 4px solid #3498db;
      color: #34495e;
      font-size: 15px;
      line-height: 1.4;
    }

    .lo-item strong {
      color: #2c3e50;
      font-weight: 600;
    }

    .action-buttons {
      text-align: right;
      margin-top: 30px;
    }

    .proceed-to-los-btn {
      background: #28a745;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      transition: background-color 0.2s ease;
    }

    .proceed-to-los-btn:hover {
      background: #218838;
    }
  `;

  document.head.appendChild(styles);
}

function initializeQuestionConfigElements() {
  // Event listeners for the question configuration interface
  const questionTypeRadios = document.querySelectorAll(
    'input[name="question-type"]'
  );
  questionTypeRadios.forEach((radio) => {
    radio.addEventListener("change", function () {
      console.log(`Question type selected: ${this.value}`);
      // You could update the UI or trigger a re-generation of questions here
    });
  });

  const quizOutputRadios = document.querySelectorAll(
    'input[name="quiz-output"]'
  );
  quizOutputRadios.forEach((radio) => {
    radio.addEventListener("change", function () {
      console.log(`Quiz output format selected: ${this.value}`);
      // You could update the UI or trigger a re-generation of questions here
    });
  });

  const generateLosBtn = document.querySelector(".generate-los-btn");
  if (generateLosBtn) {
    generateLosBtn.addEventListener("click", function () {
      console.log("Generate LOs button clicked");
      // This would typically trigger a process to generate learning objectives
      // from the uploaded file or text.
      showNotification("Generating learning objectives...", "info");
      setTimeout(() => {
        showNotification("Learning objectives generated!", "success");
      }, 2000);
    });
  }

  // Make toggleLOSection function globally available
  window.toggleLOSection = toggleLOSection;

  // Add event listener for the proceed button in question configuration
  const proceedToLosBtn = document.querySelector(".proceed-to-los-btn");
  if (proceedToLosBtn) {
    proceedToLosBtn.addEventListener("click", function () {
      console.log("Proceed to Learning Objectives button clicked");

      // Add slide transition effect
      const fileUploadArea = document.querySelector(".file-upload-area");
      fileUploadArea.style.transition = "all 0.5s ease-in-out";
      fileUploadArea.style.transform = "translateX(-100%)";
      fileUploadArea.style.opacity = "0";

      // After the slide-out animation, replace content and slide back in
      setTimeout(() => {
        // Replace the question config interface with the learning objectives screen
        fileUploadArea.innerHTML = `
          <div class="learning-objectives-screen">
            <div class="lo-header">
              <h2>Learning Objectives</h2>
              <p>Review and configure questions for each learning objective</p>
            </div>
            
            <div class="lo-container">
              <!-- Learning Objective 1.1 (Expanded) -->
              <div class="lo-section expanded">
                <div class="lo-title" onclick="toggleLOSection(this)">
                  <span class="lo-number">Learning Objective 1.1</span>
                  <span class="lo-text">Recognize that enthalpy (ΔH) alone does not determine whether a process is spontaneous</span>
                  <span class="bloom-levels">Remember, Understand</span>
                  <i class="fas fa-minus toggle-icon"></i>
                </div>
                <div class="lo-content">
                  <div class="question-section">
                    <h4>Remember</h4>
                    <div class="question-item">
                      <div class="question-text">
                        <strong>Q:</strong> What does the symbol ΔH represent in thermodynamics?
                      </div>
                      <div class="question-options">
                        <div class="option">A. Entropy</div>
                        <div class="option correct">B. Enthalpy</div>
                        <div class="option">C. Internal energy</div>
                        <div class="option">D. Temperature</div>
                      </div>
                      <div class="question-answer">
                        <strong>Answer:</strong> B. Enthalpy
                      </div>
                      <button class="edit-question-btn">
                        Edit Question <i class="fas fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                  
                  <div class="question-section">
                    <h4>Understand</h4>
                    <div class="question-item">
                      <div class="question-text">
                        <strong>Q:</strong> Why is ΔH alone insufficient to determine whether a process is spontaneous?
                      </div>
                      <div class="question-options">
                        <div class="option">A. Because it only considers pressure-volume work</div>
                        <div class="option correct">B. Because it ignores entropy and temperature effects</div>
                        <div class="option">C. Because it measures only disorder</div>
                        <div class="option">D. Because it is a state function</div>
                      </div>
                      <div class="question-answer">
                        <strong>Answer:</strong> B. Because it ignores entropy and temperature effects
                      </div>
                      <button class="edit-question-btn">
                        Edit Question <i class="fas fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Learning Objective 1.2 (Collapsed) -->
              <div class="lo-section collapsed">
                <div class="lo-title" onclick="toggleLOSection(this)">
                  <span class="lo-number">Learning Objective 1.2</span>
                  <span class="lo-text">Recognize that internal energy (ΔE) alone is insufficient to determine spontaneity</span>
                  <span class="bloom-levels">Remember, Understand</span>
                  <i class="fas fa-plus toggle-icon"></i>
                </div>
                <div class="lo-content" style="display: none;">
                  <!-- Content will be populated when expanded -->
                </div>
              </div>
              
              <!-- Learning Objective 2.1 (Collapsed) -->
              <div class="lo-section collapsed">
                <div class="lo-title" onclick="toggleLOSection(this)">
                  <span class="lo-number">Learning Objective 2.1</span>
                  <span class="lo-text">Define a macrostate and a microstate, and describe how they differ</span>
                  <span class="bloom-levels">Remember, Understand</span>
                  <i class="fas fa-plus toggle-icon"></i>
                </div>
                <div class="lo-content" style="display: none;">
                  <!-- Content will be populated when expanded -->
                </div>
              </div>
              
              <!-- Learning Objective 2.2 (Collapsed) -->
              <div class="lo-section collapsed">
                <div class="lo-title" onclick="toggleLOSection(this)">
                  <span class="lo-number">Learning Objective 2.2</span>
                  <span class="lo-text">Define entropy based on the statistical mechanical view (S = k In W)</span>
                  <span class="bloom-levels">Remember, Understand</span>
                  <i class="fas fa-plus toggle-icon"></i>
                </div>
                <div class="lo-content" style="display: none;">
                  <!-- Content will be populated when expanded -->
                </div>
              </div>
              
              <!-- Learning Objective 3.1 (Collapsed) -->
              <div class="lo-section collapsed">
                <div class="lo-title" onclick="toggleLOSection(this)">
                  <span class="lo-number">Learning Objective 3.1</span>
                  <span class="lo-text">Define a reversible process and describe its characteristics</span>
                  <span class="bloom-levels">Remember, Understand</span>
                  <i class="fas fa-plus toggle-icon"></i>
                </div>
                <div class="lo-content" style="display: none;">
                  <!-- Content will be populated when expanded -->
                </div>
              </div>
            </div>
            
            <div class="add-questions-section">
              <button class="add-questions-btn">
                Add Questions <i class="fas fa-caret-down"></i>
              </button>
            </div>
          </div>
        `;

        // Add styles for the new learning objectives screen
        addLearningObjectivesStyles();

        // Initialize event listeners for the new interface
        initializeLearningObjectivesElements();

        // Slide the new content back in
        setTimeout(() => {
          fileUploadArea.style.transform = "translateX(0)";
          fileUploadArea.style.opacity = "1";
        }, 50);
      }, 500);
    });
  }
}

// Export functions for potential external use
window.GRASPQuestionGeneration = {
  handleUploadOptionClick,
  handleCourseChange,
  handleProceedClick,
  updateFileUploadArea,
  showNotification,
};
