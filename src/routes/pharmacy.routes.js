const express = require('express');
const router = express.Router();

const authenticateJWT = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/authRole.middleware');
const pharmacyController = require('../controllers/pharmacy.controller');

// Only admins can add pharmacies
router.post('/add', authenticateJWT, authorizeRoles('admin'), pharmacyController.addPharmacy);
router.get('/pharmacy-admin', authenticateJWT, authorizeRoles('admin'), pharmacyController.getPharmacyAdmins);
router.get('/list', authenticateJWT, pharmacyController.getPharmacies);
router.get('/get-pharmacies-list', authenticateJWT, authorizeRoles('admin', 'pharmacy_admin'), pharmacyController.getPharmacyList);
router.get('/details/:id', authenticateJWT, authorizeRoles("admin", "pharmacy_admin"), pharmacyController.getPharmacyById);
router.put('/update/:id', authenticateJWT, pharmacyController.updatePharmacy);

module.exports = router;
