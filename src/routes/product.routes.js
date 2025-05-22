const express = require('express');
const router = express.Router();
const authenticateJWT = require('../middlewares/auth.middleware');
const productController = require('../controllers/product.controller');

// All routes below require auth
router.use(authenticateJWT);

// Add product to pharmacy stock
router.post('/add', productController.addProductToPharmacy);

// Search by barcode (for scanner)
router.get('/barcode/:barcode', productController.getProductByBarcode);

// List all products in pharmacy
router.get('/list', productController.listPharmacyProducts);

module.exports = router;
