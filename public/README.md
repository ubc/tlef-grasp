# GRASP Dashboard - Public Directory

This directory contains the frontend files for the GRASP (Generative AI-powered Research-informed Assessment System for Practice) dashboard.

## Files Overview

### HTML Files

- **`dashboard.html`** - Main instructor dashboard interface
- **`index.html`** - Landing page (redirects to dashboard)
- **`settings.html`** - Settings page

### CSS Files

- **`styles/dashboard.css`** - Complete styling for the dashboard
- **`styles/style.css`** - Global styles and utility classes

### JavaScript Files

- **`scripts/dashboard.js`** - Interactive functionality for the dashboard
- **`scripts/front-end.js`** - General frontend utilities

## Dashboard Features

### Navigation

- **Sidebar Navigation**: Dashboard, Question Bank, Question Builder, Course Materials, Users
- **User Controls**: Profile, Settings, Notifications (with badge)
- **Search Functionality**: Global search across the system

### Main Dashboard Sections

#### Left Column

1. **Welcome Section**: Personalized greeting with current date
2. **Quick Start**: Four action cards (Upload, Review, Quizzes, Questions)
3. **Generation Status**: Progress tracking for question generation across lectures
4. **Review Status**: Circular progress indicator with course selector

#### Right Column

1. **Calendar**: Monthly calendar view with current date highlighting
2. **Flagged Questions**: List of questions requiring attention with timestamps

### Interactive Elements

- Clickable navigation items with active states
- Hover effects on cards and buttons
- Progress bar animations
- Course selector dropdown
- Radio button selection for flagged questions

## Usage

1. **Start the server**: `npm run dev` or `npm start`
2. **Access the dashboard**: Navigate to `http://localhost:8070` or `http://localhost:8070/dashboard`
3. **Navigate**: Click on sidebar items to switch between sections
4. **Search**: Use the search bar to find content
5. **Interact**: Click on cards, progress bars, and other elements

## Customization

### Colors

The dashboard uses a consistent color scheme:

- Primary Blue: `#3498db`
- Dark Blue: `#2c3e50`
- Light Gray: `#f5f5f5`
- Accent Colors: Various shades for different states

### Fonts

- System fonts for optimal performance
- Font Awesome icons for visual elements

### Responsive Design

- Mobile-first approach
- Breakpoints at 1200px and 768px
- Flexible grid layouts

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ JavaScript features
- CSS Grid and Flexbox
- CSS Custom Properties (variables)

## Development Notes

- No external frameworks required
- Vanilla JavaScript for all interactions
- CSS Grid and Flexbox for layouts
- Font Awesome for icons
- Responsive design principles
