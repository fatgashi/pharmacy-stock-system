const cron = require('node-cron');
const db = require('../config/mysql');

// Runs daily at 2:00 AM server time
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running daily batch expiry check at', new Date().toISOString());

  try {
    // Get all active batches that have expired
    const expiredBatches = await db.query(`
      SELECT pb.id AS batch_id, pb.quantity, pb.pharmacy_id, pb.pharmacy_product_id,
             pg.name AS product_name
      FROM product_batches pb
      JOIN pharmacy_products pp ON pb.pharmacy_product_id = pp.id
      JOIN products_global pg ON pp.global_product_id = pg.id
      WHERE pb.expiry_date < CURDATE() AND pb.status = 'active' AND pb.quantity > 0
    `);

    for (const batch of expiredBatches) {
        // 1. Mark batch as expired
        await db.query(
            `UPDATE product_batches SET status = 'expired' WHERE id = ?`,
            [batch.batch_id]
        );

        const nextBatch = await db.query(
            `SELECT expiry_date FROM product_batches
            WHERE pharmacy_product_id = ? AND pharmacy_id = ? AND quantity > 0 AND status = 'active'
            ORDER BY expiry_date ASC LIMIT 1`,
            [batch.pharmacy_product_id, batch.pharmacy_id]
        );

            if (nextBatch.length > 0) {
                await db.query(
                    `UPDATE pharmacy_products SET expiry_date = ? WHERE id = ?`,
                    [nextBatch[0].expiry_date, batch.pharmacy_product_id]
                );
            }

      // 2. Check if a notification already exists for this expired batch
      const existingNotif = await db.query(
        `SELECT id FROM notifications
         WHERE pharmacy_id = ? AND product_id = ? AND type = 'expired' AND is_resolved = FALSE`,
        [batch.pharmacy_id, batch.pharmacy_product_id]
      );

      if (existingNotif.length === 0) {
        const msg = `Produkti '${batch.product_name}' ka një batch të skaduar (${batch.quantity} njësi).`;

        await db.query(
          `INSERT INTO notifications (pharmacy_id, product_id, type, message)
           VALUES (?, ?, 'expired', ?)`,
          [batch.pharmacy_id, batch.pharmacy_product_id, msg]
        );
      }
    }

    console.log(`✅ ${expiredBatches.length} expired batch(es) processed.`);
  } catch (err) {
    console.error('❌ Expired Batches Cron Error:', err);
  }
});
