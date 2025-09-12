// src/cron-jobs/lowStockCheck.js
const cron = require('node-cron');
const db = require('../config/mysql');
const { sendEmail } = require('../config/email');

async function ensureProductNotification({ pharmacy_id, product_id, type, message }) {
  const existing = await db.query(
    `SELECT id, is_resolved 
       FROM notifications
      WHERE pharmacy_id = ? AND product_id = ? AND type = ? AND batch_id = 0
      LIMIT 1`,
    [pharmacy_id, product_id, type]
  );

  if (existing.length === 0) {
    await db.query(
      `INSERT INTO notifications
         (pharmacy_id, product_id, batch_id, type, message, is_read, is_resolved, email_sent)
       VALUES (?, ?, 0, ?, ?, FALSE, FALSE, 0)`,
      [pharmacy_id, product_id, type, message]
    );
    return 'inserted';
  }

  const row = existing[0];
  if (row.is_resolved) {
    await db.query(
      `UPDATE notifications
          SET is_resolved = FALSE,
              resolved_at = NULL,
              message = ?,
              email_sent = 0
        WHERE id = ?`,
      [message, row.id]
    );
    return 'reopened';
  }

  return 'active';
}

async function sendEmailsToVerifiedUsers(pharmacy_id, template, templateArgs) {
  // Check if emails are enabled
  const [settings] = await db.query(
    `SELECT COALESCE(notify_by_email, 0) AS notify_by_email
       FROM pharmacy_settings
      WHERE pharmacy_id = ?`,
    [pharmacy_id]
  );
  const enabled = !!(settings && settings.notify_by_email);
  if (!enabled) return { enabled: false, recipients: 0, sent: 0 };

  const users = await db.query(
    `SELECT email
       FROM users
      WHERE pharmacy_id = ? AND email_verified = TRUE`,
    [pharmacy_id]
  );
  if (users.length === 0) return { enabled: true, recipients: 0, sent: 0 };

  let sent = 0;
  for (const u of users) {
    try {
      const res = await sendEmail(u.email, template, templateArgs);
      if (res?.success) sent += 1;
      else console.error(`❌ Email failed for ${u.email}:`, res?.error);
    } catch (e) {
      console.error(`❌ Error emailing ${u.email}:`, e);
    }
  }
  return { enabled: true, recipients: users.length, sent };
}

