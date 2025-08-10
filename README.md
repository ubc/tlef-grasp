# GRASP - Generative AI-powered Research-informed Assessment System for Practice

A modern, responsive instructor dashboard for a generative AI-powered formative assessment tool designed to help instructors quickly generate evidence-based, research-informed questions and provide students with spaced, adaptive, and elaborative practice.

## 🚀 Features

### Core Functionality

- **AI-Powered Question Generation**: Quickly generate evidence-based questions for lectures
- **Formative Assessment Tools**: Create and manage quizzes and assessments
- **Canvas LMS Integration**: Seamlessly integrate with UBC's Canvas LMS
- **No Extra Student Accounts**: Students can access assessments directly through Canvas

### Dashboard Components

- **Welcome Section**: Personalized greeting with current date
- **Quick Start Actions**: Upload, Review, Quizzes, Questions
- **Generation Status**: Track question generation progress across lectures
- **Review Status**: Circular progress indicator with course selection
- **Calendar View**: Monthly calendar with current date highlighting
- **Flagged Questions**: Track questions requiring attention

### Question Generation Page

- **Course Selection**: Dropdown to select course (CHEM 121, CHEM 123, CHEM 233)
- **Material Upload Options**: Text, PDF, URL, and Panopto video uploads
- **Drag & Drop Interface**: Modern file upload with visual feedback
- **Upload Progress**: Real-time progress tracking for multiple files
- **Generated Questions Preview**: AI-generated questions with edit/delete options
- **Smart File Handling**: Automatic file type detection and processing

### Technical Features

- **Responsive Design**: Mobile-first approach with breakpoints at 1200px and 768px
- **Modern UI/UX**: Clean, professional interface with smooth animations
- **Interactive Elements**: Hover effects, progress animations, and smooth transitions
- **Search Functionality**: Global search across the system
- **Navigation**: Intuitive sidebar navigation with active states

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **Backend**: Node.js with Express.js
- **Styling**: CSS Grid, Flexbox, CSS Custom Properties
- **Icons**: Font Awesome 6.0
- **Development**: Browser-sync, Nodemon, Cross-env

## 📁 Project Structure

```
tlef-grasp/
├── public/                    # Frontend files
│   ├── dashboard.html        # Main instructor dashboard
│   ├── index.html            # Landing page with redirect
│   ├── settings.html         # Settings page
│   ├── styles/
│   │   ├── dashboard.css     # Dashboard-specific styles
│   │   └── style.css         # Global styles and utilities
│   └── scripts/
│       ├── dashboard.js      # Dashboard functionality
│       └── front-end.js      # General frontend utilities
├── src/                      # Backend files
│   ├── server.js             # Express server
│   └── routes/               # API routes
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd tlef-grasp
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**

   ```bash
   npm run dev
   ```

4. **Access the dashboard**
   - Open your browser and navigate to `http://localhost:8070`
   - You'll be automatically redirected to the dashboard at `http://localhost:8070/dashboard`

### Available Scripts

- **`npm start`**: Start the production server
- **`npm run dev`**: Start development mode with hot reloading
- **`npm run dev:server`**: Start only the backend server
- **`npm run dev:client`**: Start only the frontend with browser-sync

## 🎨 Customization

### Colors

The dashboard uses a consistent color scheme:

- **Primary Blue**: `#3498db` - Main actions and highlights
- **Dark Blue**: `#2c3e50` - Sidebar and text
- **Light Gray**: `#f5f5f5` - Background and cards
- **Accent Colors**: Various shades for different states

### Styling

- **CSS Variables**: Easy to modify colors and spacing
- **Responsive Breakpoints**: 1200px and 768px
- **Component-based CSS**: Modular styling for easy maintenance

### JavaScript

- **Modular Functions**: Well-organized, reusable code
- **Event Handling**: Comprehensive interaction management
- **API Ready**: Structured for easy backend integration

## 🔧 Development

### Adding New Features

1. **HTML**: Add new sections to `dashboard.html`
2. **CSS**: Style new components in `dashboard.css`
3. **JavaScript**: Add functionality in `dashboard.js`

### File Organization

- Keep HTML semantic and accessible
- Use CSS Grid and Flexbox for layouts
- Follow ES6+ JavaScript best practices
- Maintain responsive design principles

## 🌐 Browser Support

- **Chrome**: 90+
- **Firefox**: 88+
- **Safari**: 14+
- **Edge**: 90+

## 📱 Responsive Design

The dashboard is designed to work seamlessly across all device sizes:

- **Desktop**: Full sidebar navigation with two-column layout
- **Tablet**: Responsive grid adjustments
- **Mobile**: Stacked layout with collapsible navigation

## 🔒 Security Considerations

- **No Sensitive Data**: Dashboard displays only non-sensitive information
- **Input Validation**: All user inputs are validated
- **XSS Protection**: Content is properly escaped
- **CSRF Protection**: Ready for backend CSRF implementation

## 🚀 Deployment

### Production Build

```bash
npm start
```

### Environment Variables

Create a `.env` file in the root directory:

```env
TLEF_GRASP_PORT=8070
NODE_ENV=production
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions:

- Check the documentation in the `public/README.md` file
- Review the code comments for implementation details
- Open an issue for bugs or feature requests

## 🔮 Future Enhancements

- **Real-time Updates**: WebSocket integration for live data
- **Advanced Analytics**: Detailed progress tracking and insights
- **Question Templates**: Pre-built question structures
- **Bulk Operations**: Mass question generation and management
- **Export Features**: PDF and CSV export capabilities
- **Integration APIs**: Canvas LMS API integration
- **User Management**: Role-based access control
- **Audit Logging**: Track all system activities

---

**GRASP** - Empowering instructors with AI-driven assessment tools for better learning outcomes.
