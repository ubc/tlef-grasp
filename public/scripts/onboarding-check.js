// Shared onboarding check script
// This script should be included on all pages that require onboarding

function checkOnboardingStatus() {
  const isOnboarded = null !== sessionStorage.getItem("grasp-selected-course");
  const currentPath = window.location.pathname;

  if (currentPath === "/") {
    return;
  }

  if ( isOnboarded && currentPath === "/onboarding" ) {
    window.location.href = "/dashboard";
  }

  if ( isOnboarded ) {
    return;
  }

  // If user is already onboarded and trying to access onboarding page, redirect to dashboard
  if ( currentPath !== "/onboarding") {
    window.location.href = "/onboarding";
  }
}

// Run onboarding check when page loads
document.addEventListener("DOMContentLoaded", checkOnboardingStatus);
