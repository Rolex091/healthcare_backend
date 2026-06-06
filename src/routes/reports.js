// src/routes/reports.js
const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.post('/upload', authenticate, upload.single('file'), reportsController.uploadAndAnalyzeReport);
router.get('/records', authenticate, reportsController.getMedicalRecords);
router.get('/analyses', authenticate, reportsController.getAnalysisHistory);

module.exports = router;
