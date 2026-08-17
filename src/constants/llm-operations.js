// Pipeline stages, for reporting LLM cost the way work is actually triggered.
//
// The `operation` labels recorded on each LLM call are deliberately fine-grained
// — a question batch alone emits four of them — because you cannot recover
// detail you never wrote down. These groups roll them back up into the stages an
// instructor recognizes: parsing a document, outlining it, deriving objectives,
// generating questions, reviewing and fixing them.
//
// Ordered along the pipeline, so a report reads in the order the work happens
// rather than by size.

const OPERATION_GROUPS = {
  "document-parsing": {
    label: "PDF / PPT parsing",
    operations: ["pdf-page-image", "pptx-slide-image"],
  },
  "outline-generation": {
    label: "Outline generation",
    operations: ["outline-batch", "outline-consolidate"],
  },
  "objective-generation": {
    label: "Learning objective generation",
    operations: ["objective-generate"],
  },
  "question-generation": {
    label: "Question generation",
    operations: ["question-plan", "question-generate"],
  },
  "question-review-fix": {
    label: "Question review and fix",
    operations: ["question-review", "question-fix"],
  },
  // Last in the pipeline and the only stage driven by student volume rather
  // than instructor clicks: it scales with attempts, not with authoring.
  "answer-grading": {
    label: "Answer grading",
    operations: ["grade-open-ended", "grade-fill-in-the-blank"],
  },
};

/** Anything unmapped. Nothing lands here today; a new label would. */
const OTHER_GROUP = "other";

const BY_OPERATION = new Map();
for (const [group, { operations }] of Object.entries(OPERATION_GROUPS)) {
  for (const operation of operations) BY_OPERATION.set(operation, group);
}

/**
 * The pipeline stage an operation belongs to. Unmapped operations bucket into
 * "other" rather than being dropped, so a group report's total still matches the
 * provider's bill.
 */
function groupForOperation(operation) {
  return BY_OPERATION.get(operation) || OTHER_GROUP;
}

/** Human label for a group key, including the catch-all. */
function groupLabel(group) {
  return OPERATION_GROUPS[group]?.label || "Other (unlabelled)";
}

module.exports = { OPERATION_GROUPS, OTHER_GROUP, groupForOperation, groupLabel };
