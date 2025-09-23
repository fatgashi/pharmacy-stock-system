// src/controllers/batch.controller.js
const db = require('../config/mysql');
const moment = require('moment-timezone');

async function recalcProductQuantity(conn, pharmacy_id, pharmacy_product_id) {
  const [sumRows] = await conn.query(
    `SELECT COALESCE(SUM(quantity), 0) AS qty
       FROM product_batches
      WHERE pharmacy_id = ? AND pharmacy_product_id = ? AND status = 'active'`,
    [pharmacy_id, pharmacy_product_id]
  );
  const newQty = Number(sumRows[0]?.qty || 0);
  await conn.query(
    `UPDATE pharmacy_products SET quantity = ? , updated_at = NOW()
      WHERE id = ? AND pharmacy_id = ?`,
    [newQty, pharmacy_product_id, pharmacy_id]
  );
  return newQty;
}

exports.updateBatch = async (req, res) => {
  const { batchId } = req.params;
  const { pharmacy_id } = req.user;

  // body can contain: mode ('delta'|'set'), quantity, expiry_date, status
  const { mode = 'delta', quantity, expiry_date, status } = req.body;

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Lock batch and its product
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

    // Lock product row to avoid races
    const [prodRows] = await conn.query(
      `SELECT id FROM pharmacy_products
        WHERE id = ? AND pharmacy_id = ? FOR UPDATE`,
      [batch.pharmacy_product_id, pharmacy_id]
    );
    if (!prodRows[0]) {
      await conn.rollback();
      return res.status(404).json({ message: 'Produkti nuk u gjet.' });
    }

    // Prepare updates
    const fields = [];
    const params = [];

    // Quantity logic
    if (quantity != null) {
      const q = Number(quantity);
      if (Number.isNaN(q)) {
        await conn.rollback();
        return res.status(400).json({ message: 'Sasi e pavlefshme.' });
      }
      if (mode === 'delta') {
        const newQty = Number(batch.quantity) + q;
        if (newQty < 0) {
          await conn.rollback();
          return res.status(400).json({ message: 'Sasia e batch-it nuk mund të bëhet negative.' });
        }
        fields.push('quantity = ?'); params.push(newQty);
      } else if (mode === 'set') {
        if (q < 0) {
          await conn.rollback();
          return res.status(400).json({ message: 'Sasia e batch-it nuk mund të jetë negative.' });
        }
        fields.push('quantity = ?'); params.push(q);
      } else {
        await conn.rollback();
        return res.status(400).json({ message: 'Mode i pavlefshëm. Lejohen: delta | set.' });
      }
    }

    // Expiry date validation (optional null allowed)
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

    // Status change (optional)
    if (status) {
      // if void/archived and quantity > 0, force quantity 0 (optional rule)
      if (['void', 'archived'].includes(status)) {
        fields.push('status = ?', 'quantity = 0');
        params.push(status);
      } else if (['active', 'expired'].includes(status)) {
        fields.push('status = ?'); params.push(status);
      } else {
        await conn.rollback();
        return res.status(400).json({ message: 'Status i pavlefshëm.' });
      }
    }

    if (fields.length === 0) {
      await conn.rollback();
      return res.status(400).json({ message: 'Asnjë ndryshim për t’u bërë.' });
    }

    fields.push('updated_at = NOW()');

    await conn.query(
      `UPDATE product_batches SET ${fields.join(', ')}
        WHERE id = ? AND pharmacy_id = ?`,
      [...params, batchId, pharmacy_id]
    );

    // Recalculate product total from active batches
    const newProductQty = await recalcProductQuantity(conn, pharmacy_id, batch.pharmacy_product_id);

    await conn.commit();
    return res.json({
      message: 'Batch u përditësua me sukses.',
      product_quantity: newProductQty
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
    const hard = String(req.query.hard || 'false').toLowerCase() === 'true';
  
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
  
      // If you later track batch usage in sales, check references here and block hard delete.
      if (hard) {
        if (Number(batch.quantity) !== 0) {
          await conn.rollback();
          return res.status(400).json({ message: 'Nuk lejohet fshirja e një batch-i me sasi > 0.' });
        }
        await conn.query(
          `DELETE FROM product_batches WHERE id = ? AND pharmacy_id = ?`,
          [batchId, pharmacy_id]
        );
      } else {
        // Soft delete: mark void and zero quantity
        await conn.query(
          `UPDATE product_batches
              SET status = 'void', quantity = 0, updated_at = NOW()
            WHERE id = ? AND pharmacy_id = ?`,
          [batchId, pharmacy_id]
        );
      }
  
      // Recalc product total
      const [pidRows] = await conn.query(
        `SELECT pharmacy_product_id FROM product_batches WHERE id = ?`,
        [batchId]
      );
      // Since we may have deleted it, fall back to original product id
      const pharmacy_product_id = pidRows[0]?.pharmacy_product_id ?? batch.pharmacy_product_id;
  
      await conn.query(
        `UPDATE pharmacy_products SET quantity =
            (SELECT COALESCE(SUM(quantity),0) FROM product_batches
              WHERE pharmacy_id = ? AND pharmacy_product_id = ? AND status = 'active'),
            updated_at = NOW()
          WHERE id = ? AND pharmacy_id = ?`,
        [pharmacy_id, pharmacy_product_id, pharmacy_product_id, pharmacy_id]
      );
  
      await conn.commit();
      return res.json({ message: hard ? 'Batch u fshi.' : 'Batch u çaktivizua.' });
    } catch (err) {
      if (conn) await conn.rollback();
      console.error('Delete Batch Error:', err);
      return res.status(500).json({ message: 'Gabim serveri.' });
    } finally {
      if (conn) conn.release();
    }
};
