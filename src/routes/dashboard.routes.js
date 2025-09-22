const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/dashboard.controller');
const authorizeRoles = require('../middlewares/authRole.middleware');
const authenticateJWT = require('../middlewares/auth.middleware');

router.get('/stats', authenticateJWT, authorizeRoles('user'), getDashboardStats);

module.exports = router;
