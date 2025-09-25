const express = require('express');
const router = express.Router();

const saleController = require('../controllers/sale.controller');
const authorizeRole = require('../middlewares/authRole.middleware');
const authenticateJWT = require('../middlewares/auth.middleware');

router.use(authenticateJWT);

// router.post('/cart/calculate', authenticateJWT, authorizeRole("user"), saleController.calculateCart);
router.post('/confirm', authorizeRole("user"), saleController.confirmSale);
router.get('/sales', authorizeRole("user"), saleController.listSales);
router.get('/sales/:id', authorizeRole("user"), saleController.getSaleById);
router.put('/sales/:id', authorizeRole("user"), saleController.updateSale);
router.delete('/sales/:id', authorizeRole("user"), saleController.deleteSale);

module.exports = router;
