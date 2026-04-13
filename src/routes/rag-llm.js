const express = require("express");
const router = express.Router();
const ragLlmController = require('../controllers/rag-llm');

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

module.exports = router;
