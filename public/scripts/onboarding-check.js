// Shared onboarding check script
// This script should be included on all pages that require onboarding

function checkOnboardingStatus() {
  // Use localStorage instead of sessionStorage for persistence across reloads
  const isOnboarded = localStorage.getItem("onboarded");
  const courseProfile = localStorage.getItem("courseProfile");
  const currentPath = window.location.pathname;

  // Pages that don't require onboarding check or have their own state management
  const pagesWithOwnState = [
    "/question-generation",
    "/question-generation.html",
    "/dashboard",
    "/dashboard.html",
    "/settings",
    "/settings.html",
    "/question-review",
    "/question-review.html",
    "/question-bank",
    "/question-bank.html",
  ];

  // Skip onboarding check for pages that manage their own state
  if (pagesWithOwnState.some(page => currentPath.includes(page))) {
    console.log("Skipping onboarding check for page with own state management:", currentPath);
    return;
  }

  // If user is already onboarded and trying to access onboarding page, redirect to dashboard
  if (isOnboarded === "true" && (currentPath === "/onboarding" || currentPath === "/onboarding.html")) {
    console.log("User is onboarded, redirecting from onboarding to dashboard");
    window.location.href = "/dashboard.html";
    return;
  }

  // If user has a course profile and trying to access onboarding, redirect to dashboard
  if (courseProfile && (currentPath === "/onboarding" || currentPath === "/onboarding.html")) {
    console.log("User has course profile, redirecting from onboarding to dashboard");
    window.location.href = "/dashboard.html";
    return;
  }

  // If user hasn't been onboarded and not on onboarding page, redirect to onboarding
  // Exclude certain pages that don't require onboarding
  const publicPages = ["/onboarding", "/onboarding.html", "/", "/index.html"];
  if (isOnboarded !== "true" && !courseProfile && !publicPages.includes(currentPath)) {
    // Only redirect if not already on a page with its own state management
    if (!pagesWithOwnState.some(page => currentPath.includes(page))) {
      console.log("User not onboarded, redirecting to onboarding");
      window.location.href = "/onboarding.html";
      return;
    }
  }
}

// Run onboarding check when page loads, but with a delay to allow state restoration
document.addEventListener("DOMContentLoaded", () => {
  // Delay to ensure state restoration and other scripts initialize first
  // This prevents redirect loops
  setTimeout(checkOnboardingStatus, 500);
});
