const express = require("express");
const router = express.Router();
const materialController = require('../controllers/material');
const multer = require("multer");
const {
  requireActiveCourse,
  resolveCourseFromMaterial,
} = require("../middleware/course-archive");

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

// The archived-course gate goes AFTER each body parser here, not at the top of
// the router: server.js deliberately skips its global express.json for
// /api/material (the 1mb cap would reject these bodies), so req.body does not
// exist until largeJson/multer has run.
const materialGate = requireActiveCourse();
const materialSourceGate = requireActiveCourse({ resolve: resolveCourseFromMaterial });

router.get("/course/:courseId", materialGate, materialController.getCourseMaterialsHandler);

router.post("/save", largeJson, materialGate, materialController.saveMaterialHandler);

router.post("/upload", upload.single("file"), materialGate, materialController.uploadFileHandler);

router.delete("/delete/:sourceId", materialSourceGate, materialController.deleteMaterialHandler);

router.post("/update", largeJson, materialGate, materialController.updateMaterialHandler);

router.post("/refetch", largeJson, materialGate, materialController.refetchMaterialHandler);

router.post("/fetch-url-content", express.json(), materialController.fetchUrlContentHandler);

router.get("/:sourceId/outline", materialSourceGate, materialController.getMaterialOutlineHandler);

router.post("/:sourceId/outline", materialSourceGate, materialController.generateMaterialOutlineHandler);

module.exports = router;