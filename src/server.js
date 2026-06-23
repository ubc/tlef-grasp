require("dotenv").config();
const path = require("path");
const fs = require("fs");

const express = require("express");
const helmet = require("helmet");
const { sessionMiddleware } = require('./middleware/session');
const { passport } = require('./middleware/passport');
const { dbMiddleware } = require('./middleware/database');

const authRoutes = require('./routes/auth');
const questionRoutes = require("./routes/question");
const courseRoutes = require("./routes/courses");
const studentRoutes = require("./routes/student");
const ragLlmRoutes = require("./routes/rag-llm");
const materialRoutes = require("./routes/material");
const objectiveRoutes = require("./routes/objective");
const quizRoutes = require("./routes/quiz");
const userRoutes = require("./routes/users");
const achievementRoutes = require("./routes/achievement");
const ubcApiRoutes = require("./routes/ubcApi");

const { getUserRole, ROLES } = require("./utils/auth");
const { ensureAuthenticatedAPI, requireRole } = require('./middleware/auth');

const app = express();
const port = process.env.TLEF_GRASP_PORT || 8070;

// Behind a TLS-terminating reverse proxy (e.g. nginx) on staging/production.
// Without this, req.secure stays false for proxied requests and express-session
// refuses to send the `secure` session cookie, so logins silently fail (the
// browser never stores grasp.sid → every request is a 401).
app.set('trust proxy', 1);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // All JS/CSS/fonts are bundled locally by Vite (KaTeX & FontAwesome are
        // npm deps), so no external script/style CDNs are needed.
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // Legacy fallback for browsers that don't support the granular
        // style-src-elem/style-src-attr directives below.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        // Stylesheets and <style> elements: no inline allowed. The Vite build
        // emits only an external stylesheet and nothing injects <style> at
        // runtime, so this stays strict.
        styleSrcElem: ["'self'", "https://fonts.googleapis.com"],
        // Inline style="" attributes only. Required by dynamic React style={{}}
        // props (e.g. width: `${progress}%`) and KaTeX math layout, which emit
        // runtime-varying values that cannot use a nonce or hash.
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: [
          "'self'",
          // Vite inlines small font files (FontAwesome/KaTeX) as data: URIs
          "data:",
          "https://fonts.gstatic.com",
        ],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://api.openai.com"],
        workerSrc: ["'self'", "blob:"],
      },
    },
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(dbMiddleware);

// Serve the built React client (client/dist). In development the client is
// served by Vite on port 5173 with /api and /auth proxied to this server.
const clientDistPath = path.join(__dirname, "../client/dist");
const clientIndexPath = path.join(clientDistPath, "index.html");
app.use(express.static(clientDistPath));

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

// Page routes are handled client-side by the React SPA (see fallback below).
// Role-based access is enforced on the API routes and mirrored by client guards.

// API endpoints
// Question generation, materials - require at least staff role
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

// UBC API proxy - faculty/staff only (campus, period, instructor sections lookups)
app.use("/api/ubc", ensureAuthenticatedAPI, requireRole(ROLES.STAFF), ubcApiRoutes);

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

// SPA fallback: serve the React app for any non-API GET request
app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    !req.path.startsWith("/api/") &&
    !req.path.startsWith("/auth") &&
    fs.existsSync(clientIndexPath)
  ) {
    return res.sendFile(clientIndexPath);
  }
  next();
});

// Final 404 handler for any requests that do not match a route
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.status(404).send('404: Page Not Found');
});

// Global error handler. Without this, failures in middleware (e.g. a slow or
// unreachable database) fall through to Express's default handler and the
// request appears to hang/time out. Respond with a clean error instead.
app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
  res.status(500).send('500: Internal Server Error');
});

app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
});
