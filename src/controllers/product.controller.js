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

// Search by barcode (scanner)
exports.getProductByBarcode = async (req, res) => {
    const { barcode } = req.params;
    const { pharmacy_id } = req.user;

    try {
      const result = await db.query(
        `SELECT pg.*, pp.quantity, pp.price, pp.expiry_date
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
      SELECT pg.*, pp.quantity, pp.price, pp.expiry_date
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
  const { barcode, quantity, expiry_date, price, update_price } = req.body;
  const { pharmacy_id } = req.user;

  if (!barcode || !quantity || !expiry_date) {
    return res.status(400).json({ message: 'Mungojnë fushat e kërkuara (barcode, quantity, expiry_date)!' });
  }

  try {
    // 🔍 Find pharmacy product
    const [result] = await db.query(
      `SELECT pp.id AS pharmacy_product_id, pp.quantity AS current_quantity
       FROM products_global pg
       JOIN pharmacy_products pp ON pg.id = pp.global_product_id
       WHERE pg.barcode = ? AND pp.pharmacy_id = ?`,
      [barcode, pharmacy_id]
    );

    if (!result) {
      return res.status(404).json({ message: 'Produkti nuk u gjet në këtë farmaci!' });
    }

    const { pharmacy_product_id, current_quantity } = result;

    // ➕ Insert new batch
    await db.query(
      `INSERT INTO product_batches (pharmacy_id, pharmacy_product_id, quantity, expiry_date)
       VALUES (?, ?, ?, ?)`,
      [pharmacy_id, pharmacy_product_id, quantity, expiry_date]
    );

    // 🔄 Prepare update fields
    const updateFields = [`quantity = quantity + ?`];
    const updateParams = [quantity];

    // 🔄 Update price if requested
    if (update_price === true && price) {
      updateFields.push(`price = ?`);
      updateParams.push(price);
    }

    // ✅ If current quantity is 0, update expiry date to this batch's date
    if (current_quantity === 0) {
      updateFields.push(`expiry_date = ?`);
      updateParams.push(expiry_date);
    }

    updateParams.push(pharmacy_product_id);

    // 🔄 Update the pharmacy_products table
    await db.query(
      `UPDATE pharmacy_products SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // ✅ Resolve any unresolved low stock notifications for this product
    await db.query(
      `UPDATE notifications
       SET is_resolved = TRUE
       WHERE pharmacy_id = ? AND product_id = ? AND type = 'low_stock' AND is_resolved = FALSE`,
      [pharmacy_id, pharmacy_product_id]
    );

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

  try {
    // Allow batch regardless of expiry, but make sure it exists and has quantity
    const [batch] = await db.query(
      `SELECT quantity, pharmacy_product_id, status FROM product_batches
       WHERE id = ? AND pharmacy_id = ? AND quantity > 0`,
      [id, pharmacy_id]
    );

    if (!batch) {
      return res.status(404).json({ message: 'Batch nuk u gjet ose nuk ka sasi për përpunim!' });
    }

    if (['disposed', 'returned'].includes(batch.status)) {
      return res.status(400).json({ message: 'Ky batch është trajtuar më parë!' });
    }

    // 1. Update batch status (you can optionally save `reason`)
    await db.query(
      `UPDATE product_batches SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, id]
    );

    // 2. Decrease total quantity in pharmacy_products
    await db.query(
      `UPDATE pharmacy_products
       SET quantity = quantity - ?
       WHERE id = ? AND pharmacy_id = ?`,
      [batch.quantity, batch.pharmacy_product_id, pharmacy_id]
    );

    res.status(200).json({ message: `Batch u shënua si "${status}". Stoku u përditësua.` });
  } catch (err) {
    console.error('Mark Batch Error:', err);
    res.status(500).json({ message: 'Server error' });
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
