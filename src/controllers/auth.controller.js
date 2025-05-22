const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/mysql');
require('dotenv').config();

exports.register = async (req, res) => {
    try {
        const { username, password, role, pharmacy_id, target } = req.body;
        
        if (!username || !password || !target) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        
        // Check if username exists in either table
        const [existingUser] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        const [existingAdmin] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);

        if (existingUser || existingAdmin) {
        return res.status(409).json({ message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        if (target === 'user') {
        if (!pharmacy_id) return res.status(400).json({ message: 'pharmacy_id is required for user registration' });

        await db.query(
            'INSERT INTO users (username, password_hash, pharmacy_id) VALUES (?, ?, ?)',
            [username, hashedPassword, pharmacy_id]
        );

        } else if (target === 'admin') {
        if (!role) return res.status(400).json({ message: 'Role is required for admin registration' });
        await db.query(
            'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role]
        );
        } else {
        return res.status(400).json({ message: 'Invalid target. Must be "user" or "admin".' });
        }

        return res.status(201).json({ message: 'Registered successfully' });
  } catch (err) {
    // console.error('Register Error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// 🔐 Login for both admins and users
exports.login = async (req, res) => {
    
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Try to find in admins first
        const admins = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
        if (admins.length > 0) {
        const admin = admins[0];
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) return res.status(401).json({ message: 'Invalid credentials' });

        const payload = {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            type: 'admin'
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: payload });
        }

        // Try to find in users
        const users = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length > 0) {
        const user = users[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ message: 'Invalid credentials' });

        const payload = {
            id: user.id,
            username: user.username,
            pharmacy_id: user.pharmacy_id,
            role: "user",
            type: 'user'
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: payload });
        }

        return res.status(404).json({ message: 'User not found' });
  } catch (err) {
    // console.error('Login Error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
