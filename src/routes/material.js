const express = require("express");
const router = express.Router();
const materialController = require('../controllers/material');
const multer = require("multer");

// Use memory storage for uploaded files so we can process them immediately
const upload = multer({ storage: multer.memoryStorage() });

router.post("/save", express.json(), materialController.saveMaterialHandler);

router.post("/upload", upload.single("file"), materialController.uploadFileHandler);

router.delete("/delete/:sourceId", materialController.deleteMaterialHandler);

router.get("/course/:courseId", materialController.getCourseMaterialsHandler);

router.post("/update", express.json(), materialController.updateMaterialHandler);

router.post("/refetch", express.json(), materialController.refetchMaterialHandler);

router.post("/fetch-url-content", express.json(), materialController.fetchUrlContentHandler);

module.exports = router;