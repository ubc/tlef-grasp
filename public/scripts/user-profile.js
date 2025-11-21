// User Profile Page JavaScript
// Handles user profile functionality

document.addEventListener("DOMContentLoaded", function () {
  // Initialize navigation
  new window.GRASPNavigation();

  // Initialize profile page
  initializeProfilePage();
});

function initializeProfilePage() {
  // Load user data from localStorage/sessionStorage
  loadUserProfile();

  // Load account statistics
  loadAccountStatistics();

  // Initialize form handlers
  initializeFormHandlers();
}

function loadUserProfile() {
  try {
    // Try to get profile from localStorage first, then sessionStorage
    const courseProfile = localStorage.getItem("courseProfile") || sessionStorage.getItem("courseProfile");
    
    if (courseProfile) {
      const profile = JSON.parse(courseProfile);
      
      // Update profile display
      const profileName = document.getElementById("profile-name");
      const profileEmail = document.getElementById("profile-email");
      const profileRole = document.getElementById("profile-role");
      
      if (profileName && profile.instructorName) {
        profileName.textContent = profile.instructorName;
      }
      
      if (profileEmail) {
        profileEmail.textContent = profile.email || "instructor@ubc.ca";
      }
      
      if (profileRole) {
        profileRole.textContent = "Instructor";
      }
      
      // Populate form fields
      const firstName = document.getElementById("first-name");
      const lastName = document.getElementById("last-name");
      const email = document.getElementById("email");
      const department = document.getElementById("department");
      
      if (profile.instructorName) {
        const nameParts = profile.instructorName.split(" ");
        if (firstName && nameParts.length > 0) {
          firstName.value = nameParts[0];
        }
        if (lastName && nameParts.length > 1) {
          lastName.value = nameParts.slice(1).join(" ");
        }
      }
      
      if (email) {
        email.value = profile.email || "";
      }
      
      if (department) {
        department.value = profile.department || "";
      }
    }
  } catch (error) {
    console.error("Error loading user profile:", error);
  }
}

async function loadAccountStatistics() {
  try {
    // Load courses count
    const coursesResponse = await fetch("/api/courses");
    if (coursesResponse.ok) {
      const coursesData = await coursesResponse.json();
      if (coursesData.success && coursesData.courses) {
        const coursesCount = document.getElementById("courses-count");
        if (coursesCount) {
          coursesCount.textContent = coursesData.courses.length;
        }
      }
    }

    // Load questions count (if available)
    const questionsResponse = await fetch("/api/quiz-questions");
    if (questionsResponse.ok) {
      const questionsData = await questionsResponse.json();
      if (questionsData.success && questionsData.questions) {
        const questionsCount = document.getElementById("questions-count");
        if (questionsCount) {
          questionsCount.textContent = questionsData.questions.length;
        }
      }
    }

    // Materials and quizzes counts would come from other endpoints
    // For now, set to 0 or load from available data
    const materialsCount = document.getElementById("materials-count");
    if (materialsCount) {
      materialsCount.textContent = "0"; // TODO: Load from materials API
    }

    const quizzesCount = document.getElementById("quizzes-count");
    if (quizzesCount) {
      quizzesCount.textContent = "0"; // TODO: Load from quizzes API
    }
  } catch (error) {
    console.error("Error loading account statistics:", error);
  }
}

function initializeFormHandlers() {
  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", handleProfileSave);
  }

  const editAvatarBtn = document.getElementById("edit-avatar-btn");
  if (editAvatarBtn) {
    editAvatarBtn.addEventListener("click", handleEditAvatar);
  }
}

function handleProfileSave(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const profileData = {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    department: formData.get("department"),
    phone: formData.get("phone"),
    office: formData.get("office"),
  };

  // Update profile name display
  const profileName = document.getElementById("profile-name");
  if (profileName) {
    profileName.textContent = `${profileData.firstName} ${profileData.lastName}`.trim() || "Instructor Name";
  }

  const profileEmail = document.getElementById("profile-email");
  if (profileEmail) {
    profileEmail.textContent = profileData.email || "instructor@ubc.ca";
  }

  // Save to localStorage
  try {
    const existingProfile = JSON.parse(localStorage.getItem("courseProfile") || sessionStorage.getItem("courseProfile") || "{}");
    const updatedProfile = {
      ...existingProfile,
      ...profileData,
      instructorName: `${profileData.firstName} ${profileData.lastName}`.trim(),
    };
    
    localStorage.setItem("courseProfile", JSON.stringify(updatedProfile));
    sessionStorage.setItem("courseProfile", JSON.stringify(updatedProfile));
    
    showNotification("Profile updated successfully!", "success");
  } catch (error) {
    console.error("Error saving profile:", error);
    showNotification("Error saving profile. Please try again.", "error");
  }
}

function handleEditAvatar() {
  // TODO: Implement avatar upload functionality
  showNotification("Avatar upload feature coming soon!", "info");
}

function showNotification(message, type = "info") {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    background: ${type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : "#3498db"};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transition = "opacity 0.3s ease";
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

