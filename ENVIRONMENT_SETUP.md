# 🌍 Environment Variables Setup Guide

## 📋 Quick Setup

1. **Copy the example file:**
   ```bash
   cp env.example .env
   ```

2. **Edit the `.env` file with your actual values**

3. **Restart your application**

## 🔑 Required Variables (Must Have)

### **Database Configuration**
```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_username
DB_PASSWORD=your_mysql_password
DB_NAME=pharmacy_stock_system
```

### **JWT Authentication**
```bash
JWT_SECRET=your_super_secret_key_here_make_it_long_and_random
JWT_EXPIRES_IN=24h
```

### **Email Service**
```bash
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
```

## 📧 Email Setup Instructions

### **For Gmail:**
1. Enable 2-Factor Authentication on your Google account
2. Generate an "App Password":
   - Go to Google Account Settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail"
3. Use the generated password in `EMAIL_PASSWORD`

### **For Other Providers:**
- **Outlook**: Use your regular password
- **Yahoo**: Generate an app password
- **Custom SMTP**: Add these variables:
  ```bash
  EMAIL_HOST=smtp.yourprovider.com
  EMAIL_PORT=587
  EMAIL_SECURE=false
  ```

## 🚀 Development vs Production

### **Development (.env)**
```bash
NODE_ENV=development
PORT=3000
JWT_SECRET=dev_secret_key_change_in_production
FRONTEND_URL=http://localhost:3000
```

### **Production (.env)**
```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=super_secure_random_string_here
FRONTEND_URL=https://yourdomain.com
```

## ⚙️ Optional Variables

### **Cron Job Schedules**
```bash
# Low stock check: 9 AM, 1 PM, 5 PM daily
LOW_STOCK_CRON_SCHEDULE=0 9,13,17 * * *

# Expiry check: 2 AM daily  
EXPIRY_CRON_SCHEDULE=0 2 * * *
```

### **Security Settings**
```bash
BCRYPT_ROUNDS=12
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=https://yourdomain.com
```

## 🔒 Security Best Practices

1. **Never commit `.env` to version control**
2. **Use strong, random JWT secrets**
3. **Use app passwords for email services**
4. **Limit database user permissions**
5. **Use HTTPS in production**

## 🧪 Testing Configuration

### **Test Database**
```bash
TEST_DB_HOST=localhost
TEST_DB_USER=test_user
TEST_DB_PASSWORD=test_password
TEST_DB_NAME=pharmacy_stock_system_test
```

### **Mock Email Service**
```bash
MOCK_EMAIL_SERVICE=true
TEST_EMAIL_RECIPIENT=test@example.com
```

## 📊 Monitoring & Analytics

### **Error Tracking (Optional)**
```bash
ENABLE_ERROR_TRACKING=true
SENTRY_DSN=https://your_sentry_dsn
```

### **Application Monitoring (Optional)**
```bash
ENABLE_MONITORING=true
NEW_RELIC_LICENSE_KEY=your_license_key
```

## 🚨 Troubleshooting

### **Email Not Working?**
- Check `EMAIL_SERVICE` is correct
- Verify `EMAIL_USER` and `EMAIL_PASSWORD`
- For Gmail: Use app password, not regular password
- Check your email provider's sending limits

### **Database Connection Issues?**
- Verify MySQL is running
- Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`
- Ensure database exists: `CREATE DATABASE pharmacy_stock_system;`

### **JWT Authentication Failing?**
- Check `JWT_SECRET` is set
- Verify `JWT_EXPIRES_IN` format (e.g., "24h", "7d")
- Ensure secret is long enough (at least 32 characters)

## 📝 Example Complete .env File

```bash
# Server
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3000

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=pharmacy_stock_system

# JWT
JWT_SECRET=my_super_secret_jwt_key_for_development_12345
JWT_EXPIRES_IN=24h

# Email
EMAIL_SERVICE=gmail
EMAIL_USER=yourname@gmail.com
EMAIL_PASSWORD=abcd efgh ijkl mnop

# Cron Jobs
ENABLE_LOW_STOCK_CHECK=true
ENABLE_EXPIRY_CHECK=true
LOW_STOCK_CRON_SCHEDULE=0 9,13,17 * * *
EXPIRY_CRON_SCHEDULE=0 2 * * *

# Notifications
ENABLE_EMAIL_NOTIFICATIONS=true
NOTIFY_LOW_STOCK=true
NOTIFY_NEAR_EXPIRY=true
```

## 🎯 Next Steps

1. **Copy `env.example` to `.env`**
2. **Fill in your database credentials**
3. **Configure your email service**
4. **Set a strong JWT secret**
5. **Test the email system**
6. **Adjust cron schedules as needed**

## 📞 Need Help?

If you encounter issues:
1. Check the console logs for error messages
2. Verify all required variables are set
3. Test database connection separately
4. Test email service with a simple script
5. Check file permissions for `.env`

---

**Remember:** Keep your `.env` file secure and never share it publicly! 🔐
