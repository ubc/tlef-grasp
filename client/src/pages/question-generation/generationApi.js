import { api } from "../../lib/api";
import { QUESTION_TYPES } from "../../lib/constants";
import { runPool } from "../../lib/async-pool";

// Question generation + review pipeline (port of generation-questions.js and
// the step-2 helpers in question-generation.js).

const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");

// How many objectives are generated at once. Objectives are independent, so
// this is a straight latency win; 1 reproduces the old sequential behaviour.
const DEFAULT_CONCURRENCY = 4;
// Cap on how long a provider Retry-After can stall the run.
const MAX_PAUSE_MS = 60000;
// Consecutive rate-limit failures before we stop rather than keep hammering.
const RATE_LIMIT_CIRCUIT_BREAK = 5;

// Generate question batches for every granular objective through a bounded
// concurrency pool (mirrors the legacy loop's intent: continue past failures
// once something succeeded), but issues requests in parallel instead of
// waiting on each one in turn. Results stay in objective order regardless of
// completion order.
export async function generateQuestions(course, objectiveGroups, onProgress, options = {}) {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // One task per granular objective, flattened so the pool sees a single list
  // while results stay addressable by their original position.
  const units = [];
  for (const learningObjective of objectiveGroups) {
    for (const granular of learningObjective.items) {
      units.push({ learningObjective, granular });
    }
  }

  const total = units.reduce((sum, unit) => sum + (unit.granular.count || 1), 0);
  let generated = 0;
  let consecutiveRateLimits = 0;

  const tokenTotals = {
    generation: { promptTokens: 0, completionTokens: 0 },
    review: { promptTokens: 0, completionTokens: 0 },
    fix: { promptTokens: 0, completionTokens: 0 },
  };
  const addTokens = (bucket, usage) => {
    bucket.promptTokens += usage?.promptTokens || 0;
    bucket.completionTokens += usage?.completionTokens || 0;
  };

  const tasks = units.map(({ learningObjective, granular }) => async () => {
    let response;
    try {
      response = await api.post("/api/rag-llm/generate-questions-with-rag", {
        courseId: course.id || course._id,
        courseName: course.name || course.courseName || "",
        learningObjectiveId: learningObjective.objectiveId,
        learningObjectiveText: learningObjective.title,
        granularLearningObjectiveId: granular.granularId,
        granularLearningObjectiveText: granular.text,
        bloomLevels: granular.bloom || ["Understand"],
        materialIds: learningObjective.materialIds || [],
        count: granular.count,
        // Optional: pin the generated type (Question Bank wizard). Omitted for
        // the main pathway, where type is derived from Bloom preferences.
        ...(granular.questionType ? { questionType: granular.questionType } : {}),
      });
    } catch (error) {
      if (error?.status === 429) {
        error.rateLimited = true;
        error.retryAfterSeconds = error?.body?.retryAfterSeconds;
      }
      throw error;
    }

    if (!response.success) {
      throw new Error(response.error || "Question generation service is currently unavailable");
    }
    if (!response.questions || !Array.isArray(response.questions)) {
      throw new Error("Invalid response: questions array missing");
    }

    // A success anywhere in the run breaks a rate-limit streak — "consecutive"
    // must mean consecutive, not merely "5 total across the whole run".
    consecutiveRateLimits = 0;

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
        reviewFlag: questionData.reviewFlag || false,
        reviewIssue: questionData.reviewIssue || "",
        wasAutoFixed: questionData.wasAutoFixed || false,
        autoFixReason: questionData.autoFixReason || "",
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

    const tokenUsage = response.tokenUsage || {};
    addTokens(tokenTotals.generation, tokenUsage.generation);
    addTokens(tokenTotals.review, tokenUsage.review);
    addTokens(tokenTotals.fix, tokenUsage.fix);
    generated += questions.length;
    onProgress?.({ generated, total });

    return questions;
  });

  // Named rather than inline because Task 7's retry sweep reuses it.
  const onRateLimit = (error) => {
    consecutiveRateLimits += 1;
    // An exhausted quota should cost seconds, not ten minutes of hammering.
    if (consecutiveRateLimits >= RATE_LIMIT_CIRCUIT_BREAK) error.fatal = true;
    const seconds = Number(error?.retryAfterSeconds) || 0;
    return Math.min(seconds * 1000, MAX_PAUSE_MS);
  };

  const settled = await runPool(tasks, { concurrency, onRateLimit });

  const allQuestions = [];
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      allQuestions.push(...result.value);
      return;
    }
    const { learningObjective, granular } = units[index];
    console.error(`Failed to generate questions for objective: ${granular.text}`, result.reason);
    failures.push({
      objectiveText: granular.text || learningObjective.title || "",
      granularId: granular.granularId,
      reason: result.reason?.message || String(result.reason),
      rateLimited: result.reason?.status === 429 || result.reason?.rateLimited === true,
    });
  });

  // A total failure is an outage worth surfacing as an error. A partial one is
  // a result the instructor can still use, with the gaps named.
  if (allQuestions.length === 0 && failures.length > 0) {
    throw settled.find((r) => r.status === "rejected").reason;
  }

  return {
    questions: allQuestions,
    failures,
    tokenUsage: {
      ...tokenTotals,
      total: {
        promptTokens:
          tokenTotals.generation.promptTokens + tokenTotals.review.promptTokens + tokenTotals.fix.promptTokens,
        completionTokens:
          tokenTotals.generation.completionTokens +
          tokenTotals.review.completionTokens +
          tokenTotals.fix.completionTokens,
      },
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
        learningObjectiveId: question.learningObjectiveId,
        granularObjectiveId: question.granularObjectiveId,
        explanation: question.explanation,
        flagStatus: question.flagStatus || false,
        flagReason: question.flagReason || "",
        reviewFlag: question.reviewFlag || false,
        reviewIssue: question.reviewIssue || "",
        wasAutoFixed: question.wasAutoFixed || false,
        autoFixReason: question.autoFixReason || "",
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

// Run the AI quality review and annotate flagged questions in place. Fresh
// generation no longer calls this directly — review (and an automatic fix
// attempt) now happens server-side inside generate-questions-with-rag, and
// reviewFlag/reviewIssue arrive already populated on each question. Kept
// exported for a future "re-review after manual instructor edit" flow, which
// doesn't exist yet but is the natural fit for this endpoint.
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
    stemImages: question.stemImages || (question.stemImage ? [question.stemImage] : []),
    options: question.options || [],
    correctAnswer: question.correctAnswer ?? "",
    questionType: qt,
    acceptableAnswers: Array.isArray(question.acceptableAnswers)
      ? question.acceptableAnswers
      : [],
    bloom: question.bloom || question.bloomLevel || "Understand",
    difficulty: question.difficulty || "medium",
    learningObjectiveId: question.learningObjectiveId || null,
    granularObjectiveId: question.granularObjectiveId || null,
    by: question.createdBy || "system",
    status: question.status || "Draft",
    flagStatus: question.flagStatus || false,
    flagReason: question.flagStatus ? question.flagReason || "" : "",
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

/* ----------------- Question Bank add-question wizard helpers ----------------- */

function calcVarToForm(variable) {
  const form = {
    name: variable.name || "",
    min: String(variable.min ?? "1"),
    max: String(variable.max ?? "10"),
    type: "integer",
  };
  if (!variable.integerOnly && Number.isFinite(variable.decimals)) {
    form.type = String(Math.max(1, Math.min(3, variable.decimals)));
  }
  return form;
}

// Map a generated question card (from convertQuestionsToGroups) into the shape
// AddQuestionWizard's editable form expects, so an AI question can be reviewed
// and tweaked in the same fields as a manually authored one.
export function cardToWizardForm(card) {
  const qt = card.questionType;
  const form = {
    title: card.title || "",
    stem: card.stem || "",
    options: [
      { id: "A", text: "", feedback: "" },
      { id: "B", text: "", feedback: "" },
      { id: "C", text: "", feedback: "" },
      { id: "D", text: "", feedback: "" },
    ],
    correctAnswer: "A",
    fibCorrect: "",
    fibAcceptable: "",
    calcFormula: "",
    calcVars: [{ name: "", min: "1", max: "10", type: "integer" }],
    calcDecimals: "2",
    calcTolerance: "",
    openSample: "",
    openCriteria: "",
  };

  if (qt === QUESTION_TYPES.MULTIPLE_CHOICE) {
    const opts = card.options || {};
    form.options = ["A", "B", "C", "D"].map((id) => ({
      id,
      text: opts[id]?.text || "",
      feedback: opts[id]?.feedback || "",
    }));
    form.correctAnswer =
      card.correctAnswer && opts[card.correctAnswer] ? card.correctAnswer : "A";
  } else if (qt === QUESTION_TYPES.FILL_IN_THE_BLANK) {
    form.fibCorrect = card.correctAnswer || card.acceptableAnswers?.[0] || "";
    const rest = (card.acceptableAnswers || []).filter(
      (answer) => answer && answer !== form.fibCorrect
    );
    form.fibAcceptable = rest.join("\n");
  } else if (qt === QUESTION_TYPES.CALCULATION) {
    form.calcFormula = card.calculationFormula || "";
    const vars = Array.isArray(card.calculationVariables)
      ? card.calculationVariables
      : [];
    if (vars.length) form.calcVars = vars.map(calcVarToForm);
    form.calcDecimals = String(card.calculationAnswerDecimals ?? 2);
    form.calcTolerance =
      card.calculationAnswerTolerancePercent != null
        ? String(card.calculationAnswerTolerancePercent)
        : "";
  } else if (qt === QUESTION_TYPES.OPEN_ENDED) {
    form.openSample = card.openEndedSampleAnswer || "";
    form.openCriteria = card.openEndedGradingCriteria || "";
  }
  return form;
}

// Generate a single question for one granular objective, honouring the pinned
// question type, then run the AI quality review. Returns the editable form plus
// any review flag. Used by the Question Bank add-question wizard's AI branch.
export async function generateWizardQuestion({
  course,
  metaObjectiveId,
  metaObjectiveText,
  materialIds,
  granularObjectiveId,
  granularObjectiveText,
  bloom,
  questionType,
}) {
  const objectiveGroups = [
    {
      objectiveId: metaObjectiveId,
      title: metaObjectiveText,
      materialIds: materialIds || [],
      items: [
        {
          granularId: granularObjectiveId,
          text: granularObjectiveText,
          bloom: [bloom || "Understand"],
          count: 1,
          questionType,
        },
      ],
    },
  ];

  const { questions } = await generateQuestions(course, objectiveGroups);
  const groups = convertQuestionsToGroups(questions);

  const card = groups[0]?.los?.[0]?.questions?.[0];
  if (!card) {
    throw new Error("The AI did not return a question. Please try again.");
  }
  return {
    form: cardToWizardForm(card),
    reviewFlag: !!card.reviewFlag,
    reviewIssue: card.reviewIssue || "",
  };
}
