const { MongoClient } = require("mongodb");

class DatabaseService {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.connectionUri = null;
    this.connectionType = null; // 'local' or 'remote'
  }

  async connect() {
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
      this.connectionType = username ? "authenticated" : "local";
      console.log("✅ Successfully connected to MongoDB");
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
      // Create quiz questions collection
      await this.db.collection("quizQuestions").createIndex({ courseName: 1 });
      await this.db.collection("quizQuestions").createIndex({ quizName: 1 });
      await this.db.collection("quizQuestions").createIndex({ createdAt: -1 });

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

  async saveQuizQuestion(questionData) {
    try {
      const collection = this.getCollection("quizQuestions");
      const result = await collection.insertOne({
        ...questionData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return result;
    } catch (error) {
      console.error("Error saving quiz question:", error);
      throw error;
    }
  }

  async saveQuizQuestions(questionsData) {
    try {
      const collection = this.getCollection("quizQuestions");
      const documents = questionsData.map((question) => ({
        ...question,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      const result = await collection.insertMany(documents);
      return result;
    } catch (error) {
      console.error("Error saving quiz questions:", error);
      throw error;
    }
  }

  async getQuizQuestions(filters = {}) {
    try {
      const collection = this.getCollection("quizQuestions");
      const questions = await collection
        .find(filters)
        .sort({ createdAt: -1 })
        .toArray();
      return questions;
    } catch (error) {
      console.error("Error getting quiz questions:", error);
      throw error;
    }
  }

  async getQuizQuestionsByCourse(courseName) {
    try {
      return await this.getQuizQuestions({ courseName });
    } catch (error) {
      console.error("Error getting quiz questions by course:", error);
      throw error;
    }
  }

  async updateQuizQuestion(questionId, updateData) {
    try {
      const collection = this.getCollection("quizQuestions");
      const result = await collection.updateOne(
        { _id: questionId },
        {
          $set: {
            ...updateData,
            updatedAt: new Date(),
          },
        }
      );
      return result;
    } catch (error) {
      console.error("Error updating quiz question:", error);
      throw error;
    }
  }

  async deleteQuizQuestion(questionId) {
    try {
      const collection = this.getCollection("quizQuestions");
      const result = await collection.deleteOne({ _id: questionId });
      return result;
    } catch (error) {
      console.error("Error deleting quiz question:", error);
      throw error;
    }
  }
}

// Create singleton instance
const databaseService = new DatabaseService();

module.exports = databaseService;
