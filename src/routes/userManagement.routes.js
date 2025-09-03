const express = require('express');
const router = express.Router();
const userManagementController = require('../controllers/userManagement.controller');
const authenticateJWT = require('../middlewares/auth.middleware');
const authRoleMiddleware = require('../middlewares/authRole.middleware');

// ==================== DAYS OFF ROUTES ====================

// Get days off - accessible by users (their own) and admins (all in their pharmacy)
router.get('/days-off', authenticateJWT, userManagementController.getDaysOff);

// Create day off request - accessible by users (for themselves) and admins (for any user)
router.post('/days-off', authenticateJWT, userManagementController.createDayOff);

// Update day off status (approve/reject/cancel) - accessible by admins and the user who created it
router.put('/days-off/:id/status', authenticateJWT, userManagementController.updateDayOffStatus);

// ==================== SHIFTS ROUTES ====================

// Get shifts - accessible by users (their own) and admins (all in their pharmacy)
router.get('/shifts', authenticateJWT, userManagementController.getShifts);

// Create shift - accessible by users (for themselves) and admins (for any user)
router.post('/shifts', authenticateJWT, userManagementController.createShift);

// ==================== ROTATION TEMPLATES ROUTES ====================

// Get rotation templates - accessible by admins (their pharmacy's templates)
router.get('/rotation-templates', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), userManagementController.getRotationTemplates);

// Get specific rotation template with slots
router.get('/rotation-templates/:id', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), userManagementController.getRotationTemplate);

// Create rotation template - accessible by admins only
router.post('/rotation-templates', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), userManagementController.createRotationTemplate);

// ==================== ROTATION ASSIGNMENTS ROUTES ====================

// Get rotation assignments - accessible by users (their own) and admins (all in their pharmacy)
router.get('/rotation-assignments', authenticateJWT, userManagementController.getRotationAssignments);

// Create rotation assignment - accessible by admins only
router.post('/rotation-assignments', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), userManagementController.createRotationAssignment);

module.exports = router;
