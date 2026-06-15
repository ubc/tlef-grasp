import { api } from "../../lib/api";
import { QUESTION_TYPES } from "../../lib/constants";

// Question generation + review pipeline (port of generation-questions.js and
// the step-2 helpers in question-generation.js).

const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");

// Generate question batches for every granular objective, sequentially
// (mirrors the legacy loop: continue past failures once something succeeded).
export async function generateQuestions(course, objectiveGroups, onProgress) {
  const total = objectiveGroups.reduce(
    (sum, g) => sum + g.items.reduce((s, item) => s + (item.count || 1), 0),
    0
  );
  let generated = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const allQuestions = [];

  for (const learningObjective of objectiveGroups) {
    for (const granular of learningObjective.items) {
      try {
        const response = await api.post("/api/rag-llm/generate-questions-with-rag", {
          courseId: course.id || course._id,
          courseName: course.name || course.courseName || "",
          learningObjectiveId: learningObjective.objectiveId,
          learningObjectiveText: learningObjective.title,
          granularLearningObjectiveText: granular.text,
          bloomLevels: granular.bloom || ["Understand"],
          materialIds: learningObjective.materialIds || [],
          count: granular.count,
        });

        if (!response.success) {
          throw new Error(
            response.error || "Question generation service is currently unavailable"
          );
        }
        if (!response.questions || !Array.isArray(response.questions)) {
          throw new Error("Invalid response: questions array missing");
        }

        const bloomLevels = granular.bloom || ["Understand"];
        const questions = response.questions.map((questionData, index) => {
          const resolvedType =
            questionData.questionType ||
            questionData.type ||
            QUESTION_TYPES.MULTIPLE_CHOICE;
          const bloomLevel =
            questionData.bloomLevel ||
            bloomLevels[index % bloomLevels.length] ||
            "Understand";

          const base = {
            id: `${granular.granularId}-${index + 1}-${Date.now()}`,
            granularObjectiveId: `${granular.granularId}`,
            learningObjectiveId: learningObjective.objectiveId,
            materialIds: learningObjective.materialIds || [],
            courseId: course.id || course._id,
            text: questionData.question || questionData.stem || "",
            topicTitle: questionData.topicTitle || "",
            questionType: resolvedType,
            options: questionData.options || null,
            correctAnswer: questionData.correctAnswer || "",
            acceptableAnswers: questionData.acceptableAnswers || [],
            bloomLevel,
            metaCode: learningObjective.title,
            loCode: granular.text,
            lastEdited: now(),
            by: "LLM + RAG System",
            explanation: questionData.explanation || "",
          };

          if (resolvedType === QUESTION_TYPES.CALCULATION) {
            base.stem = questionData.stem || questionData.question || "";
            base.calculationFormula = questionData.calculationFormula || "";
            base.calculationVariables = questionData.calculationVariables || [];
            base.calculationAnswerDecimals =
              questionData.calculationAnswerDecimals ?? 2;
            base.calculationAnswerTolerancePercent =
              questionData.calculationAnswerTolerancePercent ?? null;
          } else if (resolvedType === QUESTION_TYPES.OPEN_ENDED) {
            base.stem = questionData.stem || questionData.question || "";
            base.openEndedSampleAnswer = questionData.openEndedSampleAnswer || "";
            base.openEndedGradingCriteria =
              questionData.openEndedGradingCriteria || "";
          } else if (resolvedType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
            base.stem = questionData.question || "";
          }

          return base;
        });

        allQuestions.push(...questions);
        const tokenUsage = response.tokenUsage || {};
        totalPromptTokens += tokenUsage.promptTokens || 0;
        totalCompletionTokens += tokenUsage.completionTokens || 0;
        generated += questions.length;
        onProgress?.({ generated, total });
      } catch (error) {
        console.error(
          `Failed to generate questions for objective: ${granular.text}`,
          error
        );
        if (allQuestions.length === 0) throw error;
      }
    }
  }

  return {
    questions: allQuestions,
    tokenUsage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
    },
  };
}

