# Question Generation Feature

## Overview

The Question Generation feature is a 5-step workflow that allows instructors to create educational questions from various content sources. The interface follows the existing GRASP design system and provides a seamless user experience.

## Features

### Step 1: Upload Materials
- **Drag & Drop Zone**: Accept multiple files (PDF, TXT, DOC, DOCX)
- **Material Tiles**: Four input methods
  - **Text**: Paste raw text content
  - **PDF**: Upload PDF files
  - **URL**: Add web URLs
  - **Panopto**: Video integration (placeholder)
- **File Management**: View, remove uploaded items
- **Accessibility**: Screen reader announcements for file changes

### Step 2: Review Summary
- **AI-Generated Summary**: Automatic content summarization
- **Editable Summary**: Modify the generated summary
- **Loading States**: Visual feedback during processing

### Step 3: Create Objectives
- **Learning Objectives**: Add/remove educational objectives
- **Bloom's Taxonomy**: Select cognitive levels (Remember, Understand, Apply, Analyze, Evaluate, Create)
- **Dynamic Management**: Real-time objective editing

### Step 4: Generate Questions
- **AI Question Generation**: Create questions based on content and objectives
- **Multiple Choice Questions**: Standardized question format
- **Metadata Display**: Bloom level, difficulty, question type
- **Visual Feedback**: Loading states and progress indicators

### Step 5: Export Format
- **Multiple Formats**: QTI, CSV, JSON export options
- **Download Functionality**: Automatic file download
- **Format Descriptions**: Clear explanations of each format

## Technical Implementation

### Files Created
- `public/question-gen.html` - Main HTML structure
- `public/styles/question-gen.css` - Styling with BEM methodology
- `public/scripts/question-gen.js` - JavaScript functionality
- Updated `src/server.js` - Added route for question-gen page
- Updated `src/routes/questions.js` - Added API endpoints

### API Endpoints
- `POST /api/questions/summarize` - Generate content summary
- `POST /api/questions/generate-questions` - Create questions
- `POST /api/questions/export?format=qti|csv|json` - Export questions

### State Management
```javascript
const state = {
    step: 1,
    course: 'CHEM 121',
    files: [],
    urls: [],
    summary: '',
    objectives: [],
    questions: [],
    exportFormat: 'qti'
};
```

### Design System
- **Colors**: Uses existing GRASP color tokens (#3498db, #2c3e50, etc.)
- **Typography**: Consistent with existing font stack
- **Spacing**: Follows established spacing patterns
- **Components**: Reuses existing button and form styles

## Accessibility Features

- **Keyboard Navigation**: All interactive elements are keyboard accessible
- **Screen Reader Support**: ARIA labels and live regions for dynamic content
- **Focus Management**: Visible focus indicators
- **Semantic HTML**: Proper heading structure and landmarks
- **Responsive Design**: Mobile-friendly with two breakpoints

## Development Mode

The application includes a development flag (`DEV_MODE = true`) that provides:
- Mock API responses when server endpoints fail
- Sample data for testing
- Fallback functionality for offline development

## Usage

1. Navigate to `/question-gen` in the GRASP application
2. Follow the 5-step process:
   - Upload materials (files, text, URLs)
   - Review and edit the generated summary
   - Create learning objectives with Bloom's taxonomy levels
   - Generate and review questions
   - Select export format and download

## Browser Support

- Modern browsers with ES6+ support
- Responsive design for desktop and mobile
- Progressive enhancement for older browsers

## Future Enhancements

- Panopto video integration
- Advanced question types (essay, matching, etc.)
- Question bank integration
- Collaborative editing features
- Advanced export options
