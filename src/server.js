require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const exampleRoutes = require("./routes/example/hello");
const uploadRoutes = require("./routes/upload");
const questionRoutes = require("./routes/questions");
const courseRoutes = require("./routes/courses");

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
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/question-generation", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-generation.html"));
});

app.get("/question-generation.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-generation.html"));
});

app.get("/question-bank.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-bank.html"));
});

app.get("/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
});

app.get("/settings.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
});

// TA detail route - new format: users/:id (must come before /users)
app.get("/users/:id", (req, res) => {
  console.log('TA route hit:', req.params.id);
  res.sendFile(path.join(__dirname, "../public/views/users-ta.html"));
});

// Users page route (and legacy html path)
app.get(["/users", "/users.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/views/users.html"));
});

// Course Materials routes
app.get(["/course-materials", "/course-materials.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/views/course-materials.html"));
});

// Legacy routes (deprecated)
app.get("/users/ta/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/views/users-ta.html"));
});

app.get("/users/:id/ta", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/views/ta-detail.html"));
});

app.get("/course-materials/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/views/course-materials-upload.html"));
});

// Course Materials detail (serve the detail shell; client reads id from query if present)
app.get(["/course-materials/:id", "/course-materials/detail"], (req, res) => {
  res.sendFile(path.join(__dirname, "../public/views/course-materials-detail.html"));
});

// API endpoints
app.use("/api/example", exampleRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/courses", courseRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log("GRASP Test");
});
