const express = require('express');
const router = express.Router();
const authenticateJWT = require('../middlewares/auth.middleware');
const productController = require('../controllers/product.controller');
const authorizeRole = require('../middlewares/authRole.middleware');

// All routes below require auth
router.use(authenticateJWT);

// Add product to pharmacy stock
router.post('/add', authenticateJWT, authorizeRole("user"), productController.addProductToPharmacy);
router.post('/add-batch', authenticateJWT, authorizeRole("user"), productController.addStockByBarcode);

// Search by barcode (for scanner)
router.get('/barcode/:barcode', authenticateJWT, authorizeRole("user"), productController.getProductByBarcode);

// List all products in pharmacy
router.get('/list', authenticateJWT, authorizeRole("user"), productController.listPharmacyProducts);

router.put('/batch/:id/status', authenticateJWT, authorizeRole("user"), productController.markBatchStatus);

router.get('/expired', authenticateJWT, authorizeRole("user"), productController.getExpiredProducts);

module.exports = router;
