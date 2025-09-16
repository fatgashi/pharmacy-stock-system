const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

exports.getPharmacySettings = async (req, res) => {
  const { pharmacy_id } = req.user;

  try {
    const settings = await db.query(
      'SELECT low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard FROM pharmacy_settings WHERE pharmacy_id = ?',
      [pharmacy_id]
    );

    if (settings.length === 0) {
      return res.status(404).json({ message: 'Nuk u gjetën të dhënat e konfigurimit për këtë farmaci.' });
    }

    res.json({ settings: settings[0] });
  } catch (err) {
    console.error('Get Settings Error:', err);
    res.status(500).json({ message: 'Server error while fetching settings.' });
  }
};

// PUT /api/pharmacy/settings
exports.updatePharmacySettings = async (req, res) => {
  const { low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard, coupon } = safeBody(req);
  const { pharmacy_id } = req.user;

  // 🔍 Check if at least one field is provided
  if (
    low_stock_threshold == null &&
    expiry_alert_days == null &&
    notify_by_email == null &&
    notify_by_dashboard == null &&
    coupon == null
  ) {
    return res.status(400).json({ success: false, message: 'Të paktën një fushë duhet të jepet për përditësim!' });
  }

  try {
    const existing = await db.query('SELECT * FROM pharmacy_settings WHERE pharmacy_id = ?', [pharmacy_id]);

    // 🔄 Build dynamic fields for update/insert
    const fields = [];
    const values = [];

    if (low_stock_threshold != null) {
      fields.push('low_stock_threshold = ?');
      values.push(low_stock_threshold);
    }

    if (expiry_alert_days != null) {
      fields.push('expiry_alert_days = ?');
      values.push(expiry_alert_days);
    }

    if (notify_by_email != null) {
      fields.push('notify_by_email = ?');
      values.push(notify_by_email);
    }

    if (notify_by_dashboard != null) {
      fields.push('notify_by_dashboard = ?');
      values.push(notify_by_dashboard);
    }

    if (coupon != null) {
      fields.push('coupon = ?');
      values.push(coupon);
    }

    if (existing.length > 0) {
      // Existing settings → update only the changed fields
      const sql = `UPDATE pharmacy_settings SET ${fields.join(', ')} WHERE pharmacy_id = ?`;
      values.push(pharmacy_id);
      await db.query(sql, values);
    } else {
      // New settings → insert, filling in missing values with defaults
      await db.query(
        `INSERT INTO pharmacy_settings (pharmacy_id, low_stock_threshold, expiry_alert_days, notify_by_email, notify_by_dashboard)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          pharmacy_id,
          low_stock_threshold ?? 10,
          expiry_alert_days ?? 30,
          notify_by_email ?? false,
          notify_by_dashboard ?? true,
          coupon ?? false
        ]
      );
    }

    res.json({ success: true, message: 'Settings u përditësuan me sukses!' });
  } catch (err) {
    console.error('Update Settings Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

