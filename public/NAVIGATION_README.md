# GRASP Navigation Component

This document describes the refactored navigation system for the GRASP application, which provides consistent navigation across all pages.

## Overview

The navigation system has been refactored into reusable components to eliminate code duplication and ensure consistency between the dashboard and question-generation pages.

## Files

### Core Navigation Component

- **`scripts/navigation.js`** - Main navigation class that handles all navigation functionality
- **`styles/navigation.css`** - Shared navigation styles for consistency

### Page-Specific Files

- **`scripts/dashboard.js`** - Dashboard-specific functionality (now uses shared navigation)
- **`scripts/question-generation.js`** - Question generation functionality (now uses shared navigation)

## Usage

### Including Navigation in HTML

```html
<!-- Include the navigation CSS first -->
<link rel="stylesheet" href="styles/navigation.css" />

<!-- Include the navigation script before your page-specific script -->
<script src="scripts/navigation.js"></script>
<script src="scripts/your-page.js"></script>
```

### Initializing Navigation in JavaScript

```javascript
document.addEventListener("DOMContentLoaded", function () {
  // Initialize shared navigation
  new GRASPNavigation();

  // Initialize page-specific functionality
  initializeYourPage();
});
```

## Features

### Automatic Page Detection

The navigation component automatically detects the current page based on the URL and sets the appropriate active navigation item.

### Consistent Functionality

- **Navigation Items**: Click handling with active state management
- **Search**: Consistent search functionality across all pages
- **User Controls**: User profile, settings, and notifications
- **Notifications**: Shared notification system with consistent styling

### Responsive Design

- Mobile-friendly sidebar that can be toggled
- Consistent breakpoints and behavior across pages

## Navigation Structure

### Sidebar Navigation

- Logo/Header section
- User controls (profile, settings, notifications)
- Search functionality
- Navigation menu items

### Top Bar

- Page title that updates based on navigation
- Consistent styling and positioning

## Benefits of Refactoring

1. **Code Reusability**: No more duplicate navigation code between pages
2. **Consistency**: Uniform behavior and appearance across all pages
3. **Maintainability**: Single source of truth for navigation logic
4. **Scalability**: Easy to add new pages with consistent navigation
5. **Bug Fixes**: Fix navigation issues in one place

## Adding New Pages

To add a new page with consistent navigation:

1. Include the navigation CSS and script files
2. Initialize `new GRASPNavigation()` in your page's JavaScript
3. Use the same HTML structure for navigation elements
4. The component will automatically detect and handle the new page

## Browser Compatibility

The navigation component uses modern JavaScript features and CSS properties. It's compatible with:

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Troubleshooting

### Navigation Not Working

- Ensure `navigation.js` is loaded before your page script
- Check that the HTML structure matches the expected navigation classes
- Verify that `new GRASPNavigation()` is called after DOM content is loaded

### Styles Not Applied

- Ensure `navigation.css` is loaded before other CSS files
- Check that the CSS file path is correct
- Verify that the HTML elements have the correct class names

### Active State Not Set

- The component automatically detects the current page
- Ensure your page URL contains the expected page identifier
- Check the browser console for any JavaScript errors
