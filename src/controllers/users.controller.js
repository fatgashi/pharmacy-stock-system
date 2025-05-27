const db = require('../config/mysql');
const bcrypt = require('bcrypt');
const { safeBody } = require('../helpers/safeBody');

exports.getAllUsers = async (req, res) => {
  const { role, id: adminId, type } = req.user;

  const limit = parseInt(req.query.limit) || 20;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim();

  try {
    if (type === 'admin' && role === 'admin') {
      // Admins
      const adminSearchClause = search ? `WHERE username LIKE ?` : '';
      const userSearchClause = search
        ? `WHERE u.username LIKE ? OR p.name LIKE ?`
        : '';

      const admins = await db.query(
        `SELECT id, username, role, 'admin' AS type FROM admins ${adminSearchClause} LIMIT ? OFFSET ?`,
        search ? [`%${search}%`, limit, offset] : [limit, offset]
      );

      const users = await db.query(
        `SELECT u.id, u.username, u.pharmacy_id, 'user' AS type,
                p.name AS pharmacy_name, p.address AS pharmacy_address
         FROM users u
         LEFT JOIN pharmacies p ON u.pharmacy_id = p.id
         ${userSearchClause}
         LIMIT ? OFFSET ?`,
        search ? [`%${search}%`, `%${search}%`, limit, offset] : [limit, offset]
      );

      const combined = [...admins, ...users];

      return res.json({
        data: combined,
        page,
        limit,
        total: combined.length,
      });
    }

    if (type === 'admin' && role === 'pharmacy_admin') {
      const pharmacies = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?`,
        [adminId]
      );
      const pharmacyIds = pharmacies.map(p => p.id);

      if (pharmacyIds.length === 0) {
        return res.json({ data: [], page, limit, total: 0 });
      }

      const placeholders = pharmacyIds.map(() => '?').join(',');
      const baseParams = [...pharmacyIds];
      const whereSearch = search ? `AND (u.username LIKE ? OR p.name LIKE ?)` : '';
      const values = search
        ? [...baseParams, `%${search}%`, `%${search}%`, limit, offset]
        : [...baseParams, limit, offset];

      const users = await db.query(
        `SELECT u.id, u.username, u.pharmacy_id, 'user' AS type,
                p.name AS pharmacy_name, p.address AS pharmacy_address, p.phone AS pharmacy_phone
         FROM users u
         JOIN pharmacies p ON u.pharmacy_id = p.id
         WHERE u.pharmacy_id IN (${placeholders}) ${whereSearch}
         LIMIT ? OFFSET ?`,
        values
      );

      return res.json({
        data: users,
        page,
        limit,
        total: users.length,
      });
    }

    return res.status(403).json({ message: 'Nuk keni autorizim për të marrë përdoruesit.' });
  } catch (err) {
    console.error('Get Users Error:', err);
    return res.status(500).json({ message: 'Gabim në server.' });
  }
};

exports.updateProfile = async (req, res) => {
    const { id } = req.user;

    const { username, password } = safeBody(req);

    if (!username && !password) {
        return res.status(400).json({ message: 'Duhet të ndryshoni të paktën username ose password.' });
    }

    try {
        // Check if username is already taken by another user
        if (username) {
        const existing = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Ky username është në përdorim.' });
        }
        }

        // Build dynamic update
        const fields = [];
        const values = [];

        if (username) {
        fields.push('username = ?');
        values.push(username);
        }

        if (password) {
        const hashed = await bcrypt.hash(password, 10);
        fields.push('password_hash = ?');
        values.push(hashed);
        }

        values.push(id); // for WHERE clause

        await db.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values
        );

        res.json({ message: 'Profili u përditësua me sukses.' });
    } catch (err) {
        console.error('Update Profile Error:', err);
        res.status(500).json({ message: 'Server error.' });
    }
};

exports.getProfile = async (req, res) => {
  const { id, type } = req.user;

  try {
    if (type === 'user') {
      const [user] = await db.query(
        `SELECT id, username, pharmacy_id, role, created_at, updated_at FROM users WHERE id = ?`,
        [id]
      );

      if (!user) return res.status(404).json({ message: 'Përdoruesi nuk u gjet.' });

      return res.json({ profile: user });
    }

    if (type === 'admin') {
      const [admin] = await db.query(
        `SELECT id, username, role, created_at, updated_at FROM admins WHERE id = ?`,
        [id]
      );

      if (!admin) return res.status(404).json({ message: 'Admini nuk u gjet.' });

      return res.json({ profile: admin });
    }

    return res.status(400).json({ message: 'Lloj përdoruesi i panjohur.' });
  } catch (err) {
    console.error('Get Profile Error:', err);
    return res.status(500).json({ message: 'Gabim në server.' });
  }
};