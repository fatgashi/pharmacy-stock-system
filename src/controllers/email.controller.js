const crypto = require('crypto');
const db = require('../config/mysql');
const { sendEmail } = require('../config/email');
const { safeBody } = require('../helpers/safeBody');
const { sendContactEmail } = require('../config/contactMailer');
require('dotenv').config();

// Add email to profile and send confirmation
exports.addEmailToProfile = async (req, res) => {
  const { email, target } = safeBody(req);
  const { id: userId, type } = req.user;

  if (!email || !target) {
    return res.status(400).json({ message: 'Adresa e email-it dhe targeti janë të kërkuar!' });
  }

  // Validate target
  if (!['admin', 'user'].includes(target)) {
    return res.status(400).json({ message: 'Targeti duhet të jetë "admin" ose "user"!' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Ju lutem jepni një adresë të vlefshme të email-it!' });
  }

  try {
    // Check if email is already in use by another user or admin
    const [existingUser] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );
    
    const [existingAdmin] = await db.query(
      'SELECT id FROM admins WHERE email = ?',
      [email]
    );

    if (existingUser || existingAdmin) {
      return res.status(409).json({ message: 'Ky email është tashmë i regjistruar nga një përdorues ose admin tjetër!' });
    }

    // Generate confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    if (target === 'user') {
      // Check if current user is a user and updating their own profile
      if (type !== 'user') {
        return res.status(403).json({ message: 'Vetëm përdoruesit mund të shtojnë email-e në profile të përdoruesve!' });
      }

      // Update user with email and confirmation token
      await db.query(
        `UPDATE users SET 
         email = ?, 
         email_confirmation_token = ?, 
         email_confirmation_expires = ?,
         email_verified = FALSE,
         updated_at = NOW()
         WHERE id = ?`,
        [email, confirmationToken, tokenExpiry, userId]
      );

    } else if (target === 'admin') {
      // Check if current user is an admin and updating their own profile
      if (type !== 'admin') {
        return res.status(403).json({ message: 'Vetëm adminët mund të shtojnë email-e në profile të adminëve!' });
      }

      // Update admin with email and confirmation token
      await db.query(
        `UPDATE admins SET 
         email = ?, 
         email_confirmation_token = ?, 
         email_confirmation_expires = ?,
         email_verified = FALSE,
         updated_at = NOW()
         WHERE id = ?`,
        [email, confirmationToken, tokenExpiry, userId]
      );
    }

    // Generate confirmation link
    const confirmationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/confirm-email?token=${confirmationToken}`;

    // Send confirmation email
    const emailResult = await sendEmail(email, 'emailConfirmation', [req.user.username, confirmationLink]);

    if (!emailResult.success) {
      // If email fails, remove the email and token based on target
      if (target === 'user') {
        await db.query(
          'UPDATE users SET email = NULL, email_confirmation_token = NULL, email_confirmation_expires = NULL WHERE id = ?',
          [userId]
        );
      } else if (target === 'admin') {
        await db.query(
          'UPDATE admins SET email = NULL, email_confirmation_token = NULL, email_confirmation_expires = NULL WHERE id = ?',
          [userId]
        );
      }
      return res.status(500).json({ message: 'Dështoi dërgimi i email-it të konfirmimit. Ju lutem provoni përsëri më vonë.' });
    }

    res.json({ 
      message: 'Emaili u shtua me sukses! Ju lutem kontrolloni kutinë tuaj dhe konfirmoni adresën e email-it.',
      email: email,
      target: target
    });

  } catch (err) {
    console.error('Add Email Error:', err);
    res.status(500).json({ message: 'Gabim në server gjatë shtimit të email-it!' });
  }
};

// Confirm email with token
exports.confirmEmail = async (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ message: 'Tokeni i konfirmimit është i kërkuar!' });
  }

  try {
    // Find user with valid confirmation token
    let [user] = await db.query(
      `SELECT id, username, email, email_confirmation_expires, 'user' as type
       FROM users 
       WHERE email_confirmation_token = ? 
       AND email_confirmation_expires > NOW()`,
      [token]
    );

    let [admin] = await db.query(
      `SELECT id, username, email, email_confirmation_expires, 'admin' as type
       FROM admins 
       WHERE email_confirmation_token = ? 
       AND email_confirmation_expires > NOW()`,
      [token]
    );

    const targetUser = user || admin;

    if (!targetUser) {
      return res.status(400).json({ 
        message: 'Token i pavlefshëm ose i skaduar i konfirmimit. Ju lutem kërkoni një email të ri konfirmimi.' 
      });
    }

    // Mark email as verified and clear token based on type
    if (targetUser.type === 'user') {
      await db.query(
        `UPDATE users SET 
         email_verified = TRUE, 
         email_confirmation_token = NULL, 
         email_confirmation_expires = NULL,
         updated_at = NOW()
         WHERE id = ?`,
        [targetUser.id]
      );
    } else if (targetUser.type === 'admin') {
      await db.query(
        `UPDATE admins SET 
         email_verified = TRUE, 
         email_confirmation_token = NULL, 
         email_confirmation_expires = NULL,
         updated_at = NOW()
         WHERE id = ?`,
        [targetUser.id]
      );
    }

    res.json({ 
      message: 'Emaili u konfirmua me sukses! Tani do të merrni njoftime me email.',
      email: targetUser.email,
      type: targetUser.type
    });

  } catch (err) {
    console.error('Confirm Email Error:', err);
    res.status(500).json({ message: 'Gabim në server gjatë konfirmimit të email-it!' });
  }
};

// Resend confirmation email
exports.resendConfirmationEmail = async (req, res) => {
  const { id: userId, type } = req.user;

  try {
    let user;
    
    if (type === 'user') {
      [user] = await db.query(
        'SELECT email, email_verified, username FROM users WHERE id = ?',
        [userId]
      );
    } else if (type === 'admin') {
      [user] = await db.query(
        'SELECT email, email_verified, username FROM admins WHERE id = ?',
        [userId]
      );
    }

    if (!user) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet!' });
    }

    if (!user.email) {
      return res.status(400).json({ message: 'Nuk u gjet asnjë adresë email. Ju lutem shtoni një email së pari!' });
    }

    if (user.email_verified) {
      return res.status(400).json({ message: 'Emaili është tashmë i verifikuar!' });
    }

    // Generate new confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // Update user/admin with new confirmation token based on type
    if (type === 'user') {
      await db.query(
        `UPDATE users SET 
         email_confirmation_token = ?, 
         email_confirmation_expires = ?,
         updated_at = NOW()
         WHERE id = ?`,
        [confirmationToken, tokenExpiry, userId]
      );
    } else if (type === 'admin') {
      await db.query(
        `UPDATE admins SET 
         email_confirmation_token = ?, 
         email_confirmation_expires = ?,
         updated_at = NOW()
         WHERE id = ?`,
        [confirmationToken, tokenExpiry, userId]
      );
    }

    // Generate confirmation link
    const confirmationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/confirm-email?token=${confirmationToken}`;

    // Send confirmation email
    const emailResult = await sendEmail(user.email, 'emailConfirmation', [user.username, confirmationLink]);

    if (!emailResult.success) {
      return res.status(500).json({ message: 'Dështoi dërgimi i email-it të konfirmimit. Ju lutem provoni përsëri më vonë.' });
    }

    res.json({ 
      message: 'Emaili i konfirmimit u dërgua me sukses! Ju lutem kontrolloni kutinë tuaj.',
      email: user.email
    });

  } catch (err) {
    console.error('Resend Confirmation Error:', err);
    res.status(500).json({ message: 'Gabim në server gjatë ridërgimit të email-it të konfirmimit!' });
  }
};

