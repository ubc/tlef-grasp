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
          objective,
          content,
          bloomLevel
        ) => {
          console.log('Generating multiple choice question...', {
            objective,
            content,
            bloomLevel,
          });
          console.log("=== CALLING SERVER-SIDE RAG + LLM ===");

          try {
            const response = await fetch("/api/rag-llm/generate-with-rag", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                objective: objective,
                content: content,
                bloomLevel: bloomLevel,
                course: window.state?.course || "CHEM 121",
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
              return JSON.stringify(data.question);
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

      // Generate questions using RAG-enhanced content
      const questions = await this.generateRAGEnhancedQuestions(
        course,
        objectiveGroups
      );

      console.log("=== QUESTION GENERATOR RESULT ===");
      console.log("Generated questions count:", questions.length);
      console.log("Questions:", questions);

      return questions;
    } catch (error) {
      console.error("Failed to generate questions:", error);
      throw error;
    }
  }

  // Generate questions using RAG-enhanced content analysis
  async generateRAGEnhancedQuestions(course, objectiveGroups) {
    console.log("=== RAG-ENHANCED QUESTIONS DEBUG ===");
    console.log("Starting RAG-enhanced question generation");
    console.log("Objective groups:", objectiveGroups.length);

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
            course,
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
          throw error; // Re-throw to stop generation and show error in UI
        }
      }
    }

    console.log(
      `Total questions generated from objectives: ${allQuestions.length}`
    );

    // If no objectives, throw error
    if (allQuestions.length === 0) {
      throw new Error(
        "No learning objectives found. Please add objectives to generate questions."
      );
    }

    console.log(`Final question count: ${allQuestions.length}`);
    return allQuestions;
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

  getMockQuestions() {
    return [
      {
        id: 1,
        text: "What is the primary function of a catalyst in a chemical reaction?",
        type: "multiple-choice",
        options: [
          "To increase the activation energy",
          "To decrease the activation energy",
          "To change the equilibrium constant",
          "To increase the temperature",
        ],
        correctAnswer: 1,
        bloomLevel: "Understand",
        difficulty: "Medium",
      },
      {
        id: 2,
        text: "Which of the following best describes an exothermic reaction?",
        type: "multiple-choice",
        options: [
          "A reaction that absorbs heat from the surroundings",
          "A reaction that releases heat to the surroundings",
          "A reaction that requires continuous heating",
          "A reaction that occurs only at high temperatures",
        ],
        correctAnswer: 1,
        bloomLevel: "Remember",
        difficulty: "Easy",
      },
    ];
  }

  // Generate questions for specific objectives using enhanced content analysis
  async generateQuestionsForObjective(course, learningObjective, granularLearningObjective) {
    console.log(
      `=== GENERATING QUESTIONS FOR OBJECTIVE: ${granularLearningObjective.text} ===`
    );

    const questions = [];

    // Get comprehensive content for this objective
    let relevantContent = "";

    // Try RAG first if available
    console.log("RAG available:", this.contentGenerator.isRAGAvailable());
    if (this.contentGenerator.isRAGAvailable()) {
      try {
        const query = `Generate questions about learning objective: ${learningObjective.title} - ${granularLearningObjective.text} for ${course}`;
        console.log("RAG query:", query);
        let relevantChunks = await this.contentGenerator.searchKnowledgeBase(
          query,
          10
        );

        // Get course materials attached to learning objective.
        const courseMaterials = await fetch(`/api/objective/${learningObjective.objectiveId}/materials`);
        const courseMaterialsData = await courseMaterials.json();

        console.log("Relevant chunks:", relevantChunks);
        console.log("Course materials:", courseMaterialsData);

        // Filter relevant chunks to only include chunks from course materials.
        if ( courseMaterialsData.success && courseMaterialsData.materials && courseMaterialsData.materials.length > 0 ) {
          relevantChunks = relevantChunks.filter((chunk) => {
            return courseMaterialsData.materials.some((material) => material.sourceId === chunk.metadata.sourceId);
          });
        } else {
          console.log("No course materials found");
        }

        console.log(
          "RAG chunks found:",
          relevantChunks ? relevantChunks.length : 0
        );
        if (relevantChunks && relevantChunks.length > 0) {
          relevantContent = relevantChunks
            .map((chunk) => chunk.content)
            .join("\n\n");
          console.log("Using RAG content for objective:", granularLearningObjective.text);
          console.log("RAG content length:", relevantContent.length);
        }
      } catch (error) {
        console.warn("RAG search failed, using enhanced local content:", error);
      }
    } else {
      console.log("RAG not available, using local content only");
    }



    console.log("Final content length:", relevantContent.length);
    console.log("Objective count:", granularLearningObjective.count);
    console.log("Bloom levels:", granularLearningObjective.bloom);

    // Generate different types of questions based on Bloom's taxonomy
    const bloomLevels = granularLearningObjective.bloom || ["Understand"];

    for (let i = 0; i < granularLearningObjective.count; i++) {
      const bloomLevel = bloomLevels[i % bloomLevels.length];
      console.log(
        `Creating question ${i + 1}/${
          granularLearningObjective.count
        } with Bloom level: ${bloomLevel}`
      );

      const question = await this.createContextualQuestion(
        granularLearningObjective.text,
        relevantContent,
        bloomLevel,
        granularLearningObjective.granularId,
        learningObjective.title,
        i + 1
      );

      console.log(`Created question ${i + 1}:`, question.text);
      questions.push(question);
    }

    console.log(
      `Generated ${questions.length} questions for objective: ${granularLearningObjective.text}`
    );
    return questions;
  }

  // Create a contextual question based on content and Bloom's taxonomy
  async createContextualQuestion(
    objectiveText,
    content,
    bloomLevel,
    objectiveId,
    groupTitle,
    questionNumber
  ) {
    // Use LLM service
    if (this.llmService && this.llmService.isAvailable()) {
      console.log(`Generating LLM question for objective: ${objectiveText}`);
      const llmResponse = await this.llmService.generateMultipleChoiceQuestion(
        objectiveText,
        content,
        bloomLevel
      );

      // Parse LLM response
      const questionData = JSON.parse(llmResponse);

      return {
        id: `${objectiveId}-${questionNumber}`,
        granularObjectiveId: `${objectiveId}`,
        text: questionData.question,
        type: "multiple-choice",
        options: questionData.options,
        correctAnswer: questionData.correctAnswer,
        bloomLevel: bloomLevel,
        difficulty: this.determineDifficulty(bloomLevel),
        metaCode: groupTitle,
        loCode: objectiveText,
        lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
        by: "LLM + RAG System",
        explanation: questionData.explanation,
      };
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

  // Extract examples from content
  extractExamplesForQuestion(content) {
    const examples = [];

    // Look for example patterns
    const examplePatterns = [
      /for example[:\s]+([^.!?]{10,100})/gi,
      /such as[:\s]+([^.!?]{10,100})/gi,
      /including[:\s]+([^.!?]{10,100})/gi,
      /e\.g\.[:\s]+([^.!?]{10,100})/gi,
    ];

    examplePatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          const example = match
            .replace(/^(for example|such as|including|e\.g\.)[:\s]+/i, "")
            .trim();
          if (example.length > 10 && example.length < 100) {
            examples.push(example);
          }
        });
      }
    });

    return [...new Set(examples)].slice(0, 3);
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

  // Check if a word is common
  isCommonWord(word) {
    const commonWords = [
      "This",
      "That",
      "With",
      "From",
      "They",
      "Have",
      "Been",
      "Will",
      "Were",
      "Said",
      "The",
      "And",
      "For",
      "Are",
      "But",
      "Not",
      "You",
      "All",
      "Can",
      "Had",
      "Her",
      "Was",
      "One",
      "Our",
      "Out",
      "Day",
      "Get",
      "Has",
      "Him",
      "His",
      "How",
      "Man",
      "New",
      "Now",
      "Old",
      "See",
      "Two",
      "Way",
      "Who",
      "Boy",
      "Did",
      "Its",
      "Let",
      "Put",
      "Say",
      "She",
      "Too",
      "Use",
    ];
    return commonWords.includes(word);
  }

  getMockQuestionsForObjective(objective) {
    return [
      {
        id: Date.now() + Math.random(),
        text: `Sample question for: ${objective.text}`,
        type: "multiple-choice",
        options: ["Option A", "Option B", "Option C", "Option D"],
        correctAnswer: 0,
        bloomLevel: objective.bloom[0] || "Understand",
        difficulty: "Medium",
        objectiveId: objective.id,
      },
    ];
  }

  // Generate questions with specific Bloom's taxonomy levels
  async generateQuestionsByBloomLevel(course, bloomLevel, count = 5) {
    try {
      let content;

      if (this.contentGenerator.isRAGAvailable()) {
        const query = `Generate ${count} ${bloomLevel} level questions for ${course}`;
        const relevantChunks = await this.contentGenerator.searchKnowledgeBase(
          query,
          10
        );
        const context = relevantChunks
          .map((chunk) => chunk.content)
          .join("\n\n");

        content = `Course: ${course}\nBloom Level: ${bloomLevel}\nContext: ${context}\n\nGenerate ${count} multiple choice questions at the ${bloomLevel} level.`;
      } else {
        content = `Course: ${course}\nBloom Level: ${bloomLevel}\n\nGenerate ${count} multiple choice questions at the ${bloomLevel} level.`;
      }

      const response = await fetch("/api/question/generate-questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: content,
          course: course,
          bloomLevel: bloomLevel,
          count: count,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.questions;
      } else {
        throw new Error("Failed to generate questions by Bloom level");
      }
    } catch (error) {
      console.error("Bloom level question generation failed:", error);
      return this.getMockQuestionsByBloomLevel(bloomLevel, count);
    }
  }

  getMockQuestionsByBloomLevel(bloomLevel, count) {
    const questions = [];
    for (let i = 0; i < count; i++) {
      questions.push({
        id: Date.now() + Math.random() + i,
        text: `Sample ${bloomLevel} question ${i + 1}`,
        type: "multiple-choice",
        options: ["Option A", "Option B", "Option C", "Option D"],
        correctAnswer: 0,
        bloomLevel: bloomLevel,
        difficulty: "Medium",
      });
    }
    return questions;
  }

  // Validate question quality
  validateQuestion(question) {
    const issues = [];

    if (!question.text || question.text.length < 10) {
      issues.push("Question text is too short");
    }

    if (!question.options || question.options.length < 2) {
      issues.push("Question needs at least 2 options");
    }

    if (
      question.correctAnswer === undefined ||
      question.correctAnswer === null
    ) {
      issues.push("Question needs a correct answer");
    }

    if (!question.bloomLevel) {
      issues.push("Question needs a Bloom's taxonomy level");
    }

    return {
      isValid: issues.length === 0,
      issues: issues,
    };
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
      csv += `"${q.text}","${q.options[0]}","${q.options[1]}","${
        q.options[2]
      }","${q.options[3]}","${q.options[q.correctAnswer]}","${q.bloomLevel}","${
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
            ${q.options
              .map(
                (option, optIndex) => `
            <response_label ident="choice${optIndex}">
              <material>
                <mattext>${option}</mattext>
              </material>
            </response_label>
            `
              )
              .join("")}
          </render_choice>
        </response_lid>
      </presentation>
      <resprocessing>
        <outcomes>
          <decvar varname="SCORE" vartype="Decimal" defaultval="0"/>
        </outcomes>
        <respcondition continue="No">
          <conditionvar>
            <varequal respident="response1">choice${q.correctAnswer}</varequal>
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
