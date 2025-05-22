// app.js
require('dotenv').config();
const express = require('express');
const cors = require("cors");

const passport = require('passport');
const bodyParser = require('body-parser');

// Routes
const authRoutes = require('./src/routes/auth.routes');
const productRoutes = require('./src/routes/product.routes');
const pharmacyRoutes = require('./src/routes/pharmacy.routes');

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(passport.initialize());
require('./src/config/passport')(passport);


app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pharmacies', pharmacyRoutes);

const httpServer = require('http').createServer(app);

const port = process.env.PORT;

httpServer.listen(port, '0.0.0.0', () => console.log(`Up & Running on port ${port}`));
