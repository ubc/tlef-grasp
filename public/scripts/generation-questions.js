// Generation Questions Module
// Handles question generation based on content and objectives

// Question Generation Class
class QuestionGenerator {
  constructor(contentGenerator) {
    this.contentGenerator = contentGenerator;
  }


  async generateQuestions(course, objectiveGroups) {
    try {
      console.log("=== QUESTION GENERATOR DEBUG ===");
      console.log(
        "Generating questions using RAG-enhanced content analysis..."
      );
      console.log("Input parameters:", {
        course,
        objectiveGroupsCount: objectiveGroups.length,
        contentGeneratorAvailable: !!this.contentGenerator,
      });

      const allQuestions = [];

      for (const learningObjective of objectiveGroups) {
        console.log(
          `Processing group: ${learningObjective.title} with ${learningObjective.items.length} items`
        );
  
        for (const granularLearningObjective of learningObjective.items) {
          console.log(`Processing objective: ${granularLearningObjective.text}`);
  
          try {
            // Generate questions for this specific objective using RAG
            const objectiveQuestions = await this.generateQuestionsForObjective(
              course.name || course.courseName || '',
              learningObjective,
              granularLearningObjective,
              course.id || course._id
            );
  
            console.log(
              `Generated ${objectiveQuestions.length} questions for objective: ${granularLearningObjective.text}`
            );
            allQuestions.push(...objectiveQuestions);
          } catch (error) {
            console.error(
              `Failed to generate questions for objective: ${granularLearningObjective.text}`,
              error
            );
            // Continue with other objectives instead of stopping completely
            // Only throw if we have no questions at all
            if (allQuestions.length === 0) {
              throw error; // Re-throw only if this is the first objective and it failed completely
            } else {
              console.warn(
                `⚠️ Continuing with ${allQuestions.length} questions already generated despite failure for: ${granularLearningObjective.text}`
              );
            }
          }
        }
      }

      console.log("=== QUESTION GENERATOR RESULT ===");
      console.log("Generated questions count:", allQuestions.length);
      console.log("Questions:", allQuestions);

      return allQuestions;
    } catch (error) {
      console.error("Failed to generate questions:", error);
      throw error;
    }
  }
  // Generate questions for specific objectives using enhanced content analysis
  async generateQuestionsForObjective(courseName, learningObjective, granularLearningObjective, courseId) {
    console.log(
      `=== GENERATING QUESTIONS FOR OBJECTIVE: ${granularLearningObjective.text} ===`
    );

    const questions = [];
    const failedQuestions = [];

    // Get comprehensive content for this objective
    // Generate different types of questions based on Bloom's taxonomy
    const bloomLevels = granularLearningObjective.bloom || ["Understand"];

    for (let i = 0; i < granularLearningObjective.count; i++) {
      const bloomLevel = bloomLevels[i % bloomLevels.length];
      console.log(
        `Creating question ${i + 1}/${
          granularLearningObjective.count
        } with Bloom level: ${bloomLevel}`
      );

      let question = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      // Retry logic for individual question generation
      while (retryCount < maxRetries && !question) {
        try {
            question = await this.createContextualQuestion(
              courseId,
              courseName,
              learningObjective.objectiveId,
              learningObjective.title,
              granularLearningObjective.granularId,
              granularLearningObjective.text,
              bloomLevel,
              i + 1,
              learningObjective.materialIds || [],
              questions
            );

          console.log(`✅ Created question ${i + 1}:`, question.text);
          questions.push(question);
          
          // Add a small delay between questions to avoid rate limiting
          if (i < granularLearningObjective.count - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          retryCount++;
          console.warn(
            `⚠️ Failed to generate question ${i + 1} (attempt ${retryCount}/${maxRetries}):`,
            error.message
          );
          
          if (retryCount < maxRetries) {
            // Wait before retrying (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error(
              `❌ Failed to generate question ${i + 1} after ${maxRetries} attempts:`,
              error.message
            );
            failedQuestions.push({
              questionNumber: i + 1,
              bloomLevel: bloomLevel,
              error: error.message
            });
            // Continue with next question instead of stopping
          }
        }
      }
    }

    console.log(
      `Generated ${questions.length}/${granularLearningObjective.count} questions for objective: ${granularLearningObjective.text}`
    );
    
    if (failedQuestions.length > 0) {
      console.warn(
        `⚠️ Failed to generate ${failedQuestions.length} question(s):`,
        failedQuestions
      );
    }
    
    // If we got at least some questions, return them. Otherwise throw error.
    if (questions.length === 0) {
      throw new Error(
        `Failed to generate any questions for objective: ${granularLearningObjective.text}. All ${granularLearningObjective.count} attempts failed.`
      );
    }
    
    return questions;
  }

  // Create a contextual question based on content and Bloom's taxonomy
  async createContextualQuestion(
    courseId,
    courseName,
    learningObjectiveId,
    learningObjectiveText,
    granularLearningObjectiveId,
    granularLearningObjectiveText,
    bloomLevel,
    questionNumber,
    materialIds = [],
    existingQuestions = []
  ) {
    console.log(`Generating LLM question for objective: ${learningObjectiveText}`);

    try {
        const llmResponse = await fetch('/api/rag-llm/generate-questions-with-rag', {
          method: 'POST',
          body: JSON.stringify({
            courseId: courseId,
            courseName: courseName,
            learningObjectiveId: learningObjectiveId,
            learningObjectiveText: learningObjectiveText,
            granularLearningObjectiveText: granularLearningObjectiveText,
            bloomLevel: bloomLevel,
            materialIds: materialIds,
            existingQuestions: existingQuestions.map(q => q.text),
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!llmResponse.ok) {
          const errorText = await llmResponse.text().catch(() => 'Unknown error');
          console.error(`Server error ${llmResponse.status}:`, errorText);
          throw new Error(`Server error: ${llmResponse.status} - ${errorText}`);
        }
        
        const response = await llmResponse.json();
        
        if (!response.success) {
          throw new Error(
            response.error || "Question generation service is currently unavailable"
          );
        }
        
        if (!response.question) {
          throw new Error("Invalid response: question data missing");
        }
        
        const questionData = response.question;

        return {
          id: `${granularLearningObjectiveId}-${questionNumber}`,
          granularObjectiveId: `${granularLearningObjectiveId}`,
          text: questionData.question,
          type: "multiple-choice",
          options: questionData.options,
          correctAnswer: questionData.correctAnswer,
          bloomLevel: bloomLevel,
          metaCode: learningObjectiveText,
          loCode: granularLearningObjectiveText,
          lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
          by: "LLM + RAG System",
          explanation: questionData.explanation,
        };
    } catch (error) {
      console.error(`Error generating question ${questionNumber}:`, error);
      throw error;
    }
  }


}

// Export for use in other files
window.QuestionGenerator = QuestionGenerator;
