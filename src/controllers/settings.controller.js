const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

// PUT /api/pharmacy/settings
exports.updatePharmacySettings = async (req, res) => {
  const { low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard } = safeBody(req);
  const { pharmacy_id } = req.user;

  try {
    const existing = await db.query('SELECT * FROM pharmacy_settings WHERE pharmacy_id = ?', [pharmacy_id]);

    if (existing.length > 0) {
      await db.query(`
        UPDATE pharmacy_settings
        SET low_stock_threshold = ?, expiry_alert_days = ?, notify_by_email = ?, notify_by_dashboard = ?
        WHERE pharmacy_id = ?
      `, [low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard, pharmacy_id]);
    } else {
      await db.query(`
        INSERT INTO pharmacy_settings (pharmacy_id, low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard)
        VALUES (?, ?, ?, ?, ?)
      `, [pharmacy_id, low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard]);
    }

    res.json({ message: 'Settings updated successfully!' });
  } catch (err) {
    console.error('Update Settings Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
