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
- **Authentication**: SAML 2.0 with Passport.js
- **Styling**: CSS Grid, Flexbox, CSS Custom Properties
- **Icons**: Font Awesome 6.0
- **Development**: Browser-sync, Nodemon, Cross-env

## 📁 Project Structure

```
tlef-grasp/
├── public/                    # Frontend files
│   ├── instructors/          # Instructor-only pages
│   │   ├── dashboard.html
│   │   ├── question-generation.html
│   │   ├── question-bank.html
│   │   └── users.html
│   ├── students/             # Student-only pages
│   │   ├── student-dashboard.html
│   │   ├── quiz.html
│   │   └── achievements.html
│   ├── styles/               # Shared CSS
│   └── scripts/              # Shared JavaScript
├── src/                      # Backend
│   ├── server.js             # Express server
│   ├── routes/               # API routes
│   └── middleware/           # Authentication middleware
├── docker-compose.yml        # Docker configuration
└── README.md                 # This file
```

## 🚀 Getting Started

### Prerequisites

- **Docker Desktop** (Recommended) OR
- Node.js (v20 or higher) + npm

### Quick Start with Docker (Recommended)

```powershell
# 1. Copy environment template
cp env-docker.template .env

# 2. Edit .env with your SAML configuration

# 3. Start everything
.\docker-start.ps1
# OR
docker-compose up -d

# 4. Access GRASP
# Open: http://localhost:8070
```

See **[DOCKER_GUIDE.md](DOCKER_GUIDE.md)** for complete Docker setup.

### Manual Installation (Without Docker)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp env-docker.template .env
   # Edit .env with your configuration
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Access the application**
   - Open: http://localhost:8070
   - Login via SAML authentication

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

## 🔒 Security & Authentication

### SAML 2.0 Authentication with Role-Based Access

GRASP uses SAML 2.0 for secure single sign-on with automatic role detection:

- **Automatic Role Detection**: Instructors and students identified from SAML affiliation
- **Role-Based Access**: Separate interfaces for instructors and students
- **UBC CWL Compatible**: Works with UBC's authentication system
- **Single Logout**: Full SAML SLO support

**Key Features:**
- Instructors see: Question generation, user management, course materials
- Students see: Quizzes, achievements, student dashboard
- Wrong role attempts auto-redirect to correct dashboard

**SAML Endpoints:**
- `/auth/login` - Initiate login
- `/auth/logout` - Logout (with sidebar button)
- `/auth/me` - Get user info and role
- `/auth/metadata` - SP metadata

See **[SAML_AUTH_GUIDE.md](SAML_AUTH_GUIDE.md)** for complete authentication guide.

## 📖 Documentation

- **[DOCKER_GUIDE.md](DOCKER_GUIDE.md)** - Complete Docker setup and commands
- **[SAML_AUTH_GUIDE.md](SAML_AUTH_GUIDE.md)** - Authentication and role-based access
- **[env-docker.template](env-docker.template)** - Environment variable template

## 🚀 Deployment

### With Docker (Recommended)

```powershell
docker-compose up -d
```

### Without Docker

```bash
npm start
```

### Environment Variables

See **[env-docker.template](env-docker.template)** for complete configuration template.

**Required variables:**
```env
# MongoDB
MONGO_INITDB_ROOT_PASSWORD=<strong-password>

# Session
SESSION_SECRET=<random-string>

# SAML
SAML_ENTRY_POINT=<idp-sso-url>
SAML_LOGOUT_URL=<idp-logout-url>
SAML_ISSUER=https://tlef-grasp
SAML_CERT_PATH=./certs/cert.crt
```

See **[SAML_AUTH_GUIDE.md](SAML_AUTH_GUIDE.md)** for SAML configuration details.

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
