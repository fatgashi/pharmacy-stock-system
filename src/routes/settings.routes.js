const express = require('express');
const router = express.Router();

const settingsController = require('../controllers/settings.controller');
// Middleware to protect routes
const authenticate = require('../middlewares/auth.middleware');
const authRoleMiddleware = require('../middlewares/authRole.middleware');

router.get('/get-settings', authenticate, authRoleMiddleware("user"), settingsController.getPharmacySettings);
router.put('/update-settings', authenticate, authRoleMiddleware("user"), settingsController.updatePharmacySettings);

module.exports = router;
