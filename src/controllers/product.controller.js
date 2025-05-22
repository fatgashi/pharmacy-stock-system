const db = require('../config/mysql');

// Add or Link Product to Pharmacy Stock
exports.addProductToPharmacy = async (req, res) => {
  const { barcode, quantity, price, expiry_date, custom_name } = req.body;
  const { pharmacy_id } = req.user;

  if (!barcode || !quantity || !price) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Check if product exists globally
    let [globalProduct] = await db.query(
      'SELECT * FROM products_global WHERE barcode = ?',
      [barcode]
    );

    if (!globalProduct) {
      return res.status(404).json({ message: 'Product not found globally. Please register globally first.' });
    }

    // Check if already in pharmacy
    const exists = await db.query(
      'SELECT * FROM pharmacy_products WHERE global_product_id = ? AND pharmacy_id = ?',
      [globalProduct.id, pharmacy_id]
    );

    if (exists.length > 0) {
      return res.status(409).json({ message: 'Product already exists in pharmacy stock' });
    }

    // Insert into pharmacy stock
    await db.query(
      `INSERT INTO pharmacy_products (pharmacy_id, global_product_id, custom_name, quantity, price, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [pharmacy_id, globalProduct.id, custom_name || globalProduct.name, quantity, price, expiry_date]
    );

    res.status(201).json({ message: 'Product added to pharmacy stock' });
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

  try {
    const products = await db.query(
      `SELECT pg.*, pp.quantity, pp.price, pp.expiry_date
       FROM products_global pg
       JOIN pharmacy_products pp ON pp.global_product_id = pg.id
       WHERE pp.pharmacy_id = ?
       ORDER BY pg.name ASC
       LIMIT ? OFFSET ?`,
      [pharmacy_id, limit, offset]
    );

    res.json({ data: products, page });
  } catch (err) {
    console.error('List Products Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
