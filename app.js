// app.js
require('dotenv').config();
const express = require('express');
const cors = require("cors");

const passport = require('passport');

require('./src/cron-jobs/expirycheck');
require('./src/cron-jobs/expiredBatches');
require('./src/cron-jobs/lowStockCheck');

// Routes
const authRoutes = require('./src/routes/auth.routes');
const productRoutes = require('./src/routes/product.routes');
const pharmacyRoutes = require('./src/routes/pharmacy.routes');
const saleRoutes = require('./src/routes/sale.routes');
const usersRoutes = require('./src/routes/users.routes');
const notificationsRoutes = require('./src/routes/notifications.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const emailRoutes = require('./src/routes/email.routes');
const userManagementRoutes = require('./src/routes/userManagement.routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());
require('./src/config/passport')(passport);


app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pharmacies', pharmacyRoutes);
app.use('/api/sale', saleRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/user-management', userManagementRoutes);

const httpServer = require('http').createServer(app);

const port = process.env.PORT;

httpServer.listen(port, '0.0.0.0', () => console.log(`Up & Running on port ${port}`));
