// app.js
require('dotenv').config();
const express = require('express');
const passport = require('passport');
require('./config/passport')(passport); // Passport config

const app = express();
app.use(express.json());
app.use(passport.initialize());

// Routes
app.get('/', (req, res) => res.send('Pharmacy Stock System API'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
