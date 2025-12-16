// LLM Service - Singleton pattern
// Handles all LLM operations for question generation

class LLMService {
  constructor() {
    if (LLMService.instance) {
      return LLMService.instance;
    }

    this.LLMModule = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.provider = process.env.LLM_PROVIDER || 'ollama';

    // Initialize on first instantiation
    this.initializationPromise = this.initializeLLM();

    LLMService.instance = this;
  }

  async initializeLLM() {
    try {
      console.log("Initializing LLM Service on server...");

      // Import LLM module dynamically
      const llmModule = await import("ubc-genai-toolkit-llm");

      // Try different ways to access the module
      this.LLMModule =
        llmModule.LLMModule || llmModule.default?.LLMModule || llmModule.default;

      if (!this.LLMModule) {
        throw new Error("LLMModule not found in ubc-genai-toolkit-llm");
      }

      console.log("✅ LLM Service initialized successfully");
      this.isInitialized = true;
    } catch (error) {
      console.error("❌ LLM Service initialization failed:", error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Get LLM instance with proper configuration
   * @returns {Promise<Object>} LLM instance
   */
  async getLLMInstance() {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }

    if (!this.isInitialized || !this.LLMModule) {
      throw new Error("LLM service not initialized");
    }

    // Import ConsoleLogger for LLM config
    const coreModule = await import("ubc-genai-toolkit-core");
    const ConsoleLogger =
      coreModule.ConsoleLogger ||
      coreModule.default?.ConsoleLogger ||
      coreModule.default;

    // Build config based on provider
    let llmConfig;
    
    if (this.provider === 'openai') {
      llmConfig = {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        defaultOptions: {
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
          maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000
        },
        logger: new ConsoleLogger('LLM'),
      };
    } else {
      // Ollama (local LLM)
      llmConfig = {
        provider: 'ollama',
        endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
        defaultModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
        defaultOptions: {
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
          maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 2000
        },
        logger: new ConsoleLogger('LLM'),
      };
    }

    // LLMModule uses constructor, not static create method
    return new this.LLMModule(llmConfig);
  }  

  /**
   * Generate a summary from course materials
   * @param {string} course - Course name
   * @param {Array} files - Array of file objects with content
   * @param {Array} urls - Array of URL objects
   * @returns {Promise<string>} Generated summary
   */
  async generateSummary(course, files, urls) {
    try {
      // Combine content from files and URLs
      let combinedContent = "";

      // Add file contents
      if (files && Array.isArray(files)) {
        files.forEach((file) => {
          if (file.content) {
            combinedContent += file.content + "\n\n";
          }
        });
      }

      // Add URLs
      if (urls && Array.isArray(urls)) {
        urls.forEach((url) => {
          combinedContent += `URL: ${url.url}\n\n`;
        });
      }

      // Get LLM instance
      const llm = await this.getLLMInstance();

      // Generate summary prompt
      const prompt = `Generate a comprehensive summary of the following course materials for "${course}".

${combinedContent}

Please provide a detailed summary that:
1. Identifies key concepts and topics
2. Highlights important information
3. Organizes content logically
4. Is suitable for generating educational questions

Summary:`;

      const response = await llm.sendMessage(prompt);
      return response.content || response.text || response;
    } catch (error) {
      console.error("Summary generation failed:", error);
      throw error;
    }
  }

  /**
   * Generate questions from course content and objectives
   * @param {string} course - Course name
   * @param {string} summary - Course content summary
   * @param {Array} objectiveGroups - Array of objective groups
   * @returns {Promise<Array>} Generated questions
   */
  async generateQuestions(course, summary, objectiveGroups) {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }

    if (!this.isInitialized || !this.LLMModule) {
      throw new Error("LLM service not initialized");
    }

    try {
      // Get LLM instance
      const llm = await this.getLLMInstance();

      // Build questions for each objective group
      const allQuestions = [];

      for (const group of objectiveGroups) {
        for (const item of group.items) {
          // Generate questions for this granular objective
          const count = item.count || 2;
          const bloomLevels = item.bloom && item.bloom.length > 0 
            ? item.bloom.join(", ") 
            : "Understand";

          const prompt = `Generate ${count} multiple-choice question(s) for the following learning objective:

Course: ${course}
Learning Objective: ${item.text}
Bloom's Taxonomy Level(s): ${bloomLevels}

Course Content Summary:
${summary}

For each question, provide:
1. A clear, specific question text
2. Four answer options (A, B, C, D)
3. The correct answer (A, B, C, or D)
4. An explanation for why the correct answer is correct
5. Bloom's taxonomy level
6. Difficulty level (easy, medium, hard)

Format the response as JSON array with the following structure:
[
  {
    "text": "Question text here",
    "options": {
      "A": "Option A text",
      "B": "Option B text",
      "C": "Option C text",
      "D": "Option D text"
    },
    "correctAnswer": 0,
    "explanation": "Explanation here",
    "bloomLevel": "Understand",
    "difficulty": "medium",
    "metaCode": "${group.title}",
    "loCode": "${item.text}"
  }
]`;

          try {
            const response = await llm.sendMessage(prompt);
            const responseText = response.content || response.text || response;
            
            // Parse JSON response
            let questions;
            try {
              // Try to extract JSON from markdown code blocks if present
              const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                                responseText.match(/```\s*([\s\S]*?)\s*```/);
              const jsonText = jsonMatch ? jsonMatch[1] : responseText;
              questions = JSON.parse(jsonText);
            } catch (parseError) {
              console.error("Failed to parse LLM response as JSON:", parseError);
              // Create a fallback question
              questions = [{
                text: item.text + " - Question",
                options: {
                  A: "Option A",
                  B: "Option B",
                  C: "Option C",
                  D: "Option D"
                },
                correctAnswer: 0,
                explanation: "Generated from learning objective",
                bloomLevel: bloomLevels.split(", ")[0] || "Understand",
                difficulty: "medium",
                metaCode: group.title,
                loCode: item.text
              }];
            }

            // Ensure questions is an array
            if (!Array.isArray(questions)) {
              questions = [questions];
            }

            // Add metadata and format questions
            questions.forEach((q, index) => {
              allQuestions.push({
                id: `${group.id}-${item.id}-${index}`,
                text: q.text,
                options: q.options,
                correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 0,
                explanation: q.explanation || "",
                bloomLevel: q.bloomLevel || bloomLevels.split(", ")[0] || "Understand",
                difficulty: q.difficulty || "medium",
                metaCode: q.metaCode || group.title,
                loCode: q.loCode || item.text,
                status: "Generated",
                lastEdited: new Date().toISOString(),
                by: "LLM"
              });
            });
          } catch (itemError) {
            console.error(`Error generating questions for objective ${item.id}:`, itemError);
            // Continue with next objective
          }
        }
      }

      return allQuestions;
    } catch (error) {
      console.error("Question generation failed:", error);
      throw error;
    }
  }

  /**
   * Check if the service is initialized
   * @returns {boolean}
   */
  isReady() {
    return this.isInitialized && !!this.LLMModule;
  }
}

// Export singleton instance
module.exports = new LLMService();
