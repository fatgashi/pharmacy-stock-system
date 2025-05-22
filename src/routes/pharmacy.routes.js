const express = require('express');
const router = express.Router();

const authenticateJWT = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/authRole.middleware');
const pharmacyController = require('../controllers/pharmacy.controller');

// Only admins can add pharmacies
router.post('/add', authenticateJWT, authorizeRoles('admin'), pharmacyController.addPharmacy);

module.exports = router;
