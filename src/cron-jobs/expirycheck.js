const cron = require('node-cron');
const db = require('../config/mysql');
const { sendEmail } = require('../config/email');

// Production mode: Runs daily at 2:00 AM
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running daily expiry check at', new Date().toISOString());

  try {
    // Get all pharmacies and their expiry settings
    const pharmacies = await db.query(`SELECT pharmacy_id, expiry_alert_days FROM pharmacy_settings`);

    for (const { pharmacy_id, expiry_alert_days } of pharmacies) {
      const expiring = await db.query(
        `
        SELECT pp.id AS pharmacy_product_id, pg.name AS product_name, pg.barcode, pb.expiry_date
        FROM product_batches pb
        JOIN pharmacy_products pp ON pb.pharmacy_product_id = pp.id
        JOIN products_global pg ON pp.global_product_id = pg.id
        WHERE pb.pharmacy_id = ? AND pb.quantity > 0 AND pb.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        `,
        [pharmacy_id, expiry_alert_days]
      );

      for (const product of expiring) {
        // Check if we already sent a notification for this product today
        const today = new Date().toISOString().split('T')[0];
        const existingNotification = await db.query(
          `SELECT * FROM notifications
           WHERE pharmacy_id = ? AND product_id = ? AND type = 'near_expiry' 
           AND DATE(created_at) = ? AND is_resolved = FALSE`,
          [pharmacy_id, product.pharmacy_product_id, today]
        );

        if (existingNotification.length === 0) {
          const msg = `Produkti '${product.product_name}' (Barkodi: ${product.barcode}) skadon me ${new Date(product.expiry_date).toLocaleDateString()}.`;

          // Create notification
          await db.query(
            `INSERT INTO notifications (pharmacy_id, product_id, type, message)
             VALUES (?, ?, 'near_expiry', ?)`,
            [pharmacy_id, product.pharmacy_product_id, msg]
          );

          // Send email notifications if enabled
          await sendExpiryEmailNotifications(pharmacy_id, product);
        }
      }
    }

    console.log('✅ Expiry notifications generated successfully');
  } catch (err) {
    console.error('❌ Expiry check cron job error:', err);
  }
});

// Function to send expiry email notifications
async function sendExpiryEmailNotifications(pharmacyId, product) {
  try {
    // Get pharmacy settings to check if email notifications are enabled
    const [settings] = await db.query(
      'SELECT notify_by_email FROM pharmacy_settings WHERE pharmacy_id = ?',
      [pharmacyId]
    );

    if (!settings || !settings.notify_by_email) {
      return; // Email notifications not enabled for this pharmacy
    }

    // Get all users with verified emails for this pharmacy
    const users = await db.query(
      'SELECT id, username, email FROM users WHERE pharmacy_id = ? AND email_verified = TRUE',
      [pharmacyId]
    );

    if (users.length === 0) {
      return; // No users with verified emails
    }

    // Calculate days until expiry
    const expiryDate = new Date(product.expiry_date);
    const today = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

    // Send email to each user with barcode information
    for (const user of users) {
      const emailResult = await sendEmail(
        user.email,
        'expiryAlert',
        [product.product_name, product.barcode, product.expiry_date.toLocaleDateString(), daysUntilExpiry]
      );
      
      if (!emailResult.success) {
        console.error(`❌ Failed to send expiry email to ${user.email}:`, emailResult.error);
      }
    }

    console.log(`📧 Sent expiry emails to ${users.length} users for product: ${product.product_name}`);
  } catch (error) {
    console.error('❌ Error sending expiry emails:', error);
  }
}
