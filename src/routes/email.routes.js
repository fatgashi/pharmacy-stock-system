const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');
const authenticateJWT = require('../middlewares/auth.middleware');

// All email routes require authentication
router.use(authenticateJWT);

// Add email to profile and send confirmation
router.post('/add', emailController.addEmailToProfile);

// Get email status
router.get('/status', emailController.getEmailStatus);

// Resend confirmation email
router.post('/resend-confirmation', emailController.resendConfirmationEmail);

// Remove email from profile
router.delete('/remove', emailController.removeEmail);

// Confirm email (public route - no auth required)
router.get('/confirm/:token', emailController.confirmEmail);

module.exports = router;
