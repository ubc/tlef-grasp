require("dotenv").config();
const express = require("express");
const path = require("path");
const databaseService = require("./services/database");
const uploadRoutes = require("./routes/upload");
const questionRoutes = require("./routes/question");
//const quizQuestionRoutes = require("./routes/quiz-questions");
const courseRoutes = require("./routes/courses");
const studentRoutes = require("./routes/student");
const ragLlmRoutes = require("./routes/rag-llm");
const materialRoutes = require("./routes/material");
const objectiveRoutes = require("./routes/objective");
const quizRoutes = require("./routes/quiz");
const userRoutes = require("./routes/users");
const { isFaculty } = require("./utils/auth");

const app = express();
const port = process.env.TLEF_GRASP_PORT || 8070;

// Middleware
const { sessionMiddleware } = require('./middleware/session');
const { passport } = require('./middleware/passport');
const { dbMiddleware } = require('./middleware/database');

// Session middleware - must be before passport
app.use(sessionMiddleware);
// Passport middleware
app.use(passport.initialize());
app.use(passport.session());
// Database middleware
app.use(dbMiddleware);

const authRoutes = require('./routes/auth');
const { ensureAuthenticated } = require('passport-ubcshib');

// Custom middleware for API routes - returns JSON instead of redirecting
function ensureAuthenticatedAPI(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  // For API requests, return JSON error instead of redirecting
  res.status(401).json({
    success: false,
    error: 'Authentication required',
    authenticated: false
  });
}

// Authentication routes (no /api prefix as they serve HTML too)
app.use('/auth', express.json(), express.urlencoded({extended: true }), authRoutes);

// Shibboleth SP endpoint - traditional Shibboleth callback path
// This handles POST requests from UBC IdP if configured to use /Shibboleth.sso/SAML2/POST
app.post(
  '/Shibboleth.sso/SAML2/POST',
  express.json(),  // allow up to 50 MB
  express.urlencoded({ extended: true }),
  passport.authenticate('ubcshib', { failureRedirect: '/login' }),
  (req, res) => {
    // Successful authentication
    res.redirect('/onboarding');
  }
);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "../public")));

// Page routes
app.get("/", (req, res) => {

});

app.get("/onboarding", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/onboarding.html"));
});

app.get("/dashboard", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/question-generation", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-generation.html"));
});

app.get("/settings", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
});

app.get("/student-dashboard", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/student-dashboard.html"));
});

app.get("/quiz", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/quiz.html"));
});

app.get("/quiz-summary", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/quiz-summary.html"));
});

app.get("/course-materials", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/course-materials.html"));
});

app.get("/achievements", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/achievements.html"));
});

app.get("/users", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/users.html"));
});

app.get("/question-bank", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-bank.html"));
});

app.get("/question-review", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-review.html"));
});

// API endpoints - pass middleware function by reference (no parentheses)
app.use("/api/upload", ensureAuthenticatedAPI, uploadRoutes);
app.use("/api/question", ensureAuthenticatedAPI, questionRoutes);
//app.use("/api/quiz-questions", ensureAuthenticatedAPI, quizQuestionRoutes);
app.use("/api/courses", ensureAuthenticatedAPI, courseRoutes);
app.use("/api/student", ensureAuthenticatedAPI, studentRoutes);
app.use("/api/rag-llm", ensureAuthenticatedAPI, ragLlmRoutes);
app.use("/api/material", ensureAuthenticatedAPI, materialRoutes);
app.use("/api/objective", ensureAuthenticatedAPI, objectiveRoutes);
app.use("/api/quiz", ensureAuthenticatedAPI, quizRoutes);
app.use("/api/users", ensureAuthenticatedAPI, userRoutes);

app.use("/api/current-user", ensureAuthenticatedAPI, async (req, res) => {
  try {
    // Check if user is faculty (includes administrator check)
    const userIsFaculty = await isFaculty(req.user);
    
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
        isFaculty: userIsFaculty,
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
  // If it's an API path, send a JSON 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // For all other paths, send a simple text 404
  res.status(404).send('404: Page Not Found');
});

app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log("GRASP Test");

  // Initialize MongoDB connection
  try {
    await databaseService.connect();
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    console.log("Please make sure MongoDB is installed and running");
  }
});
