// src/controllers/dashboard.controller.js
const db = require('../config/mysql');
const moment = require('moment-timezone');

function getRange({ range = 'today', from, to, tz = 'Europe/Belgrade' }) {
  const now = moment.tz(tz);
  let start, end;

  switch (range) {
    case 'today':
      start = now.clone().startOf('day');
      end = now.clone().endOf('day');
      break;

    case 'week': // ISO week: Mon → Sun
      start = now.clone().startOf('isoWeek');
      end = now.clone().endOf('isoWeek');
      break;

    case 'month': // full calendar month
      start = now.clone().startOf('month');
      end = now.clone().endOf('month');
      break;

    case 'all':
      start = null;
      end = null;
      break;

    case 'custom': {
      const s = moment.tz(from, 'YYYY-MM-DD', true, tz).startOf('day');
      const e = moment.tz(to,   'YYYY-MM-DD', true, tz).endOf('day');
      if (!s.isValid() || !e.isValid() || e.isBefore(s)) {
        throw new Error('invalid_custom_range');
      }
      start = s; end = e;
      break;
    }

    default:
      throw new Error('invalid_range');
  }

  return {
    startUtc: start ? start.clone().utc().format('YYYY-MM-DD HH:mm:ss') : null,
    endUtc:   end   ? end.clone().utc().format('YYYY-MM-DD HH:mm:ss')   : null,
    tz,
  };
}

exports.getDashboardStats = async (req, res) => {
  try {
    const { pharmacy_id } = req.user; // from Passport
    const {
      range = 'today',
      from,
      to,
      tz = 'Europe/Belgrade',
      topLimit = 5
    } = req.query;

    // 1) Per-pharmacy settings (fallbacks if missing)
    const settingsRows = await db.query(
      `SELECT low_stock_threshold, expiry_alert_days
       FROM pharmacy_settings
       WHERE pharmacy_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [pharmacy_id]
    );
    const settings = settingsRows[0] || {};
    const lowStockThreshold = Number(settings.low_stock_threshold ?? 20);
    const expiryInDays = Number(settings.expiry_alert_days ?? 30);

    // 2) Resolve date window for SALES
    const { startUtc, endUtc } = getRange({ range, from, to, tz });

    let salesDateClause = '';
    const salesParams = [pharmacy_id];
    if (startUtc && endUtc) {
      salesDateClause = 'AND s.created_at >= ? AND s.created_at <= ?';
      salesParams.push(startUtc, endUtc);
    }

    // 3) Sales KPIs
    const salesAggRows = await db.query(
      `
      SELECT
        COUNT(*)                  AS salesCount,
        COALESCE(SUM(s.total), 0) AS revenue
      FROM sales s
      WHERE s.pharmacy_id = ?
        ${salesDateClause}
      `,
      salesParams
    );
    const salesAgg = salesAggRows[0] || { salesCount: 0, revenue: 0 };
    const salesCount = Number(salesAgg.salesCount || 0);
    const revenue = Number(salesAgg.revenue || 0);
    const avgOrderValue = salesCount > 0 ? revenue / salesCount : 0;

    // 4) Top products (same window) — NOTE: table name is sale_items per your schema
    const topRows = await db.query(
      `
      SELECT
        si.product_barcode  AS barcode,
        si.product_name     AS name,
        SUM(si.quantity)    AS total_qty,
        SUM(si.subtotal)    AS total_subtotal
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.pharmacy_id = ?
        ${salesDateClause}
      GROUP BY si.product_barcode, si.product_name
      ORDER BY total_qty DESC
      LIMIT ?
      `,
      [...salesParams, Number(topLimit)]
    );

    // 5) Inventory snapshot KPIs (point-in-time)
    const stockAggRows = await db.query(
      `
      SELECT
        COUNT(*)                                              AS distinctProducts,
        SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END)         AS productsInStock,
        COALESCE(SUM(quantity), 0)                            AS totalUnitsInStock,
        COALESCE(SUM(quantity * price), 0)                    AS inventoryValue,
        SUM(CASE WHEN quantity <= ? THEN 1 ELSE 0 END)        AS lowStockCount,
        SUM(CASE WHEN expiry_date IS NOT NULL
                  AND expiry_date >= UTC_TIMESTAMP()
                  AND expiry_date <  DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)
                  AND quantity > 0
             THEN 1 ELSE 0 END)                              AS expiringSoonCount
      FROM pharmacy_products
      WHERE pharmacy_id = ?
      `,
      [lowStockThreshold, expiryInDays, pharmacy_id]
    );
    const stockAgg = stockAggRows[0] || {};

    // 6) Response
    return res.json({
      ok: true,
      range,
      window: { startUtc, endUtc, tz },
      sales: {
        salesCount,
        revenue,
        avgOrderValue,
        topProducts: (topRows ?? []).map(r => ({
          barcode: r.barcode,
          name: r.name,
          quantity: Number(r.total_qty || 0),
          subtotal: Number(r.total_subtotal || 0),
        })),
      },
      inventory: {
        distinctProducts: Number(stockAgg.distinctProducts || 0),
        productsInStock: Number(stockAgg.productsInStock || 0),
        totalUnitsInStock: Number(stockAgg.totalUnitsInStock || 0),
        inventoryValue: Number(stockAgg.inventoryValue || 0),
        lowStockCount: Number(stockAgg.lowStockCount || 0),
        expiringSoonCount: Number(stockAgg.expiringSoonCount || 0),
        thresholds: {
          lowStockThreshold,
          expiryInDays,
        },
      },
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    const message =
      err.message === 'invalid_range' || err.message === 'invalid_custom_range'
        ? err.message
        : 'server_error';
    return res.status(400).json({ ok: false, message });
  }
};
