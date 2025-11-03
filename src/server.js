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
const requireAuth = require("./middleware/requireAuth");

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
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/dashboard.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/dashboard.html"));
});

app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/dashboard.html"));
});

app.get("/question-generation", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-generation.html"));
});

app.get("/question-generation.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-generation.html"));
});

app.get("/question-bank.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-bank.html"));
});

app.get("/question-review", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-review.html"));
});

app.get("/question-review.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/question-review.html"));
});

app.get("/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/settings.html"));
});

app.get("/settings.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/settings.html"));
});

// TA detail route - new format: users/:id (must come before /users)
app.get("/users/:id", (req, res) => {
  console.log('TA route hit:', req.params.id);
  res.sendFile(path.join(__dirname, "../public/instructors/users-ta.html"));
});

// Users page route (and legacy html path)
app.get(["/users", "/users.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/users.html"));
});

// Course Materials routes
app.get(["/course-materials", "/course-materials.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/course-materials-list.html"));
});

// Legacy routes (deprecated)
app.get("/users/ta/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/users-ta.html"));
});

app.get("/users/:id/ta", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/ta-detail.html"));
});

app.get("/course-materials/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/course-materials-upload.html"));
});

// Course Materials detail (serve the detail shell; client reads id from query if present)
app.get(["/course-materials/:id", "/course-materials/detail"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/course-materials-detail.html"));
});

app.get("/student-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/student-dashboard.html"));
});

app.get("/quiz", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/quiz.html"));
});

app.get("/quiz-summary", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/quiz-summary.html"));
});

app.get("/achievements", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/students/achievements.html"));
});

// SAML
// Neutral, protected dashboard - URL does not reveal role
app.get("/auth/me/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/instructors/dashboard.html"));
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
