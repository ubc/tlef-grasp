require("dotenv").config();
const express = require("express");
const path = require("path");
const exampleRoutes = require("./routes/example/hello");
const uploadRoutes = require("./routes/upload");
const questionRoutes = require("./routes/questions");
const courseRoutes = require("./routes/courses");
const studentRoutes = require("./routes/student");
const simpleOllamaRoutes = require("./routes/simple-ollama");
const ragLlmRoutes = require("./routes/rag-llm");

// Import middleware
const sessionMiddleware = require("./middleware/session");
const { passport } = require("./middleware/passport");
const { requireAuth, requireInstructor, requireStudent } = require("./middleware/requireRole");

const authRoutes = require('./routes/auth');

const app = express();
const port = process.env.PORT || 8070;

// Middleware
app.use(express.json());

// SAML: keep urlencoded for IdP POST to /auth/saml/callback
app.use(express.urlencoded({ extended: false }));

// Session middleware - must be before passport
app.use(sessionMiddleware);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "../public")));

// Page routes
// Root route - redirect based on user role
app.get("/", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    // Redirect based on user role
    if (req.user.role === 'instructor') {
      return res.redirect('/dashboard');
    } else if (req.user.role === 'student') {
      return res.redirect('/student-dashboard');
    }
  }
  // Not authenticated - redirect to login
  res.redirect('/auth/login');
});

// Instructor routes - protected with requireInstructor middleware
app.get("/dashboard", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/dashboard.html"));
});

app.get("/dashboard.html", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/dashboard.html"));
});

app.get("/question-generation", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-generation.html"));
});

app.get("/question-generation.html", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-generation.html"));
});

app.get("/question-bank.html", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-bank.html"));
});

app.get("/question-review", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-review.html"));
});

app.get("/question-review.html", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-review.html"));
});

app.get("/settings", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/settings.html"));
});

app.get("/settings.html", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/settings.html"));
});

// User management routes - protected with requireInstructor
app.get("/users/:id", requireInstructor, (req, res) => {
  console.log('TA route hit:', req.params.id);
  res.sendFile(path.join(__dirname, "../public/instructors/users-ta.html"));
});

app.get(["/users", "/users.html"], requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/users.html"));
});

// Course Materials routes - protected with requireInstructor
app.get(["/course-materials", "/course-materials.html"], requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/course-materials-list.html"));
});

app.get("/course-materials/upload", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/course-materials-upload.html"));
});

app.get(["/course-materials/:id", "/course-materials/detail"], requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/course-materials-detail.html"));
});

// Legacy routes (deprecated) - also protected
app.get("/users/ta/:id", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/users-ta.html"));
});

app.get("/users/:id/ta", requireInstructor, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/ta-detail.html"));
});

// Student routes - protected with requireStudent middleware
app.get("/student-dashboard", requireStudent, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/student-dashboard.html"));
});

app.get("/quiz", requireStudent, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/quiz.html"));
});

app.get("/quiz-summary", requireStudent, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/quiz-summary.html"));
});

app.get("/achievements", requireStudent, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/achievements.html"));
});

// SAML
// Neutral, protected dashboard - redirect based on role
app.get("/auth/me/dashboard", requireAuth, (req, res) => {
  if (req.user.role === 'instructor') {
    return res.redirect('/dashboard');
  } else if (req.user.role === 'student') {
    return res.redirect('/student-dashboard');
  }
  // Fallback
  res.redirect('/');
});

// API endpoints
app.use("/api/example", exampleRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/rag-llm", ragLlmRoutes);

// SAML auth endpoints
app.use("/auth", authRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log("GRASP Test");
});
