const express = require('express');
const router = express.Router();

const saleController = require('../controllers/sale.controller');
const authorizeRole = require('../middlewares/authRole.middleware');
const authenticateJWT = require('../middlewares/auth.middleware');

// router.post('/cart/calculate', authenticateJWT, authorizeRole("user"), saleController.calculateCart);
router.post('/confirm', authenticateJWT, authorizeRole("user"), saleController.confirmSale);

module.exports = router;
