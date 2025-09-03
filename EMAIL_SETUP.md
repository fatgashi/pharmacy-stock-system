# Email Service Setup Guide

## Overview
This guide explains how to set up the email service for the Pharmacy Stock System, including email confirmation for users and automated notifications for low stock and expiry alerts.

## New Database Columns

The following columns need to be added to your database tables:

### Users Table
- `email` - User's email address (VARCHAR(255), UNIQUE)
- `email_confirmation_token` - Token for email confirmation (VARCHAR(255))
- `email_confirmation_expires` - Token expiration timestamp (DATETIME)
- `email_verified` - Whether email is verified (BOOLEAN, default FALSE)
- `created_at` - User creation timestamp (TIMESTAMP)
- `updated_at` - Last update timestamp (TIMESTAMP)

### Admins Table (Optional)
- `email` - Admin's email address (VARCHAR(255), UNIQUE)
- `email_confirmation_token` - Token for email confirmation (VARCHAR(255))
- `email_confirmation_expires` - Token expiration timestamp (DATETIME)
- `email_verified` - Whether email is verified (BOOLEAN, default FALSE)
- `created_at` - Admin creation timestamp (TIMESTAMP)
- `updated_at` - Last update timestamp (TIMESTAMP)

## Database Setup

1. Run the `database_updates.sql` script in your MySQL database
2. This will add all necessary columns and indexes

## Environment Variables

Add these variables to your `.env` file:

```env
# Email Configuration
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password_or_email_password

# Frontend URL (for email confirmation links)
FRONTEND_URL=http://localhost:3000
```

## Email Service Configuration

### Gmail Setup (Recommended)
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
3. Use the generated password in `EMAIL_PASSWORD`

### Other Email Services
- **Outlook/Hotmail**: Use `EMAIL_SERVICE=outlook`
- **Yahoo**: Use `EMAIL_SERVICE=yahoo`
- **Custom SMTP**: Modify the email config file

## New API Endpoints

### Email Management
- `POST /api/email/add` - Add email to profile (requires target parameter)
- `GET /api/email/status` - Get email verification status
- `POST /api/email/resend-confirmation` - Resend confirmation email
- `DELETE /api/email/remove` - Remove email from profile
- `GET /api/email/confirm/:token` - Confirm email with token

### Authentication Required
Most endpoints require JWT authentication except for email confirmation.

### Target Parameter
The `add` endpoint now requires a `target` parameter:
- `"user"` - Add email to user profile (only users can do this)
- `"admin"` - Add email to admin profile (only admins can do this)

## Email Templates

The system includes three email templates:

1. **Email Confirmation** - Sent when user adds email
2. **Low Stock Alert** - Sent when product stock is below threshold
3. **Expiry Alert** - Sent when product is approaching expiry

## Automated Notifications

### Low Stock Alerts
- Runs at 9:00 AM, 1:00 PM, and 5:00 PM daily
- Checks products below the configured threshold
- Sends emails to verified users AND admins if enabled in pharmacy settings

### Expiry Alerts
- Runs daily at 2:00 AM
- Checks products approaching expiry based on configured days
- Sends emails to verified users AND admins if enabled in pharmacy settings

## Pharmacy Settings

Users can configure notification preferences in pharmacy settings:
- `notify_by_email` - Enable/disable email notifications
- `low_stock_threshold` - Stock level that triggers low stock alerts
- `expiry_alert_days` - Days before expiry to send alerts

## Installation Steps

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run database updates:
   ```bash
   mysql -u your_user -p your_database < database_updates.sql
   ```

3. Configure environment variables

4. Restart your application

## Testing

### 1. Add Email to User Profile:
```bash
POST /api/email/add
Authorization: Bearer <jwt_token>
{
  "email": "user@example.com",
  "target": "user"
}
```

### 2. Add Email to Admin Profile:
```bash
POST /api/email/add
Authorization: Bearer <jwt_token>
{
  "email": "admin@example.com",
  "target": "admin"
}
```

### 3. Check Email Status:
```bash
GET /api/email/status
Authorization: Bearer <jwt_token>
```

### 4. Confirm Email (click link in email or use API):
```bash
GET /api/email/confirm/<token>
```

## Email Uniqueness

The system ensures email addresses are unique across both users and admins:
- A user cannot use an email that's already registered by another user or admin
- An admin cannot use an email that's already registered by another user or admin
- This prevents conflicts and ensures proper email delivery

## Notification Recipients

When email notifications are enabled, the system sends alerts to:
1. **Verified users** in the specific pharmacy
2. **Pharmacy admin** (if they have verified email)
3. **Super admins** (role = "admin") with verified emails

## Troubleshooting

### Email Not Sending
- Check email credentials in `.env`
- Verify email service configuration
- Check console logs for error messages

### Database Errors
- Ensure all columns were added correctly
- Check database permissions
- Verify table structure with `DESCRIBE users` and `DESCRIBE admins`

### Token Issues
- Tokens expire after 24 hours
- Use resend confirmation endpoint if needed
- Check token format in database

### Target Parameter Errors
- Ensure `target` is either "user" or "admin"
- Verify user type matches target (users can only target "user", admins can only target "admin")

## Security Features

- Email confirmation tokens expire after 24 hours
- Tokens are cryptographically secure (32 bytes random)
- Email addresses are unique across both users and admins
- Verification required before receiving notifications
- JWT authentication for all management endpoints
- Role-based access control for email operations
