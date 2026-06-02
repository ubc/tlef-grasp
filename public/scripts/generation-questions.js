// Generation Questions Module
// Handles question generation based on content and objectives

function escapeCsvField(value) {
  if (value == null) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class QuestionGenerator {
  constructor(contentGenerator, options = {}) {
    this.contentGenerator = contentGenerator;
    this.bloomTypePreferences = options.bloomTypePreferences || window.DEFAULT_BLOOM_TYPE_PREFERENCES;
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

  getBloomTypePreferences() {
    return this.bloomTypePreferences;
  }

  determineQuestionType(bloomLevel) {
    const preferences = this.getBloomTypePreferences();
    return preferences[bloomLevel]?.[0] || QUESTION_TYPES.MULTIPLE_CHOICE;
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
        learningObjective.materialIds || [],
        granularLearningObjective.count
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
    materialIds = [],
    count
  ) {
    console.log(`Generating batch questions for objective: ${learningObjectiveText}`);

    try {
      const llmResponse = await fetch('/api/rag-llm/generate-questions-with-rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          courseName,
          learningObjectiveId,
          learningObjectiveText,
          granularLearningObjectiveText,
          bloomLevels,
          materialIds,
          count,
        }),
      });

      if (!llmResponse.ok) {
        const errorText = await llmResponse.text().catch(() => 'Unknown error');
        throw new Error(`Server error: ${llmResponse.status} - ${errorText}`);
      }

      const response = await llmResponse.json();

      if (!response.success) {
        throw new Error(response.error || "Question generation service is currently unavailable");
      }

      if (!response.questions || !Array.isArray(response.questions)) {
        throw new Error("Invalid response: questions array missing");
      }

      return response.questions.map((questionData, index) => {
        const resolvedType = questionData.questionType || questionData.type || QUESTION_TYPES.MULTIPLE_CHOICE;
        const bloomLevel = questionData.bloomLevel || bloomLevels[index % bloomLevels.length] || "Understand";

        const base = {
          id: `${granularLearningObjectiveId}-${index + 1}-${Date.now()}`,
          granularObjectiveId: `${granularLearningObjectiveId}`,
          learningObjectiveId,
          materialIds,
          courseId,
          text: questionData.question || questionData.stem || "",
          topicTitle: questionData.topicTitle || "",
          questionType: resolvedType,
          options: questionData.options || null,
          correctAnswer: questionData.correctAnswer || "",
          acceptableAnswers: questionData.acceptableAnswers || [],
          bloomLevel,
          metaCode: learningObjectiveText,
          loCode: granularLearningObjectiveText,
          lastEdited: new Date().toISOString().slice(0, 16).replace("T", " "),
          by: "LLM + RAG System",
          explanation: questionData.explanation || "",
        };

        if (resolvedType === QUESTION_TYPES.CALCULATION) {
          base.stem = questionData.stem || questionData.question || "";
          base.calculationFormula = questionData.calculationFormula || "";
          base.calculationVariables = questionData.calculationVariables || [];
          base.calculationAnswerDecimals = questionData.calculationAnswerDecimals ?? 2;
          base.calculationAnswerTolerancePercent = questionData.calculationAnswerTolerancePercent ?? null;
        } else if (resolvedType === QUESTION_TYPES.OPEN_ENDED) {
          base.stem = questionData.stem || questionData.question || "";
          base.openEndedSampleAnswer = questionData.openEndedSampleAnswer || "";
          base.openEndedGradingCriteria = questionData.openEndedGradingCriteria || "";
        } else if (resolvedType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
          base.stem = questionData.question || "";
        }

        return base;
      });
    } catch (error) {
      console.error(`Error generating batch questions:`, error);
      throw error;
    }
  }


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
      "Question Type,Question,Option A,Option B,Option C,Option D,Correct Answer,Acceptable Answers,Bloom Level,Difficulty\n";
    questions.forEach((q) => {
      const qt = q.type || q.questionType || QUESTION_TYPES.MULTIPLE_CHOICE;
      if (qt === QUESTION_TYPES.CALCULATION) {
        const stem = q.text || q.stem || "";
        const formula = q.calculationFormula || "";
        const varsJson = JSON.stringify(q.calculationVariables || []);
        csv += `${escapeCsvField(qt)},${escapeCsvField(stem)},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField(formula)},${escapeCsvField(varsJson)},${escapeCsvField(q.bloomLevel)},${escapeCsvField(q.difficulty)}\n`;
        return;
      }
      if (qt === QUESTION_TYPES.FILL_IN_THE_BLANK) {
        const acc =
          Array.isArray(q.acceptableAnswers) && q.acceptableAnswers.length
            ? q.acceptableAnswers.join("; ")
            : q.correctAnswer != null
              ? String(q.correctAnswer)
              : "";
        const fibQ = q.text || q.stem || "";
        csv += `${escapeCsvField(qt)},${escapeCsvField(fibQ)},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField(q.correctAnswer)},${escapeCsvField(acc)},${escapeCsvField(q.bloomLevel)},${escapeCsvField(q.difficulty)}\n`;
        return;
      }
      if (qt === QUESTION_TYPES.OPEN_ENDED) {
        const stem = q.text || q.stem || "";
        const sample = q.openEndedSampleAnswer || "";
        const crit = q.openEndedGradingCriteria || "";
        const combined = `Sample: ${sample} | Criteria: ${crit}`;
        csv += `${escapeCsvField(qt)},${escapeCsvField(stem)},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField("")},${escapeCsvField(combined)},${escapeCsvField(q.bloomLevel)},${escapeCsvField(q.difficulty)}\n`;
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
      csv += `${escapeCsvField(qt)},${escapeCsvField(q.text)},${escapeCsvField(optA)},${escapeCsvField(optB)},${escapeCsvField(optC)},${escapeCsvField(optD)},${escapeCsvField(correctOpt)},${escapeCsvField("")},${escapeCsvField(q.bloomLevel)},${escapeCsvField(q.difficulty)}\n`;
    });
    return csv;
  }

  formatAsQTI(questions) {
    const itemsXml = questions
      .map((q, index) => {
        const qt = q.type || q.questionType || QUESTION_TYPES.MULTIPLE_CHOICE;
        const ident = `q${index + 1}`;
        if (qt === QUESTION_TYPES.CALCULATION) {
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
          <mattext>${escapeXml(stem)}</mattext>
        </material>
        <material>
          <mattext>${escapeXml(note)}</mattext>
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
        if (qt === QUESTION_TYPES.FILL_IN_THE_BLANK) {
          const acceptable =
            Array.isArray(q.acceptableAnswers) && q.acceptableAnswers.length
              ? q.acceptableAnswers
              : q.correctAnswer != null
                ? [String(q.correctAnswer)]
                : [];
          const conditions =
            acceptable.length <= 1
              ? `<varequal respident="response1">${escapeXml(acceptable[0] || "")}</varequal>`
              : `<or>${acceptable.map((a) => `<varequal respident="response1">${escapeXml(a)}</varequal>`).join("")}</or>`;
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
          <mattext>${escapeXml(q.text || q.stem || "")}</mattext>
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
          <mattext>${escapeXml(q.text)}</mattext>
        </material>
        <response_lid ident="response1">
          <render_choice>
            ${["A", "B", "C", "D"]
              .map(
                (key, optIndex) => `
            <response_label ident="choice${optIndex}">
              <material>
                <mattext>${escapeXml(q.options?.[key] || "")}</mattext>
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
