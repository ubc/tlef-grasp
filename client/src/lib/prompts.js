// The course prompts instructors can edit in Settings, keyed to the server's
// DEFAULT_PROMPTS. Shared with the administrator page that resets them.
export const PROMPT_FIELDS = [
  {
    key: "questionGeneration",
    label: "Question Generation Prompt",
    rows: 15,
    description:
      "Handles the creation of multiple-choice questions based on selected objectives.",
    variables: [
      ["{learningObjectiveText}", "The text of the parent learning objective."],
      ["{granularLearningObjectiveText}", "The specific sub-objective text."],
      ["{bloomLevel}", "The targeted Bloom's Taxonomy level(s)."],
      ["{questionType}", "The type of question to generate."],
      ["{ragContext}", "Relevant educational content retrieved from course materials."],
    ],
  },
  {
    key: "objectiveGenerationAuto",
    label: "Learning Objective Generation Prompt - Auto Mode",
    rows: 12,
    description:
      "Used when the AI generates a set of course learning objectives from scratch based on processed materials.",
    variables: [
      ["{courseName}", "The name of the current course."],
      ["{ragContext}", "Comprehensive content extracted from all selected materials."],
    ],
  },
  {
    key: "objectiveGenerationManual",
    label: "Learning Objective Generation Prompt - Manual Mode",
    rows: 12,
    description:
      "Used when you provide specific main objectives and want the AI to generate detailed sub-objectives and taxonomy levels for them.",
    variables: [
      ["{courseName}", "The name of the current course."],
      ["{userObjectivesList}", "The list of main objectives you provided."],
      ["{ragContext}", "Relevant content from materials to support sub-objective generation."],
    ],
  },
  {
    key: "powerPointImageDescription",
    label: "PowerPoint Image Extraction Prompt",
    rows: 8,
    description:
      "Used when PowerPoint uploads contain embedded images, charts, screenshots, or diagrams that need vision-model descriptions.",
    variables: [
      ["{slideNumber}", "The slide number containing the embedded image."],
      ["{fileName}", "The embedded image filename from the PowerPoint archive, when available."],
    ],
  },
  {
    key: "openEndedGrading",
    label: "Open-Ended Answer Grading Prompt",
    rows: 12,
    description:
      "Used when the AI grades a student's open-ended answer against the question's grading criteria and sample answer. Returns a pass/fail verdict with per-criterion feedback; instructors can override the grade in Quiz Scores.",
    variables: [
      ["{question}", "The open-ended question shown to the student."],
      ["{studentAnswer}", "The student's submitted answer."],
      ["{gradingCriteria}", "The grading criteria/rubric from the question."],
      ["{sampleAnswer}", "The sample strong answer from the question."],
    ],
  },
  {
    key: "fillInTheBlankGrading",
    label: "Fill-in-the-Blank Fallback Grading Prompt",
    rows: 12,
    description:
      "Used only when a fill-in-the-blank answer does not exactly match an accepted answer. The AI decides whether the answer is equivalent (synonym, alternate notation) and writes brief feedback; it can only upgrade an answer to correct, never downgrade an exact match.",
    variables: [
      ["{question}", "The fill-in-the-blank question with its blank."],
      ["{studentAnswer}", "The student's submitted answer."],
      ["{correctAnswer}", "The canonical correct answer."],
      ["{acceptableAnswers}", "Instructor-provided acceptable alternatives."],
    ],
  },
];
