const db = require('../config/mysql');
const { safeBody } = require('../helpers/safeBody');
const { overlapsDate, overlapsDateTime, validHalf, validDayOfWeek, validTime, isTimeOrderValid, isDateTimeOrderValid } = require('../helpers/timeRanges');

// ==================== DAYS OFF ENDPOINTS ====================

// Get all days off for a user or pharmacy
exports.getDaysOff = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { user_id, pharmacy_id, status, start_date, end_date } = req.query;

  try {
    let query = `
      SELECT do.*, u.username, p.name as pharmacy_name
      FROM days_off do
      LEFT JOIN users u ON do.user_id = u.id
      LEFT JOIN pharmacies p ON do.pharmacy_id = p.id
      WHERE 1=1
    `;
    const params = [];

    // Role-based filtering
    if (type === 'user') {
      query += ` AND do.user_id = ?`;
      params.push(userId);
    } else if (type === 'admin' && role === 'pharmacy_admin') {
      // Pharmacy admin can only see their pharmacy's days off
      const pharmacies = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?`,
        [userId]
      );
      if (pharmacies.length === 0) {
        return res.json({ data: [] });
      }
      const pharmacyIds = pharmacies.map(p => p.id);
      query += ` AND do.pharmacy_id IN (${pharmacyIds.map(() => '?').join(',')})`;
      params.push(...pharmacyIds);
    }

    // Additional filters
    if (user_id) {
      query += ` AND do.user_id = ?`;
      params.push(user_id);
    }
    if (pharmacy_id) {
      query += ` AND do.pharmacy_id = ?`;
      params.push(pharmacy_id);
    }
    if (status) {
      query += ` AND do.status = ?`;
      params.push(status);
    }
    if (start_date && end_date) {
      const [frag, prms] = overlapsDate(start_date, end_date);
      query += ` AND ${frag}`;
      params.push(...prms);
    } else if (start_date) {
      query += ` AND do.end_date >= ?`;
      params.push(start_date);
    } else if (end_date) {
      query += ` AND do.start_date <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY do.start_date DESC`;

    const daysOff = await db.query(query, params);
    res.json({ data: daysOff });
  } catch (err) {
    console.error('Get Days Off Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Create a new day off request
exports.createDayOff = async (req, res) => {
  const { id: userId, type } = req.user;
  const { user_id, pharmacy_id, start_date, end_date, start_half, end_half, reason } = safeBody(req);

  try {
    // Validate required fields
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Data e fillimit dhe e mbarimit janë të detyrueshme.' });
    }
    if (start_date > end_date) {
      return res.status(400).json({ message: 'start_date nuk mund të jetë pas end_date.' });
    }

    const startHalf = validHalf(start_half) ? start_half : 'FULL';
    const endHalf = validHalf(end_half) ? end_half : 'FULL';

    // Determine user and pharmacy
    let targetUserId = userId;
    let targetPharmacyId = pharmacy_id;

    if (type === 'admin' && user_id) {
      targetUserId = user_id;
    } else if (type === 'user') {
      // Get user's pharmacy
      const [user] = await db.query('SELECT pharmacy_id FROM users WHERE id = ?', [userId]);
      if (!user) {
        return res.status(404).json({ message: 'Përdoruesi nuk u gjet.' });
      }
      targetPharmacyId = user.pharmacy_id;
    }

    // Safety: make sure target user really belongs to that pharmacy
    const [uCheck] = await db.query('SELECT pharmacy_id FROM users WHERE id=?', [targetUserId]);
    if (!uCheck) return res.status(404).json({ message: 'Përdoruesi nuk u gjet.' });
    if (!targetPharmacyId) targetPharmacyId = uCheck.pharmacy_id;

    if (!targetPharmacyId) {
      return res.status(400).json({ message: 'ID e farmacisë është e detyrueshme.' });
    }

    // Check for overlapping days off
    const [frag, prms] = overlapsDate(start_date, end_date);
    const overlapping = await db.query(
      `SELECT id FROM days_off 
       WHERE user_id = ? AND status IN ('PENDING','APPROVED') AND ${frag} LIMIT 1`,
      [targetUserId, ...prms]
    );

    if (overlapping.length > 0) {
      return res.status(409).json({ message: 'Keni pushime të mbivendosura për këtë periudhë.' });
    }

    const result = await db.query(
      `INSERT INTO days_off (user_id, pharmacy_id, start_date, end_date, start_half, end_half, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [targetUserId, targetPharmacyId, start_date, end_date, startHalf, endHalf, reason]
    );

    res.status(201).json({ 
      message: 'Kërkesa për pushime u krijua me sukses.',
      id: result.insertId 
    });
  } catch (err) {
    console.error('Create Day Off Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Update day off status (approve/reject)
exports.updateDayOffStatus = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { id } = req.params;
  const { status, reason } = safeBody(req);

  try {
    if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ message: 'Statusi i pavlefshëm.' });
    }

    // Check if user can update this day off
    const [dayOff] = await db.query(
      `SELECT do.*, u.username FROM days_off do
       JOIN users u ON do.user_id = u.id
       WHERE do.id = ?`,
      [id]
    );

    if (!dayOff) {
      return res.status(404).json({ message: 'Pushimet nuk u gjetën.' });
    }

    // Authorization check
    if (type === 'user') {
      if (dayOff.user_id !== userId) return res.status(403).json({ message: 'Jo i autorizuar.' });
      if (status !== 'CANCELLED') return res.status(403).json({ message: 'Vetem admins mund të refuzojn ose aprovojn kërkesën.' });
      if (dayOff.status !== 'PENDING') return res.status(400).json({ message: 'Mund të anuloni vetëm kërkesen PENDING.' });
    }

    if (type === 'admin' && role === 'pharmacy_admin') {
      const allowed = await db.query(
        `SELECT 1 AS ok
           FROM pharmacies
          WHERE pharmacy_admin_id = ?
            AND id = ?
          LIMIT 1`,
        [userId, dayOff.pharmacy_id]
      );
  
    
      if (!Array.isArray(allowed) || allowed.length === 0) {
        return res.status(403).json({ message: 'Nuk keni autorizim për këtë farmaci.' });
      }
    }

    await db.query(
      `UPDATE days_off SET status = ?, reason = COALESCE(?, reason), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, reason, id]
    );

    res.json({ message: 'Statusi i pushimeve u përditësua me sukses.' });
  } catch (err) {
    console.error('Update Day Off Status Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// ==================== SHIFTS ENDPOINTS ====================

// Get all shifts
exports.getShifts = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { user_id, pharmacy_id, start_date, end_date, start_datetime, end_datetime } = req.query;

  try {
    let query = `
      SELECT s.*, u.username, p.name as pharmacy_name, creator.username as created_by_username
      FROM shifts s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN pharmacies p ON s.pharmacy_id = p.id
      LEFT JOIN users creator ON s.created_by = creator.id
      WHERE 1=1
    `;
    const params = [];

    // Role-based filtering
    if (type === 'user') {
      query += ` AND s.user_id = ?`;
      params.push(userId);
    } else if (type === 'admin' && role === 'pharmacy_admin') {
      const pharmacies = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?`,
        [userId]
      );
      if (pharmacies.length === 0) {
        return res.json({ data: [] });
      }
      const pharmacyIds = pharmacies.map(p => p.id);
      query += ` AND s.pharmacy_id IN (${pharmacyIds.map(() => '?').join(',')})`;
      params.push(...pharmacyIds);
    }

    // Additional filters
    if (user_id) {
      query += ` AND s.user_id = ?`;
      params.push(user_id);
    }
    if (pharmacy_id) {
      query += ` AND s.pharmacy_id = ?`;
      params.push(pharmacy_id);
    }
    if (start_datetime && end_datetime) {
      const [frag, prms] = overlapsDateTime(start_datetime, end_datetime);
      query += ` AND ${frag}`;
      params.push(...prms);
    } else if (start_date && end_date) {
      // date-only overlap
      const [frag, prms] = overlapsDate(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
      // reusing same fragment works if you store dates as DATETIME ranges
      query += ` AND ${frag.replace(/_date/g, '_datetime')}`;
      params.push(...prms);
    } else if (start_datetime) {
      query += ` AND s.end_datetime > ?`;
      params.push(start_datetime);
    } else if (end_datetime) {
      query += ` AND s.start_datetime < ?`;
      params.push(end_datetime);
    }

    query += ` ORDER BY s.start_datetime DESC`;

    const shifts = await db.query(query, params);
    res.json({ data: shifts });
  } catch (err) {
    console.error('Get Shifts Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Create a new shift
exports.createShift = async (req, res) => {
  const { id: userId, type } = req.user;
  const { user_id, pharmacy_id, start_datetime, end_datetime, label, location, notes } = safeBody(req);

  try {
    // Validate required fields
    if (!start_datetime || !end_datetime) {
      return res.status(400).json({ message: 'Data dhe ora e fillimit dhe e mbarimit janë të detyrueshme.' });
    }
    if (!isDateTimeOrderValid(start_datetime, end_datetime)) {
      return res.status(400).json({ message: 'start_datetime duhet të jetë para end_datetime.' });
    }

    // Determine user and pharmacy
    let targetUserId = user_id;
    let targetPharmacyId = pharmacy_id;

    if (type === 'user') {
      targetUserId = userId;
      const [user] = await db.query('SELECT pharmacy_id FROM users WHERE id = ?', [userId]);
      if (!user) {
        return res.status(404).json({ message: 'Përdoruesi nuk u gjet.' });
      }
      targetPharmacyId = user.pharmacy_id;
    }

    // Safety: if acting as admin and only user_id provided, infer the pharmacy
    if (!targetPharmacyId && targetUserId) {
      const [u] = await db.query('SELECT pharmacy_id FROM users WHERE id=?', [targetUserId]);
      if (u) targetPharmacyId = u.pharmacy_id;
    }

    if (!targetUserId || !targetPharmacyId) {
      return res.status(400).json({ message: 'ID e përdoruesit dhe e farmacisë janë të detyrueshme.' });
    }

    // Check for overlapping shifts
    const [frag, prms] = overlapsDateTime(start_datetime, end_datetime);
    const overlapping = await db.query(
      `SELECT id FROM shifts WHERE user_id=? AND ${frag} LIMIT 1`,
      [targetUserId, ...prms]
    );

    if (overlapping.length > 0) {
      return res.status(409).json({ message: 'Keni turne të mbivendosura për këtë periudhë.' });
    }

    const result = await db.query(
      `INSERT INTO shifts (user_id, pharmacy_id, start_datetime, end_datetime, label, location, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [targetUserId, targetPharmacyId, start_datetime, end_datetime, label, location, notes, userId]
    );

    res.status(201).json({ 
      message: 'Turni u krijua me sukses.',
      id: result.insertId 
    });
  } catch (err) {
    console.error('Create Shift Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// ==================== ROTATION ENDPOINTS ====================

// Get all rotation templates
exports.getRotationTemplates = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { pharmacy_id } = req.query;

  try {
    let query = `
      SELECT rt.*, p.name as pharmacy_name
      FROM rotation_templates rt
      JOIN pharmacies p ON rt.pharmacy_id = p.id
      WHERE 1=1
    `;
    const params = [];

    // Role-based filtering
    if (type === 'admin' && role === 'pharmacy_admin') {
      const pharmacies = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?`,
        [userId]
      );
      if (pharmacies.length === 0) {
        return res.json({ data: [] });
      }
      const pharmacyIds = pharmacies.map(p => p.id);
      query += ` AND rt.pharmacy_id IN (${pharmacyIds.map(() => '?').join(',')})`;
      params.push(...pharmacyIds);
    }

    if (pharmacy_id) {
      query += ` AND rt.pharmacy_id = ?`;
      params.push(pharmacy_id);
    }

    query += ` ORDER BY rt.name`;

    const templates = await db.query(query, params);
    res.json({ data: templates });
  } catch (err) {
    console.error('Get Rotation Templates Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Get rotation template with slots
exports.getRotationTemplate = async (req, res) => {
  const { id } = req.params;

  try {
    const [template] = await db.query(
      `SELECT rt.*, p.name as pharmacy_name
       FROM rotation_templates rt
       JOIN pharmacies p ON rt.pharmacy_id = p.id
       WHERE rt.id = ?`,
      [id]
    );

    if (!template) {
      return res.status(404).json({ message: 'Template i rotacionit nuk u gjet.' });
    }

    const slots = await db.query(
      `SELECT * FROM rotation_template_slots WHERE template_id = ? ORDER BY dow, start_time`,
      [id]
    );

    res.json({ 
      template,
      slots 
    });
  } catch (err) {
    console.error('Get Rotation Template Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Create rotation template
exports.createRotationTemplate = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { pharmacy_id, name, description, slots } = safeBody(req);

  try {
    if (!pharmacy_id || !name) {
      return res.status(400).json({ message: 'ID e farmacisë dhe emri janë të detyrueshme.' });
    }

    // Check authorization
    if (type === 'admin' && role === 'pharmacy_admin') {
      const [pharmacy] = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ? AND id = ?`,
        [userId, pharmacy_id]
      );
      if (!pharmacy) {
        return res.status(403).json({ message: 'Nuk keni autorizim për këtë farmaci.' });
      }
    }

    // Check if template name already exists for this pharmacy
    const [existing] = await db.query(
      `SELECT id FROM rotation_templates WHERE pharmacy_id = ? AND name = ?`,
      [pharmacy_id, name]
    );

    if (existing) {
      return res.status(409).json({ message: 'Template me këtë emër ekziston tashmë për këtë farmaci.' });
    }

    const result = await db.query(
      `INSERT INTO rotation_templates (pharmacy_id, name, description, active)
       VALUES (?, ?, ?, 1)`,
      [pharmacy_id, name, description]
    );

    const templateId = result.insertId;

    // Add slots if provided
    if (slots && Array.isArray(slots)) {
      const values = [];
      for (const s of slots) {
        if (!validDayOfWeek(s.dow)) continue;
        if (!validTime(s.start_time) || !validTime(s.end_time) || !isTimeOrderValid(s.start_time, s.end_time)) continue;
        values.push([templateId, s.dow, s.start_time, s.end_time, s.label ?? null]);
      }
      if (values.length) {
        const placeholders = values.map(() => '(?,?,?,?,?)').join(',');
        await db.query(
          `INSERT INTO rotation_template_slots (template_id, dow, start_time, end_time, label)
           VALUES ${placeholders}`,
          values.flat()
        );
      }
    }

    res.status(201).json({ 
      message: 'Template i rotacionit u krijua me sukses.',
      id: templateId 
    });
  } catch (err) {
    console.error('Create Rotation Template Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Get rotation assignments
exports.getRotationAssignments = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { user_id, pharmacy_id, template_id } = req.query;

  try {
    let query = `
      SELECT ra.*, u.username, p.name as pharmacy_name, rt.name as template_name
      FROM rotation_assignments ra
      JOIN users u ON ra.user_id = u.id
      JOIN pharmacies p ON ra.pharmacy_id = p.id
      JOIN rotation_templates rt ON ra.template_id = rt.id
      WHERE 1=1
    `;
    const params = [];

    // Role-based filtering
    if (type === 'user') {
      query += ` AND ra.user_id = ?`;
      params.push(userId);
    } else if (type === 'admin' && role === 'pharmacy_admin') {
      const pharmacies = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ?`,
        [userId]
      );
      if (pharmacies.length === 0) {
        return res.json({ data: [] });
      }
      const pharmacyIds = pharmacies.map(p => p.id);
      query += ` AND ra.pharmacy_id IN (${pharmacyIds.map(() => '?').join(',')})`;
      params.push(...pharmacyIds);
    }

    // Additional filters
    if (user_id) {
      query += ` AND ra.user_id = ?`;
      params.push(user_id);
    }
    if (pharmacy_id) {
      query += ` AND ra.pharmacy_id = ?`;
      params.push(pharmacy_id);
    }
    if (template_id) {
      query += ` AND ra.template_id = ?`;
      params.push(template_id);
    }

    query += ` ORDER BY ra.effective_from DESC`;

    const assignments = await db.query(query, params);
    res.json({ data: assignments });
  } catch (err) {
    console.error('Get Rotation Assignments Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};

// Create rotation assignment
exports.createRotationAssignment = async (req, res) => {
  const { role, id: userId, type } = req.user;
  const { user_id, pharmacy_id, template_id, effective_from, effective_to } = safeBody(req);

  try {
    if (!user_id || !pharmacy_id || !template_id || !effective_from) {
      return res.status(400).json({ message: 'Të gjitha fushat janë të detyrueshme.' });
    }

    // Check authorization
    if (type === 'admin' && role === 'pharmacy_admin') {
      const [pharmacy] = await db.query(
        `SELECT id FROM pharmacies WHERE pharmacy_admin_id = ? AND id = ?`,
        [userId, pharmacy_id]
      );
      if (!pharmacy) {
        return res.status(403).json({ message: 'Nuk keni autorizim për këtë farmaci.' });
      }
    }

    // Check if user exists and belongs to the pharmacy
    const [user] = await db.query(
      `SELECT id FROM users WHERE id = ? AND pharmacy_id = ?`,
      [user_id, pharmacy_id]
    );

    if (!user) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet ose nuk i përket kësaj farmacie.' });
    }

    // Check if template exists and belongs to the pharmacy
    const [template] = await db.query(
      `SELECT id FROM rotation_templates WHERE id = ? AND pharmacy_id = ? AND active = 1`,
      [template_id, pharmacy_id]
    );

    if (!template) {
      return res.status(404).json({ message: 'Template i rotacionit nuk u gjet ose nuk është aktiv.' });
    }

    // Check for overlapping assignments
    const to = effective_to || '2999-12-31';
    const overlapping = await db.query(
      `SELECT id FROM rotation_assignments
       WHERE user_id = ?
         AND NOT (COALESCE(effective_to,'2999-12-31') < ? OR effective_from > ?) LIMIT 1`,
      [user_id, effective_from, to]
    );

    if (overlapping.length > 0) {
      return res.status(409).json({ message: 'Përdoruesi ka një caktim të mbivendosur për këtë periudhë.' });
    }

    const result = await db.query(
      `INSERT INTO rotation_assignments (user_id, pharmacy_id, template_id, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, pharmacy_id, template_id, effective_from, effective_to]
    );

    res.status(201).json({ 
      message: 'Caktimi i rotacionit u krijua me sukses.',
      id: result.insertId 
    });
  } catch (err) {
    console.error('Create Rotation Assignment Error:', err);
    res.status(500).json({ message: 'Gabim në server.' });
  }
};
