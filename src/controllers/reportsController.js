const pool = require('../config/db');
const { uploadFile } = require('../utils/storage');
const { v4: uuidv4 } = require('uuid');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');

/**
 * Helper to clean markdown JSON wrapper if the LLM includes it
 */
function cleanJsonString(str) {
  let cleaned = str.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * POST /reports/upload
 * Handle PDF/Image upload, extract text (OCR), parse metrics via DeepSeek, and perform comparative progress analysis.
 */
exports.uploadAndAnalyzeReport = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const patientId = req.user.id;
    if (req.user.role !== 'patient') {
      return res.status(403).json({ success: false, message: 'Only patients can upload reports' });
    }

    console.log(`Starting upload process for user: ${patientId}, file: ${req.file.originalname}`);

    // 1. Upload file to 'medical-reports' bucket
    const fileUrl = await uploadFile('medical-reports', req.file);

    // 2. Save medical_reports entry
    const reportResult = await pool.query(
      `INSERT INTO medical_reports (patient_id, file_url, file_name)
       VALUES ($1, $2, $3)
       RETURNING id, file_name, file_url, created_at`,
      [patientId, fileUrl, req.file.originalname]
    );
    const reportId = reportResult.rows[0].id;

    // 3. Extract text depending on file type
    let extractedText = '';
    const mime = req.file.mimetype;
    console.log(`Extracting text from mime-type: ${mime}`);

    try {
      if (mime === 'application/pdf') {
        const parsedPdf = await pdfParse(req.file.buffer);
        extractedText = parsedPdf.text || '';
      } else if (mime.startsWith('image/')) {
        const ocrResult = await Tesseract.recognize(req.file.buffer, 'eng');
        extractedText = ocrResult.data.text || '';
      } else {
        extractedText = req.file.buffer.toString('utf8');
      }
    } catch (ocrErr) {
      console.error('Error during OCR or text extraction:', ocrErr.message);
      extractedText = '';
    }

    console.log(`Extracted text length: ${extractedText.length}. Parsing metrics via AI...`);

    // 4. Parse metrics using OpenRouter DeepSeek API
    let metrics = {
      heart_rate: null,
      bp_systolic: null,
      bp_diastolic: null,
      blood_sugar: null,
      weight: null,
      height: null,
      bmi: null,
      oxygen_level: null,
      cholesterol: null,
      hemoglobin: null,
      temperature: null
    };

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey === 'YOUR_NEW_KEY') {
      console.warn('⚠️ OpenRouter API Key not configured. Skipping AI metric parsing.');
    } else if (extractedText.trim().length > 0) {
      try {
        const systemPrompt = `You are a medical data extractor. Extract numerical values from the raw health report text and return them in JSON format.
Only extract:
- heart_rate (numeric bpm, e.g. 72)
- bp_systolic (numeric mmHg, e.g. 120 from 120/80)
- bp_diastolic (numeric mmHg, e.g. 80 from 120/80)
- blood_sugar (numeric mg/dL, e.g. 95)
- weight (numeric kg, e.g. 70)
- height (numeric cm, e.g. 175)
- bmi (numeric Body Mass Index, e.g. 22.8)
- oxygen_level (numeric SpO2 %, e.g. 98)
- cholesterol (numeric mg/dL, e.g. 190)
- hemoglobin (numeric g/dL, e.g. 14.2)
- temperature (numeric body temp, convert to Celsius if in Fahrenheit, e.g. 37.0)

Rules:
- If a value is missing or cannot be resolved, output null.
- Output ONLY a valid JSON object. Do NOT include markdown code blocks, explanations, or introductory text.`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat:free',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Raw report text:\n${extractedText}` }
            ]
          })
        });

        if (response.ok) {
          const resJson = await response.json();
          let rawContent = resJson.choices?.[0]?.message?.content || '{}';
          rawContent = cleanJsonString(rawContent);
          const parsed = JSON.parse(rawContent);
          
          metrics = {
            heart_rate: parsed.heart_rate ?? null,
            bp_systolic: parsed.bp_systolic ?? null,
            bp_diastolic: parsed.bp_diastolic ?? null,
            blood_sugar: parsed.blood_sugar ?? null,
            weight: parsed.weight ?? null,
            height: parsed.height ?? null,
            bmi: parsed.bmi ?? null,
            oxygen_level: parsed.oxygen_level ?? null,
            cholesterol: parsed.cholesterol ?? null,
            hemoglobin: parsed.hemoglobin ?? null,
            temperature: parsed.temperature ?? null
          };
        } else {
          console.error(`OpenRouter error status: ${response.status}`);
        }
      } catch (err) {
        console.error('Error parsing metrics via AI:', err.message);
      }
    }

    // 5. Store metrics
    const metricsResult = await pool.query(
      `INSERT INTO medical_metrics (
        report_id, patient_id, heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
        blood_sugar, weight, height, bmi, oxygen_level, cholesterol, hemoglobin, temperature
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        reportId, patientId, metrics.heart_rate, metrics.bp_systolic, metrics.bp_diastolic,
        metrics.blood_sugar, metrics.weight, metrics.height, metrics.bmi, metrics.oxygen_level,
        metrics.cholesterol, metrics.hemoglobin, metrics.temperature
      ]
    );
    const savedMetrics = metricsResult.rows[0];

    // 6. Fetch previous metrics for progress analysis
    const prevMetricsResult = await pool.query(
      `SELECT * FROM medical_metrics
       WHERE patient_id = $1 AND report_id != $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [patientId, reportId]
    );

    let progressAnalysis = {
      improved_metrics: 'N/A',
      worsened_metrics: 'N/A',
      normal_metrics: 'N/A',
      health_summary: 'First report uploaded. No historical data to compare.',
      lifestyle_recommendations: 'Please upload subsequent reports to begin tracking progress.',
      doctor_consultation_needed: false
    };

    if (prevMetricsResult.rows.length > 0 && apiKey && apiKey !== 'YOUR_NEW_KEY') {
      const prevMetrics = prevMetricsResult.rows[0];
      try {
        console.log(`Comparing with previous metrics from report: ${prevMetrics.report_id}`);
        const comparePrompt = `You are a healthcare AI assistant. Analyze the patient's health progress by comparing current metrics with their previous metrics.
Current Metrics:
${JSON.stringify(savedMetrics, null, 2)}

Previous Metrics:
${JSON.stringify(prevMetrics, null, 2)}

Provide an analysis including:
1. Improved metrics (with explanations of why it's good)
2. Worsened metrics (with precautions/warnings)
3. Normal/stable metrics
4. Health summary
5. Lifestyle/dietary recommendations
6. Whether a doctor consultation is required (set to true if any severe worsened metrics are present, otherwise false)

Format your response as a strict JSON object with these keys:
- improved_metrics (string)
- worsened_metrics (string)
- normal_metrics (string)
- health_summary (string)
- lifestyle_recommendations (string)
- doctor_consultation_needed (boolean)

Do NOT include markdown syntax or extra text outside JSON.`;

        const compareResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat:free',
            messages: [
              { role: 'user', content: comparePrompt }
            ]
          })
        });

        if (compareResponse.ok) {
          const compareJson = await compareResponse.json();
          let rawCompare = compareJson.choices?.[0]?.message?.content || '{}';
          rawCompare = cleanJsonString(rawCompare);
          const parsedCompare = JSON.parse(rawCompare);

          progressAnalysis = {
            improved_metrics: parsedCompare.improved_metrics || 'None',
            worsened_metrics: parsedCompare.worsened_metrics || 'None',
            normal_metrics: parsedCompare.normal_metrics || 'Stable',
            health_summary: parsedCompare.health_summary || 'No summary generated.',
            lifestyle_recommendations: parsedCompare.lifestyle_recommendations || 'Maintain healthy diet.',
            doctor_consultation_needed: parsedCompare.doctor_consultation_needed === true
          };
        }
      } catch (err) {
        console.error('Error generating AI comparison:', err.message);
      }
    }

    // 7. Save AI analysis
    const analysisResult = await pool.query(
      `INSERT INTO ai_report_analysis (
        report_id, patient_id, improved_metrics, worsened_metrics, normal_metrics,
        health_summary, lifestyle_recommendations, doctor_consultation_needed, raw_analysis_response
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        reportId,
        patientId,
        progressAnalysis.improved_metrics,
        progressAnalysis.worsened_metrics,
        progressAnalysis.normal_metrics,
        progressAnalysis.health_summary,
        progressAnalysis.lifestyle_recommendations,
        progressAnalysis.doctor_consultation_needed,
        JSON.stringify(progressAnalysis)
      ]
    );

    // 8. Log to report_history
    await pool.query(
      `INSERT INTO report_history (patient_id, action_type, details)
       VALUES ($1, 'upload', $2)`,
      [patientId, `Uploaded report: ${req.file.originalname}`]
    );

    res.status(201).json({
      success: true,
      message: 'Report uploaded and analyzed successfully',
      data: {
        report: reportResult.rows[0],
        metrics: savedMetrics,
        analysis: analysisResult.rows[0]
      }
    });

  } catch (err) {
    next(err);
  }
};

/**
 * GET /reports/records
 * Returns list of all historical records, prescriptions, and medical files for the patient.
 */
exports.getMedicalRecords = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    // Get uploaded reports
    const reportsQuery = await pool.query(
      `SELECT id, file_name, file_url, created_at, 'report' AS type
       FROM medical_reports
       WHERE patient_id = $1
       ORDER BY created_at DESC`,
      [patientId]
    );

    // Get shared files in chat rooms of this patient
    const chatFilesQuery = await pool.query(
      `SELECT 
        f.id, 
        f.file_name, 
        f.file_url, 
        f.created_at,
        CASE WHEN f.file_type LIKE 'application/pdf' THEN 'document' ELSE 'image' END AS type
       FROM chat_participants cp
       JOIN chat_messages m ON m.chat_id = cp.chat_id
       JOIN chat_messages_files f ON f.message_id = m.id
       WHERE cp.user_id = $1
       ORDER BY f.created_at DESC`,
      [patientId]
    );

    // Combine records
    const records = [...reportsQuery.rows, ...chatFilesQuery.rows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /reports/analyses
 * Returns list of historical AI progress tracking analyses.
 */
exports.getAnalysisHistory = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    const result = await pool.query(
      `SELECT 
        a.id, 
        a.report_id, 
        a.improved_metrics, 
        a.worsened_metrics, 
        a.normal_metrics, 
        a.health_summary, 
        a.lifestyle_recommendations, 
        a.doctor_consultation_needed, 
        a.created_at,
        r.file_name AS report_name,
        r.file_url AS report_url
       FROM ai_report_analysis a
       JOIN medical_reports r ON r.id = a.report_id
       WHERE a.patient_id = $1
       ORDER BY a.created_at DESC`,
      [patientId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};
