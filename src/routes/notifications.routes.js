const express = require('express');
const router = express.Router();

const notificationsController = require('../controllers/notifications.controller');
const authenticate = require('../middlewares/auth.middleware');
const authRoleMiddleware = require('../middlewares/authRole.middleware');

// GET /api/notifications
router.get('/', authenticate, authRoleMiddleware("user"), notificationsController.getNotifications);
// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, authRoleMiddleware("user"), notificationsController.markNotificationAsRead);

module.exports = router;