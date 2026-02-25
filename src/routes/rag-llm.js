const express = require("express");
const router = express.Router();
const ragLlmController = require('../controllers/rag-llm');

// Add document to RAG
router.post(
  "/add-document",
  express.json({ limit: "50mb" }),  // allow up to 50 MB
  express.urlencoded({ limit: "50mb", extended: true }),
  ragLlmController.addDocumentToRagHandler
);

// Search RAG knowledge base
router.post("/search", express.json(), ragLlmController.searchRagHandler);

// Generate questions using RAG + LLM
router.post("/generate-questions-with-rag", express.json(), ragLlmController.generateQuestionsWithRagHandler);

router.delete("/delete-document/:sourceId", ragLlmController.deleteDocumentHandler);

// Generate learning objectives from selected materials
router.post("/generate-learning-objectives", express.json(), ragLlmController.generateLearningObjectivesHandler);

module.exports = router;
