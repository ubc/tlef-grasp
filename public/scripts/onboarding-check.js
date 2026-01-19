// Shared onboarding check script
// This script should be included on all pages that require onboarding

function checkOnboardingStatus() {
  const isOnboarded = null !== sessionStorage.getItem("grasp-selected-course");
  const currentPath = window.location.pathname;

  // Don't check on root path or auth paths
  if (currentPath === "/" || currentPath.startsWith("/auth")) {
    return;
  }

  // Always allow access to onboarding page (users may want to select different course)
  if (currentPath === "/onboarding") {
    // If onboarded and on onboarding page, redirect to dashboard
    if (isOnboarded) {
      window.location.href = "/dashboard";
    }
    return;
  }

  // If user is NOT onboarded and trying to access protected pages, redirect to onboarding
  if (!isOnboarded) {
    window.location.href = "/onboarding";
    return;
  }

  // If user is onboarded, allow access to all other pages
  // (no redirect needed)
}

// Run onboarding check when page loads
document.addEventListener("DOMContentLoaded", checkOnboardingStatus);
