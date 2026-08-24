const express = require("express");
const router = express.Router();
const ragLlmController = require('../controllers/rag-llm');
const {
  requireActiveCourse,
  resolveCourseFromMaterial,
} = require('../middleware/course-archive');

// Every route here is a write or a paid LLM call against one course, named by
// courseId in the body except for the document delete, which names a material.
router.use(requireActiveCourse());
router.use('/delete-document/:sourceId', requireActiveCourse({ resolve: resolveCourseFromMaterial }));

// Add document to RAG
router.post(
  "/add-document",
  ragLlmController.addDocumentToRagHandler
);

// Search RAG knowledge base
router.post("/search", ragLlmController.searchRagHandler);

// Generate questions using RAG + LLM
router.post("/generate-questions-with-rag", ragLlmController.generateQuestionsWithRagHandler);

router.delete("/delete-document/:sourceId", ragLlmController.deleteDocumentHandler);

// Generate learning objectives from selected materials
router.post("/generate-learning-objectives", ragLlmController.generateLearningObjectivesHandler);

// AI review of generated questions
router.post("/review-questions", ragLlmController.reviewQuestionsHandler);

module.exports = router;
