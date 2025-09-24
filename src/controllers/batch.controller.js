// src/controllers/batch.controller.js
const db = require('../config/mysql');
const moment = require('moment-timezone');
const { safeBody } = require('../helpers/safeBody');

async function recalcProductSnapshot(conn, pharmacy_id, pharmacy_product_id) {
  const [sumRows] = await conn.query(
    `SELECT COALESCE(SUM(quantity), 0) AS qty
       FROM product_batches
      WHERE pharmacy_id = ? AND pharmacy_product_id = ? AND status = 'active'`,
    [pharmacy_id, pharmacy_product_id]
  );
  const newQty = Number(sumRows[0]?.qty || 0);

  const [expRows] = await conn.query(
    `SELECT MIN(expiry_date) AS next_expiry
       FROM product_batches
      WHERE pharmacy_id = ?
        AND pharmacy_product_id = ?
        AND status = 'active'
        AND quantity > 0
        AND expiry_date IS NOT NULL`,
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

exports.updateBatch = async (req, res) => {
  const { batchId } = req.params;
  const { pharmacy_id } = req.user;
  const { quantity, expiry_date, status } = safeBody(req);

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Lock the batch
    const [batchRows] = await conn.query(
      `SELECT id, pharmacy_id, pharmacy_product_id, quantity, status, expiry_date
         FROM product_batches
        WHERE id = ? AND pharmacy_id = ?
        FOR UPDATE`,
      [batchId, pharmacy_id]
    );
    const batch = batchRows[0];
    if (!batch) {
      await conn.rollback();
      return res.status(404).json({ message: 'Batch nuk u gjet.' });
    }

    // Lock the parent product
    const [prodRows] = await conn.query(
      `SELECT id FROM pharmacy_products
        WHERE id = ? AND pharmacy_id = ? FOR UPDATE`,
      [batch.pharmacy_product_id, pharmacy_id]
    );
    if (!prodRows[0]) {
      await conn.rollback();
      return res.status(404).json({ message: 'Produkti nuk u gjet.' });
    }

    // Build updates
    const fields = [];
    const params = [];

    // Quantity (absolute SET)
    if (quantity != null) {
      const q = Number(quantity);
      if (!Number.isFinite(q) || q < 0) {
        await conn.rollback();
        return res.status(400).json({ message: 'Sasia e pavlefshme (duhet >= 0).' });
      }
      fields.push('quantity = ?'); params.push(q);
    }

    // Expiry date
    if (expiry_date !== undefined) {
      if (expiry_date === null || expiry_date === '') {
        fields.push('expiry_date = NULL');
      } else {
        const m = moment(expiry_date, 'YYYY-MM-DD', true);
        if (!m.isValid()) {
          await conn.rollback();
          return res.status(400).json({ message: 'Data e skadimit e pavlefshme (YYYY-MM-DD).' });
        }
        fields.push('expiry_date = ?'); params.push(m.format('YYYY-MM-DD'));
      }
    }

    // Status
    if (status) {
      const allowed = new Set(['active', 'expired', 'disposed', 'returned']);
      if (!allowed.has(status)) {
        await conn.rollback();
        return res.status(400).json({ message: 'Status i pavlefshëm.' });
      }

      // If non-sellable, force quantity 0
      if (status === 'disposed' || status === 'returned') {
        // Set status and zero out quantity regardless of previous edit
        fields.push('status = ?', 'quantity = 0'); params.push(status);
      } else {
        // 'active' or 'expired'
        fields.push('status = ?'); params.push(status);
      }
    }

    if (fields.length === 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'Asgjë për t’u ndryshuar.' });
    }

    fields.push('updated_at = NOW()');

    await conn.query(
      `UPDATE product_batches SET ${fields.join(', ')}
        WHERE id = ? AND pharmacy_id = ?`,
      [...params, batchId, pharmacy_id]
    );

    const { newQty, nextExpiry } = await recalcProductSnapshot(
      conn,
      pharmacy_id,
      batch.pharmacy_product_id
    );

    await conn.commit();
    return res.json({
      message: 'Batch u përditësua me sukses.',
      product_quantity: newQty,
      product_next_expiry: nextExpiry
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Update Batch Error:', err);
    return res.status(500).json({ message: 'Gabim serveri.' });
  } finally {
    if (conn) conn.release();
  }
};


exports.deleteBatch = async (req, res) => {
  const { batchId } = req.params;
  const { pharmacy_id } = req.user;

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [batchRows] = await conn.query(
      `SELECT id, pharmacy_id, pharmacy_product_id, quantity, status
         FROM product_batches
        WHERE id = ? AND pharmacy_id = ?
        FOR UPDATE`,
      [batchId, pharmacy_id]
    );
    const batch = batchRows[0];
    if (!batch) {
      await conn.rollback();
      return res.status(404).json({ message: 'Batch nuk u gjet.' });
    }

    // Hard delete - remove the batch entity completely
    await conn.query(
      `DELETE FROM product_batches WHERE id = ? AND pharmacy_id = ?`,
      [batchId, pharmacy_id]
    );

    // Determine the product id for recalculation
    const pharmacy_product_id = batch.pharmacy_product_id;

    const { newQty, nextExpiry } = await recalcProductSnapshot(
      conn,
      pharmacy_id,
      pharmacy_product_id
    );

    await conn.commit();
    return res.json({
      message: 'Batch u fshi.',
      product_quantity: newQty,
      product_next_expiry: nextExpiry
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Delete Batch Error:', err);
    return res.status(500).json({ message: 'Gabim serveri.' });
  } finally {
    if (conn) conn.release();
  }
};
