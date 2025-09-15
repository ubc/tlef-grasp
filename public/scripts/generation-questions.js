// Generation Questions Module
// Handles question generation based on content and objectives

// Question Generation Class
class QuestionGenerator {
  constructor(contentGenerator) {
    this.contentGenerator = contentGenerator;
  }

  async generateQuestions(course, summary, objectiveGroups) {
    try {
      console.log("=== QUESTION GENERATOR DEBUG ===");
      console.log(
        "Generating questions using RAG-enhanced content analysis..."
      );
      console.log("Input parameters:", {
        course,
        summaryLength: summary.length,
        objectiveGroupsCount: objectiveGroups.length,
        contentGeneratorAvailable: !!this.contentGenerator,
        ragAvailable: this.contentGenerator
          ? this.contentGenerator.isRAGAvailable()
          : false,
      });

      // Generate questions using RAG-enhanced content
      const questions = await this.generateRAGEnhancedQuestions(
        course,
        summary,
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
  async generateRAGEnhancedQuestions(course, summary, objectiveGroups) {
    console.log("=== RAG-ENHANCED QUESTIONS DEBUG ===");
    console.log("Starting RAG-enhanced question generation");
    console.log("Objective groups:", objectiveGroups.length);

    const allQuestions = [];

    for (const group of objectiveGroups) {
      console.log(
        `Processing group: ${group.title} with ${group.items.length} items`
      );

      for (const objective of group.items) {
        console.log(`Processing objective: ${objective.text}`);

        try {
          // Generate questions for this specific objective using RAG
          const objectiveQuestions = await this.generateQuestionsForObjective(
            course,
            summary,
            objective,
            group.title
          );

          console.log(
            `Generated ${objectiveQuestions.length} questions for objective: ${objective.text}`
          );
          allQuestions.push(...objectiveQuestions);
        } catch (error) {
          console.error(
            `Failed to generate questions for objective: ${objective.text}`,
            error
          );
          // Add fallback question
          const fallbackQuestion = this.createFallbackQuestion(
            objective,
            group.title
          );
          console.log("Created fallback question:", fallbackQuestion);
          allQuestions.push(fallbackQuestion);
        }
      }
    }

    console.log(
      `Total questions generated from objectives: ${allQuestions.length}`
    );

    // If no objectives, generate general questions from content
    if (allQuestions.length === 0 && summary) {
      console.log(
        "No objectives found, generating general questions from summary"
      );
      const generalQuestions = await this.generateGeneralQuestions(
        course,
        summary
      );
      console.log(`Generated ${generalQuestions.length} general questions`);
      allQuestions.push(...generalQuestions);
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
  async generateQuestionsForObjective(course, summary, objective, groupTitle) {
    console.log(
      `=== GENERATING QUESTIONS FOR OBJECTIVE: ${objective.text} ===`
    );
    const questions = [];

    // Get comprehensive content for this objective
    let relevantContent = "";

    // Try RAG first if available
    console.log("RAG available:", this.contentGenerator.isRAGAvailable());
    if (this.contentGenerator.isRAGAvailable()) {
      try {
        const query = `Generate questions about: ${objective.text} for ${course}`;
        console.log("RAG query:", query);
        const relevantChunks = await this.contentGenerator.searchKnowledgeBase(
          query,
          3
        );

        console.log(
          "RAG chunks found:",
          relevantChunks ? relevantChunks.length : 0
        );
        if (relevantChunks && relevantChunks.length > 0) {
          relevantContent = relevantChunks
            .map((chunk) => chunk.content)
            .join("\n\n");
          console.log("Using RAG content for objective:", objective.text);
          console.log("RAG content length:", relevantContent.length);
        }
      } catch (error) {
        console.warn("RAG search failed, using enhanced local content:", error);
      }
    } else {
      console.log("RAG not available, using local content only");
    }

    // Enhanced local content generation (always use this as base)
    const localContent = this.getEnhancedContentForObjective(
      course,
      summary,
      objective
    );
    console.log("Local content length:", localContent.length);

    // Combine RAG and local content
    if (relevantContent) {
      relevantContent = `${relevantContent}\n\n${localContent}`;
    } else {
      relevantContent = localContent;
    }

    console.log("Final content length:", relevantContent.length);
    console.log("Objective count:", objective.count);
    console.log("Bloom levels:", objective.bloom);

    // Generate different types of questions based on Bloom's taxonomy
    const bloomLevels = objective.bloom || ["Understand"];

    for (let i = 0; i < objective.count; i++) {
      const bloomLevel = bloomLevels[i % bloomLevels.length];
      console.log(
        `Creating question ${i + 1}/${
          objective.count
        } with Bloom level: ${bloomLevel}`
      );

      const question = await this.createContextualQuestion(
        objective.text,
        relevantContent,
        bloomLevel,
        objective.id,
        groupTitle,
        i + 1
      );

      console.log(`Created question ${i + 1}:`, question.text);
      questions.push(question);
    }

    console.log(
      `Generated ${questions.length} questions for objective: ${objective.text}`
    );
    return questions;
  }

  // Get enhanced content for objective from uploaded materials
  getEnhancedContentForObjective(course, summary, objective) {
    console.log("=== GETTING ENHANCED CONTENT FOR OBJECTIVE ===");
    let content = `Course: ${course}\n\n`;

    // Add summary content
    if (summary) {
      content += `Summary: ${summary}\n\n`;
      console.log("Added summary to content, length:", summary.length);
    } else {
      console.log("No summary available");
    }

    // Add objective-specific content
    content += `Objective: ${objective.text}\n\n`;
    console.log("Added objective to content:", objective.text);

    // Add content from uploaded files (if available in global state)
    if (window.state && window.state.files) {
      console.log("Checking uploaded files:", window.state.files.length);
      const fileContent = window.state.files
        .filter((file) => file.content)
        .map((file) => `File: ${file.name}\nContent: ${file.content}`)
        .join("\n\n");

      if (fileContent) {
        content += `Uploaded Materials:\n${fileContent}\n\n`;
        console.log("Added file content, length:", fileContent.length);
      } else {
        console.log("No file content available");
      }
    } else {
      console.log("No window.state.files available");
    }

    // Add URLs (if available in global state)
    if (window.state && window.state.urls) {
      console.log("Checking URLs:", window.state.urls.length);
      const urlContent = window.state.urls
        .map((url) => `URL: ${url.url}`)
        .join("\n");

      if (urlContent) {
        content += `Referenced URLs:\n${urlContent}\n\n`;
        console.log("Added URL content, length:", urlContent.length);
      } else {
        console.log("No URL content available");
      }
    } else {
      console.log("No window.state.urls available");
    }

    console.log("Final enhanced content length:", content.length);
    return content;
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
    // Extract key concepts from content for question generation
    const keyConcepts = this.extractKeyConceptsForQuestion(content);
    const examples = this.extractExamplesForQuestion(content);

    // Generate question based on Bloom's taxonomy level
    let questionText, options, correctAnswer;

    switch (bloomLevel.toLowerCase()) {
      case "remember":
        ({ questionText, options, correctAnswer } =
          this.generateRememberQuestion(objectiveText, keyConcepts));
        break;
      case "understand":
        ({ questionText, options, correctAnswer } =
          this.generateUnderstandQuestion(objectiveText, keyConcepts, content));
        break;
      case "apply":
        ({ questionText, options, correctAnswer } = this.generateApplyQuestion(
          objectiveText,
          examples,
          content
        ));
        break;
      case "analyze":
        ({ questionText, options, correctAnswer } =
          this.generateAnalyzeQuestion(objectiveText, keyConcepts, content));
        break;
      case "evaluate":
        ({ questionText, options, correctAnswer } =
          this.generateEvaluateQuestion(objectiveText, keyConcepts, content));
        break;
      case "create":
        ({ questionText, options, correctAnswer } = this.generateCreateQuestion(
          objectiveText,
          keyConcepts,
          content
        ));
        break;
      default:
        ({ questionText, options, correctAnswer } =
          this.generateUnderstandQuestion(objectiveText, keyConcepts, content));
    }

    return {
      id: `${objectiveId}-${questionNumber}`,
      text: questionText,
      type: "multiple-choice",
      options: options,
      correctAnswer: correctAnswer,
      bloomLevel: bloomLevel,
      difficulty: this.determineDifficulty(bloomLevel),
      metaCode: groupTitle,
      loCode: objectiveText,
      lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
      by: "RAG-Enhanced System",
    };
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

  // Generate Remember level questions
  generateRememberQuestion(objectiveText, keyConcepts) {
    const concept = keyConcepts[0] || "key concept";
    const questionText = `What is the definition of ${concept} as described in the course materials?`;

    const options = [
      `The correct definition of ${concept} based on the uploaded materials`,
      `An incorrect definition of ${concept}`,
      `A definition of a related but different concept`,
      `A general description that doesn't match ${concept}`,
    ];

    return { questionText, options, correctAnswer: 0 };
  }

  // Generate Understand level questions
  generateUnderstandQuestion(objectiveText, keyConcepts, content) {
    const concept = keyConcepts[0] || "the main concept";
    const questionText = `Which of the following best explains ${concept} based on the course content?`;

    const options = [
      `The most accurate explanation of ${concept} as presented in the uploaded materials`,
      `A partially correct but incomplete explanation of ${concept}`,
      `An explanation of a different concept`,
      `A misleading explanation of ${concept}`,
    ];

    return { questionText, options, correctAnswer: 0 };
  }

  // Generate Apply level questions
  generateApplyQuestion(objectiveText, examples, content) {
    const example = examples[0] || "a practical scenario";
    const questionText = `How would you apply the concepts from "${objectiveText}" to ${example}?`;

    const options = [
      `The most appropriate application method`,
      `A partially correct application approach`,
      `An application method for a different concept`,
      `An inappropriate application method`,
    ];

    return { questionText, options, correctAnswer: 0 };
  }

  // Generate Analyze level questions
  generateAnalyzeQuestion(objectiveText, keyConcepts, content) {
    const concept1 = keyConcepts[0] || "concept A";
    const concept2 = keyConcepts[1] || "concept B";
    const questionText = `What is the relationship between ${concept1} and ${concept2} as described in the materials?`;

    const options = [
      `The correct relationship between ${concept1} and ${concept2}`,
      `A partially accurate relationship description`,
      `A relationship that doesn't exist between these concepts`,
      `A relationship between different concepts`,
    ];

    return { questionText, options, correctAnswer: 0 };
  }

  // Generate Evaluate level questions
  generateEvaluateQuestion(objectiveText, keyConcepts, content) {
    const concept = keyConcepts[0] || "the concept";
    const questionText = `Which of the following best evaluates the effectiveness of ${concept}?`;

    const options = [
      `The most comprehensive evaluation criteria`,
      `A limited evaluation approach`,
      `Evaluation criteria for a different concept`,
      `Inappropriate evaluation criteria`,
    ];

    return { questionText, options, correctAnswer: 0 };
  }

  // Generate Create level questions
  generateCreateQuestion(objectiveText, keyConcepts, content) {
    const concept = keyConcepts[0] || "the concepts";
    const questionText = `How would you create a solution using ${concept}?`;

    const options = [
      `The most innovative and appropriate solution`,
      `A basic but functional solution`,
      `A solution that doesn't use ${concept}`,
      `An impractical solution approach`,
    ];

    return { questionText, options, correctAnswer: 0 };
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

  // Create fallback question when RAG fails
  createFallbackQuestion(objective, groupTitle) {
    return {
      id: `${objective.id}-fallback`,
      text: `Based on the course materials, which of the following best relates to: ${objective.text}?`,
      type: "multiple-choice",
      options: [
        "The most accurate answer based on course content",
        "A partially correct answer",
        "An answer that doesn't relate to the objective",
        "An incorrect answer",
      ],
      correctAnswer: 0,
      bloomLevel: objective.bloom[0] || "Understand",
      difficulty: "Medium",
      metaCode: groupTitle,
      loCode: objective.text,
      lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
      by: "Fallback System",
    };
  }

  // Generate general questions when no specific objectives exist
  async generateGeneralQuestions(course, summary) {
    const questions = [];
    const keyConcepts = this.extractKeyConceptsForQuestion(summary);

    for (let i = 0; i < 5; i++) {
      const concept = keyConcepts[i % keyConcepts.length] || "course content";
      const question = {
        id: `general-${i + 1}`,
        text: `Which of the following best describes ${concept} as presented in the ${course} materials?`,
        type: "multiple-choice",
        options: [
          `The most accurate description of ${concept}`,
          `A partially accurate description`,
          `A description of a different concept`,
          `An inaccurate description`,
        ],
        correctAnswer: 0,
        bloomLevel: "Understand",
        difficulty: "Medium",
        metaCode: "General Content",
        loCode: "General Understanding",
        lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
        by: "RAG-Enhanced System",
      };

      questions.push(question);
    }

    return questions;
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

      const response = await fetch("/api/questions/generate-questions", {
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
