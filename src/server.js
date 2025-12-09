require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const databaseService = require("./services/database/database");
const exampleRoutes = require("./routes/example/hello");
const uploadRoutes = require("./routes/upload");
const questionRoutes = require("./routes/questions");
const quizQuestionRoutes = require("./routes/quiz-questions");
const courseRoutes = require("./routes/courses");
const studentRoutes = require("./routes/student");
const simpleOllamaRoutes = require("./routes/simple-ollama");
const ragLlmRoutes = require("./routes/rag-llm");

const app = express();
const port = process.env.TLEF_GRASP_PORT || 8070;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = require('./middleware/session');
const { passport } = require('./middleware/passport');

const authRoutes = require('./routes/auth');
const { ensureAuthenticated } = require('passport-ubcshib');

// Session middleware - must be before passport
app.use(sessionMiddleware);
// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Authentication routes (no /api prefix as they serve HTML too)
app.use('/auth', authRoutes);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "../public")));

// Page routes
app.get("/", ensureAuthenticated(), (req, res) => {
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

app.get("/onboarding", ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "../public/onboarding.html"));
});

// API endpoints
app.use("/api/example", ensureAuthenticated(), exampleRoutes);
app.use("/api/upload", ensureAuthenticated(), uploadRoutes);
app.use("/api/questions", ensureAuthenticated(), questionRoutes);
app.use("/api/quiz-questions", ensureAuthenticated(), quizQuestionRoutes);
app.use("/api/courses", ensureAuthenticated(), courseRoutes);
app.use("/api/student", ensureAuthenticated(), studentRoutes);
app.use("/api/rag-llm", ensureAuthenticated(), ragLlmRoutes);

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
