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
      // Get total counts first
      const adminCountQuery = search 
        ? `SELECT COUNT(*) as count FROM admins WHERE username LIKE ?`
        : `SELECT COUNT(*) as count FROM admins`;
      const adminCountParams = search ? [`%${search}%`] : [];
      
      const userCountQuery = search
        ? `SELECT COUNT(*) as count FROM users u LEFT JOIN pharmacies p ON u.pharmacy_id = p.id WHERE u.isDeleted = 0 AND (u.username LIKE ? OR p.name LIKE ?)`
        : `SELECT COUNT(*) as count FROM users WHERE isDeleted = 0`;
      const userCountParams = search ? [`%${search}%`, `%${search}%`] : [];

      const [adminCountResult] = await db.query(adminCountQuery, adminCountParams);
      const [userCountResult] = await db.query(userCountQuery, userCountParams);
      
      const totalAdmins = adminCountResult.count;
      const totalUsers = userCountResult.count;
      const totalCount = totalAdmins + totalUsers;

      // Calculate how many items to take from each source
      let adminLimit = 0;
      let userLimit = 0;
      let adminOffset = 0;
      let userOffset = 0;

      if (offset < totalAdmins) {
        // We need some admins
        adminLimit = Math.min(limit, totalAdmins - offset);
        adminOffset = offset;
        
        // If we need more items, get them from users
        if (adminLimit < limit) {
          userLimit = limit - adminLimit;
          userOffset = 0;
        }
      } else {
        // We're past all admins, only get users
        userLimit = limit;
        userOffset = offset - totalAdmins;
      }

      // Fetch admins if needed
      let admins = [];
      if (adminLimit > 0) {
        const adminSearchClause = search ? `WHERE username LIKE ?` : '';
        admins = await db.query(
          `SELECT id, username, role, email, 'admin' AS type FROM admins ${adminSearchClause} LIMIT ? OFFSET ?`,
          search ? [`%${search}%`, adminLimit, adminOffset] : [adminLimit, adminOffset]
        );
      }

      // Fetch users if needed
      let users = [];
      if (userLimit > 0) {
        const userSearchClause = search
          ? `WHERE u.username LIKE ? OR p.name LIKE ?`
          : '';
        users = await db.query(
          `SELECT u.id, u.username, u.email, u.status, u.pharmacy_id, 'user' AS type,
                  p.name AS pharmacy_name, p.address AS pharmacy_address, p.phone AS pharmacy_phone
           FROM users u
           LEFT JOIN pharmacies p ON u.pharmacy_id = p.id
           WHERE u.isDeleted = 0 ${userSearchClause ? 'AND ' + userSearchClause.replace('WHERE ', '') : ''}
           LIMIT ? OFFSET ?`,
          search ? [`%${search}%`, `%${search}%`, userLimit, userOffset] : [userLimit, userOffset]
        );
      }

      const combined = [...admins, ...users];

      return res.json({
        data: combined,
        page,
        limit,
        total: totalCount,
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
      
      // Get total count first
      const countQuery = `
        SELECT COUNT(*) as count
        FROM users u
        JOIN pharmacies p ON u.pharmacy_id = p.id
        WHERE u.isDeleted = 0 AND u.pharmacy_id IN (${placeholders}) ${whereSearch}
      `;
      const countParams = search 
        ? [...baseParams, `%${search}%`, `%${search}%`]
        : baseParams;
      
      const [countResult] = await db.query(countQuery, countParams);
      const totalCount = countResult.count;

      // Get paginated results
      const values = search
        ? [...baseParams, `%${search}%`, `%${search}%`, limit, offset]
        : [...baseParams, limit, offset];

      const users = await db.query(
        `SELECT u.id, u.username, u.email, u.status, u.pharmacy_id, 'user' AS type,
                p.name AS pharmacy_name, p.address AS pharmacy_address, p.phone AS pharmacy_phone
         FROM users u
         JOIN pharmacies p ON u.pharmacy_id = p.id
         WHERE u.isDeleted = 0 AND u.pharmacy_id IN (${placeholders}) ${whereSearch}
         LIMIT ? OFFSET ?`,
        values
      );

      return res.json({
        data: users,
        page,
        limit,
        total: totalCount,
      });
    }

    return res.status(403).json({ message: 'Nuk keni autorizim për të marrë përdoruesit.' });
  } catch (err) {
    console.error('Get Users Error:', err);
    return res.status(500).json({ message: 'Gabim në server.' });
  }
};

