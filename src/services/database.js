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
    const dbName = process.env.MONGODB_DB_NAME || "grasp_db";

    // Define local and remote MongoDB URIs
    const localUri = "mongodb://localhost:27017";
    const remoteUri = process.env.MONGODB_URI;

    // Connection options with shorter timeout for faster fallback
    const connectionOptions = {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    };

    // Try local MongoDB first (faster if available)
    if (localUri) {
      try {
        console.log("Attempting to connect to local MongoDB...");
        this.client = new MongoClient(localUri, connectionOptions);
        await this.client.connect();
        this.db = this.client.db(dbName);
        this.isConnected = true;
        this.connectionUri = localUri;
        this.connectionType = "local";

        console.log("✅ Connected to local MongoDB");
        await this.initializeCollections();
        return this.db;
      } catch (localError) {
        console.log(
          `⚠️  Local MongoDB connection failed: ${localError.message}`
        );
        // Close the failed connection attempt
        if (this.client) {
          try {
            await this.client.close();
          } catch (closeError) {
            // Ignore close errors
          }
          this.client = null;
        }
      }
    }

    // Fallback to remote MongoDB if local failed
    if (remoteUri) {
      try {
        console.log("Attempting to connect to remote MongoDB...");
        this.client = new MongoClient(remoteUri, connectionOptions);
        await this.client.connect();
        this.db = this.client.db(dbName);
        this.isConnected = true;
        this.connectionUri = remoteUri;
        this.connectionType = "remote";

        console.log("✅ Connected to remote MongoDB");
        await this.initializeCollections();
        return this.db;
      } catch (remoteError) {
        console.error(
          "❌ Remote MongoDB connection error:",
          remoteError.message
        );
        // Close the failed connection attempt
        if (this.client) {
          try {
            await this.client.close();
          } catch (closeError) {
            // Ignore close errors
          }
          this.client = null;
        }
        throw new Error(
          `Failed to connect to both local and remote MongoDB. Last error: ${remoteError.message}`
        );
      }
    } else {
      // No remote URI configured and local failed
      throw new Error(
        "No MongoDB URI configured and local connection failed. Please set MONGODB_URI in your .env file."
      );
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
