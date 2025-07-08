const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

// Add a new pharmacy (admin only)
exports.addPharmacy = async (req, res) => {
    const { name, address, phone, pharmacy_admin_id } = safeBody(req);

    if (!name || !pharmacy_admin_id) {
      return res.status(400).json({ message: 'Name dhe pharmacy_admin_id jane te kerkuara!' });
    }

    try {
      // Check if pharmacy_admin exists and has correct role
      const result = await db.query(
        'SELECT * FROM admins WHERE id = ? AND role = ?',
        [pharmacy_admin_id, 'pharmacy_admin']
      );

      if (result.length === 0) {
        return res.status(404).json({ message: 'Pharmacy admin nuk u gjete' });
      }

      // Insert new pharmacy
      await db.query(
        'INSERT INTO pharmacies (pharmacy_admin_id, name, address, phone) VALUES (?, ?, ?, ?)',
        [pharmacy_admin_id, name, address || '', phone || '']
      );

      res.status(201).json({ message: 'Pharmacy u krijua me sukses!' });
    } catch (err) {
      console.error('Add Pharmacy Error:', err);
      res.status(500).json({ message: 'Server error' });
    }
};

exports.getPharmacies = async (req, res) => {
  const { role, type, pharmacy_id, id: user_id } = req.user;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim();

  try {
    let query = `SELECT * FROM pharmacies WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) AS total FROM pharmacies WHERE 1=1`;
    const params = [];
    const countParams = [];

    // 🔍 Search by name or address
    if (search) {
      query += ` AND (name LIKE ? OR address LIKE ?)`;
      countQuery += ` AND (name LIKE ? OR address LIKE ?)`;
      const keyword = `%${search}%`;
      params.push(keyword, keyword);
      countParams.push(keyword, keyword);
    }

    // 🧑‍⚕️ Role: pharmacy_admin → filter their pharmacies
    if (type === 'admin' && role === 'pharmacy_admin') {
      query += ` AND pharmacy_admin_id = ?`;
      countQuery += ` AND pharmacy_admin_id = ?`;
      params.push(user_id);
      countParams.push(user_id);
    }

    // 👤 Role: user → only their pharmacy
    if (type === 'user') {
      query += ` AND id = ?`;
      countQuery += ` AND id = ?`;
      params.push(pharmacy_id);
      countParams.push(pharmacy_id);
    }

    // 📄 Add pagination
    query += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // ✅ Execute queries
    const data = await db.query(query, params);
    const countResults = await db.query(countQuery, countParams);
    const countResult = countResults[0];
    const total = countResult.total;
    const totalPages = Math.ceil(total / limit);

    return res.json({
      data,
      page,
      limit,
      total,
      totalPages
    });
  } catch (err) {
    console.error('Get Pharmacies Error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.updatePharmacy = async (req, res) => {
  const { id } = req.params;
  const { name, address, phone, status, pharmacy_admin_id } = safeBody(req);
  if (!name || !address || !phone) {
    return res.status(400).json({ message: 'name, address, dhe phone kerkohen ne body!' });
  }
  const { role, id: userId, type } = req.user;

  try {
    // Check if the pharmacy exists
    const [pharmacy] = await db.query(`SELECT * FROM pharmacies WHERE id = ?`, [id]);
    if (!pharmacy) {
      return res.status(404).json({ message: 'Pharmacy not found' });
    }

    // Role-based access control
    if (type === 'admin' && role === 'admin') {
      let updateQuery = `
        UPDATE pharmacies SET name = ?, address = ?, phone = ?, status = ?, updated_at = NOW()
      `;
      const params = [name, address, phone, status];

      // If pharmacy_admin_id is provided, validate it and include in update
      if (pharmacy_admin_id !== undefined) {
        const [admin] = await db.query(`SELECT * FROM admins WHERE id = ? AND role = 'pharmacy_admin'`, [pharmacy_admin_id]);
        if (!admin) {
          return res.status(400).json({ message: 'Invalid pharmacy_admin_id' });
        }
        updateQuery += `, pharmacy_admin_id = ?`;
        params.push(pharmacy_admin_id);
      }

      updateQuery += ` WHERE id = ?`;
      params.push(id);

      await db.query(updateQuery, params);

      return res.json({ message: 'Farmacia u përditësua me sukses!' });
    }else if (type === 'admin' && role === 'pharmacy_admin') {
      // Can only update their own pharmacies, no changing pharmacy_admin_id
      if (pharmacy.pharmacy_admin_id !== userId) {
        return res.status(403).json({ message: 'Mund ti perditsosh vetem farmacit e tua!' });
      }

      await db.query(
        `UPDATE pharmacies SET name = ?, address = ?, phone = ?, updated_at = NOW() WHERE id = ?`,
        [name, address, phone, id]
      );
      return res.json({ message: 'Farmacia u perditesua me sukses!' });

    } else if (type === 'user') {
      // Users can update only their own pharmacy
      const [user] = await db.query(`SELECT pharmacy_id FROM users WHERE id = ?`, [userId]);
      if (!user || user.pharmacy_id !== pharmacy.id) {
        return res.status(403).json({ message: 'Mund të përditësoni vetëm farmacinë tuaj!' });
      }

      await db.query(
        `UPDATE pharmacies SET name = ?, address = ?, phone = ?, updated_at = NOW() WHERE id = ?`,
        [name, address, phone, id]
      );
      return res.json({ message: 'Farmacia u perditesua me sukses!' });
    }

    return res.status(403).json({ message: 'Role i pa autorizuar!' });
  } catch (err) {
    console.error('Update Pharmacy Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getPharmacyById = async (req, res) => {
  const { id } = req.params;
  const { type, role, id: requesterId } = req.user;

  try {
    // Check access
    if (type !== 'admin' || (role !== 'admin' && role !== 'pharmacy_admin')) {
      return res.status(403).json({ message: 'Nuk keni autorizim për këtë veprim.' });
    }

    let query = `SELECT * FROM pharmacies WHERE id = ?`;
    let params = [id];

    // If pharmacy_admin, limit to their own pharmacies
    if (role === 'pharmacy_admin') {
      query += ` AND pharmacy_admin_id = ?`;
      params.push(requesterId);
    }

    const [pharmacy] = await db.query(query, params);

    if (!pharmacy) {
      return res.status(403).json({ message: 'Nuk jeni i autorizuar per kete farmaci.' });
    }

    res.json({ data: pharmacy });
  } catch (err) {
    console.error('Get Pharmacy Error:', err);
    res.status(500).json({ message: 'Gabim serveri.' });
  }
};

exports.getPharmacyAdmins = async (req, res) => {
  try {
    const results = await db.query(
      'SELECT id, username FROM admins WHERE role = ?',
      ['pharmacy_admin']
    );

    res.json({ data: results });
  } catch (err) {
    console.error('Get Pharmacy Admins Error:', err);
    res.status(500).json({ message: 'Gabim serveri.' });
  }
};

exports.getPharmacyList = async (req, res) => {
  const { role, id: userId } = req.user;

  try {
    let query = `SELECT id AS pharmacy_id, name FROM pharmacies`;
    let params = [];

    // Restrict for pharmacy_admin
    if (role === 'pharmacy_admin') {
      query += ` WHERE pharmacy_admin_id = ?`;
      params.push(userId);
    }

    const results = await db.query(query, params);
    res.json(results);
  } catch (err) {
    console.error('Get Pharmacy List Error:', err);
    res.status(500).json({ message: 'Gabim serveri gjatë marrjes së listës së farmacive.' });
  }
};