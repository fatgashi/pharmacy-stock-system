const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authenticateJWT = require('../middlewares/auth.middleware');
const authRoleMiddleware = require('../middlewares/authRole.middleware');

// Register
router.post('/register', authenticateJWT, authRoleMiddleware('admin'), authController.register);

// Login
router.post('/login', authController.login);

module.exports = router;
