const express = require('express');
const router = express.Router();
const {updateBatch, deleteBatch} = require('../controllers/batch.controller');
const authenticateJWT = require('../middlewares/auth.middleware');
const authRoleMiddleware = require('../middlewares/authRole.middleware');

router.patch('/edit-batch/:batchId', authenticateJWT, authRoleMiddleware('user'), updateBatch);
router.delete('/delete-batch/:batchId', authenticateJWT, authRoleMiddleware('user'), deleteBatch);

module.exports = router;