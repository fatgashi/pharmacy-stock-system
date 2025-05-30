const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');

// exports.calculateCart = async (req, res) => {
//     const { items, amount_given } = safeBody(req);
//     const { pharmacy_id } = req.user;

//     if (!items || !Array.isArray(items) || items.length === 0 || amount_given == null) {
//         return res.status(400).json({ message: 'Invalid cart or amount' });
//     }

//     try {
//         let total = 0;
//         const validatedItems = [];

//         for (const item of items) {
//         const { barcode, quantity } = item;

//         const result = await db.query(
//             `SELECT pg.name, pg.barcode, pp.price, pp.quantity AS stock
//             FROM products_global pg
//             JOIN pharmacy_products pp ON pp.global_product_id = pg.id
//             WHERE pg.barcode = ? AND pp.pharmacy_id = ?`,
//             [barcode, pharmacy_id]
//         );

//         if (result.length === 0) {
//             return res.status(404).json({ message: `Product with barcode ${barcode} not found` });
//         }

//         const product = result[0];

//         if (product.stock < quantity) {
//             return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
//         }

//         const subtotal = product.price * quantity;
//         total += subtotal;

//         validatedItems.push({
//             barcode: product.barcode,
//             name: product.name,
//             quantity,
//             price: product.price,
//             subtotal
//         });
//         }

//         const change = amount_given - total;
//         if (change < 0) {
//         return res.status(400).json({ message: 'Insufficient payment amount' });
//         }

//         res.json({
//         total: total.toFixed(2),
//         change: change.toFixed(2),
//         items: validatedItems
//         });
//     } catch (err) {
//         console.error('Cart Calculation Error:', err);
//         res.status(500).json({ message: 'Server error' });
//     }
// };

exports.confirmSale = async (req, res) => {
  let connection;

  const { items, amount_given } = safeBody(req);
  const { pharmacy_id, id: user_id } = req.user;

  if (!items || !Array.isArray(items) || items.length === 0 || amount_given == null) {
    return res.status(400).json({ message: 'Invalid cart or amount' });
  }

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    let total = 0;
    const saleItems = [];

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

      const [batchRows] = await connection.query(
        `SELECT * FROM product_batches
        WHERE pharmacy_product_id = ? AND pharmacy_id = ? AND quantity > 0
        ORDER BY expiry_date ASC`,
        [product.pharmacy_product_id, pharmacy_id]
      );

      let remainingQty = quantity;
      const batchUpdates = [];

      for (const batch of batchRows) {
        if (remainingQty <= 0) break;

        const usedQty = Math.min(batch.quantity, remainingQty);
        remainingQty -= usedQty;

        batchUpdates.push({ batch_id: batch.id, usedQty });
      }

      if (remainingQty > 0) {
        await connection.rollback();
        return res.status(400).json({ message: `Stoku nuk perputhet per ${product.name}!` });
      }

      const subtotal = product.price * quantity;
      total += subtotal;

      saleItems.push({
        barcode: product.barcode,
        name: product.name,
        quantity,
        price: product.price,
        subtotal,
        global_product_id: product.global_product_id,
        pharmacy_product_id: product.pharmacy_product_id,
        batchUpdates
      });
    }

    const change = amount_given - total;
    if (change < 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Pagesa nuk perputhet me qmimin e barnave!' });
    }

    const [saleInsert] = await connection.query(
      `INSERT INTO sales (pharmacy_id, user_id, total, amount_given, change_given)
       VALUES (?, ?, ?, ?, ?)`,
      [pharmacy_id, user_id, total, amount_given, change]
    );
    const sale_id = saleInsert.insertId;

    for (const item of saleItems) {
      await connection.query(
        `INSERT INTO sale_items (sale_id, product_barcode, product_name, quantity, price, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [sale_id, item.barcode, item.name, item.quantity, item.price, item.subtotal]
      );

      // 🔁 Update all affected batches
      for (const { batch_id, usedQty } of item.batchUpdates) {
        await connection.query(
          `UPDATE product_batches
          SET quantity = quantity - ?
          WHERE id = ? AND pharmacy_id = ?`,
          [usedQty, batch_id, pharmacy_id]
        );
      }

      // 🔁 Update total stock in pharmacy_products
      await connection.query(
        `UPDATE pharmacy_products
        SET quantity = quantity - ?
        WHERE id = ?`,
        [item.quantity, item.pharmacy_product_id]
      );

      // ✅ Update expiry_date based on next available batch (after batch updates)
      const [remainingBatches] = await connection.query(
        `SELECT expiry_date
        FROM product_batches
        WHERE pharmacy_product_id = ? AND pharmacy_id = ? AND quantity > 0
        ORDER BY expiry_date ASC
        LIMIT 1`,
        [item.pharmacy_product_id, pharmacy_id]
      );

      if (remainingBatches.length > 0) {
        const newExpiry = remainingBatches[0].expiry_date;
        await connection.query(
          `UPDATE pharmacy_products
          SET expiry_date = ?
          WHERE id = ?`,
          [newExpiry, item.pharmacy_product_id]
        );
      }
    }

    await connection.commit();

    res.status(201).json({
      message: 'Shitja u regjistrua me sukses!',
      sale_id,
      total: total.toFixed(2),
      change: change.toFixed(2),
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
    console.error('Sale Confirm Error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

