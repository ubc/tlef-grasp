const MAX_EXISTING_QUESTIONS_IN_PROMPT = 50;
const MAX_EXISTING_QUESTION_LENGTH = 500;

const normalizeQuestionText = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const getGeneratedQuestionText = (question) =>
  question?.question || question?.stem || question?.title || "";

const uniqueQuestionTexts = (values = []) => {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const normalized = normalizeQuestionText(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(text);
  }

  return result;
};

const buildExistingQuestionsContext = (questionTexts = []) => {
  const questions = uniqueQuestionTexts(questionTexts)
    .slice(0, MAX_EXISTING_QUESTIONS_IN_PROMPT)
    .map((text) => text.slice(0, MAX_EXISTING_QUESTION_LENGTH));

  if (questions.length === 0) return "";

  return [
    "EXISTING QUESTIONS FOR THIS GRANULAR LEARNING OBJECTIVE:",
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    "Do not repeat or lightly rephrase any question above. Test a different facet, scenario, or skill.",
  ].join("\n");
};

module.exports = {
  buildExistingQuestionsContext,
  getGeneratedQuestionText,
  normalizeQuestionText,
  uniqueQuestionTexts,
};
