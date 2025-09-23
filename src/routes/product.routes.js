const express = require('express');
const router = express.Router();
const authenticateJWT = require('../middlewares/auth.middleware');
const productController = require('../controllers/product.controller');
const authorizeRole = require('../middlewares/authRole.middleware');

// All routes below require auth
router.use(authenticateJWT);

// Add product to pharmacy stock
router.post('/add', authorizeRole("user"), productController.addProductToPharmacy);
router.post('/add-batch', authorizeRole("user"), productController.addStockByBarcode);

router.get('/:id/details', authorizeRole("user"), productController.getProductDetails);

// Search by barcode (for scanner)
router.get('/barcode/:barcode', authorizeRole("user"), productController.getProductByBarcode);

// List all products in pharmacy
router.get('/list', authorizeRole("user"), productController.listPharmacyProducts);

router.put('/batch/:id/status', authorizeRole("user"), productController.markBatchStatus);

router.get('/expired', authorizeRole("user"), productController.getExpiredProducts);

router.put('/batch/:id/edit', authorizeRole("user"), productController.editBatch);

module.exports = router;
