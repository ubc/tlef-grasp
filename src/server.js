require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const databaseService = require("./services/database");
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

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "grasp-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "../public")));

// Page routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/onboarding.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/question-generation", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-generation.html"));
});

app.get("/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
});

app.get("/student-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/student-dashboard.html"));
});

app.get("/quiz", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/quiz.html"));
});

app.get("/quiz-summary", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/quiz-summary.html"));
});

app.get("/course-materials", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/course-materials.html"));
});

app.get("/achievements", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/achievements.html"));
});

app.get("/onboarding", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/onboarding.html"));
});

// API endpoints
app.use("/api/example", exampleRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/quiz-questions", quizQuestionRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/rag-llm", ragLlmRoutes);

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
