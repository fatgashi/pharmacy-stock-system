// src/helpers/inventory.js
const db = require('../config/mysql');

/** === Snapshot === */
async function recalcProductSnapshot(conn, pharmacy_id, pharmacy_product_id) {
    // Sum only saleable batches
    const [sumRows] = await conn.query(
      `SELECT COALESCE(SUM(quantity), 0) AS qty
         FROM product_batches
        WHERE pharmacy_id = ?
          AND pharmacy_product_id = ?
          AND status = 'active'
          AND quantity > 0
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE())`,
      [pharmacy_id, pharmacy_product_id]
    );
    const newQty = Number(sumRows[0]?.qty || 0);
  
    // Earliest saleable expiry
    const [expRows] = await conn.query(
      `SELECT MIN(expiry_date) AS next_expiry
         FROM product_batches
        WHERE pharmacy_id = ?
          AND pharmacy_product_id = ?
          AND status = 'active'
          AND quantity > 0
          AND expiry_date IS NOT NULL
          AND expiry_date >= CURRENT_DATE()`,
      [pharmacy_id, pharmacy_product_id]
    );
    const nextExpiry = expRows[0]?.next_expiry || null;
  
    await conn.query(
      `UPDATE pharmacy_products
          SET quantity = ?, expiry_date = ?, updated_at = NOW()
        WHERE id = ? AND pharmacy_id = ?`,
      [newQty, nextExpiry, pharmacy_product_id, pharmacy_id]
    );
  
    return { newQty, nextExpiry };
  }

/** === Resolve product by barcode === */
async function resolvePharmacyProduct(conn, pharmacy_id, barcode) {
  const [rows] = await conn.query(
    `SELECT pp.id AS pharmacy_product_id, pg.name, pg.id AS global_product_id
       FROM products_global pg
       JOIN pharmacy_products pp ON pp.global_product_id = pg.id
      WHERE pg.barcode = ? AND pp.pharmacy_id = ?`,
    [barcode, pharmacy_id]
  );
  return rows[0] || null;
}

