const express = require('express');
const router = express.Router();
const authenticateJWT = require('../middlewares/auth.middleware');
const productController = require('../controllers/product.controller');
const authorizeRole = require('../middlewares/authRole.middleware');

// All routes below require auth
router.use(authenticateJWT);

// Add product to pharmacy stock
router.post('/add', authenticateJWT, authorizeRole("user"), productController.addProductToPharmacy);

// Search by barcode (for scanner)
router.get('/barcode/:barcode', authenticateJWT, authorizeRole("user"), productController.getProductByBarcode);

// List all products in pharmacy
router.get('/list', authenticateJWT, authorizeRole("user"), productController.listPharmacyProducts);

module.exports = router;
