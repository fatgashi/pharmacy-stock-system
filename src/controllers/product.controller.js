const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

// Add or Link Product to Pharmacy Stock
exports.addProductToPharmacy = async (req, res) => {
  const { barcode, quantity, price, expiry_date, custom_name, manufacturer, description } = safeBody(req);
  const { pharmacy_id, id: user_id } = req.user;

  if (!barcode || !quantity || !price || !custom_name || !manufacturer || !description || !expiry_date) {
    return res.status(400).json({ message: 'Mungojnë fushat e kërkuara (barcode, quantity, price, expiry_date, custom_name, manufacturer, description)!' });
  }

  try {
    // 🔍 Check if global product exists
    let [globalProduct] = await db.query('SELECT * FROM products_global WHERE barcode = ?', [barcode]);

    if (!globalProduct) {
      const insert = await db.query(
        'INSERT INTO products_global (name, barcode, manufacturer, description) VALUES (?, ?, ?, ?)',
        [custom_name, barcode, manufacturer, description]
      );
      const [inserted] = await db.query('SELECT * FROM products_global WHERE id = LAST_INSERT_ID()');
      globalProduct = inserted;
    }

    // 🔍 Check if product already linked to this pharmacy
    const [pharmacyProduct] = await db.query(
      'SELECT * FROM pharmacy_products WHERE global_product_id = ? AND pharmacy_id = ?',
      [globalProduct.id, pharmacy_id]
    );

    let pharmacyProductId;

    if (!pharmacyProduct) {
      // 🧾 Create new link to pharmacy
      const result = await db.query(
        `INSERT INTO pharmacy_products (pharmacy_id, user_id, global_product_id, custom_name, quantity, price, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pharmacy_id, user_id, globalProduct.id, custom_name, quantity, price, expiry_date]
      );
      const [inserted] = await db.query('SELECT * FROM pharmacy_products WHERE id = LAST_INSERT_ID()');
      pharmacyProductId = inserted.id;
    } else {
      pharmacyProductId = pharmacyProduct.id;
    }

    // 🧾 Insert batch with pharmacy_id included
    await db.query(
      `INSERT INTO product_batches (pharmacy_id, pharmacy_product_id, quantity, expiry_date)
       VALUES (?, ?, ?, ?)`,
      [pharmacy_id, pharmacyProductId, quantity, expiry_date]
    );

    res.status(201).json({ message: 'Produkti dhe batch-i u shtuan me sukses!' });
  } catch (err) {
    console.error('Add Product Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getProductDetails = async (req, res) => {
  const { id } = req.params; // pharmacy_products.id
  const { pharmacy_id } = req.user;

  // Query params
  const includeEmpty = String(req.query.includeEmpty || 'false').toLowerCase() === 'true';
  const orderByRaw = (req.query.orderBy || 'expiry_date').toLowerCase();
  const orderRaw   = (req.query.order || 'asc').toLowerCase();
  let   page       = parseInt(req.query.page, 10) || 1;
  let   limit      = parseInt(req.query.limit, 10) || 20;

  // Safety: clamp pagination + whitelist sort
  if (page < 1) page = 1;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  const allowedOrderBy = new Set(['expiry_date', 'created_at']);
  const orderBy = allowedOrderBy.has(orderByRaw) ? orderByRaw : 'expiry_date';

  const order = (orderRaw === 'desc') ? 'DESC' : 'ASC';

  const offset = (page - 1) * limit;

  try {
    // 1) Product (with global name)
    const productRows = await db.query(
      `SELECT 
          pp.id,
          pp.pharmacy_id,
          pp.global_product_id,
          pg.name AS global_name,
          pp.custom_name,
          pp.quantity,
          pp.price,
          pp.expiry_date
       FROM pharmacy_products pp
       JOIN products_global pg ON pg.id = pp.global_product_id
       WHERE pp.id = ? AND pp.pharmacy_id = ?
       LIMIT 1`,
      [id, pharmacy_id]
    );

    const product = productRows[0];
    if (!product) {
      return res.status(404).json({ message: 'Produkti nuk u gjet.' });
    }

    // 2) Build WHERE for batches
    let where = `WHERE pharmacy_product_id = ? AND pharmacy_id = ?`;
    const params = [id, pharmacy_id];

    if (!includeEmpty) {
      where += ` AND quantity > 0`;
    }

    // 3) Total count (for pagination)
    const countRows = await db.query(
      `SELECT COUNT(*) AS total FROM product_batches ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    // 4) Batches listing (active first, then by chosen field, NULLS LAST)
    // We keep active first for usability; adjust if you ever want otherwise.
    const batches = await db.query(
      `
      SELECT 
          id, pharmacy_product_id, quantity, expiry_date, status, created_at, updated_at
      FROM product_batches
      ${where}
      ORDER BY 
          CASE WHEN status = 'active' THEN 0 ELSE 1 END,
          ${orderBy} IS NULL,        -- push NULLs last
          ${orderBy} ${order},
          id ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    // 5) Quick aggregate sanity (sum active quantities across *all* batches)
    //    Note: This ignores pagination—intentionally, to compare against product.quantity.
    const activeAggRows = await db.query(
      `
      SELECT COALESCE(SUM(quantity), 0) AS active_qty
      FROM product_batches
      WHERE pharmacy_product_id = ? AND pharmacy_id = ? AND status = 'active'
      `,
      [id, pharmacy_id]
    );
    const activeQty = Number(activeAggRows[0]?.active_qty || 0);

    return res.json({
      data: {
        product,
        batches,
        aggregates: {
          activeQuantity: activeQty,
          productQuantity: Number(product.quantity || 0),
          mismatch: activeQty !== Number(product.quantity || 0)
        }
      },
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1
      },
      query: {
        includeEmpty,
        orderBy,
        order
      }
    });
  } catch (err) {
    console.error('Get Product Details Error:', err);
    return res.status(500).json({ message: 'Gabim serveri.' });
  }
};

// Search by barcode (scanner)
exports.getProductByBarcode = async (req, res) => {
    const { barcode } = req.params;
    const { pharmacy_id } = req.user;

    try {
      const result = await db.query(
        `SELECT pg.*, pp.quantity, pp.id AS pharmacy_product_id, pp.price, pp.expiry_date
        FROM products_global pg
        JOIN pharmacy_products pp ON pp.global_product_id = pg.id
        WHERE pg.barcode = ? AND pp.pharmacy_id = ?`,
        [barcode, pharmacy_id]
      );

      if (result.length === 0) {
        return res.status(404).json({ message: 'Product not found in your pharmacy stock' });
      }

      res.json(result[0]);
    } catch (err) {
      console.error('Get Product Error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  };

// List products in pharmacy (paginated)
exports.listPharmacyProducts = async (req, res) => {
  const { pharmacy_id } = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim();

  // Ensure times are appended correctly for DATETIME
  const expiry_before_raw = req.query.expiry_before?.trim();
  const expiry_after_raw = req.query.expiry_after?.trim();

  const expiry_before = expiry_before_raw
    ? `${expiry_before_raw} 23:59:59`
    : null;

  const expiry_after = expiry_after_raw
    ? `${expiry_after_raw} 00:00:00`
    : null;

  try {
    let query = `
      SELECT pg.*, pp.quantity, pp.id AS pharmacy_product_id, pp.price, pp.expiry_date
      FROM products_global pg
      JOIN pharmacy_products pp ON pp.global_product_id = pg.id
      WHERE pp.pharmacy_id = ?
    `;
    const params = [pharmacy_id];

    if (search) {
      query += ` AND (pg.name LIKE ? OR pg.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (expiry_after) {
      query += ` AND pp.expiry_date >= ?`;
      params.push(expiry_after);
    }

    if (expiry_before) {
      query += ` AND pp.expiry_date <= ?`;
      params.push(expiry_before);
    }

    query += ` ORDER BY pg.name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const products = await db.query(query, params);

    res.json({ data: products, page, limit, total: products.length });
  } catch (err) {
    console.error('List Products Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.addStockByBarcode = async (req, res) => {
  const { barcode, quantity, expiry_date, price, update_price } = safeBody(req);
  const { pharmacy_id } = req.user;

  if (!barcode || !quantity || !expiry_date) {
    return res.status(400).json({ message: 'Mungojnë fushat e kërkuara (barcode, quantity, expiry_date)!' });
  }

  try {
    // 🔍 Find pharmacy product + current qty
    const [result] = await db.query(
      `SELECT 
         pp.id   AS pharmacy_product_id, 
         pp.quantity AS current_quantity
       FROM products_global pg
       JOIN pharmacy_products pp ON pg.id = pp.global_product_id
       WHERE pg.barcode = ? AND pp.pharmacy_id = ?`,
      [barcode, pharmacy_id]
    );

    if (!result) {
      return res.status(404).json({ message: 'Produkti nuk u gjet në këtë farmaci!' });
    }

    const { pharmacy_product_id, current_quantity } = result;
    const newQuantity = Number(current_quantity) + Number(quantity);

    // ⚙️ Get low-stock settings for resolution/hysteresis
    const [settings] = await db.query(
      `SELECT COALESCE(low_stock_threshold, 0) AS low_stock_threshold 
         FROM pharmacy_settings 
        WHERE pharmacy_id = ?`,
      [pharmacy_id]
    );
    const low_stock_threshold = settings?.low_stock_threshold ?? 0;
    const buffer = Math.max(1, Math.ceil(low_stock_threshold * 0.10));
    const resolveQty = low_stock_threshold + buffer;

    // ➕ Insert new batch (ensure status 'active' if your default isn't set)
    await db.query(
      `INSERT INTO product_batches (pharmacy_id, pharmacy_product_id, quantity, expiry_date, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [pharmacy_id, pharmacy_product_id, quantity, expiry_date]
    );

    // 🔄 Build product update (qty, optional price)
    const updateFields = [`quantity = quantity + ?`];
    const updateParams = [quantity];

    if (update_price === true && price) {
      updateFields.push(`price = ?`);
      updateParams.push(price);
    }

    updateParams.push(pharmacy_product_id);

    await db.query(
      `UPDATE pharmacy_products SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // ♻️ Recalculate product's "next expiry" snapshot from batches (always)
    const [nextExp] = await db.query(
      `SELECT MIN(expiry_date) AS next_expiry
         FROM product_batches
        WHERE pharmacy_id = ?
          AND pharmacy_product_id = ?
          AND status = 'active'
          AND quantity > 0`,
      [pharmacy_id, pharmacy_product_id]
    );

    await db.query(
      `UPDATE pharmacy_products
          SET expiry_date = ?
        WHERE id = ?`,
      [nextExp?.next_expiry || null, pharmacy_product_id]
    );

    // ✅ Resolve / ensure notifications (product-level, batch_id = 0)
    // 1) If product was out of stock and now has >0 → resolve OUT_OF_STOCK
    if (current_quantity === 0 && newQuantity > 0) {
      await db.query(
        `UPDATE notifications
            SET is_resolved = TRUE, resolved_at = NOW()
          WHERE pharmacy_id = ? AND product_id = ? 
            AND type = 'out_of_stock' AND is_resolved = FALSE AND batch_id = 0`,
        [pharmacy_id, pharmacy_product_id]
      );
    }

    // 2) Low-stock resolution/ensure logic with hysteresis
    if (newQuantity >= resolveQty) {
      // Fully recovered → resolve LOW_STOCK if any
      await db.query(
        `UPDATE notifications
            SET is_resolved = TRUE, resolved_at = NOW()
          WHERE pharmacy_id = ? AND product_id = ?
            AND type = 'low_stock' AND is_resolved = FALSE AND batch_id = 0`,
        [pharmacy_id, pharmacy_product_id]
      );
    } else if (newQuantity > 0 && newQuantity <= low_stock_threshold) {
      // Still low → ensure there is an active low_stock (no email here)
      const msg = `Produkti është në stok të ulët (${newQuantity} copë). Pragu: ${low_stock_threshold} copë.`;
      await db.query(
        `INSERT INTO notifications
           (pharmacy_id, product_id, batch_id, type, message, is_read, is_resolved, email_sent)
         VALUES (?, ?, 0, 'low_stock', ?, FALSE, FALSE, 0)
         ON DUPLICATE KEY UPDATE message = VALUES(message)`,
        [pharmacy_id, pharmacy_product_id, msg]
      );
    } else {
      // newQuantity is >0 but below resolveQty and above threshold → no action needed
      // (low_stock not active; out_of_stock already resolved above if applicable)
    }

    res.status(200).json({ message: 'Stoku i ri u shtua me sukses përmes barkodit!' });
  } catch (err) {
    console.error('Add Stock by Barcode Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.markBatchStatus = async (req, res) => {
  const { id } = req.params;
  const { status, reason } = safeBody(req);
  const { pharmacy_id } = req.user;

  if (!['disposed', 'returned'].includes(status)) {
    return res.status(400).json({ message: 'Status i pavlefshëm!' });
  }

  let conn;
  try {
    conn = await db.getConnection();        // mysql2/promise pool
    await conn.beginTransaction();

    // Lock the batch row so quantity/expiry math is consistent
    const [rows] = await conn.query(
      `SELECT id, quantity, pharmacy_product_id, status
         FROM product_batches
        WHERE id = ? AND pharmacy_id = ? AND quantity > 0
        FOR UPDATE`,
      [id, pharmacy_id]
    );

    const batch = rows[0];
    if (!batch) {
      await conn.rollback();
      return res.status(404).json({ message: 'Batch nuk u gjet ose nuk ka sasi për përpunim!' });
    }

    if (['disposed', 'returned'].includes(batch.status)) {
      await conn.rollback();
      return res.status(400).json({ message: 'Ky batch është trajtuar më parë!' });
    }

    // 1) Update batch status (+ optional reason)
    await conn.query(
      `UPDATE product_batches
          SET status = ?, reason = ?, updated_at = NOW()
        WHERE id = ?`,
      [status, reason || null, id]
    );

    // 2) Decrease total quantity on the product safely (no negatives)
    await conn.query(
      `UPDATE pharmacy_products
          SET quantity = GREATEST(quantity - ?, 0)
        WHERE id = ? AND pharmacy_id = ?`,
      [batch.quantity, batch.pharmacy_product_id, pharmacy_id]
    );

    // 3) Recompute product expiry from remaining usable batches
    //    (keeps only batches with stock, not disposed/returned, and with a real future/now expiry)
    const [nextRows] = await conn.query(
      `SELECT MIN(expiry_date) AS next_expiry
         FROM product_batches
        WHERE pharmacy_id = ?
          AND pharmacy_product_id = ?
          AND quantity > 0
          AND status NOT IN ('disposed','returned')
          AND expiry_date IS NOT NULL
          AND expiry_date >= CURDATE()`,
      [pharmacy_id, batch.pharmacy_product_id]
    );

    const nextExpiry = nextRows[0]?.next_expiry || batch.expiry_date;

    await conn.query(
      `UPDATE pharmacy_products
          SET expiry_date = ?
        WHERE id = ? AND pharmacy_id = ?`,
      [nextExpiry, batch.pharmacy_product_id, pharmacy_id]
    );

    await conn.commit();

    return res.status(200).json({
      message: `Batch u shënua si "${status}". Stoku u përditësua.`,
      next_expiry: nextExpiry, // optional: handy for UI
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Mark Batch Error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
};


exports.getExpiredProducts = async (req, res) => {
  const { pharmacy_id } = req.user;
  const search = req.query.search?.trim();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT pb.id AS batch_id, pb.expiry_date, pb.quantity,
             pp.id AS pharmacy_product_id, pp.custom_name,
             pg.barcode, pb.status
      FROM product_batches pb
      JOIN pharmacy_products pp ON pb.pharmacy_product_id = pp.id
      JOIN products_global pg ON pp.global_product_id = pg.id
      WHERE pb.pharmacy_id = ? AND pb.status = 'expired'
    `;
    const params = [pharmacy_id];

    if (search) {
      query += ` AND (pg.barcode LIKE ? OR pp.custom_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const countQuery = `SELECT COUNT(*) AS total FROM (${query}) AS sub`;
    const countRows = await db.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    query += ` ORDER BY pb.expiry_date ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const expiredProducts = await db.query(query, params);

    res.json({
      data: expiredProducts,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Get Expired Products Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.editBatch = async (req, res) => {
  const { id } = req.params;
  const { quantity, price, expiry_date } = safeBody(req);
  const { pharmacy_id } = req.user;

  try {
    // 1. Get the original batch info
    const [batches] = await db.query(
      `SELECT * FROM product_batches WHERE id = ? AND pharmacy_id = ? AND status = 'active'`,
      [id, pharmacy_id]
    );

    if (batches.length === 0) {
      return res.status(404).json({ message: 'Batch jo i gjetur ose jo i vlefshëm!' });
    }

    const batch = batches;
    const quantityDiff = quantity - batch.quantity;

    // 2. Update the batch
    const updateFields = [];
    const updateParams = [];

    if (quantity != null) {
      updateFields.push('quantity = ?');
      updateParams.push(quantity);
    }

    if (expiry_date != null) {
      updateFields.push('expiry_date = ?');
      updateParams.push(expiry_date);
    }

    if (updateFields.length === 0 && price == null) {
      return res.status(400).json({ message: 'Nuk ka ndryshime për të bërë.' });
    }

    if (updateFields.length > 0) {
      updateParams.push(id);

      await db.query(
        `UPDATE product_batches SET ${updateFields.join(', ')} WHERE id = ?`,
        updateParams
      );
    }

    // 3. Update pharmacy_products.quantity if quantity changed
    if (quantity != null) {
      await db.query(
        `UPDATE pharmacy_products SET quantity = quantity + ? WHERE id = ? AND pharmacy_id = ?`,
        [quantityDiff, batch.pharmacy_product_id, pharmacy_id]
      );
    }

    // 4. Update pharmacy_products.price if requested
    if (price != null) {
      await db.query(
        `UPDATE pharmacy_products SET price = ? WHERE id = ? AND pharmacy_id = ?`,
        [price, batch.pharmacy_product_id, pharmacy_id]
      );
    }

    // 5. If expiry_date changed, update main product expiry_date (if this batch was the earliest)
    const newEarliest = await db.query(
      `SELECT expiry_date FROM product_batches
      WHERE pharmacy_product_id = ? AND pharmacy_id = ? AND quantity > 0 AND status = 'active'
      ORDER BY expiry_date ASC LIMIT 1`,
      [batch.pharmacy_product_id, pharmacy_id]
    );

    if (newEarliest.length > 0) {
      await db.query(
        `UPDATE pharmacy_products SET expiry_date = ? WHERE id = ? AND pharmacy_id = ?`,
        [newEarliest[0].expiry_date, batch.pharmacy_product_id, pharmacy_id]
      );
    }

    res.status(200).json({ message: 'Batch u përditësua me sukses.' });
  } catch (err) {
    console.error('Edit Batch Error:', err);
    res.status(500).json({ message: 'Gabim serveri.' });
  }
};
