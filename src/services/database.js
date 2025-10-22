const { MongoClient } = require("mongodb");

class DatabaseService {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
      const dbName = process.env.MONGODB_DB_NAME || "grasp_db";

      this.client = new MongoClient(mongoUri);
      await this.client.connect();
      this.db = this.client.db(dbName);
      this.isConnected = true;

      console.log("✅ Connected to MongoDB");

      // Create collections if they don't exist
      await this.initializeCollections();

      return this.db;
    } catch (error) {
      console.error("❌ MongoDB connection error:", error);
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
