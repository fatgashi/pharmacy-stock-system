// services/contactMailer.js
const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Dedicated transporter for contact form.
 * You can use separate SMTP creds or fall back to the general ones.
 */
const createContactTransporter = () => {
  // If you prefer host/port instead of "service", set CONTACT_SMTP_HOST/PORT/etc.
  if (process.env.CONTACT_SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.CONTACT_SMTP_HOST,
      port: Number(process.env.CONTACT_SMTP_PORT || 587),
      secure: Number(process.env.CONTACT_SMTP_PORT) === 465,
      auth: {
        user: process.env.CONTACT_SMTP_USER,
        pass: process.env.CONTACT_SMTP_PASS,
      },
    });
  }

  // Otherwise use a "service" (e.g., gmail) for contact emails
  return nodemailer.createTransport({
    service: process.env.CONTACT_EMAIL_SERVICE || process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.CONTACT_EMAIL_USER || process.env.EMAIL_USER,
      pass: process.env.CONTACT_EMAIL_PASSWORD || process.env.EMAIL_PASSWORD,
    },
  });
};

const sanitize = (v) => String(v || '').replace(/[<>]/g, '');

const SUBJECT_MAP = {
  quote: 'Kërkesë për Ofertë',
  custom: 'Porosi e Personalizuar',
  support: 'Asistencë Teknike',
  general: 'Kërkesë e Përgjithshme',
};

const contactTemplate = ({
  firstName,
  lastName,
  email,
  phone,
  company,
  subject,
  message,
}) => {
  const fullName = `${sanitize(firstName)} ${sanitize(lastName)}`.trim();
  const subjectLabel = SUBJECT_MAP[subject] || 'Kontakt nga Formulari';
  const subjectLine = `📨 ${subjectLabel} — ${fullName}`;

  return {
    subject: subjectLine,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2 style="color:#2c3e50; margin: 0 0 8px;">Mesazh i ri nga formulari i kontaktit</h2>
        <p style="color:#7f8c8d; margin: 0 0 16px;">Ky mesazh u dërgua nga faqja e kontaktit.</p>

        <table cellpadding="8" cellspacing="0" style="border-collapse:collapse; background:#f8f9fa; border-radius:8px; width:100%; margin: 12px 0;">
          <tr><td style="width:180px;"><b>Emri</b></td><td>${fullName}</td></tr>
          <tr><td><b>Email</b></td><td>${sanitize(email)}</td></tr>
          ${phone ? `<tr><td><b>Telefoni</b></td><td>${sanitize(phone)}</td></tr>` : ''}
          ${company ? `<tr><td><b>Kompania</b></td><td>${sanitize(company)}</td></tr>` : ''}
          <tr><td><b>Subjekti</b></td><td>${sanitize(subjectLabel)}</td></tr>
        </table>

        <div style="margin-top: 16px;">
          <h3 style="margin:0 0 8px; color:#2c3e50;">Mesazhi</h3>
          <div style="white-space:pre-wrap; line-height:1.5; color:#2c3e50;">${sanitize(message)}</div>
        </div>
      </div>
    `,
    text:
      `Mesazh i ri nga formulari i kontaktit\n\n` +
      `Emri: ${fullName}\n` +
      `Email: ${email}\n` +
      (phone ? `Telefoni: ${phone}\n` : '') +
      (company ? `Kompania: ${company}\n` : '') +
      `Subjekti: ${subjectLabel}\n\n` +
      `${message}\n`,
  };
};

/**
 * Public API: send contact email
 */
const sendContactEmail = async (payload) => {
  const transporter = createContactTransporter();
  const email = contactTemplate(payload);

  const mailOptions = {
    from: process.env.CONTACT_EMAIL_FROM || process.env.CONTACT_EMAIL_USER || process.env.EMAIL_USER,
    to: process.env.CONTACT_TO || process.env.EMAIL_TO || process.env.EMAIL_USER,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: `${payload.firstName} ${payload.lastName} <${payload.email}>`,
    cc: process.env.CONTACT_CC || undefined,
    bcc: process.env.CONTACT_BCC || undefined,
  };

  const result = await transporter.sendMail(mailOptions);
  return result;
};

module.exports = {
  sendContactEmail,
};
