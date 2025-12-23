// Generation Questions Module
// Handles question generation based on content and objectives

// Question Generation Class
class QuestionGenerator {
  constructor(contentGenerator) {
    this.contentGenerator = contentGenerator;
    this.llmService = null;
    this.initializeLLMService();
  }

  async initializeLLMService() {
    try {
      console.log("=== QUESTION GENERATOR LLM INITIALIZATION ===");

      // Use server-side RAG + LLM endpoint
      this.llmService = {
        isAvailable: () => true,
        generateMultipleChoiceQuestion: async (
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevel
        ) => {
          console.log('Generating multiple choice question...', {
            courseName: courseName,
            learningObjectiveId: learningObjectiveId,
            learningObjectiveText: learningObjectiveText,
            granularLearningObjectiveText: granularLearningObjectiveText,
            bloomLevel: bloomLevel,
          });
          console.log("=== CALLING SERVER-SIDE RAG + LLM ===");

          try {
            const response = await fetch("/api/rag-llm/generate-questions-with-rag", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                courseName: courseName,
                learningObjectiveId: learningObjectiveId,
                learningObjectiveText: learningObjectiveText,
                granularLearningObjectiveText: granularLearningObjectiveText,
                bloomLevel: bloomLevel,
              }),
            });

            if (!response.ok) {
              const errorText = await response
                .text()
                .catch(() => "Unknown error");
              console.error(`Server error ${response.status}:`, errorText);
              throw new Error(
                `Server error: ${response.status} - ${errorText}`
              );
            }

            const data = await response.json();
            console.log("✅ Server-side RAG + LLM response:", data);

            if (data.success) {
              return JSON.stringify(data.questions);
            } else {
              throw new Error(
                data.error ||
                  "Question generation service is currently unavailable"
              );
            }
          } catch (error) {
            console.error("❌ Server-side RAG + LLM failed:", error);
            throw error;
          }
        },
      };

      console.log("✅ Server-side RAG + LLM service initialized");
    } catch (error) {
      console.error("❌ Failed to initialize LLM service:", error);
      this.llmService = null;
    }
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
        ragAvailable: this.contentGenerator
          ? this.contentGenerator.isRAGAvailable()
          : false,
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
              course.name || '',
              learningObjective,
              granularLearningObjective
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

  prepareContentForQuestions(summary, objectiveGroups) {
    let content = `Summary: ${summary}\n\n`;
    content += `Objectives:\n`;
    objectiveGroups.forEach((group) => {
      group.items.forEach((item) => {
        content += `- ${item.text} (${item.bloom.join(", ")}) Min: ${
          item.minQuestions
        }, Count: ${item.count}\n`;
      });
    });
    content += `\nGenerate multiple choice questions based on this content.`;

    return content;
  }

  // Generate questions for specific objectives using enhanced content analysis
  async generateQuestionsForObjective(courseName, learningObjective, granularLearningObjective) {
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
            courseName,
            learningObjective.objectiveId,
            learningObjective.title,
            granularLearningObjective.granularId,
            granularLearningObjective.text,
            bloomLevel,
            i + 1
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
    courseName,
    learningObjectiveId,
    learningObjectiveText,
    granularLearningObjectiveId,
    granularLearningObjectiveText,
    bloomLevel,
    questionNumber
  ) {
    // Use LLM service
    if (this.llmService && this.llmService.isAvailable()) {
      console.log(`Generating LLM question for objective: ${learningObjectiveText}`);
      
      try {
        const llmResponse = await fetch('/api/rag-llm/generate-questions-with-rag', {
          method: 'POST',
          body: JSON.stringify({
            courseName: courseName,
            learningObjectiveId: learningObjectiveId,
            learningObjectiveText: learningObjectiveText,
            granularLearningObjectiveText: granularLearningObjectiveText,
            bloomLevel: bloomLevel,
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
          difficulty: this.determineDifficulty(bloomLevel),
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
    } else {
      throw new Error("Question generation service is currently unavailable");
    }
  }

  // Extract key concepts from content for question generation
  extractKeyConceptsForQuestion(content) {
    const concepts = [];

    // Look for capitalized terms and technical concepts
    const capitalizedWords =
      content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

    capitalizedWords.forEach((word) => {
      if (word.length > 3 && !this.isCommonWord(word)) {
        concepts.push(word);
      }
    });

    return [...new Set(concepts)].slice(0, 5);
  }

  // Determine difficulty based on Bloom's taxonomy
  determineDifficulty(bloomLevel) {
    const difficultyMap = {
      remember: "Easy",
      understand: "Easy",
      apply: "Medium",
      analyze: "Medium",
      evaluate: "Hard",
      create: "Hard",
    };

    return difficultyMap[bloomLevel.toLowerCase()] || "Medium";
  }

  // Format questions for export
  formatQuestionsForExport(questions, format = "json") {
    switch (format) {
      case "csv":
        return this.formatAsCSV(questions);
      case "qti":
        return this.formatAsQTI(questions);
      case "json":
      default:
        return JSON.stringify(questions, null, 2);
    }
  }

  formatAsCSV(questions) {
    let csv =
      "Question,Option A,Option B,Option C,Option D,Correct Answer,Bloom Level,Difficulty\n";
    questions.forEach((q) => {
      // Options are always objects with keys A, B, C, D
      const optA = q.options?.A || '';
      const optB = q.options?.B || '';
      const optC = q.options?.C || '';
      const optD = q.options?.D || '';
      // correctAnswer is always a letter (A, B, C, D)
      const correctAnswerLetter = typeof q.correctAnswer === 'string' 
        ? q.correctAnswer.toUpperCase() 
        : (typeof q.correctAnswer === 'number' ? ['A', 'B', 'C', 'D'][q.correctAnswer] : 'A');
      const correctOpt = q.options?.[correctAnswerLetter] || '';
      csv += `"${q.text}","${optA}","${optB}","${optC}","${optD}","${correctOpt}","${q.bloomLevel}","${
        q.difficulty
      }"\n`;
    });
    return csv;
  }

  formatAsQTI(questions) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="GRASP_QUESTIONS" title="Generated Questions">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>qmd_timelimit</fieldlabel>
        <fieldentry>PT30M</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
    ${questions
      .map(
        (q, index) => `
    <item ident="q${index + 1}">
      <itemmetadata>
        <qtimetadata>
          <qtimetadatafield>
            <fieldlabel>qmd_itemtype</fieldlabel>
            <fieldentry>Multiple Choice</fieldentry>
          </qtimetadatafield>
        </qtimetadata>
      </itemmetadata>
      <presentation>
        <material>
          <mattext>${q.text}</mattext>
        </material>
        <response_lid ident="response1">
          <render_choice>
            ${['A', 'B', 'C', 'D'].map((key, optIndex) => `
            <response_label ident="choice${optIndex}">
              <material>
                <mattext>${q.options?.[key] || ''}</mattext>
              </material>
            </response_label>
            `).join("")}
          </render_choice>
        </response_lid>
      </presentation>
      <resprocessing>
        <outcomes>
          <decvar varname="SCORE" vartype="Decimal" defaultval="0"/>
        </outcomes>
        <respcondition continue="No">
          <conditionvar>
            <varequal respident="response1">choice${(() => {
              // Convert letter to index (0-3) for QTI format
              if (typeof q.correctAnswer === 'string') {
                const letter = q.correctAnswer.toUpperCase();
                if (letter === 'A') return 0;
                if (letter === 'B') return 1;
                if (letter === 'C') return 2;
                if (letter === 'D') return 3;
              } else if (typeof q.correctAnswer === 'number') {
                return q.correctAnswer;
              }
              return 0;
            })()}</varequal>
          </conditionvar>
          <setvar action="Set">1</setvar>
        </respcondition>
      </resprocessing>
    </item>
    `
      )
      .join("")}
  </assessment>
</questestinterop>`;
  }
}

// Export for use in other files
window.QuestionGenerator = QuestionGenerator;
