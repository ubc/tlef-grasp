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
    
    // Validate required environment variables
    const dbName = process.env.MONGODB_DB_NAME || "grasp_db";

    // Construct MongoDB URI
    const mongodbUri = process.env.MONGODB_URI;

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
      try {
        await this.db.collection("grasp_course").dropIndex("campus_1_courseSubject_1_courseNumber_1");
      } catch (e) {
        // Legacy compound index didn't exist — fine.
      }
      await this.db.collection("grasp_question").createIndex({ questionTitle: 1 });
      await this.db.collection("grasp_question").createIndex({ courseId: 1, granularObjectiveId: 1 });
      await this.db.collection("grasp_user_course").createIndex({ userId: 1, courseId: 1 }, { unique: true });
      await this.db.collection("grasp_material").createIndex({ sourceId: 1 }, { unique: true });
      await this.db.collection("grasp_objective").createIndex({ parent: 1 });
      await this.db.collection("grasp_objective_material").createIndex({ objectiveId: 1, materialId: 1 }, { unique: true });
      await this.db.collection("grasp_objective_material").createIndex({ objectiveId: 1 });
      await this.db.collection("grasp_objective_material").createIndex({ materialId: 1 });
      await this.db.collection("grasp_quiz").createIndex({ courseId: 1 });
      await this.db.collection("grasp_quiz_question").createIndex({ quizId: 1, questionId: 1 }, { unique: true });
      await this.db.collection("grasp_quiz_question").createIndex({ quizId: 1 });
      await this.db.collection("grasp_quiz_question").createIndex({ questionId: 1 });
      // One report per student/question. The unique index makes the upsert in
      // quiz-question-flag safe even when a student submits twice at once.
      await this.db.collection("grasp_quiz_question_flag").createIndex(
        { courseId: 1, quizId: 1, questionId: 1, studentId: 1 },
        { unique: true }
      );
      await this.db.collection("grasp_quiz_question_flag").createIndex({ courseId: 1, status: 1, updatedAt: -1 });
      await this.db.collection("grasp_achievement").createIndex({ userId: 1, quizId: 1, type: 1 }, { unique: true });
      await this.db.collection("grasp_achievement").createIndex({ userId: 1 });
      await this.db.collection("grasp_achievement").createIndex({ courseId: 1 });
      await this.db.collection("grasp_achievement").createIndex({ type: 1 });
      // --- Student Performance & Attempt Tracking ---
      
      // 1. Audit Log: Tracks every individual attempt
      await this.db.collection("grasp_student_attempt").createIndex({ userId: 1 });
      await this.db.collection("grasp_student_attempt").createIndex({ quizId: 1 });
      await this.db.collection("grasp_student_attempt").createIndex({ questionId: 1 });
      await this.db.collection("grasp_student_attempt").createIndex({ learningObjectiveId: 1 });
      await this.db.collection("grasp_student_attempt").createIndex({ userId: 1, learningObjectiveId: 1 });
      // New compound indexes for efficient lookups at scale
      await this.db.collection("grasp_student_attempt").createIndex({ userId: 1, courseId: 1 });
      await this.db.collection("grasp_student_attempt").createIndex({ userId: 1, quizId: 1 });
      await this.db.collection("grasp_student_attempt").createIndex({ isFirstAttempt: 1 });

      // 2. Mastery State: Tracks current level/status per objective.
      //
      // A granular-only row has learningObjectiveId=null. A normal unique
      // compound index treats that null as a value, so the second granular
      // objective for the same student/course used to fail with E11000. Use
      // partial unique indexes so each objective namespace is unique only when
      // its identifier is actually present. createOrReplaceIndex also upgrades
      // the legacy indexes in existing databases at startup.
      const performanceCollection = this.db.collection("grasp_student_performance");
      await this.createOrReplaceIndex(
        performanceCollection,
        { userId: 1, courseId: 1, learningObjectiveId: 1 },
        {
          name: "userId_1_courseId_1_learningObjectiveId_1",
          unique: true,
          partialFilterExpression: { learningObjectiveId: { $type: "objectId" } },
        }
      );
      await this.createOrReplaceIndex(
        performanceCollection,
        { userId: 1, courseId: 1, granularObjectiveId: 1 },
        {
          name: "userId_1_courseId_1_granularObjectiveId_1",
          unique: true,
          partialFilterExpression: { granularObjectiveId: { $type: "objectId" } },
        }
      );
      await this.db.collection("grasp_student_performance").createIndex({ needsRemediation: 1 });
    
      // 3. Quiz Score: Tracks the score of the FIRST attempt per student per quiz
      await this.db.collection("grasp_quiz_score").createIndex({ userId: 1, quizId: 1 }, { unique: true });
      await this.db.collection("grasp_quiz_score").createIndex({ courseId: 1 });
      await this.db.collection("grasp_quiz_session").createIndex({ userId: 1, quizId: 1 }, { unique: true });

      // --- Per-Section Quiz Scheduling ---
      await this.db.collection("grasp_quiz_section_schedule").createIndex({ quizId: 1, courseSectionId: 1 }, { unique: true });
      await this.db.collection("grasp_quiz_section_schedule").createIndex({ courseSectionId: 1 });

      // --- Course Section Tracking ---
      await this.db.collection("grasp_course_section").createIndex({ courseId: 1, sectionId: 1 }, { unique: true });
      await this.db.collection("grasp_user_course_section").createIndex({ userId: 1, courseId: 1, sectionId: 1 }, { unique: true });
      await this.db.collection("grasp_user_course_section").createIndex({ courseId: 1, sectionId: 1 });

      console.log("✅ MongoDB collections initialized");
    } catch (error) {
      console.error("❌ Error initializing collections:", error);
    }
  }

  async createOrReplaceIndex(collection, keys, options) {
    try {
      await collection.createIndex(keys, options);
    } catch (error) {
      // MongoDB reports IndexOptionsConflict when an index with this generated
      // name already exists with the old options. Replace only that known
      // index; propagate duplicate-data and other migration failures.
      const isKnownIndexConflict = [85, 86].includes(error?.code)
        || ["IndexOptionsConflict", "IndexKeySpecsConflict"].includes(error?.codeName);
      if (!isKnownIndexConflict) {
        throw error;
      }
      await collection.dropIndex(options.name);
      await collection.createIndex(keys, options);
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