// Runs at 09:00, 13:00, 17:00 server time
cron.schedule('0 9,13,17 * * *', async () => {
// cron.schedule('* * * * *', async () => {
  console.log('📦 Running low stock check at', new Date().toISOString());

  try {
    // Threshold + email toggle per pharmacy (we still re-check notify_by_email inside helper)
    const pharmacies = await db.query(`
      SELECT pharmacy_id, COALESCE(low_stock_threshold, 0) AS low_stock_threshold
      FROM pharmacy_settings
    `);

    for (const { pharmacy_id, low_stock_threshold } of pharmacies) {
      // Hysteresis buffer to avoid flapping (10% or at least 1 unit)
      const buffer = Math.max(1, Math.ceil(low_stock_threshold * 0.10));
      const resolveQty = low_stock_threshold + buffer;

      // 0a) Resolve OUT_OF_STOCK if qty > 0
      const restockedFromZero = await db.query(
        `SELECT id AS pharmacy_product_id
           FROM pharmacy_products
          WHERE pharmacy_id = ? AND quantity > 0`,
        [pharmacy_id]
      );
      for (const r of restockedFromZero) {
        const res = await db.query(
          `UPDATE notifications
              SET is_resolved = TRUE, resolved_at = NOW()
            WHERE pharmacy_id = ? AND product_id = ?
              AND type = 'out_of_stock' AND is_resolved = FALSE AND batch_id = 0`,
          [pharmacy_id, r.pharmacy_product_id]
        );
        if (res.affectedRows > 0) {
          console.log(`🔄 Resolved OUT_OF_STOCK for product ${r.pharmacy_product_id} (qty > 0).`);
        }
      }

      // 0b) Resolve LOW_STOCK if qty >= threshold + buffer
      const fullyRecovered = await db.query(
        `SELECT id AS pharmacy_product_id
           FROM pharmacy_products
          WHERE pharmacy_id = ? AND quantity >= ?`,
        [pharmacy_id, resolveQty]
      );
      for (const r of fullyRecovered) {
        const res = await db.query(
          `UPDATE notifications
              SET is_resolved = TRUE, resolved_at = NOW()
            WHERE pharmacy_id = ? AND product_id = ?
              AND type = 'low_stock' AND is_resolved = FALSE AND batch_id = 0`,
          [pharmacy_id, r.pharmacy_product_id]
        );
        if (res.affectedRows > 0) {
          console.log(`🔄 Resolved LOW_STOCK for product ${r.pharmacy_product_id} (>= threshold+buffer).`);
        }
      }

      // 1) OUT OF STOCK (qty == 0) → ensure + email on transition
      const outOfStock = await db.query(
        `SELECT 
            pp.id AS pharmacy_product_id,
            pg.name AS product_name,
            pg.barcode,
            pp.quantity
           FROM pharmacy_products pp
           JOIN products_global pg ON pg.id = pp.global_product_id
          WHERE pp.pharmacy_id = ? AND pp.quantity = 0`,
        [pharmacy_id]
      );

      for (const p of outOfStock) {
        // Ensure we don't keep low_stock active at the same time
        await db.query(
          `UPDATE notifications
              SET is_resolved = TRUE, resolved_at = NOW()
            WHERE pharmacy_id = ? AND product_id = ?
              AND type = 'low_stock' AND is_resolved = FALSE AND batch_id = 0`,
          [pharmacy_id, p.pharmacy_product_id]
        );

        const msg = `Produkti '${p.product_name}' (Barkodi: ${p.barcode || '-'}) ka përfunduar (0 copë).`;
        const action = await ensureProductNotification({
          pharmacy_id,
          product_id: p.pharmacy_product_id,
          type: 'out_of_stock',
          message: msg
        });

        if (action === 'inserted' || action === 'reopened') {
          const { enabled, recipients, sent } = await sendEmailsToVerifiedUsers(
            pharmacy_id,
            'lowStockAlert', // optionally create & use 'outOfStockAlert'
            [p.product_name, p.barcode || '-', 0, low_stock_threshold]
          );

          // Mark email_sent = 1 only if email is enabled (don’t downgrade existing state)
          if (enabled) {
            await db.query(
              `UPDATE notifications
                  SET email_sent = 1
                WHERE pharmacy_id = ? AND product_id = ? 
                  AND type = 'out_of_stock' AND batch_id = 0`,
              [pharmacy_id, p.pharmacy_product_id]
            );
          }

          console.log(
            `✅ ${action.toUpperCase()} OUT_OF_STOCK for product ${p.pharmacy_product_id}. Emails: enabled=${enabled}, recipients=${recipients}, sent=${sent}`
          );
        }
      }

      // 2) LOW STOCK (0 < qty ≤ threshold) → ensure + email on transition
      const lowStock = await db.query(
        `SELECT 
            pp.id AS pharmacy_product_id,
            pg.name AS product_name,
            pg.barcode,
            pp.quantity
           FROM pharmacy_products pp
           JOIN products_global pg ON pg.id = pp.global_product_id
          WHERE pp.pharmacy_id = ?
            AND pp.quantity > 0
            AND pp.quantity <= ?`,
        [pharmacy_id, low_stock_threshold]
      );

      for (const p of lowStock) {
        // If OUT_OF_STOCK is somehow active, skip low_stock (priority)
        const existsOOS = await db.query(
          `SELECT id FROM notifications
            WHERE pharmacy_id = ? AND product_id = ?
              AND type = 'out_of_stock' AND is_resolved = FALSE AND batch_id = 0
            LIMIT 1`,
          [pharmacy_id, p.pharmacy_product_id]
        );
        if (existsOOS.length > 0) continue;

        const msg = `Produkti '${p.product_name}' (Barkodi: ${p.barcode || '-'}) ka stock të ulët (${p.quantity} copë). Pragu: ${low_stock_threshold} copë.`;
        const action = await ensureProductNotification({
          pharmacy_id,
          product_id: p.pharmacy_product_id,
          type: 'low_stock',
          message: msg
        });

        if (action === 'inserted' || action === 'reopened') {
          const { enabled, recipients, sent } = await sendEmailsToVerifiedUsers(
            pharmacy_id,
            'lowStockAlert',
            [p.product_name, p.barcode || '-', p.quantity, low_stock_threshold]
          );

          if (enabled) {
            await db.query(
              `UPDATE notifications
                  SET email_sent = 1
                WHERE pharmacy_id = ? AND product_id = ? 
                  AND type = 'low_stock' AND batch_id = 0`,
              [pharmacy_id, p.pharmacy_product_id]
            );
          }

          console.log(
            `✅ ${action.toUpperCase()} LOW_STOCK for product ${p.pharmacy_product_id}. Emails: enabled=${enabled}, recipients=${recipients}, sent=${sent}`
          );
        }
      }
    }

    console.log('✅ Low stock notifications processed successfully');
  } catch (err) {
    console.error('❌ Low stock check cron job error:', err);
  }
});
