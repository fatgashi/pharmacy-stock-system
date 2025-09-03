const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter for email sending
const createTransporter = () => {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

// Email templates in Albanian
const emailTemplates = {
  emailConfirmation: (username, confirmationLink) => ({
    subject: 'Konfirmoni Email-in Tuaj - Sistemi i Menaxhimit të Farmacisë',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">Mirë se vini në Sistemin e Menaxhimit të Farmacisë!</h2>
        <p>Përshëndetje <strong>${username}</strong>,</p>
        <p>Faleminderit që u regjistruat me sistemin tonë të menaxhimit të farmacisë. Për të përfunduar regjistrimin dhe për të aktivizuar njoftimet me email, ju lutem konfirmoni adresën tuaj të email-it.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${confirmationLink}" 
             style="background-color: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Konfirmoni Email-in tuaj!
          </a>
        </div>
        
        <p>Nëse butoni i mësipërm nuk funksionon, mund te klikoni këtu:</p>
        <p style="word-break: break-all; color: #7f8c8d;">${confirmationLink}</p>
        
        <p>Ky link do të skadoje pas 24 orësh për arsye sigurie.</p>
        
        <p>Me respekt,<br>Ekipi i Sistemit të Menaxhimit të Farmacisë</p>
      </div>
    `,
    text: `
      Mirë se vini në Sistemin e Menaxhimit të Farmacisë!
      
      Përshëndetje ${username},
      
      Faleminderit që u regjistruat me sistemin tonë të menaxhimit të farmacisë. Për të përfunduar regjistrimin dhe për të aktivizuar njoftimet me email, ju lutem konfirmoni adresën tuaj të email-it.
      
      Konfirmoni email-in tuaj duke vizituar këtë link:
      ${confirmationLink}
      
      Kjo lidhje do të skadoje pas 24 orësh për arsye sigurie.
      
      Me respekt,
      Ekipi i Sistemit të Menaxhimit të Farmacisë
    `
  }),
  
  lowStockAlert: (productName, barcode, currentStock, threshold) => ({
    subject: 'Njoftim Stock i Ulët - Sistemi i Menaxhimit të Farmacisë',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #e74c3c;">⚠️ Njoftim Stock i Ulët</h2>
        <p>Përshëndetje,</p>
        <p>Ky është një njoftim i automatizuar që një nga produktet tuaja ka stock të ulët.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #2c3e50; margin-top: 0;">Detajet e Produktit:</h3>
          <p><strong>Produkti:</strong> ${productName}</p>
          <p><strong>Barkodi:</strong> ${barcode}</p>
          <p><strong>Stocki Aktual:</strong> ${currentStock} copë</p>
          <p><strong>Pragu i Stockit:</strong> ${threshold} copë</p>
        </div>
        
        <p>Ju lutem rimbushni këtë produkt së shpejti për të shmangur mungesën e inventarit.</p>
        
        <p>Me respekt,<br>Sistemi i Menaxhimit të Farmacisë</p>
      </div>
    `,
    text: `
      ⚠️ Njoftim Stock i Ulët
      
      Përshëndetje,
      
      Ky është një njoftim i automatizuar që një nga produktet tuaja ka stock të ulët.
      
      Detajet e Produktit:
      Produkti: ${productName}
      Barkodi: ${barcode}
      Stocki Aktual: ${currentStock} copë
      Pragu i Stockit: ${threshold} copë
      
      Ju lutem rimbushni këtë produkt së shpejti për të shmangur mungesën e inventarit.
      
      Me respekt,
      Sistemi i Menaxhimit të Farmacisë
    `
  }),
  
  expiryAlert: (productName, barcode, expiryDate, daysUntilExpiry) => ({
    subject: 'Njoftim Skadimi i Produktit - Sistemi i Menaxhimit të Farmacisë',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f39c12;">⏰ Njoftim Skadimi</h2>
        <p>Përshëndetje,</p>
        <p>Ky është një njoftim i automatizuar që një nga produktet tuaja po i afrohet datës së skadimit.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #2c3e50; margin-top: 0;">Detajet e Produktit:</h3>
          <p><strong>Produkti:</strong> ${productName}</p>
          <p><strong>Barkodi:</strong> ${barcode}</p>
          <p><strong>Data e Skadimit:</strong> ${expiryDate}</p>
          <p><strong>Ditët Deri në Skadim:</strong> ${daysUntilExpiry} ditë</p>
        </div>
        
        <p>Ju lutem ndërmerrni veprime të përshtatshme për të menaxhuar këtë inventar para se të skadojë.</p>
        
        <p>Me respekt,<br>Sistemi i Menaxhimit të Farmacisë</p>
      </div>
    `,
    text: `
      ⏰ Njoftim Skadimi
      
      Përshëndetje,
      
      Ky është një njoftim i automatizuar që një nga produktet tuaja po i afrohet datës së skadimit.
      
      Detajet e Produktit:
      Produkti: ${productName}
      Barkodi: ${barcode}
      Data e Skadimit: ${expiryDate}
      Ditët Deri në Skadim: ${daysUntilExpiry} ditë
      
      Ju lutem ndërmerrni veprime të përshtatshme për të menaxhuar këtë inventar para se të skadojë.
      
      Me respekt,
      Sistemi i Menaxhimit të Farmacisë
    `
  })
};

// Send email function
const sendEmail = async (to, template, data = {}) => {
  try {
    const transporter = createTransporter();
    const emailContent = emailTemplates[template](...data);
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    };
    
    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendEmail,
  emailTemplates
};
