/**
 * Session Configuration Middleware
 *
 * Configures express-session for managing user sessions.
 * Sessions are persisted in MongoDB (via connect-mongo) so they survive
 * server restarts/redeploys and are shared across processes. The default
 * in-memory store leaks memory and drops every session on restart, which
 * logs users out unexpectedly.
 */

const session = require('express-session');
const { MongoStore } = require('connect-mongo');

const maxAge = parseInt(process.env.SESSION_TIMEOUT_MS) || 7200000; // 2 hours default

const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME || 'grasp_db',
        collectionName: 'grasp_session',
        ttl: Math.floor(maxAge / 1000), // expire sessions in sync with the cookie
        touchAfter: 24 * 3600 // only rewrite the session once per day unless data changes
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true, // Prevent client-side JS from accessing the cookie
        // From another site, the browser sends the cookie only on top-level
        // GET navigations (a link, Canvas's OAuth redirect back), never with
        // that site's POSTs or embedded requests (CSRF). Browsers differ when
        // this is left unset. Other *.ubc.ca sites count as same-site and do
        // get it sent; middleware/cross-origin.js refuses their writes.
        sameSite: 'lax',
        maxAge
    },
    name: 'grasp.sid' // Custom session ID name
};

const sessionMiddleware = session(sessionConfig);

module.exports = {
    sessionMiddleware,
};