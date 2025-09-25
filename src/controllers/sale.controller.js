// src/controllers/sales.controller.js
const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

const {
  resolvePharmacyProduct,
  consumeFromBatchesFIFO_LOGGED,
  returnToOriginalBatches_LOGGED,
  checkLowStockAndNotify
} = require('../helpers/inventory');

/* ======================== Internal Utilities ======================== */

function computeItemDeltas(oldItems, newItems) {
  // Aggregate quantities by barcode
  const mapOld = new Map();
  for (const it of oldItems) {
    const k = String(it.product_barcode);
    mapOld.set(k, (mapOld.get(k) || 0) + Number(it.quantity));
  }
  const mapNew = new Map();
  for (const it of newItems) {
    const k = String(it.product_barcode);
    mapNew.set(k, (mapNew.get(k) || 0) + Number(it.quantity));
  }
  const keys = new Set([...mapOld.keys(), ...mapNew.keys()]);
  const out = [];
  for (const k of keys) {
    const delta = (mapNew.get(k) || 0) - (mapOld.get(k) || 0);
    if (delta !== 0) out.push({ barcode: k, deltaQty: delta });
  }
  return out;
}

async function loadSaleWithItems(conn, sale_id, pharmacy_id) {
  const [saleRows] = await conn.query(
    `SELECT * FROM sales WHERE id = ? AND pharmacy_id = ?`,
    [sale_id, pharmacy_id]
  );
  const sale = saleRows[0];
  if (!sale) return null;

  const [itemsRows] = await conn.query(
    `SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC`,
    [sale_id]
  );
  return { sale, items: itemsRows };
}

/* ============================ CREATE ============================ */