exports.getUserById = async (req, res) => {
  const { id } = req.params;
  const { role, type, id: requesterId } = req.user;

  try {

    let query = `
      SELECT u.id, u.username, u.email, u.status, u.pharmacy_id, u.role, u.created_at, u.updated_at,
             p.name AS pharmacy_name, p.address AS pharmacy_address, p.phone AS pharmacy_phone
      FROM users u
      LEFT JOIN pharmacies p ON u.pharmacy_id = p.id
      WHERE u.id = ? AND u.isDeleted = 0
    `;
    let params = [id];

    // If pharmacy_admin, ensure they can only access users from their pharmacies
    if (role === 'pharmacy_admin') {
      query += ` AND u.pharmacy_id IN (
        SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?
      )`;
      params.push(requesterId);
    }

    const [user] = await db.query(query, params);

    if (!user) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet ose nuk keni autorizim për të parë këtë përdorues.' });
    }

    return res.json({ user });
  } catch (err) {
    console.error('Get User By ID Error:', err);
    return res.status(500).json({ message: 'Gabim në server.' });
  }
};

exports.editUser = async (req, res) => {
  const { id } = req.params; // User ID to edit
  const { role, type, id: requesterId } = req.user;
  const { username, password, email, status } = safeBody(req);

  try {

    if (!username && !password && !email && !status) {
      return res.status(400).json({ message: 'Duhet të ndryshoni të paktën username, password, email ose status.' });
    }

    let query = `
      SELECT u.id, u.username, u.pharmacy_id, u.role, u.isDeleted
      FROM users u
      WHERE u.id = ? AND u.isDeleted = 0
    `;
    let params = [id];

    if (role === 'pharmacy_admin') {
      query += ` AND u.pharmacy_id IN (
        SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?
      )`;
      params.push(requesterId);
    }

    const [user] = await db.query(query, params);

    if (!user) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet ose nuk keni autorizim për të ndryshuar këtë përdorues.' });
    }

    // Check if username is already taken by another user
    if (username) {
      const existing = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
      if (existing.length > 0) {
        return res.status(409).json({ message: 'Ky username është në përdorim.' });
      }
    }

    // Check if email is already taken by another user
    if (email) {
      const existing = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
      if (existing.length > 0) {
        return res.status(409).json({ message: 'Ky email është në përdorim.' });
      }
    }

    // Validate status if provided
    if (status) {
      const allowedStatuses = ['active', 'suspended'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Status i pavlefshëm. Lejohen vetëm: active ose suspended.' });
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

    if (email) {
      fields.push('email = ?', 'email_verified = 1');
      values.push(email);
    }

    if (status) {
      fields.push('status = ?');
      values.push(status);
    }

    fields.push('updated_at = NOW()');
    values.push(id); // for WHERE clause

    await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return res.json({ message: 'Përdoruesi u përditësua me sukses.' });
  } catch (err) {
    console.error('Edit User Error:', err);
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

exports.deleteUser = async (req, res) => {
  const { id } = req.params; // User ID to delete
  const { role, type, id: requesterId } = req.user;

  try {
    // Check if user exists and get their details
    let query = `
      SELECT u.id, u.username, u.pharmacy_id, u.role, u.isDeleted
      FROM users u
      WHERE u.id = ?
    `;
    let params = [id];

    // If pharmacy_admin, ensure they can only delete users from their pharmacies
    if (role === 'pharmacy_admin') {
      query += ` AND u.pharmacy_id IN (
        SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?
      )`;
      params.push(requesterId);
    }

    const [user] = await db.query(query, params);

    if (!user) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet ose nuk keni autorizim për të fshirë këtë përdorues.' });
    }

    // Check if user is already deleted
    if (user.isDeleted) {
      return res.status(400).json({ message: 'Përdoruesi është tashmë i fshirë.' });
    }

    // Soft delete the user
    await db.query(
      `UPDATE users SET isDeleted = 1, updated_at = NOW() WHERE id = ?`,
      [id]
    );

    return res.json({ message: 'Përdoruesi u fshi me sukses.' });
  } catch (err) {
    console.error('Delete User Error:', err);
    return res.status(500).json({ message: 'Gabim në server.' });
  }
};

exports.getProfile = async (req, res) => {
  const { id, type } = req.user;

  try {
    if (type === 'user') {
      const [user] = await db.query(
        `SELECT id, username, pharmacy_id, role, created_at, updated_at FROM users WHERE id = ? AND isDeleted = 0`,
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