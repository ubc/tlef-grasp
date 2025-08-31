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

app.get("/question-gen", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/question-gen.html"));
});

app.get("/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
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
