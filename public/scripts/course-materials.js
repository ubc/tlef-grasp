// Course Materials Page JavaScript

let materials = [];
let filteredMaterials = [];

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize course materials
  initializeCourseMaterials();
});

function initializeCourseMaterials() {
  console.log("Initializing Course Materials page...");
  console.log("Course materials script is running!");

  // Set page title
  document.title = "Course Materials - GRASP";

  // Load course data first
  loadCourseData();

  // Initialize filters
  initializeFilters();

  // Initialize search
  initializeSearch();
}

async function loadCourseData() {
  try {
    console.log("Loading course data...");
    const response = await fetch("/api/courses");
    console.log("Response status:", response.status);
    const data = await response.json();
    console.log("Course data received:", data);

    if (data.success && data.courses) {
      console.log("Courses found:", data.courses.length);
      // Update course filter dropdown
      updateCourseFilter(data.courses);
    } else {
      console.log("No courses found or invalid response");
    }

    // Load materials (initially empty)
    loadMaterials();
  } catch (error) {
    console.error("Error loading course data:", error);
    showNotification("Error loading course data", "error");
  }
}

function updateCourseFilter(courses) {
  console.log("updateCourseFilter called with courses:", courses);
  const courseFilter = document.getElementById("courseFilter");
  console.log("Course filter element:", courseFilter);

  if (!courseFilter) {
    console.error("Course filter element not found!");
    return;
  }

  // Clear existing options except "All Courses"
  courseFilter.innerHTML = '<option value="all">All Courses</option>';

  // Add course options
  courses.forEach((course) => {
    console.log("Adding course option:", course.code, course.name);
    const option = document.createElement("option");
    option.value = course.code;
    option.textContent = `${course.code} - ${course.name}`;
    courseFilter.appendChild(option);
  });

  console.log("Course filter updated with", courses.length, "courses");
}

function loadMaterials() {
  const materialsGrid = document.getElementById("materialsGrid");
  const noResults = document.getElementById("noResults");

  if (filteredMaterials.length === 0) {
    materialsGrid.style.display = "none";
    noResults.style.display = "flex";
    return;
  }

  materialsGrid.style.display = "grid";
  noResults.style.display = "none";

  materialsGrid.innerHTML = "";

  filteredMaterials.forEach((material) => {
    const materialCard = createMaterialCard(material);
    materialsGrid.appendChild(materialCard);
  });
}

function createMaterialCard(material) {
  const card = document.createElement("div");
  card.className = "material-card";

  const typeIcon = getTypeIcon(material.type);
  const typeLabel = getTypeLabel(material.type);

  card.innerHTML = `
        <div class="material-header">
            <div class="material-icon ${material.type}">
                <i class="${typeIcon}"></i>
            </div>
            <div class="material-info">
                <h3 class="material-title">${material.title}</h3>
                <p class="material-type">${typeLabel}</p>
                <p class="material-meta">Week ${material.week} • ${
    material.lecture
  }</p>
            </div>
        </div>
        
        <div class="material-description">
            ${material.description}
        </div>
        
        <div class="material-objectives">
            ${material.objectives
              .map(
                (obj) =>
                  `<span class="objective-tag" data-objective="${obj}">${obj}</span>`
              )
              .join("")}
        </div>
        
        <div class="material-footer">
            <span class="related-questions">${
              material.relatedQuestions
            } related questions</span>
            <button class="view-button" onclick="viewMaterial('${
              material.id
            }')">
                View
            </button>
        </div>
    `;

  // Add click handler for objective tags
  const objectiveTags = card.querySelectorAll(".objective-tag");
  objectiveTags.forEach((tag) => {
    tag.addEventListener("click", function (e) {
      e.stopPropagation();
      filterByObjective(tag.dataset.objective);
    });
  });

  // Add click handler for card
  card.addEventListener("click", function () {
    viewMaterial(material.id);
  });

  return card;
}

