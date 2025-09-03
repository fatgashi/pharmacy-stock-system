const cron = require('node-cron');
const db = require('../config/mysql');
const { sendEmail } = require('../config/email');

// Production mode: Runs at 9:00 AM, 1:00 PM, and 5:00 PM daily
cron.schedule('0 9,13,17 * * *', async () => {
  console.log('📦 Running low stock check at', new Date().toISOString());

  try {
    // Get all pharmacies and their low stock settings
    const pharmacies = await db.query(`SELECT pharmacy_id, low_stock_threshold FROM pharmacy_settings`);

    for (const { pharmacy_id, low_stock_threshold } of pharmacies) {
      // Find products with low stock
      const lowStockProducts = await db.query(
        `
        SELECT 
          pp.id AS pharmacy_product_id,
          pg.name AS product_name,
          pg.barcode,
          pp.quantity,
          pp.price
        FROM pharmacy_products pp
        JOIN products_global pg ON pp.global_product_id = pg.id
        WHERE pp.pharmacy_id = ? AND pp.quantity <= ?
        `,
        [pharmacy_id, low_stock_threshold]
      );

      for (const product of lowStockProducts) {
        // Check if we already sent a notification for this product today
        const today = new Date().toISOString().split('T')[0];
        const existingNotification = await db.query(
          `SELECT * FROM notifications
           WHERE pharmacy_id = ? AND product_id = ? AND type = 'low_stock' 
           AND DATE(created_at) = ? AND is_resolved = FALSE`,
          [pharmacy_id, product.pharmacy_product_id, today]
        );

        if (existingNotification.length === 0) {
          const msg = `Produkti '${product.product_name}' (Barkodi: ${product.barcode}) ka stock të ulët (${product.quantity} copë).`;

          await db.query(
            `INSERT INTO notifications (pharmacy_id, product_id, type, message)
             VALUES (?, ?, 'low_stock', ?)`,
            [pharmacy_id, product.pharmacy_product_id, msg]
          );

          // Send email notifications if enabled
          await sendLowStockEmailNotifications(pharmacy_id, product, low_stock_threshold);
        }
      }
    }

    console.log('✅ Low stock notifications generated successfully');
  } catch (err) {
    console.error('❌ Low stock check cron job error:', err);
  }
});

// Function to send low stock email notifications
async function sendLowStockEmailNotifications(pharmacyId, product, threshold) {
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

    // Send email to each user with barcode information
    for (const user of users) {
      const emailResult = await sendEmail(
        user.email,
        'lowStockAlert',
        [product.product_name, product.barcode, product.quantity, threshold]
      );
      
      if (!emailResult.success) {
        console.error(`❌ Failed to send low stock email to ${user.email}:`, emailResult.error);
      }
    }

    console.log(`📧 Sent low stock emails to ${users.length} users for product: ${product.product_name}`);
  } catch (error) {
    console.error('❌ Error sending low stock emails:', error);
  }
}
