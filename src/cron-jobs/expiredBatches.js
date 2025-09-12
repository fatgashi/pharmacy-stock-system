const cron = require('node-cron');
const db = require('../config/mysql');
const { sendEmail } = require('../config/email');

// Runs daily at 2:00 AM server time
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running daily batch expiry check at', new Date().toISOString());

  try {
    const expiredBatches = await db.query(`
      SELECT 
        pb.id AS batch_id,
        pb.pharmacy_id,
        pb.pharmacy_product_id,
        pb.quantity,
        pb.status,
        pb.expiry_date,
        pg.name AS product_name,
        pg.barcode
      FROM product_batches pb
      JOIN pharmacy_products pp ON pb.pharmacy_product_id = pp.id
      JOIN products_global pg ON pp.global_product_id = pg.id
      WHERE pb.expiry_date < CURDATE()
        AND pb.status = 'active'
        AND pb.quantity > 0
    `);

    let processed = 0;

    for (const batch of expiredBatches) {
      try {
        // 1) Flip to expired only if still active
        const updateRes = await db.query(
          `UPDATE product_batches 
             SET status = 'expired' 
           WHERE id = ? AND status = 'active'`,
          [batch.batch_id]
        );
        const actuallyExpiredNow = updateRes.affectedRows > 0;

        // 2) Recompute next product-level expiry
        const nextBatch = await db.query(
          `SELECT expiry_date 
             FROM product_batches
            WHERE pharmacy_product_id = ? 
              AND pharmacy_id = ? 
              AND quantity > 0 
              AND status = 'active'
            ORDER BY expiry_date ASC 
            LIMIT 1`,
          [batch.pharmacy_product_id, batch.pharmacy_id]
        );

        if (nextBatch.length > 0) {
          await db.query(
            `UPDATE pharmacy_products SET expiry_date = ? WHERE id = ?`,
            [nextBatch[0].expiry_date, batch.pharmacy_product_id]
          );
        }

        // 3) One-time notification per batch (UPSERT guarded by unique index)
        const msg = `Produkti '${batch.product_name}' (Barkodi: ${batch.barcode}) ka një batch të skaduar (${batch.quantity} njësi).`;
        await db.query(
          `INSERT INTO notifications 
              (pharmacy_id, product_id, batch_id, type, message, is_read, is_resolved)
           VALUES (?, ?, ?, 'expired', ?, FALSE, FALSE)
           ON DUPLICATE KEY UPDATE message = VALUES(message)`,
          [batch.pharmacy_id, batch.pharmacy_product_id, batch.batch_id, msg]
        );

        // 4) Send email ONLY on first flip (avoid duplicates later)
        if (actuallyExpiredNow) {
          // Check pharmacy setting
          const [settings] = await db.query(
            `SELECT notify_by_email FROM pharmacy_settings WHERE pharmacy_id = ?`,
            [batch.pharmacy_id]
          );
          if (settings && settings.notify_by_email) {
            const users = await db.query(
              `SELECT id, username, email 
                 FROM users 
                WHERE pharmacy_id = ? AND email_verified = TRUE`,
              [batch.pharmacy_id]
            );

            if (users.length > 0) {
              // Prepare email data
              const humanDate = new Date(batch.expiry_date).toLocaleDateString();
              const templateArgs = [
                batch.product_name,     // name
                batch.barcode || '-',   // barcode
                humanDate,              // expired on (date)
                batch.quantity          // qty remaining
              ];

              for (const user of users) {
                try {
                  const emailResult = await sendEmail(
                    user.email,
                    'expiredBatchAlert',
                    [batch.product_name, batch.barcode || '-', humanDate, batch.quantity]
                  );
                  if (!emailResult?.success) {
                    console.error(`❌ Failed to send expired-batch email to ${user.email}:`, emailResult?.error);
                  }
                } catch (e) {
                  console.error(`❌ Error emailing ${user.email}:`, e);
                }
              }
              console.log(`📧 Sent expired-batch emails to ${users.length} users for batch ${batch.batch_id}.`);
            }
          }
        }

        processed += 1;
        console.log(
          actuallyExpiredNow
            ? `✅ Batch ${batch.batch_id} marked expired; notification + (first-time) email handled.`
            : `🔁 Batch ${batch.batch_id} already expired earlier; notification ensured (no email resend).`
        );
      } catch (innerErr) {
        console.error(`❌ Error processing batch ${batch.batch_id}:`, innerErr);
      }
    }

    console.log(`✅ Expired batches processed: ${processed}/${expiredBatches.length}`);
  } catch (err) {
    console.error('❌ Expired Batches Cron Error:', err);
  }
});
