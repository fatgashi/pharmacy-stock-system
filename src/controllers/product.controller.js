const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

// Add or Link Product to Pharmacy Stock
exports.addProductToPharmacy = async (req, res) => {
    const { barcode, quantity, price, expiry_date, custom_name, manufacturer, description } = safeBody(req);
    const { pharmacy_id } = req.user;
    const user_id = req.user.id;

    if (!barcode || !quantity || !price || !custom_name || !manufacturer || !description) {
      return res.status(400).json({ message: 'Mungojn fushat e kerkuara (barcode, quantity, price, custom_name)!' });
    }

    try {
      let [globalProduct] = await db.query(
        'SELECT * FROM products_global WHERE barcode = ?',
        [barcode]
      );

      // ✅ If not found, create it globally
      if (!globalProduct) {
        const insert = await db.query(
          'INSERT INTO products_global (name, barcode, manufacturer, description) VALUES (?, ?, ?, ?)',
          [custom_name, barcode, manufacturer || '', description || '']
        );

        // Refetch the inserted product to get its ID
        const [inserted] = await db.query('SELECT * FROM products_global WHERE id = LAST_INSERT_ID()');
        globalProduct = inserted;
      }

      // 🚫 Check if already exists in this pharmacy
      const exists = await db.query(
        'SELECT * FROM pharmacy_products WHERE global_product_id = ? AND pharmacy_id = ?',
        [globalProduct.id, pharmacy_id]
      );

      if (exists.length > 0) {
        return res.status(409).json({ message: 'Product tashme egziston ne stok!' });
      }

      const normalizedExpiry = expiry_date.includes('T') || expiry_date.includes(':')
        ? expiry_date
        : `${expiry_date} 23:00`;

      // ✅ Insert into pharmacy_products
      await db.query(
        `INSERT INTO pharmacy_products (pharmacy_id, user_id, global_product_id, custom_name, quantity, price, expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pharmacy_id, user_id, globalProduct.id, custom_name, quantity, price, normalizedExpiry]
      );

      res.status(201).json({ message: 'Product u shtua ne stok!' });
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
