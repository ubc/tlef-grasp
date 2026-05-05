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

    const bloomLevels = granularLearningObjective.bloom || ["Understand"];
    
    let questions = [];

    try {
      questions = await this.createContextualQuestionsBatch(
        courseId,
        courseName,
        learningObjective.objectiveId,
        learningObjective.title,
        granularLearningObjective.granularId,
        granularLearningObjective.text,
        bloomLevels,
        learningObjective.materialIds || []
      );
    } catch (error) {
      console.error(
        `❌ Failed to generate questions for objective: ${granularLearningObjective.text}`,
        error.message
      );
      throw error;
    }

    console.log(
      `Generated ${questions.length}/${bloomLevels.length} questions for objective: ${granularLearningObjective.text}`
    );
    
    if (questions.length === 0) {
      throw new Error(
        `Failed to generate any questions for objective: ${granularLearningObjective.text}.`
      );
    }
    
    return questions;
  }

  // Create contextual questions batch based on content and Bloom's taxonomy
  async createContextualQuestionsBatch(
    courseId,
    courseName,
    learningObjectiveId,
    learningObjectiveText,
    granularLearningObjectiveId,
    granularLearningObjectiveText,
    bloomLevels,
    materialIds = []
  ) {
    console.log(`Generating LLM batch questions for objective: ${learningObjectiveText}`);

    try {
        const llmResponse = await fetch('/api/rag-llm/generate-questions-with-rag', {
          method: 'POST',
          body: JSON.stringify({
            courseId: courseId,
            courseName: courseName,
            learningObjectiveId: learningObjectiveId,
            learningObjectiveText: learningObjectiveText,
            granularLearningObjectiveText: granularLearningObjectiveText,
            bloomLevels: bloomLevels,
            materialIds: materialIds,
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
        
        if (!response.questions || !Array.isArray(response.questions)) {
          throw new Error("Invalid response: questions array missing");
        }
        
        return response.questions.map((questionData, index) => {
          return {
            id: `${granularLearningObjectiveId}-${index + 1}-${Date.now()}`,
            granularObjectiveId: `${granularLearningObjectiveId}`,
            text: questionData.question,
            type: "multiple-choice",
            options: questionData.options,
            correctAnswer: questionData.correctAnswer,
            bloomLevel: bloomLevels[index] || "Understand",
            metaCode: learningObjectiveText,
            loCode: granularLearningObjectiveText,
            lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
            by: "LLM + RAG System",
            explanation: questionData.explanation,
          };
        });
    } catch (error) {
      console.error(`Error generating batch questions:`, error);
      throw error;
    }
  }


}

// Export for use in other files
window.QuestionGenerator = QuestionGenerator;