exports.confirmSale = async (req, res) => {
  let connection;

  const { items, amount_given, description } = safeBody(req);
  const { pharmacy_id, id: user_id } = req.user;

  if (!items || !Array.isArray(items) || items.length === 0 || amount_given == null) {
    return res.status(400).json({ message: 'Invalid cart or amount' });
  }

  // Optional description sanitization
  let saleDescription = null;
  if (typeof description === 'string') {
    const trimmed = description.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 2000) {
        return res.status(400).json({ message: 'Përshkrimi është shumë i gjatë (max 2000 karaktere).' });
      }
      saleDescription = trimmed;
    }
  }

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    let total = 0;
    const saleItems = [];

    // Build cart & totals (no stock mutations here)
    for (const item of items) {
      const { barcode, quantity } = item;

      const [productRows] = await connection.query(
        `SELECT pg.name, pg.barcode, pp.price, pg.id AS global_product_id, pp.id AS pharmacy_product_id
         FROM products_global pg
         JOIN pharmacy_products pp ON pp.global_product_id = pg.id
         WHERE pg.barcode = ? AND pp.pharmacy_id = ?`,
        [barcode, pharmacy_id]
      );

      const product = productRows[0];
      if (!product) {
        await connection.rollback();
        return res.status(404).json({ message: `Produkti me barcode ${barcode} nuk u gjete ne stok!` });
      }

      const qtyNum = Number(quantity);
      const priceNum = Number(product.price);
      const subtotal = priceNum * qtyNum;
      total += subtotal;

      saleItems.push({
        barcode: product.barcode,
        name: product.name,
        quantity: qtyNum,
        price: priceNum,
        subtotal,
        global_product_id: product.global_product_id,
        pharmacy_product_id: product.pharmacy_product_id
      });
    }

    const change = Number(amount_given) - Number(total);
    if (change < 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Pagesa nuk perputhet me qmimin e barnave!' });
    }

    // Insert sale header
    const [saleInsert] = await connection.query(
      `INSERT INTO sales (pharmacy_id, user_id, total, amount_given, change_given, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [pharmacy_id, user_id, total, amount_given, change, saleDescription]
    );
    const sale_id = saleInsert.insertId;

    // Insert lines, then CONSUME + LOG stock for each line
    for (const item of saleItems) {
      const [itemInsert] = await connection.query(
        `INSERT INTO sale_items (sale_id, product_barcode, product_name, quantity, price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sale_id, item.barcode, item.name, item.quantity, item.price, item.subtotal]
      );
      const sale_item_id = itemInsert.insertId;

      await consumeFromBatchesFIFO_LOGGED(connection, {
        pharmacy_id,
        pharmacy_product_id: item.pharmacy_product_id,
        barcode: item.barcode,
        qty: Number(item.quantity),
        sale_id,
        sale_item_id
      });

      await checkLowStockAndNotify(connection, pharmacy_id, item.pharmacy_product_id);
    }

    await connection.commit();

    return res.status(201).json({
      message: 'Shitja u regjistrua me sukses!',
      sale_id,
      total: total.toFixed(2),
      change: change.toFixed(2),
      description: saleDescription || null,
      items: saleItems.map(i => ({
        barcode: i.barcode,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        subtotal: i.subtotal.toFixed(2)
      }))
    });
  } catch (err) {
    if (connection) await connection.rollback();

    if (err && err.code === 'INSUFFICIENT_STOCK') {
      const { available, requested } = err.details || {};
      return res.status(400).json({
        message: `Stoku nuk mjafton (kerkuar: ${requested ?? '?'}; gjendje: ${available ?? '?'})`
      });
    }

    console.error('Sale Confirm Error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

/* ============================ LIST ============================ */

exports.listSales = async (req, res) => {
  const { pharmacy_id } = req.user;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const search = req.query.search?.trim();
  const user_id = req.query.user_id ? Number(req.query.user_id) : null;
  const min_total = req.query.min_total ? Number(req.query.min_total) : null;
  const max_total = req.query.max_total ? Number(req.query.max_total) : null;

  const date_from = req.query.date_from ? `${req.query.date_from.trim()} 00:00:00` : null;
  const date_to   = req.query.date_to   ? `${req.query.date_to.trim()} 23:59:59`   : null;

  try {
    let base = `FROM sales s WHERE s.pharmacy_id = ?`;
    const params = [pharmacy_id];

    if (user_id)        { base += ` AND s.user_id = ?`;      params.push(user_id); }
    if (min_total != null) { base += ` AND s.total >= ?`;     params.push(min_total); }
    if (max_total != null) { base += ` AND s.total <= ?`;     params.push(max_total); }
    if (date_from)      { base += ` AND s.created_at >= ?`;  params.push(date_from); }
    if (date_to)        { base += ` AND s.created_at <= ?`;  params.push(date_to); }
    if (search) {
      base += ` AND (
        s.id = ? OR
        EXISTS (
          SELECT 1 FROM sale_items si
           WHERE si.sale_id = s.id
             AND (si.product_barcode LIKE ? OR si.product_name LIKE ?)
        )
      )`;
      params.push(Number(search) || -1, `%${search}%`, `%${search}%`);
    }

    const countRows = await db.query(`SELECT COUNT(*) AS total ${base}`, params);
    const totalRows = countRows[0]?.total || 0;

    const rows = await db.query(
      `SELECT s.id, s.user_id, s.total, s.amount_given, s.change_given, s.description, s.created_at
         ${base}
       ORDER BY s.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const saleIds = rows.map(r => r.id);
    const counts = new Map();
    if (saleIds.length) {
      const placeholders = saleIds.map(() => '?').join(',');
      const crows = await db.query(
        `SELECT sale_id, COUNT(*) AS item_count
           FROM sale_items
          WHERE sale_id IN (${placeholders})
          GROUP BY sale_id`,
        saleIds
      );
      for (const r of crows) counts.set(r.sale_id, r.item_count);
    }

    const data = rows.map(r => ({ ...r, item_count: counts.get(r.id) || 0 }));
    return res.json({
      page, limit, total: totalRows, pages: Math.ceil(totalRows / limit), data
    });
  } catch (err) {
    console.error('listSales error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ============================ READ ONE ============================ */

exports.getSaleById = async (req, res) => {
  const { pharmacy_id } = req.user;
  const sale_id = Number(req.params.id);

  try {
    const conn = await db.getConnection();
    try {
      const current = await loadSaleWithItems(conn, sale_id, pharmacy_id);
      conn.release();
      if (!current) return res.status(404).json({ message: 'Sale not found' });
      return res.json(current);
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (err) {
    console.error('getSaleById error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ============================ UPDATE ============================ */

exports.updateSale = async (req, res) => {
  const { pharmacy_id } = req.user;
  const sale_id = Number(req.params.id);
  const { items, amount_given, description } = safeBody(req);

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'items required and must be non-empty' });
  }

  // Normalize/prepare new items
  const newItems = items.map(it => ({
    product_barcode: String(it.product_barcode).trim(),
    product_name: it.product_name || '',
    quantity: Number(it.quantity),
    price: Number(it.price),
    subtotal: Number(it.subtotal ?? (Number(it.price) * Number(it.quantity)))
  }));

  // Recompute totals on server
  const computedTotal = newItems.reduce((acc, it) => acc + Number(it.subtotal), 0);
  const newAmountGiven = amount_given != null ? Number(amount_given) : null;
  const newChange = newAmountGiven != null ? (newAmountGiven - computedTotal) : null;

  if (newAmountGiven != null && newChange < 0) {
    return res.status(400).json({ message: 'Pagesa nuk perputhet me qmimin e barnave!' });
  }

  // Optional description
  let saleDescription = null;
  if (typeof description === 'string') {
    const trimmed = description.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 2000) {
        return res.status(400).json({ message: 'Përshkrimi është shumë i gjatë (max 2000 karaktere).' });
      }
      saleDescription = trimmed;
    }
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const current = await loadSaleWithItems(conn, sale_id, pharmacy_id);
    if (!current) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ message: 'Sale not found' });
    }

    // Apply inventory deltas (before rewriting items)
    const deltas = computeItemDeltas(current.items, newItems);
    for (const d of deltas) {
      const product = await resolvePharmacyProduct(conn, pharmacy_id, d.barcode);
      if (!product) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ message: `Product not found for barcode ${d.barcode}` });
      }
      const pid = product.pharmacy_product_id;

      if (d.deltaQty > 0) {
        // Need to CONSUME more stock (log usage; sale_item_id not tied here on purpose)
        await consumeFromBatchesFIFO_LOGGED(conn, {
          pharmacy_id,
          pharmacy_product_id: pid,
          barcode: d.barcode,
          qty: d.deltaQty,
          sale_id,
          sale_item_id: null
        });
        await checkLowStockAndNotify(conn, pharmacy_id, pid);
      } else {
        // Need to RETURN stock to the exact batches used by this sale
        const toReturn = Math.abs(d.deltaQty);
        const { returned } = await returnToOriginalBatches_LOGGED(conn, {
          pharmacy_id,
          pharmacy_product_id: pid,
          barcode: d.barcode,
          qtyToReturn: toReturn,
          sale_id,
          sale_item_id: null
        });

        if (Number(returned) !== Number(toReturn)) {
          await conn.rollback(); conn.release();
          return res.status(409).json({
            message: `Inventory reversal mismatch for ${d.barcode} (wanted ${toReturn}, reversed ${returned}).`
          });
        }
      }
    }

    // Replace sale_items with new items
    await conn.query(`DELETE FROM sale_items WHERE sale_id = ?`, [sale_id]);

    if (newItems.length) {
      const placeholders = newItems.map(() => `(?,?,?,?,?,?)`).join(',');
      const values = newItems.flatMap(it => [
        sale_id, it.product_barcode, it.product_name, it.quantity, it.price, it.subtotal
      ]);
      await conn.query(
        `INSERT INTO sale_items (sale_id, product_barcode, product_name, quantity, price, subtotal)
         VALUES ${placeholders}`,
        values
      );
    }

    // Update sale header (use computed totals)
    await conn.query(
      `UPDATE sales
          SET total = ?, amount_given = ?, change_given = ?, description = ?
        WHERE id = ? AND pharmacy_id = ?`,
      [
        computedTotal,
        newAmountGiven,                 // may be null -> set NULL
        newAmountGiven != null ? newChange : null,
        saleDescription,
        sale_id,
        pharmacy_id
      ]
    );

    await conn.commit(); conn.release();
    return res.json({ message: 'Sale updated', sale_id });
  } catch (err) {
    if (conn) { try { await conn.rollback(); conn.release(); } catch(e) {} }

    if (err && err.code === 'INSUFFICIENT_STOCK') {
      const { available, requested } = err.details || {};
      return res.status(400).json({
        message: `Stoku nuk mjafton (kerkuar: ${requested ?? '?'}; gjendje: ${available ?? '?'})`
      });
    }

    console.error('updateSale error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ============================ DELETE ============================ */

exports.deleteSale = async (req, res) => {
  const { pharmacy_id } = req.user;
  const sale_id = Number(req.params.id);

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const current = await loadSaleWithItems(conn, sale_id, pharmacy_id);
    if (!current) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ message: 'Sale not found' });
    }

    // Reverse all quantities for this sale back to the original batches
    for (const it of current.items) {
      const product = await resolvePharmacyProduct(conn, pharmacy_id, it.product_barcode);
      if (!product) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ message: `Product not found for barcode ${it.product_barcode}` });
      }

      const qty = Number(it.quantity);
      const { returned } = await returnToOriginalBatches_LOGGED(conn, {
        pharmacy_id,
        pharmacy_product_id: product.pharmacy_product_id,
        barcode: it.product_barcode,
        qtyToReturn: qty,
        sale_id,
        sale_item_id: null
      });

      if (Number(returned) !== qty) {
        await conn.rollback(); conn.release();
        return res.status(409).json({
          message: `Inventory reversal mismatch for ${it.product_barcode} (wanted ${qty}, reversed ${returned}).`
        });
      }
    }

    // Hard delete sale and items (switch to soft-delete if you later add status columns)
    await conn.query(`DELETE FROM sale_items WHERE sale_id = ?`, [sale_id]);
    await conn.query(`DELETE FROM sales WHERE id = ? AND pharmacy_id = ?`, [sale_id, pharmacy_id]);

    await conn.commit(); conn.release();
    return res.json({ message: 'Sale deleted', sale_id });
  } catch (err) {
    if (conn) { try { await conn.rollback(); conn.release(); } catch(e) {} }
    console.error('deleteSale error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
