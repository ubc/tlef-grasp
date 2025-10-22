const fs = require("fs");
const path = require("path");

class FileStorageService {
  constructor() {
    this.dataDir = path.join(__dirname, "../../data");
    this.questionsFile = path.join(this.dataDir, "quiz-questions.json");
    this.initializeStorage();
  }

  initializeStorage() {
    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Create questions file if it doesn't exist
    if (!fs.existsSync(this.questionsFile)) {
      fs.writeFileSync(this.questionsFile, JSON.stringify([]));
    }
  }

  readQuestions() {
    try {
      const data = fs.readFileSync(this.questionsFile, "utf8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error reading questions file:", error);
      return [];
    }
  }

  writeQuestions(questions) {
    try {
      fs.writeFileSync(this.questionsFile, JSON.stringify(questions, null, 2));
      return true;
    } catch (error) {
      console.error("Error writing questions file:", error);
      return false;
    }
  }

  async saveQuizQuestion(questionData) {
    try {
      const questions = this.readQuestions();
      const newQuestion = {
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...questionData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      questions.push(newQuestion);
      this.writeQuestions(questions);

      return { insertedId: newQuestion.id };
    } catch (error) {
      console.error("Error saving quiz question:", error);
      throw error;
    }
  }

  async saveQuizQuestions(questionsData) {
    try {
      const questions = this.readQuestions();
      const newQuestions = questionsData.map((question) => ({
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...question,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      questions.push(...newQuestions);
      this.writeQuestions(questions);

      return {
        insertedCount: newQuestions.length,
        insertedIds: newQuestions.map((q) => q.id),
      };
    } catch (error) {
      console.error("Error saving quiz questions:", error);
      throw error;
    }
  }

  async getQuizQuestions(filters = {}) {
    try {
      const questions = this.readQuestions();

      // Apply filters
      let filteredQuestions = questions;

      if (filters.courseName) {
        filteredQuestions = filteredQuestions.filter(
          (q) => q.courseName === filters.courseName
        );
      }

      if (filters.quizName) {
        filteredQuestions = filteredQuestions.filter(
          (q) => q.quizName === filters.quizName
        );
      }

      if (filters.status) {
        filteredQuestions = filteredQuestions.filter(
          (q) => q.status === filters.status
        );
      }

      // Sort by creation date (newest first)
      filteredQuestions.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      return filteredQuestions;
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
      const questions = this.readQuestions();
      const questionIndex = questions.findIndex((q) => q.id === questionId);

      if (questionIndex === -1) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      questions[questionIndex] = {
        ...questions[questionIndex],
        ...updateData,
        updatedAt: new Date().toISOString(),
      };

      this.writeQuestions(questions);

      return { matchedCount: 1, modifiedCount: 1 };
    } catch (error) {
      console.error("Error updating quiz question:", error);
      throw error;
    }
  }

  async deleteQuizQuestion(questionId) {
    try {
      const questions = this.readQuestions();
      const initialLength = questions.length;
      const filteredQuestions = questions.filter((q) => q.id !== questionId);

      if (filteredQuestions.length === initialLength) {
        return { deletedCount: 0 };
      }

      this.writeQuestions(filteredQuestions);

      return { deletedCount: 1 };
    } catch (error) {
      console.error("Error deleting quiz question:", error);
      throw error;
    }
  }
}

// Create singleton instance
const fileStorageService = new FileStorageService();

module.exports = fileStorageService;
