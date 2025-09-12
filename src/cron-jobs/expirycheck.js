const cron = require('node-cron');
const db = require('../config/mysql');
const { sendEmail } = require('../config/email');

// Runs daily at 2:00 AM server time
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running daily near-expiry check at', new Date().toISOString());

  try {
    // Pull both threshold and email toggle in one go
    const pharmacies = await db.query(`
      SELECT pharmacy_id, expiry_alert_days, COALESCE(notify_by_email, 0) AS notify_by_email
      FROM pharmacy_settings
    `);

    for (const { pharmacy_id, expiry_alert_days, notify_by_email } of pharmacies) {
      // --- A) INITIAL STAGE: within configured window but NOT exactly day 7 ---
      const initialCandidates = await db.query(
        `
        SELECT 
          pb.id AS batch_id,
          pp.id AS pharmacy_product_id,
          pg.name AS product_name,
          pg.barcode,
          pb.expiry_date,
          DATEDIFF(pb.expiry_date, CURDATE()) AS days_left
        FROM product_batches pb
        JOIN pharmacy_products pp ON pb.pharmacy_product_id = pp.id
        JOIN products_global pg ON pp.global_product_id = pg.id
        WHERE pb.pharmacy_id = ?
          AND pb.status = 'active'
          AND pb.quantity > 0
          AND pb.expiry_date >= CURDATE() -- not expired yet
          AND DATEDIFF(pb.expiry_date, CURDATE()) BETWEEN 0 AND ?
          AND DATEDIFF(pb.expiry_date, CURDATE()) <> 7
        ORDER BY pb.expiry_date ASC
        `,
        [pharmacy_id, expiry_alert_days]
      );

      for (const row of initialCandidates) {
        // Ensure we haven't already created the INITIAL notification for this batch
        const existing = await db.query(
          `SELECT id FROM notifications 
           WHERE pharmacy_id = ? AND product_id = ? AND batch_id = ? AND type = 'near_expiry_initial' 
           LIMIT 1`,
          [pharmacy_id, row.pharmacy_product_id, row.batch_id]
        );

        if (existing.length === 0) {
          const humanDate = new Date(row.expiry_date).toLocaleDateString();
          const msg = `Produkti '${row.product_name}' (Barkodi: ${row.barcode || '-'}) skadon me ${row.days_left} ditë (${humanDate}).`;

          // One-time notification per batch & stage
          await db.query(
            `INSERT INTO notifications 
               (pharmacy_id, product_id, batch_id, type, message, is_read, is_resolved, email_sent)
             VALUES (?, ?, ?, 'near_expiry_initial', ?, FALSE, FALSE, TRUE)`,
            [pharmacy_id, row.pharmacy_product_id, row.batch_id, msg]
          );

          // Email (only if enabled)
          if (notify_by_email) {
            const users = await db.query(
              `SELECT id, username, email 
               FROM users 
               WHERE pharmacy_id = ? AND email_verified = TRUE`,
              [pharmacy_id]
            );

            if (users.length > 0) {
              const templateArgs = [
                row.product_name,
                row.barcode || '-',
                humanDate,
                row.days_left,
              ];

              for (const user of users) {
                try {
                  const emailResult = await sendEmail(
                    user.email,
                    'expiryAlert',
                    templateArgs
                  );
                  if (!emailResult?.success) {
                    console.error(`❌ Failed to send near-expiry (initial) email to ${user.email}:`, emailResult?.error);
                  }
                } catch (e) {
                  console.error(`❌ Error emailing ${user.email}:`, e);
                }
              }
              console.log(`📧 Sent near-expiry (initial) emails for batch ${row.batch_id} to ${users.length} users.`);
            }
          }

          console.log(`✅ Created INITIAL near-expiry notification for batch ${row.batch_id} (${row.product_name}).`);
        } else {
          // Already notified once; do nothing (no daily spam)
          // console.log(`⏭️ Initial near-expiry already exists for batch ${row.batch_id}.`);
        }
      }

      // --- B) 7-DAY REMINDER STAGE: always independent, exactly at 7 days left ---
      const sevenDayCandidates = await db.query(
        `
        SELECT 
          pb.id AS batch_id,
          pp.id AS pharmacy_product_id,
          pg.name AS product_name,
          pg.barcode,
          pb.expiry_date,
          DATEDIFF(pb.expiry_date, CURDATE()) AS days_left
        FROM product_batches pb
        JOIN pharmacy_products pp ON pb.pharmacy_product_id = pp.id
        JOIN products_global pg ON pp.global_product_id = pg.id
        WHERE pb.pharmacy_id = ?
          AND pb.status = 'active'
          AND pb.quantity > 0
          AND DATEDIFF(pb.expiry_date, CURDATE()) = 7
        ORDER BY pb.expiry_date ASC
        `,
        [pharmacy_id]
      );

      for (const row of sevenDayCandidates) {
        const existing7 = await db.query(
          `SELECT id FROM notifications 
           WHERE pharmacy_id = ? AND product_id = ? AND batch_id = ? AND type = 'near_expiry_7d' 
           LIMIT 1`,
          [pharmacy_id, row.pharmacy_product_id, row.batch_id]
        );

        if (existing7.length === 0) {
          const humanDate = new Date(row.expiry_date).toLocaleDateString();
          const msg = `Kujtesë: Produkti '${row.product_name}' (Barkodi: ${row.barcode || '-'}) skadon për 7 ditë (${humanDate}).`;

          await db.query(
            `INSERT INTO notifications 
               (pharmacy_id, product_id, batch_id, type, message, is_read, is_resolved, email_sent)
             VALUES (?, ?, ?, 'near_expiry_7d', ?, FALSE, FALSE, TRUE)`,
            [pharmacy_id, row.pharmacy_product_id, row.batch_id, msg]
          );

          // Email (only if enabled)
          if (notify_by_email) {
            const users = await db.query(
              `SELECT id, username, email 
               FROM users 
               WHERE pharmacy_id = ? AND email_verified = TRUE`,
              [pharmacy_id]
            );

            if (users.length > 0) {
              const templateArgs = [
                row.product_name,
                row.barcode || '-',
                humanDate,
                7, // daysUntilExpiry
              ];

              for (const user of users) {
                try {
                  const emailResult = await sendEmail(
                    user.email,
                    'expiryAlert',
                    templateArgs
                  );
                  if (!emailResult?.success) {
                    console.error(`❌ Failed to send 7-day reminder email to ${user.email}:`, emailResult?.error);
                  }
                } catch (e) {
                  console.error(`❌ Error emailing ${user.email}:`, e);
                }
              }
              console.log(`📧 Sent 7-day reminder emails for batch ${row.batch_id} to ${users.length} users.`);
            }
          }

          console.log(`✅ Created 7-DAY near-expiry reminder for batch ${row.batch_id} (${row.product_name}).`);
        } else {
          // Already sent the 7-day reminder once; no repeat
          // console.log(`⏭️ 7-day reminder already exists for batch ${row.batch_id}.`);
        }
      }
    }

    console.log('✅ Near-expiry notifications processed successfully');
  } catch (err) {
    console.error('❌ Near-expiry cron error:', err);
  }
});