function firstWords(text, splitter, fallback) {
  const head = splitter ? String(text || "").split(splitter)[0] : String(text || "");
  const words = head.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 10).join(" ") || fallback;
}

function normalizeOptions(opts) {
  if (!opts || typeof opts !== "object") return {};
  const out = {};
  ["A", "B", "C", "D"].forEach((key) => {
    const opt = opts[key];
    if (typeof opt === "string") {
      out[key] = { id: key, text: opt, feedback: "" };
    } else if (opt && typeof opt === "object") {
      out[key] = { id: key, text: opt.text || "", feedback: opt.feedback || "" };
    } else {
      out[key] = { id: key, text: `Option ${key}`, feedback: "" };
    }
  });
  return out;
}

// Group generated questions by meta objective into the step-2 view model.
export function convertQuestionsToGroups(questions) {
  const groupedQuestions = {};
  questions.forEach((question) => {
    const metaCode = question.metaCode || "General Content";
    (groupedQuestions[metaCode] ||= []).push(question);
  });

  return Object.entries(groupedQuestions).map(([metaCode, groupQuestions], index) => ({
    id: index + 1,
    title: metaCode,
    isOpen: true,
    los: groupQuestions.map((question, itemIndex) => {
      const qType =
        question.type || question.questionType || QUESTION_TYPES.MULTIPLE_CHOICE;
      const isFib = qType === QUESTION_TYPES.FILL_IN_THE_BLANK;
      const isCalc = qType === QUESTION_TYPES.CALCULATION;
      const isOpen = qType === QUESTION_TYPES.OPEN_ENDED;

      const common = {
        id: question.id,
        bloom: question.bloomLevel || "Understand",
        status: "Draft",
        lastEdited: question.lastEdited || now(),
        by: question.by || "System",
        metaCode: question.metaCode || metaCode,
        loCode: question.loCode || question.text,
        granularObjectiveId: question.granularObjectiveId,
        explanation: question.explanation,
      };

      let card;
      if (isFib) {
        const acceptable =
          Array.isArray(question.acceptableAnswers) && question.acceptableAnswers.length
            ? question.acceptableAnswers
            : question.correctAnswer != null
              ? [String(question.correctAnswer)]
              : [];
        card = {
          ...common,
          title:
            (question.topicTitle && String(question.topicTitle).trim()) ||
            firstWords(question.text, "_________", "Fill-in-the-blank"),
          stem: question.stem || question.text,
          questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
          options: {},
          correctAnswer: question.correctAnswer,
          acceptableAnswers: acceptable,
        };
      } else if (isCalc) {
        const stemCalc = String(question.stem || question.text || "").trim();
        card = {
          ...common,
          title:
            (question.topicTitle && String(question.topicTitle).trim()) ||
            firstWords(stemCalc, "{{", "Calculation"),
          stem: stemCalc,
          questionType: QUESTION_TYPES.CALCULATION,
          options: {},
          correctAnswer: "",
          acceptableAnswers: [],
          calculationFormula: question.calculationFormula || "",
          calculationVariables: Array.isArray(question.calculationVariables)
            ? question.calculationVariables
            : [],
          calculationAnswerDecimals: question.calculationAnswerDecimals ?? 2,
          calculationAnswerTolerancePercent:
            question.calculationAnswerTolerancePercent ?? null,
        };
      } else if (isOpen) {
        const stemOpen = String(question.stem || question.text || "").trim();
        card = {
          ...common,
          title:
            (question.topicTitle && String(question.topicTitle).trim()) ||
            firstWords(stemOpen, null, "Open-ended"),
          stem: stemOpen,
          questionType: QUESTION_TYPES.OPEN_ENDED,
          options: {},
          correctAnswer: "",
          acceptableAnswers: [],
          openEndedSampleAnswer: String(question.openEndedSampleAnswer || "").trim(),
          openEndedGradingCriteria: String(
            question.openEndedGradingCriteria || ""
          ).trim(),
        };
      } else {
        card = {
          ...common,
          title: question.text,
          stem: "Select the best answer:",
          questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
          options: normalizeOptions(question.options),
          correctAnswer: question.correctAnswer,
          acceptableAnswers: [],
          learningObjectiveId: question.learningObjectiveId,
        };
      }

      return {
        id: `lo-${index + 1}-${itemIndex + 1}`,
        code: `LO ${index + 1}.${itemIndex + 1}`,
        generated: question.count || 1,
        min: 1,
        badges: [],
        questions: [card],
      };
    }),
  }));
}

