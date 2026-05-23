// src/routes/appointments.js
// ⚠️  IMPORTANT: Specific routes MUST come before wildcard /:appointmentId routes
const express = require('express');
const router = express.Router();
const apptController = require('../controllers/appointmentsController');
const { authenticate, authorize } = require('../middleware/auth');

// ── Doctor-specific (must be before /:appointmentId to avoid wildcard conflict)
router.get('/doctor/stats', authenticate, authorize('doctor'), apptController.getDoctorStats);
router.get('/doctor', authenticate, authorize('doctor'), apptController.getDoctorAppointments);
router.patch('/doctor/slots', authenticate, authorize('doctor'), apptController.updateDoctorSlots);

// ── Browse doctors (any authenticated user)
router.get('/doctors', authenticate, apptController.getDoctorsBySpeciality);
router.get('/doctors/:doctorId', authenticate, apptController.getDoctorById);
router.get('/slots/:doctorId', authenticate, apptController.getDoctorSlots);

// ── Patient routes
router.post('/book', authenticate, authorize('patient'), apptController.bookAppointment);
router.get('/patient', authenticate, authorize('patient'), apptController.getPatientAppointments);

// ── Wildcard /:appointmentId (must be LAST)
router.patch('/:appointmentId/cancel', authenticate, authorize('patient'), apptController.cancelAppointment);
router.patch('/:appointmentId/status', authenticate, authorize('doctor'), apptController.updateAppointmentStatus);

module.exports = router;