function getTypeIcon(type) {
  const icons = {
    pdf: "fas fa-file-pdf",
    video: "fas fa-play",
    textbook: "fas fa-book",
    link: "fas fa-external-link-alt",
  };
  return icons[type] || "fas fa-file";
}

function getTypeLabel(type) {
  const labels = {
    pdf: "PDF",
    video: "Video",
    textbook: "Textbook",
    link: "Link",
  };
  return labels[type] || "File";
}

function initializeFilters() {
  const courseFilter = document.getElementById("courseFilter");
  const weekFilter = document.getElementById("weekFilter");
  const objectiveFilter = document.getElementById("objectiveFilter");
  const typeFilter = document.getElementById("typeFilter");

  courseFilter.addEventListener("change", applyFilters);
  weekFilter.addEventListener("change", applyFilters);
  objectiveFilter.addEventListener("change", applyFilters);
  typeFilter.addEventListener("change", applyFilters);
}

function initializeSearch() {
  const searchInput = document.getElementById("searchInput");

  searchInput.addEventListener("input", function () {
    applyFilters();
  });
}

function applyFilters() {
  const courseFilter = document.getElementById("courseFilter").value;
  const weekFilter = document.getElementById("weekFilter").value;
  const objectiveFilter = document.getElementById("objectiveFilter").value;
  const typeFilter = document.getElementById("typeFilter").value;
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();

  filteredMaterials = materials.filter((material) => {
    // Course filter
    if (courseFilter !== "all" && material.course !== courseFilter) {
      return false;
    }

    // Week filter
    if (weekFilter !== "all" && material.week.toString() !== weekFilter) {
      return false;
    }

    // Objective filter
    if (
      objectiveFilter !== "all" &&
      !material.objectives.includes(objectiveFilter)
    ) {
      return false;
    }

    // Type filter
    if (typeFilter !== "all" && material.type !== typeFilter) {
      return false;
    }

    // Search filter
    if (
      searchTerm &&
      !material.title.toLowerCase().includes(searchTerm) &&
      !material.description.toLowerCase().includes(searchTerm)
    ) {
      return false;
    }

    return true;
  });

  loadMaterials();
}

function filterByObjective(objective) {
  const objectiveFilter = document.getElementById("objectiveFilter");
  objectiveFilter.value = objective;
  applyFilters();
}

function viewMaterial(materialId) {
  const material = materials.find((m) => m.id === materialId);
  if (material) {
    console.log(`Viewing material: ${material.title}`);

    // In a real application, this would open the material
    // For now, we'll show an alert
    alert(
      `Opening: ${
        material.title
      }\n\nThis would normally open the ${material.type.toUpperCase()} material.`
    );

    // You could also redirect to a material viewer page:
    // window.location.href = `material-viewer.html?id=${materialId}`;
  }
}

function clearFilters() {
  document.getElementById("courseFilter").value = "all";
  document.getElementById("weekFilter").value = "all";
  document.getElementById("objectiveFilter").value = "all";
  document.getElementById("typeFilter").value = "all";
  document.getElementById("searchInput").value = "";

  filteredMaterials = [...materials];
  loadMaterials();
}

function showNotification(message, type = "info") {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Style the notification
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 4px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    opacity: 0;
    transform: translateX(100%);
    transition: all 0.3s ease;
  `;

  // Set background color based on type
  if (type === "error") {
    notification.style.backgroundColor = "#e74c3c";
  } else if (type === "success") {
    notification.style.backgroundColor = "#27ae60";
  } else {
    notification.style.backgroundColor = "#3498db";
  }

  // Add to page
  document.body.appendChild(notification);

  // Animate in
  setTimeout(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateX(0)";
  }, 100);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateX(100%)";
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// Function to add materials (called when files are uploaded)
function addMaterial(material) {
  materials.push(material);
  filteredMaterials = [...materials];
  loadMaterials();
}

// Export functions for potential use by other scripts
window.CourseMaterials = {
  viewMaterial,
  filterByObjective,
  clearFilters,
  applyFilters,
  addMaterial,
};