// Remove email from profile
exports.removeEmail = async (req, res) => {
  const { id: userId, type } = req.user;

  try {
    // First check if the user/admin actually has an email
    let currentUser;
    
    if (type === 'user') {
      [currentUser] = await db.query(
        'SELECT email FROM users WHERE id = ?',
        [userId]
      );
    } else if (type === 'admin') {
      [currentUser] = await db.query(
        'SELECT email FROM admins WHERE id = ?',
        [userId]
      );
    }

    if (!currentUser) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet!' });
    }

    // Check if there's no email to remove
    if (!currentUser.email) {
      return res.status(400).json({ 
        message: 'Nuk u gjet asnjë adresë email për të hequr. Profili juaj nuk ka një adresë email të konfiguruar.' 
      });
    }

    // Remove email and related fields based on user type
    if (type === 'user') {
      await db.query(
        `UPDATE users SET 
         email = NULL, 
         email_confirmation_token = NULL, 
         email_confirmation_expires = NULL,
         email_verified = FALSE,
         updated_at = NOW()
         WHERE id = ?`,
        [userId]
      );
    } else if (type === 'admin') {
      await db.query(
        `UPDATE admins SET 
         email = NULL, 
         email_confirmation_token = NULL, 
         email_confirmation_expires = NULL,
         email_verified = FALSE,
         updated_at = NOW()
         WHERE id = ?`,
        [userId]
      );
    }

    res.json({ 
      message: 'Emaili u hoq me sukses! Nuk do të merrni më njoftime me email.',
      removedEmail: currentUser.email
    });

  } catch (err) {
    console.error('Remove Email Error:', err);
    res.status(500).json({ message: 'Gabim në server gjatë heqjes së email-it!' });
  }
};

// Get email status
exports.getEmailStatus = async (req, res) => {
  const { id: userId, type } = req.user;

  try {
    let user;
    
    if (type === 'user') {
      [user] = await db.query(
        'SELECT email, email_verified FROM users WHERE id = ?',
        [userId]
      );
    } else if (type === 'admin') {
      [user] = await db.query(
        'SELECT email, email_verified FROM admins WHERE id = ?',
        [userId]
      );
    }

    if (!user) {
      return res.status(404).json({ message: 'Përdoruesi nuk u gjet!' });
    }

    res.json({
      hasEmail: !!user.email,
      email: user.email,
      emailVerified: user.email_verified || false,
      type: type
    });

  } catch (err) {
    console.error('Get Email Status Error:', err);
    res.status(500).json({ message: 'Gabim në server gjatë marrjes së statusit të email-it!' });
  }
};

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

exports.postContact = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone = '',
      company = '',
      subject = '',
      message,
    } = req.body || {};

    if (!firstName || !lastName || !email || !subject || !message) {
      return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: 'INVALID_EMAIL' });
    }

    const result = await sendContactEmail({
      firstName,
      lastName,
      email,
      phone,
      company,
      subject,
      message,
    });

    return res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('Contact controller error:', err);
    return res.status(500).json({ ok: false, error: 'MAIL_FAILED' });
  }
};
