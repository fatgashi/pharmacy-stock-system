const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');
const authenticateJWT = require('../middlewares/auth.middleware');


// Add email to profile and send confirmation
router.post('/add', authenticateJWT, emailController.addEmailToProfile);

router.post('/contact', emailController.postContact);

// Get email status
router.get('/status', authenticateJWT, emailController.getEmailStatus);

// Resend confirmation email
router.post('/resend-confirmation', authenticateJWT, emailController.resendConfirmationEmail);

// Remove email from profile
router.delete('/remove', authenticateJWT, emailController.removeEmail);

// Confirm email (public route - no auth required)
router.get('/confirm/:token', authenticateJWT, emailController.confirmEmail);

module.exports = router;
