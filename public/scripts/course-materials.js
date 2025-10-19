// Course Materials Page JavaScript

// Mock course materials data
const mockMaterials = [
  {
    id: 1,
    title: "Photosynthesis Overview (Slides)",
    type: "pdf",
    course: "BIOL101",
    week: 1,
    lecture: "L1",
    description:
      "High-level summary of light-dependent reactions and Calvin cycle.",
    objectives: ["LO 2.1", "LO 2.2"],
    relatedQuestions: 12,
    url: "#",
  },
  {
    id: 2,
    title: "Forces & Motion Intro",
    type: "video",
    course: "PHYS101",
    week: 2,
    lecture: "L1",
    description: "Intro lecture recording: net force, acceleration, vectors.",
    objectives: ["LO 1.1"],
    relatedQuestions: 8,
    url: "#",
  },
  {
    id: 3,
    title: "Cell Division Reading",
    type: "textbook",
    course: "BIOL101",
    week: 3,
    lecture: "L2",
    description: "Chapter on mitosis vs meiosis with diagrams.",
    objectives: ["LO 3.2"],
    relatedQuestions: 15,
    url: "#",
  },
  {
    id: 4,
    title: "Velocity-Time Graphs",
    type: "link",
    course: "PHYS101",
    week: 2,
    lecture: "L2",
    description:
      "External resource explaining V-T graphs and area under curve.",
    objectives: ["LO 1.2", "LO 1.3"],
    relatedQuestions: 6,
    url: "#",
  },
  {
    id: 5,
    title: "Binary Search Algorithm",
    type: "pdf",
    course: "CS101",
    week: 1,
    lecture: "L3",
    description:
      "Detailed explanation of binary search with examples and complexity analysis.",
    objectives: ["LO 1.1", "LO 1.2"],
    relatedQuestions: 10,
    url: "#",
  },
  {
    id: 6,
    title: "Data Structures Overview",
    type: "video",
    course: "CS101",
    week: 2,
    lecture: "L1",
    description: "Introduction to arrays, linked lists, stacks, and queues.",
    objectives: ["LO 2.1", "LO 2.2"],
    relatedQuestions: 14,
    url: "#",
  },
];

let filteredMaterials = [...mockMaterials];

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize course materials
  initializeCourseMaterials();
});

function initializeCourseMaterials() {
  console.log("Initializing Course Materials page...");

  // Set page title
  document.title = "Course Materials - GRASP";

  // Load materials
  loadMaterials();

  // Initialize filters
  initializeFilters();

  // Initialize search
  initializeSearch();
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
            <button class="view-button" onclick="viewMaterial(${material.id})">
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

  filteredMaterials = mockMaterials.filter((material) => {
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
  const material = mockMaterials.find((m) => m.id === materialId);
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

  filteredMaterials = [...mockMaterials];
  loadMaterials();
}

// Export functions for potential use by other scripts
window.CourseMaterials = {
  viewMaterial,
  filterByObjective,
  clearFilters,
  applyFilters,
};
