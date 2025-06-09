const cron = require('node-cron');
const db = require('../config/mysql');

// Runs every day at 2:00 AM
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
        // Avoid duplicate notification for the same product if it's already active
        const existing = await db.query(
          `SELECT * FROM notifications
           WHERE pharmacy_id = ? AND product_id = ? AND type = 'near_expiry' AND is_resolved = FALSE`,
          [pharmacy_id, product.pharmacy_product_id]
        );

        if (existing.length === 0) {
          const msg = `Produkti '${product.product_name}' skadon me ${new Date(product.expiry_date).toLocaleDateString()}.`;

          await db.query(
            `INSERT INTO notifications (pharmacy_id, product_id, type, message)
             VALUES (?, ?, 'near_expiry', ?)`,
            [pharmacy_id, product.pharmacy_product_id, msg]
          );
        }
      }
    }

    console.log('✅ Expiry notifications generated.');
  } catch (err) {
    console.error('❌ Cron Job Error:', err);
  }
});