// Run the AI quality review and annotate flagged questions in place.
export async function reviewGeneratedQuestions(questionGroups, courseId) {
  const allQuestions = [];
  questionGroups.forEach((group) => {
    group.los.forEach((lo) => {
      lo.questions.forEach((q) => {
        allQuestions.push({
          id: q.id,
          questionType: q.questionType || q.type || "multiple-choice",
          bloomLevel: q.bloom,
          title: q.title,
          stem: q.stem,
          options: q.options,
          correctAnswer: q.correctAnswer,
          acceptableAnswers: q.acceptableAnswers,
          calculationFormula: q.calculationFormula,
          calculationVariables: q.calculationVariables,
          openEndedSampleAnswer: q.openEndedSampleAnswer,
          openEndedGradingCriteria: q.openEndedGradingCriteria,
          learningObjectiveText: q.metaCode,
          granularObjectiveText: q.loCode,
          learningObjectiveId: q.learningObjectiveId,
          materialIds: q.materialIds,
          courseId,
        });
      });
    });
  });

  if (allQuestions.length === 0) return;

  try {
    const data = await api.post("/api/rag-llm/review-questions", {
      questions: allQuestions,
    });
    if (!data.success || !Array.isArray(data.results)) return;

    const resultMap = {};
    data.results.forEach((r) => {
      resultMap[r.originalId] = r;
    });

    questionGroups.forEach((group) => {
      group.los.forEach((lo) => {
        lo.questions.forEach((q) => {
          const result = resultMap[q.id];
          if (!result) return;
          q.reviewFlag = result.flagged;
          q.reviewIssue = result.issue || "";
        });
      });
    });
  } catch (error) {
    console.error("Failed to review questions:", error);
  }
}

// Build the API payload for one question card (used by save-to-quiz / bank).
export function buildQuestionPayload(question) {
  const qt = question.questionType || question.type || QUESTION_TYPES.MULTIPLE_CHOICE;
  const payload = {
    title: question.title || question.stem || "",
    stem: question.stem || question.title || "",
    options: question.options || [],
    correctAnswer: question.correctAnswer ?? "",
    questionType: qt,
    acceptableAnswers: Array.isArray(question.acceptableAnswers)
      ? question.acceptableAnswers
      : [],
    bloom: question.bloom || question.bloomLevel || "Understand",
    difficulty: question.difficulty || "medium",
    granularObjectiveId: question.granularObjectiveId || null,
    by: question.createdBy || "system",
    status: question.status || "Draft",
    flagStatus: question.flagStatus || false,
  };
  if (qt === QUESTION_TYPES.CALCULATION) {
    payload.options = {};
    payload.calculationFormula = question.calculationFormula || "";
    payload.calculationVariables = Array.isArray(question.calculationVariables)
      ? question.calculationVariables
      : [];
    let d = parseInt(question.calculationAnswerDecimals, 10);
    if (!Number.isFinite(d)) d = 2;
    payload.calculationAnswerDecimals = Math.max(0, Math.min(12, d));
  }
  if (qt === QUESTION_TYPES.OPEN_ENDED) {
    payload.options = {};
    payload.openEndedSampleAnswer = String(question.openEndedSampleAnswer || "").trim();
    payload.openEndedGradingCriteria = String(
      question.openEndedGradingCriteria || ""
    ).trim();
  }
  return payload;
}
