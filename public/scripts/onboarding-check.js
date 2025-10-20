// Shared onboarding check script
// This script should be included on all pages that require onboarding

function checkOnboardingStatus() {
  const isOnboarded = sessionStorage.getItem("onboarded");
  const currentPath = window.location.pathname;

  // If user is already onboarded and trying to access onboarding page, redirect to dashboard
  if (isOnboarded === "true" && currentPath === "/onboarding") {
    window.location.href = "/dashboard";
    return;
  }

  // If user hasn't been onboarded and not on onboarding page, redirect to onboarding
  // Exclude certain pages that don't require onboarding
  const publicPages = ["/onboarding", "/", "/index.html"];
  if (isOnboarded !== "true" && !publicPages.includes(currentPath)) {
    window.location.href = "/onboarding";
    return;
  }
}

// Run onboarding check when page loads
document.addEventListener("DOMContentLoaded", checkOnboardingStatus);
