const express = require("express");
const router = express.Router();
const materialController = require('../controllers/material');
const multer = require("multer");

// Material bodies carry full parsed document text, so they get a much larger
// limit than the app-wide 1mb default in server.js.
const MATERIAL_BODY_LIMIT = "50mb";
const largeJson = express.json({ limit: MATERIAL_BODY_LIMIT });

// Use memory storage for uploaded files so we can process them immediately.
// The fileSize cap keeps a burst of concurrent uploads from exhausting RAM.
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

router.post("/save", largeJson, materialController.saveMaterialHandler);

router.post("/upload", upload.single("file"), materialController.uploadFileHandler);

router.delete("/delete/:sourceId", materialController.deleteMaterialHandler);

router.get("/course/:courseId", materialController.getCourseMaterialsHandler);

router.post("/update", largeJson, materialController.updateMaterialHandler);

router.post("/refetch", largeJson, materialController.refetchMaterialHandler);

router.post("/fetch-url-content", express.json(), materialController.fetchUrlContentHandler);

module.exports = router;