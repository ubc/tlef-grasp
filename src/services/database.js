const { MongoClient } = require("mongodb");

class DatabaseService {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.connectionUri = null;
  }

  async connect() {
    if ( null !== this.db ) {
      return this.db;
    }
    
    if ( ! process.env.MONGO_INITDB_ROOT_USERNAME || ! process.env.MONGO_INITDB_ROOT_PASSWORD || ! process.env.MONGODB_HOST || ! process.env.MONGODB_PORT || ! process.env.MONGODB_DB_NAME ) {
      throw new Error("Missing MongoDB connection variables. Please set MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD, MONGODB_HOST, MONGODB_PORT, and MONGODB_DB_NAME in your .env file.");
    }
    
    // Validate required environment variables
    const dbName = process.env.MONGODB_DB_NAME || "grasp_db";
    const username = process.env.MONGO_INITDB_ROOT_USERNAME;
    const password = process.env.MONGO_INITDB_ROOT_PASSWORD;
    const host = process.env.MONGODB_HOST || "localhost";
    const port = process.env.MONGODB_PORT || "27017";

    // Construct MongoDB URI
    const mongodbUri = `mongodb://${username}:${password}@${host}:${port}/`;

    // Connection options with shorter timeout for faster fallback
    const connectionOptions = {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    };

    try {
      console.log("Attempting to connect to MongoDB...");
      this.client = new MongoClient(mongodbUri, connectionOptions);
      await this.client.connect();
      this.db = this.client.db(dbName);
      this.isConnected = true;
      this.connectionUri = mongodbUri;
      
      console.log("✅ Successfully connected to MongoDB");

      await this.initializeCollections();

      return this.db;
    } catch (error) {
      console.error("❌ Error connecting to MongoDB:", error.message);
      // Close the failed connection attempt
      if (this.client) {
        try {
          await this.client.close();
        } catch (closeError) {
          // Ignore close errors
        }
        this.client = null;
      }
      this.isConnected = false;
      throw error;
    }
  }

  async initializeCollections() {
    try {
      await this.db.collection("grasp_user").createIndex({ puid: 1 }, { unique: true });
      await this.db.collection("grasp_course").createIndex({ courseCode: 1 }, { unique: true });
      await this.db.collection("grasp_question").createIndex({ questionTitle: 1 });
      await this.db.collection("grasp_user_course").createIndex({ userId: 1, courseId: 1 }, { unique: true });
      await this.db.collection("grasp_material").createIndex({ sourceId: 1 }, { unique: true });
    
      console.log("✅ MongoDB collections initialized");
    } catch (error) {
      console.error("❌ Error initializing collections:", error);
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log("✅ Disconnected from MongoDB");
    }
  }

  getCollection(name) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    return this.db.collection(name);
  }

  getConnectionInfo() {
    return {
      connected: this.isConnected,
      connectionType: this.connectionType,
      uri: this.connectionUri
        ? this.connectionUri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@") // Mask credentials
        : null,
    };
  }
}

// Create singleton instance
const databaseService = new DatabaseService();

module.exports = databaseService;
