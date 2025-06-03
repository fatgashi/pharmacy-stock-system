const db = require('../config/mysql');

exports.getNotifications = async (req, res) => {
  const { pharmacy_id } = req.user;
  const showAll = req.query.all === 'true';

  try {
    const query = `
      SELECT n.id, n.type, n.message, n.is_read, n.is_resolved, n.created_at,
             pg.name AS product_name, pg.barcode
      FROM notifications n
      JOIN pharmacy_products pp ON pp.id = n.product_id
      JOIN products_global pg ON pg.id = pp.global_product_id
      WHERE n.pharmacy_id = ?
      ${showAll ? '' : 'AND n.is_read = FALSE'}
      ORDER BY n.created_at DESC
    `;

    const notifications = await db.query(query, [pharmacy_id]);
    res.json({ notifications });
  } catch (err) {
    console.error('Fetch Notifications Error:', err);
    res.status(500).json({ message: 'Server error while fetching notifications' });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  const { id } = req.params;
  const { pharmacy_id } = req.user;

  try {
    const result = await db.query(
      `UPDATE notifications
      SET is_read = TRUE
      WHERE id = ? AND pharmacy_id = ?`,
      [id, pharmacy_id]
    );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Notification not found or access denied.' });
  }

  res.status(200).json({ message: 'Notification marked as read.' });
  } catch (err) {
    console.error('Mark Notification Read Error:', err);
    res.status(500).json({ message: 'Server error while updating notification' });
  }
};