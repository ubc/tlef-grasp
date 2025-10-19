const { MongoClient } = require("mongodb");

// MongoDB connection configuration
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/tlef_grasp";
const DB_NAME = "tlef_grasp";

let client;
let db;

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    client = new MongoClient(MONGODB_URI);

    await client.connect();
    console.log("✅ Connected to MongoDB successfully");

    db = client.db(DB_NAME);
    console.log(`📊 Using database: ${DB_NAME}`);

    return db;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

// Get database instance
function getDB() {
  if (!db) {
    throw new Error("Database not connected. Call connectToMongoDB() first.");
  }
  return db;
}

// Get collection
function getCollection(collectionName) {
  return getDB().collection(collectionName);
}

// Close connection
async function closeConnection() {
  if (client) {
    await client.close();
    console.log("🔌 MongoDB connection closed");
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  await closeConnection();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeConnection();
  process.exit(0);
});

module.exports = {
  connectToMongoDB,
  getDB,
  getCollection,
  closeConnection,
};
