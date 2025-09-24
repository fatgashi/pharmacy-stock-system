const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const authenticateJWT = require('../middlewares/auth.middleware');
const authRoleMiddleware = require('../middlewares/authRole.middleware');

router.get('/all', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), usersController.getAllUsers);
router.put('/profile', authenticateJWT, authRoleMiddleware('user'), usersController.updateProfile);
router.get('/profile', authenticateJWT, usersController.getProfile);
router.get('/:id', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), usersController.getUserById);
router.put('/:id', authenticateJWT, authRoleMiddleware('admin', 'pharmacy_admin'), usersController.editUser);


module.exports = router;
