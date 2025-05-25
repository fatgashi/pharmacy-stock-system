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