/** === Log usage (one row per batch allocation) === */
async function logSaleBatchUsage(conn, {
  sale_id, sale_item_id, pharmacy_id, pharmacy_product_id, batch_id, barcode, qty
}) {
  await conn.query(
    `INSERT INTO sale_batch_usages
       (sale_id, sale_item_id, pharmacy_id, pharmacy_product_id, batch_id, barcode, qty)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sale_id, sale_item_id || null, pharmacy_id, pharmacy_product_id, batch_id, String(barcode), Number(qty)]
  );
}

/** === Consume FIFO + log exactly which batches were used === */
async function consumeFromBatchesFIFO_LOGGED(conn, {
    pharmacy_id, pharmacy_product_id, barcode, qty, sale_id, sale_item_id
  }) {
    const need = Number(qty);
    if (!Number.isFinite(need) || need <= 0) return { consumed: 0, allocations: [] };
  
    // Check saleable total
    const [sumRows] = await conn.query(
      `SELECT COALESCE(SUM(quantity),0) AS total
         FROM product_batches
        WHERE pharmacy_id = ?
          AND pharmacy_product_id = ?
          AND status = 'active'
          AND quantity > 0
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE())`,
      [pharmacy_id, pharmacy_product_id]
    );
    const total = Number(sumRows[0]?.total || 0);
    if (total < need) {
      const err = new Error('insufficient_stock');
      err.code = 'INSUFFICIENT_STOCK';
      err.details = { available: total, requested: need };
      throw err;
    }
  
    // Allocate FIFO from saleable batches only
    const [batches] = await conn.query(
      `SELECT id, quantity
         FROM product_batches
        WHERE pharmacy_id = ?
          AND pharmacy_product_id = ?
          AND status = 'active'
          AND quantity > 0
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE())
        ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, id ASC`,
      [pharmacy_id, pharmacy_product_id]
    );
  
    let remaining = need;
    const allocations = [];
    for (const b of batches) {
      if (remaining <= 0) break;
      const use = Math.min(Number(b.quantity), remaining);
      if (use > 0) {
        await conn.query(
          `UPDATE product_batches SET quantity = quantity - ? WHERE id = ? AND pharmacy_id = ?`,
          [use, b.id, pharmacy_id]
        );
        allocations.push({ batch_id: b.id, qty: use });
        await logSaleBatchUsage(conn, {
          sale_id, sale_item_id, pharmacy_id, pharmacy_product_id, batch_id: b.id, barcode, qty: use
        });
        remaining -= use;
      }
    }
  
    await recalcProductSnapshot(conn, pharmacy_id, pharmacy_product_id);
    return { consumed: need, allocations };
  }

/**
 * === Reverse usage back into the same batches ===
 * Pulls usage rows for this sale & product (optionally narrowed by sale_item_id) and returns qty into the exact batches used.
 * We traverse in LIFO order so the newest allocation is reversed first.
 * If the batch is expired/inactive, it still receives the qty, which keeps stock non-saleable (correct).
 */
async function returnToOriginalBatches_LOGGED(conn, {
  pharmacy_id, pharmacy_product_id, barcode, qtyToReturn, sale_id, sale_item_id
}) {
  let remaining = Number(qtyToReturn);
  if (!Number.isFinite(remaining) || remaining <= 0) return { returned: 0 };

  const params = [sale_id, pharmacy_id, pharmacy_product_id, String(barcode)];
  let filter = ``;
  if (sale_item_id) { filter = ` AND sale_item_id = ?`; params.push(sale_item_id); }

  const [usage] = await conn.query(
    `SELECT id, batch_id, qty
       FROM sale_batch_usages
      WHERE sale_id = ? AND pharmacy_id = ? AND pharmacy_product_id = ? AND barcode = ?
        ${filter}
      ORDER BY id DESC`, // LIFO
    params
  );

  let returned = 0;
  for (const u of usage) {
    if (remaining <= 0) break;
    const give = Math.min(Number(u.qty), remaining);

    // Add back to the exact batch id (even if expired/inactive)
    await conn.query(
      `UPDATE product_batches SET quantity = quantity + ? WHERE id = ? AND pharmacy_id = ?`,
      [give, u.batch_id, pharmacy_id]
    );

    // Reduce / clear the usage row
    if (give === Number(u.qty)) {
      await conn.query(`DELETE FROM sale_batch_usages WHERE id = ?`, [u.id]);
    } else {
      await conn.query(`UPDATE sale_batch_usages SET qty = qty - ? WHERE id = ?`, [give, u.id]);
    }

    returned += give;
    remaining -= give;
  }

  // If we couldn't find enough usage rows (shouldn't happen), we stop at what we have.
  await recalcProductSnapshot(conn, pharmacy_id, pharmacy_product_id);
  return { returned };
}

/** (Optional) low-stock notifier identical to your style */
async function checkLowStockAndNotify(conn, pharmacy_id, pharmacy_product_id) {
  const [settingsRows] = await conn.query(
    `SELECT low_stock_threshold FROM pharmacy_settings WHERE pharmacy_id = ?`,
    [pharmacy_id]
  );
  const lowStockThreshold = Number(settingsRows[0]?.low_stock_threshold ?? 10);

  const [pRows] = await conn.query(
    `SELECT quantity, global_product_id FROM pharmacy_products WHERE id = ?`,
    [pharmacy_product_id]
  );
  const qty = Number(pRows[0]?.quantity ?? 0);
  if (qty > lowStockThreshold) return;

  const [nameRows] = await conn.query(`SELECT name FROM products_global WHERE id = ?`, [pRows[0]?.global_product_id]);
  const productName = nameRows[0]?.name || 'Produkt';

  const [existing] = await conn.query(
    `SELECT id FROM notifications
      WHERE pharmacy_id = ? AND product_id = ? AND type = 'low_stock' AND is_resolved = FALSE`,
    [pharmacy_id, pharmacy_product_id]
  );
  if (existing.length === 0) {
    await conn.query(
      `INSERT INTO notifications (pharmacy_id, product_id, type, message)
       VALUES (?, ?, 'low_stock', ?)`,
      [pharmacy_id, pharmacy_product_id, `Produkti '${productName}' ka stok të ulët (${qty} njësi).`]
    );
  }
}

module.exports = {
  recalcProductSnapshot,
  resolvePharmacyProduct,
  consumeFromBatchesFIFO_LOGGED,
  returnToOriginalBatches_LOGGED,
  checkLowStockAndNotify
};
