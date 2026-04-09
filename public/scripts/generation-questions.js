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
  
      this.llmService = {
        isAvailable: () => true,
  
        generateMultipleChoiceQuestion: async ({
          courseId,
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevel,
        }) => {
          return await this.callQuestionGenerationApi({
            courseId,
            courseName,
            learningObjectiveId,
            learningObjectiveText,
            granularLearningObjectiveText,
            bloomLevel,
            questionType: "multiple-choice",
          });
        },
  
        generateFillInTheBlankQuestion: async ({
          courseId,
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevel,
        }) => {
          return await this.callQuestionGenerationApi({
            courseId,
            courseName,
            learningObjectiveId,
            learningObjectiveText,
            granularLearningObjectiveText,
            bloomLevel,
            questionType: "fill-in-the-blank",
          });
        },

        generateCalculationQuestion: async ({
          courseId,
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevel,
        }) => {
          return await this.callQuestionGenerationApi({
            courseId,
            courseName,
            learningObjectiveId,
            learningObjectiveText,
            granularLearningObjectiveText,
            bloomLevel,
            questionType: "calculation",
          });
        },

        generateOpenEndedQuestion: async ({
          courseId,
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevel,
        }) => {
          return await this.callQuestionGenerationApi({
            courseId,
            courseName,
            learningObjectiveId,
            learningObjectiveText,
            granularLearningObjectiveText,
            bloomLevel,
            questionType: "open-ended",
          });
        },
  
        generateQuestionByType: async (questionType, params) => {
          switch (questionType) {
            case "fill-in-the-blank":
              return await this.llmService.generateFillInTheBlankQuestion(params);
            case "calculation":
              return await this.llmService.generateCalculationQuestion(params);
            case "open-ended":
              return await this.llmService.generateOpenEndedQuestion(params);
            case "multiple-choice":
            default:
              return await this.llmService.generateMultipleChoiceQuestion(params);
          }
        },
      };
  
      console.log("✅ Server-side RAG + LLM service initialized");
    } catch (error) {
      console.error("❌ Failed to initialize LLM service:", error);
      this.llmService = null;
    }
  }

  async callQuestionGenerationApi({
    courseId,
    courseName,
    learningObjectiveId,
    learningObjectiveText,
    granularLearningObjectiveText,
    bloomLevel,
    questionType,
  }) {
    console.log(`Generating ${questionType} question...`, {
      courseId,
      courseName,
      learningObjectiveId,
      learningObjectiveText,
      granularLearningObjectiveText,
      bloomLevel,
      questionType,
    });
  
    const response = await fetch("/api/rag-llm/generate-questions-with-rag", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        courseId,
        courseName,
        learningObjectiveId,
        learningObjectiveText,
        granularLearningObjectiveText,
        bloomLevel,
        questionType,
      }),
    });
  
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`Server error ${response.status}:`, errorText);
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }
  
    const data = await response.json();
    console.log("✅ Server-side RAG + LLM response:", data);
  
    if (!data.success || !data.question) {
      throw new Error(
        data.error || "Question generation service is currently unavailable"
      );
    }
  
    return data.question;
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

  getBloomTypePreferences() {
    return {
      Remember: ["fill-in-the-blank", "multiple-choice"],
      Understand: ["multiple-choice", "fill-in-the-blank"],
      Apply: ["multiple-choice", "fill-in-the-blank"],
      Analyze: ["multiple-choice", "fill-in-the-blank"],
      Evaluate: ["calculation"],
      Create: ["open-ended"],
    };
  }
  
  determineQuestionType(bloomLevel) {
    const preferences = this.getBloomTypePreferences();
    return preferences[bloomLevel]?.[0] || "multiple-choice";
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
      const questionType = this.determineQuestionType(bloomLevel);
      console.log(
        `Creating question ${i + 1}/${
          granularLearningObjective.count
        } with Bloom level: ${bloomLevel} and question type: ${questionType}`
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
              questionType
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
              questionType: questionType,
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
    questionType
  ) {
    if (!this.llmService || !this.llmService.isAvailable()) {
      throw new Error("Question generation service is currently unavailable");
    }
  
    console.log(
      `Generating ${questionType} question for objective: ${learningObjectiveText}`
    );
  
    try {
      const questionData = await this.llmService.generateQuestionByType(
        questionType,
        {
          courseId,
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevel,
        }
      );
  
      const resolvedType = questionData.type || questionData.questionType || questionType;

      if (resolvedType === "calculation") {
        const stemText = String(
          questionData.stem || questionData.question || ""
        ).trim();
        let topicTitleCalc = String(
          questionData.topicTitle ||
            questionData.topic ||
            questionData.shortTitle ||
            ""
        )
          .trim()
          .replace(/\?+$/, "");
        if (!topicTitleCalc) {
          const before = stemText.split("{{")[0].trim();
          const words = before.split(/\s+/).filter(Boolean);
          topicTitleCalc = words.slice(0, 10).join(" ") || "Calculation";
        }
        let answerDec = parseInt(questionData.calculationAnswerDecimals, 10);
        if (!Number.isFinite(answerDec)) answerDec = 2;
        answerDec = Math.max(0, Math.min(12, answerDec));
        return {
          id: `${granularLearningObjectiveId}-${questionNumber}`,
          granularObjectiveId: `${granularLearningObjectiveId}`,
          text: stemText,
          topicTitle: topicTitleCalc,
          type: "calculation",
          questionType: "calculation",
          options: null,
          correctAnswer: "",
          acceptableAnswers: [],
          calculationFormula: questionData.calculationFormula,
          calculationVariables: questionData.calculationVariables,
          calculationAnswerDecimals: answerDec,
          bloomLevel: bloomLevel,
          difficulty: this.determineDifficulty(bloomLevel),
          metaCode: learningObjectiveText,
          loCode: granularLearningObjectiveText,
          lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
          by: "LLM + RAG System",
          explanation: questionData.explanation,
        };
      }

      if (resolvedType === "open-ended") {
        const stemText = String(
          questionData.stem || questionData.question || ""
        ).trim();
        let topicTitleOpen = String(
          questionData.topicTitle ||
            questionData.topic ||
            questionData.shortTitle ||
            ""
        )
          .trim()
          .replace(/\?+$/, "");
        if (!topicTitleOpen) {
          const words = stemText.split(/\s+/).filter(Boolean);
          topicTitleOpen = words.slice(0, 10).join(" ") || "Open-ended";
        }
        return {
          id: `${granularLearningObjectiveId}-${questionNumber}`,
          granularObjectiveId: `${granularLearningObjectiveId}`,
          text: stemText,
          stem: stemText,
          topicTitle: topicTitleOpen,
          type: "open-ended",
          questionType: "open-ended",
          options: null,
          correctAnswer: "",
          acceptableAnswers: [],
          openEndedSampleAnswer: String(
            questionData.openEndedSampleAnswer || ""
          ).trim(),
          openEndedGradingCriteria: String(
            questionData.openEndedGradingCriteria || ""
          ).trim(),
          bloomLevel: bloomLevel,
          difficulty: this.determineDifficulty(bloomLevel),
          metaCode: learningObjectiveText,
          loCode: granularLearningObjectiveText,
          lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
          by: "LLM + RAG System",
          explanation: questionData.explanation,
        };
      }

      const acceptable =
        resolvedType === "fill-in-the-blank"
          ? Array.isArray(questionData.acceptableAnswers) && questionData.acceptableAnswers.length
            ? questionData.acceptableAnswers
            : questionData.correctAnswer != null
              ? [String(questionData.correctAnswer)]
              : []
          : [];

      const fibStem = String(questionData.question || "").trim();
      const rawTopic =
        resolvedType === "fill-in-the-blank"
          ? String(
              questionData.topicTitle ||
                questionData.topic ||
                questionData.shortTitle ||
                ""
            ).trim()
          : "";
      const topicTitleFib =
        resolvedType === "fill-in-the-blank"
          ? rawTopic ||
            (() => {
              const before = fibStem.split("_________")[0].trim();
              const words = before.split(/\s+/).filter(Boolean);
              return words.slice(0, 10).join(" ") || "Fill-in-the-blank";
            })()
          : "";

      return {
        id: `${granularLearningObjectiveId}-${questionNumber}`,
        granularObjectiveId: `${granularLearningObjectiveId}`,
        text: questionData.question,
        topicTitle: resolvedType === "fill-in-the-blank" ? topicTitleFib : undefined,
        type: resolvedType,
        questionType: resolvedType,
        options: questionData.options || null,
        correctAnswer: questionData.correctAnswer,
        acceptableAnswers: acceptable,
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

  escapeCsvField(value) {
    if (value == null) return '""';
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  escapeXml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  formatAsCSV(questions) {
    let csv =
      "Question Type,Question,Option A,Option B,Option C,Option D,Correct Answer,Acceptable Answers,Bloom Level,Difficulty\n";
    questions.forEach((q) => {
      const qt = q.type || q.questionType || "multiple-choice";
      if (qt === "calculation") {
        const stem = q.text || q.stem || "";
        const formula = q.calculationFormula || "";
        const varsJson = JSON.stringify(q.calculationVariables || []);
        csv += `${this.escapeCsvField(qt)},${this.escapeCsvField(stem)},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField(formula)},${this.escapeCsvField(varsJson)},${this.escapeCsvField(q.bloomLevel)},${this.escapeCsvField(q.difficulty)}\n`;
        return;
      }
      if (qt === "fill-in-the-blank") {
        const acc =
          Array.isArray(q.acceptableAnswers) && q.acceptableAnswers.length
            ? q.acceptableAnswers.join("; ")
            : q.correctAnswer != null
              ? String(q.correctAnswer)
              : "";
        const fibQ = q.text || q.stem || "";
        csv += `${this.escapeCsvField(qt)},${this.escapeCsvField(fibQ)},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField(q.correctAnswer)},${this.escapeCsvField(acc)},${this.escapeCsvField(q.bloomLevel)},${this.escapeCsvField(q.difficulty)}\n`;
        return;
      }
      if (qt === "open-ended") {
        const stem = q.text || q.stem || "";
        const sample = q.openEndedSampleAnswer || "";
        const crit = q.openEndedGradingCriteria || "";
        const combined = `Sample: ${sample} | Criteria: ${crit}`;
        csv += `${this.escapeCsvField(qt)},${this.escapeCsvField(stem)},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField("")},${this.escapeCsvField(combined)},${this.escapeCsvField(q.bloomLevel)},${this.escapeCsvField(q.difficulty)}\n`;
        return;
      }
      const optA = q.options?.A || "";
      const optB = q.options?.B || "";
      const optC = q.options?.C || "";
      const optD = q.options?.D || "";
      const correctAnswerLetter =
        typeof q.correctAnswer === "string"
          ? q.correctAnswer.toUpperCase()
          : typeof q.correctAnswer === "number"
            ? ["A", "B", "C", "D"][q.correctAnswer]
            : "A";
      const correctOpt = q.options?.[correctAnswerLetter] || "";
      csv += `${this.escapeCsvField(qt)},${this.escapeCsvField(q.text)},${this.escapeCsvField(optA)},${this.escapeCsvField(optB)},${this.escapeCsvField(optC)},${this.escapeCsvField(optD)},${this.escapeCsvField(correctOpt)},${this.escapeCsvField("")},${this.escapeCsvField(q.bloomLevel)},${this.escapeCsvField(q.difficulty)}\n`;
    });
    return csv;
  }

  formatAsQTI(questions) {
    const itemsXml = questions
      .map((q, index) => {
        const qt = q.type || q.questionType || "multiple-choice";
        const ident = `q${index + 1}`;
        if (qt === "calculation") {
          const stem = q.text || q.stem || "";
          const note = `[Formula: ${q.calculationFormula || ""}; variables JSON: ${JSON.stringify(q.calculationVariables || [])}; answerDecimals: ${q.calculationAnswerDecimals != null ? q.calculationAnswerDecimals : 2}]`;
          return `
    <item ident="${ident}">
      <itemmetadata>
        <qtimetadata>
          <qtimetadatafield>
            <fieldlabel>qmd_itemtype</fieldlabel>
            <fieldentry>Calculation</fieldentry>
          </qtimetadatafield>
        </qtimetadata>
      </itemmetadata>
      <presentation>
        <material>
          <mattext>${this.escapeXml(stem)}</mattext>
        </material>
        <material>
          <mattext>${this.escapeXml(note)}</mattext>
        </material>
        <response_str ident="response1">
          <render_fib fibtype="String" columns="40" rows="1">
            <response_label ident="fib"/>
          </render_fib>
        </response_str>
      </presentation>
      <resprocessing>
        <outcomes>
          <decvar varname="SCORE" vartype="Decimal" defaultval="0"/>
        </outcomes>
      </resprocessing>
    </item>`;
        }
        if (qt === "fill-in-the-blank") {
          const acceptable =
            Array.isArray(q.acceptableAnswers) && q.acceptableAnswers.length
              ? q.acceptableAnswers
              : q.correctAnswer != null
                ? [String(q.correctAnswer)]
                : [];
          const conditions =
            acceptable.length <= 1
              ? `<varequal respident="response1">${this.escapeXml(acceptable[0] || "")}</varequal>`
              : `<or>${acceptable.map((a) => `<varequal respident="response1">${this.escapeXml(a)}</varequal>`).join("")}</or>`;
          return `
    <item ident="${ident}">
      <itemmetadata>
        <qtimetadata>
          <qtimetadatafield>
            <fieldlabel>qmd_itemtype</fieldlabel>
            <fieldentry>Fill In The Blank</fieldentry>
          </qtimetadatafield>
        </qtimetadata>
      </itemmetadata>
      <presentation>
        <material>
          <mattext>${this.escapeXml(q.text || q.stem || "")}</mattext>
        </material>
        <response_str ident="response1">
          <render_fib fibtype="String" columns="40" rows="1">
            <response_label ident="fib"/>
          </render_fib>
        </response_str>
      </presentation>
      <resprocessing>
        <outcomes>
          <decvar varname="SCORE" vartype="Decimal" defaultval="0"/>
        </outcomes>
        <respcondition continue="No">
          <conditionvar>
            ${conditions}
          </conditionvar>
          <setvar action="Set">1</setvar>
        </respcondition>
      </resprocessing>
    </item>`;
        }
        const choiceIndex = (() => {
          if (typeof q.correctAnswer === "string") {
            const letter = q.correctAnswer.toUpperCase();
            if (letter === "A") return 0;
            if (letter === "B") return 1;
            if (letter === "C") return 2;
            if (letter === "D") return 3;
          } else if (typeof q.correctAnswer === "number") {
            return q.correctAnswer;
          }
          return 0;
        })();
        return `
    <item ident="${ident}">
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
          <mattext>${this.escapeXml(q.text)}</mattext>
        </material>
        <response_lid ident="response1">
          <render_choice>
            ${["A", "B", "C", "D"]
              .map(
                (key, optIndex) => `
            <response_label ident="choice${optIndex}">
              <material>
                <mattext>${this.escapeXml(q.options?.[key] || "")}</mattext>
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
            <varequal respident="response1">choice${choiceIndex}</varequal>
          </conditionvar>
          <setvar action="Set">1</setvar>
        </respcondition>
      </resprocessing>
    </item>`;
      })
      .join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="GRASP_QUESTIONS" title="Generated Questions">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>qmd_timelimit</fieldlabel>
        <fieldentry>PT30M</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
    ${itemsXml}
  </assessment>
</questestinterop>`;
  }
}

// Export for use in other files
window.QuestionGenerator = QuestionGenerator;
