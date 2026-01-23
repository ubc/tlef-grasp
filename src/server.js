require("dotenv").config();
const path = require("path");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { sessionMiddleware } = require('./middleware/session');
const { passport } = require('./middleware/passport');
const { dbMiddleware } = require('./middleware/database');

const authRoutes = require('./routes/auth');
const uploadRoutes = require("./routes/upload");
const questionRoutes = require("./routes/question");
const courseRoutes = require("./routes/courses");
const studentRoutes = require("./routes/student");
const ragLlmRoutes = require("./routes/rag-llm");
const materialRoutes = require("./routes/material");
const objectiveRoutes = require("./routes/objective");
const quizRoutes = require("./routes/quiz");
const userRoutes = require("./routes/users");
const achievementRoutes = require("./routes/achievement");

const { getUserRole, ROLES } = require("./utils/auth");
const { ensureAuthenticated } = require('passport-ubcshib');
const { ensureAuthenticatedAPI, requireRole, requirePageRole } = require('./middleware/auth');

const app = express();
const port = process.env.TLEF_GRASP_PORT || 8070;

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
        ],
        fontSrc: [
          "'self'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.gstatic.com",
          "https://cdn.jsdelivr.net",
        ],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://api.openai.com"],
        workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
      },
    },
  })
);
app.use(cors());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(dbMiddleware);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "../public")));

// Authentication routes (no /api prefix as they serve HTML too)
// Shibboleth SP endpoint - traditional Shibboleth callback path
app.post(
  '/Shibboleth.sso/SAML2/POST',
  express.json(),
  express.urlencoded({ extended: true }),
  passport.authenticate('ubcshib', { failureRedirect: '/auth/login' }),
  (req, res) => {
    res.redirect('/onboarding');
  }
);

app.use('/auth', express.json(), express.urlencoded({ extended: true }), authRoutes);

// Page routes
app.get("/", (req, res) => {
  // Redirect to onboarding or login
  if (req.isAuthenticated()) {
    res.redirect('/onboarding');
  } else {
    res.redirect('/auth/login');
  }
});

// Onboarding - all authenticated users can access
app.get("/onboarding", ensureAuthenticated(), requirePageRole(ROLES.STUDENT), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/onboarding.html"));
});

// Faculty and Staff pages (require at least staff role)
app.get("/dashboard", ensureAuthenticated(), requirePageRole(ROLES.STAFF), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/question-generation", ensureAuthenticated(), requirePageRole(ROLES.STAFF), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-generation.html"));
});

app.get("/course-materials", ensureAuthenticated(), requirePageRole(ROLES.STAFF), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/course-materials.html"));
});

app.get("/question-bank", ensureAuthenticated(), requirePageRole(ROLES.STAFF), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-bank.html"));
});

app.get("/question-review", ensureAuthenticated(), requirePageRole(ROLES.STAFF), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-review.html"));
});

// Users page - faculty only
app.get("/users", ensureAuthenticated(), requirePageRole(ROLES.FACULTY), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/users.html"));
});

// Settings - all authenticated users
app.get("/settings", ensureAuthenticated(), requirePageRole(ROLES.FACULTY), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
});

// Student pages - all authenticated users (students see their view, others can preview)
app.get("/student-dashboard", ensureAuthenticated(), requirePageRole(ROLES.STUDENT), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/student-dashboard.html"));
});

app.get("/quiz", ensureAuthenticated(), requirePageRole(ROLES.STUDENT), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/quiz.html"));
});

app.get("/quiz-summary", ensureAuthenticated(), requirePageRole(ROLES.STUDENT), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/quiz-summary.html"));
});

app.get("/achievements", ensureAuthenticated(), requirePageRole(ROLES.STUDENT), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/achievements.html"));
});

// API endpoints
// Upload, question generation, materials - require at least staff role
app.use("/api/upload", ensureAuthenticatedAPI, requireRole(ROLES.STAFF), uploadRoutes);
app.use("/api/question", ensureAuthenticatedAPI, requireRole(ROLES.STAFF), questionRoutes);
app.use("/api/rag-llm", ensureAuthenticatedAPI, requireRole(ROLES.STAFF), ragLlmRoutes);
app.use("/api/material", ensureAuthenticatedAPI, requireRole(ROLES.STAFF), materialRoutes);
app.use("/api/objective", ensureAuthenticatedAPI, requireRole(ROLES.STAFF), objectiveRoutes);

// Course routes - staff and above for management, but students might need read access
app.use("/api/courses", ensureAuthenticatedAPI, requireRole(ROLES.STUDENT), courseRoutes);

// Quiz routes - all authenticated users (students take quizzes, staff/faculty manage)
app.use("/api/quiz", ensureAuthenticatedAPI, requireRole(ROLES.STUDENT), quizRoutes);

// Student routes - all authenticated users
app.use("/api/student", ensureAuthenticatedAPI, requireRole(ROLES.STUDENT), studentRoutes);

// Achievement routes - all authenticated users
app.use("/api/achievement", ensureAuthenticatedAPI, requireRole(ROLES.STUDENT), achievementRoutes);

// Users management - faculty only
app.use("/api/users", ensureAuthenticatedAPI, requireRole(ROLES.FACULTY), userRoutes);

// Current user endpoint - all authenticated users
app.use("/api/current-user", ensureAuthenticatedAPI, requireRole(ROLES.STUDENT), async (req, res) => {
  try {
    const userRole = await getUserRole(req.user);
    const userIsFaculty = userRole === ROLES.FACULTY;
    const userIsStaff = userRole === ROLES.STAFF;
    const userIsStudent = userRole === ROLES.STUDENT;

    res.json({
      success: true,
      user: {
        _id: req.user._id,
        id: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName,
        email: req.user.email,
        affiliation: req.user.affiliation,
        puid: req.user.puid,
        role: userRole,
        isFaculty: userIsFaculty,
        isStaff: userIsStaff,
        isStudent: userIsStudent,
      },
    });
  } catch (error) {
    console.error("Error in /api/current-user:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user information",
    });
  }
});

// Final 404 handler for any requests that do not match a route
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.status(404).send('404: Page Not Found');
});

app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
});
