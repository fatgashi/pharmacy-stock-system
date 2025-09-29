const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');
require('dotenv').config();

exports.register = async (req, res) => {
  const { username, password, role: inputRole, pharmacy_id: inputPharmacyId, target } = safeBody(req);
  const { role, id } = req.user;

  if (!username || !password || !target) {
    return res.status(400).json({ message: 'Mungon username, password ose target!' });
  }

  try {
    // Check if username exists in either table
    const [existingUser] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    const [existingAdmin] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);

    if (existingUser || existingAdmin) {
      return res.status(409).json({ message: 'Ky user ekziston!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (target === 'user') {
        if (!inputPharmacyId) {
            return res.status(400).json({ message: 'pharmacy_id është i kërkuar për regjistrimin nga pharmacy_admin!' });
        }

        let finalPharmacyId = inputPharmacyId;

        if (role === 'pharmacy_admin') {

            const [pharmacy] = await db.query(
            'SELECT * FROM pharmacies WHERE id = ? AND pharmacy_admin_id = ?',
            [inputPharmacyId, id]
            );

            if (!pharmacy) {
            return res.status(400).json({ message: 'Nuk u gjet farmacia e lidhur me këtë admin!' });
            }

            finalPharmacyId = pharmacy.id;
        } else if (role === 'admin') {

            // Optional: validate that pharmacy exists
            const [pharmacy] = await db.query('SELECT id FROM pharmacies WHERE id = ?', [inputPharmacyId]);
            if (!pharmacy) {
            return res.status(404).json({ message: 'Farmacia nuk ekziston!' });
            }

            finalPharmacyId = inputPharmacyId;
        } else {
            return res.status(403).json({ message: 'Nuk keni leje për të shtuar user!' });
        }

        if (!finalPharmacyId) {
            return res.status(400).json({ message: 'pharmacy_id është i kërkuar për regjistrimin e userit!' });
        }

        await db.query(
            'INSERT INTO users (username, role, password_hash, pharmacy_id) VALUES (?, ?, ?, ?)',
            [username, 'user', hashedPassword, finalPharmacyId]
        );

        const [settings] = await db.query(
            'SELECT id FROM pharmacy_settings WHERE pharmacy_id = ?',
            [finalPharmacyId]
        );

        if (!settings) {
            await db.query(
            `INSERT INTO pharmacy_settings (pharmacy_id, low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard)
            VALUES (?, 20, 30, FALSE, TRUE)`,
            [finalPharmacyId]
            );
        }

    } else if (target === 'admin') {
      if (role !== 'admin') {
        return res.status(403).json({ message: 'Vetëm adminat mund të shtojnë adminë të tjerë!' });
      }

      if (!inputRole) {
        return res.status(400).json({ message: 'Roli është i kërkuar për regjistrimin e adminit!' });
      }

      await db.query(
        'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
        [username, hashedPassword, inputRole]
      );
    } else {
      return res.status(400).json({ message: 'Target është i pavlefshëm. Duhet të jetë "user" ose "admin".' });
    }

    return res.status(201).json({ message: 'U regjistrua me sukses!' });

  } catch (err) {
    console.error('Register Error:', err);
    return res.status(500).json({ message: 'Gabim serveri gjatë regjistrimit!' });
  }
};

// 🔐 Login for both admins and users
exports.login = async (req, res) => {
    const { username, password } = safeBody(req);

    if (!username || !password) {
        return res.status(400).json({ message: 'Mungon username ose password!' });
    }
    
    try {

        // Try to find in admins first
        const admins = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
        if (admins.length > 0) {
        const admin = admins[0];
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) return res.status(401).json({ message: 'Password eshte gabim!' });

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
        if (user.isDeleted || user.status === 'suspended') {
            return res.status(401).json({ message: 'Ky user është i fshirë ose i suspenduar!' });
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ message: 'Password eshte gabim!' });

        const payload = {
            id: user.id,
            username: user.username,
            pharmacy_id: user.pharmacy_id,
            isDeleted: user.isDeleted,
            status: user.status,
            role: "user",
            type: 'user'
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: payload });
        }

        return res.status(404).json({ message: 'Ky user nuk egziston!' });
    } catch (err) {
        // console.error('Login Error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
};
