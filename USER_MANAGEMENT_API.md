# User Management API Documentation

This document provides comprehensive documentation for the User Management API endpoints, including authentication, request/response formats, and usage examples.

## Table of Contents
- [Authentication](#authentication)
- [Base URL](#base-url)
- [Days Off Management](#days-off-management)
- [Shifts Management](#shifts-management)
- [Rotation Management](#rotation-management)
- [Error Handling](#error-handling)
- [Common Response Formats](#common-response-formats)

## Authentication

All endpoints require JWT authentication. Include the token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

### User Roles
- **`user`**: Regular pharmacy employee
- **`admin`**: System administrator (full access)
- **`pharmacy_admin`**: Pharmacy administrator (limited to their pharmacy)

## Base URL

```
/api/user-management
```

---

## Days Off Management

### 1. Get Days Off

**Endpoint:** `GET /api/user-management/days-off`

**Description:** Retrieve days off requests with filtering options.

**Query Parameters:**
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `user_id` | integer | Filter by specific user ID | `?user_id=1` |
| `pharmacy_id` | integer | Filter by pharmacy ID | `?pharmacy_id=1` |
| `status` | string | Filter by status | `?status=PENDING` |
| `start_date` | string | Filter from date (YYYY-MM-DD) | `?start_date=2025-09-01` |
| `end_date` | string | Filter to date (YYYY-MM-DD) | `?end_date=2025-09-30` |

**Status Values:**
- `PENDING` - Awaiting approval
- `APPROVED` - Approved by admin
- `REJECTED` - Rejected by admin
- `CANCELLED` - Cancelled by user

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "user_id": 1,
      "pharmacy_id": 1,
      "start_date": "2025-09-10",
      "end_date": "2025-09-12",
      "start_half": "FULL",
      "end_half": "FULL",
      "status": "PENDING",
      "reason": "Vacation",
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-15T10:30:00.000Z",
      "username": "john_doe",
      "pharmacy_name": "Main Pharmacy"
    }
  ]
}
```

**Access Control:**
- **Users**: Can only see their own days off
- **Pharmacy Admins**: Can see all days off in their pharmacy
- **System Admins**: Can see all days off

---

### 2. Create Day Off Request

**Endpoint:** `POST /api/user-management/days-off`

**Description:** Create a new day off request.

**Request Body:**
```json
{
  "user_id": 1,              // Optional for admins, auto-filled for users
  "pharmacy_id": 1,          // Optional for admins, auto-filled for users
  "start_date": "2025-09-10",
  "end_date": "2025-09-12",
  "start_half": "AM",        // Optional: "AM", "PM", "FULL" (default: "FULL")
  "end_half": "PM",          // Optional: "AM", "PM", "FULL" (default: "FULL")
  "reason": "Vacation"
}
```

**Validation Rules:**
- `start_date` and `end_date` are required
- `start_date` must be ≤ `end_date`
- `start_half` and `end_half` must be one of: "AM", "PM", "FULL"
- No overlapping days off for the same user

**Response:**
```json
{
  "message": "Kërkesa për pushime u krijua me sukses.",
  "id": 1
}
```

**Access Control:**
- **Users**: Can create requests for themselves only
- **Admins**: Can create requests for any user in their pharmacy

---

### 3. Update Day Off Status

**Endpoint:** `PUT /api/user-management/days-off/:id/status`

**Description:** Update the status of a day off request (approve, reject, or cancel).

**Request Body:**
```json
{
  "status": "APPROVED",      // "APPROVED", "REJECTED", "CANCELLED"
  "reason": "Approved for vacation"  // Optional
}
```

**Response:**
```json
{
  "message": "Statusi i pushimeve u përditësua me sukses."
}
```

**Access Control:**
- **Users**: Can only cancel their own PENDING requests
- **Admins**: Can approve/reject/cancel any request in their pharmacy

---

## Shifts Management

### 1. Get Shifts

**Endpoint:** `GET /api/user-management/shifts`

**Description:** Retrieve shifts with filtering options.

**Query Parameters:**
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `user_id` | integer | Filter by user ID | `?user_id=1` |
| `pharmacy_id` | integer | Filter by pharmacy ID | `?pharmacy_id=1` |
| `start_date` | string | Filter from date (YYYY-MM-DD) | `?start_date=2025-09-01` |
| `end_date` | string | Filter to date (YYYY-MM-DD) | `?end_date=2025-09-30` |
| `start_datetime` | string | Filter from datetime | `?start_datetime=2025-09-03 09:00:00` |
| `end_datetime` | string | Filter to datetime | `?end_datetime=2025-09-03 17:00:00` |

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "user_id": 1,
      "pharmacy_id": 1,
      "start_datetime": "2025-09-03T09:00:00.000Z",
      "end_datetime": "2025-09-03T17:00:00.000Z",
      "label": "9-5",
      "location": "Main Pharmacy",
      "notes": "Regular shift",
      "created_by": 1,
      "created_at": "2025-01-15T10:30:00.000Z",
      "username": "john_doe",
      "pharmacy_name": "Main Pharmacy",
      "created_by_username": "admin_user"
    }
  ]
}
```

**Access Control:**
- **Users**: Can only see their own shifts
- **Pharmacy Admins**: Can see all shifts in their pharmacy
- **System Admins**: Can see all shifts

---

### 2. Create Shift

**Endpoint:** `POST /api/user-management/shifts`

**Description:** Create a new shift.

**Request Body:**
```json
{
  "user_id": 1,                    // Optional for admins, auto-filled for users
  "pharmacy_id": 1,                // Optional for admins, auto-filled for users
  "start_datetime": "2025-09-03 09:00:00",
  "end_datetime": "2025-09-03 17:00:00",
  "label": "9-5",                  // Optional
  "location": "Main Pharmacy",     // Optional
  "notes": "Regular shift"         // Optional
}
```

**Validation Rules:**
- `start_datetime` and `end_datetime` are required
- `start_datetime` must be < `end_datetime`
- No overlapping shifts for the same user
- Datetime format: `YYYY-MM-DD HH:MM:SS`

**Response:**
```json
{
  "message": "Turni u krijua me sukses.",
  "id": 1
}
```

**Access Control:**
- **Users**: Can create shifts for themselves only
- **Admins**: Can create shifts for any user in their pharmacy

---

## Rotation Management

### 1. Get Rotation Templates

**Endpoint:** `GET /api/user-management/rotation-templates`

**Description:** Retrieve rotation templates.

**Query Parameters:**
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `pharmacy_id` | integer | Filter by pharmacy ID | `?pharmacy_id=1` |

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "pharmacy_id": 1,
      "name": "Week A",
      "description": "Mon-Fri 9-17, Sat 9-13",
      "active": 1,
      "pharmacy_name": "Main Pharmacy"
    }
  ]
}
```

**Access Control:**
- **Pharmacy Admins**: Can see templates for their pharmacy
- **System Admins**: Can see all templates

---

### 2. Get Rotation Template with Slots

**Endpoint:** `GET /api/user-management/rotation-templates/:id`

**Description:** Get a specific rotation template with its time slots.

**Response:**
```json
{
  "template": {
    "id": 1,
    "pharmacy_id": 1,
    "name": "Week A",
    "description": "Mon-Fri 9-17, Sat 9-13",
    "active": 1,
    "pharmacy_name": "Main Pharmacy"
  },
  "slots": [
    {
      "id": 1,
      "template_id": 1,
      "dow": 1,                    // Day of week (0=Sunday, 1=Monday, etc.)
      "start_time": "09:00:00",
      "end_time": "17:00:00",
      "label": "9-5"
    },
    {
      "id": 2,
      "template_id": 1,
      "dow": 6,
      "start_time": "09:00:00",
      "end_time": "13:00:00",
      "label": "9-1"
    }
  ]
}
```

**Access Control:**
- **Pharmacy Admins**: Can see templates for their pharmacy
- **System Admins**: Can see all templates

---

### 3. Create Rotation Template

**Endpoint:** `POST /api/user-management/rotation-templates`

**Description:** Create a new rotation template with time slots.

**Request Body:**
```json
{
  "pharmacy_id": 1,
  "name": "Week A",
  "description": "Mon-Fri 9-17, Sat 9-13",
  "slots": [
    {
      "dow": 1,                    // Day of week (0-6)
      "start_time": "09:00:00",    // HH:MM:SS format
      "end_time": "17:00:00",      // HH:MM:SS format
      "label": "9-5"               // Optional
    },
    {
      "dow": 2,
      "start_time": "09:00:00",
      "end_time": "17:00:00",
      "label": "9-5"
    },
    {
      "dow": 6,
      "start_time": "09:00:00",
      "end_time": "13:00:00",
      "label": "9-1"
    }
  ]
}
```

**Validation Rules:**
- `pharmacy_id` and `name` are required
- Template name must be unique per pharmacy
- `dow` must be 0-6 (0=Sunday, 1=Monday, etc.)
- `start_time` and `end_time` must be valid HH:MM:SS format
- `start_time` must be < `end_time`

**Response:**
```json
{
  "message": "Template i rotacionit u krijua me sukses.",
  "id": 1
}
```

**Access Control:**
- **Pharmacy Admins**: Can create templates for their pharmacy
- **System Admins**: Can create templates for any pharmacy

---

### 4. Get Rotation Assignments

**Endpoint:** `GET /api/user-management/rotation-assignments`

**Description:** Retrieve rotation assignments.

**Query Parameters:**
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `user_id` | integer | Filter by user ID | `?user_id=1` |
| `pharmacy_id` | integer | Filter by pharmacy ID | `?pharmacy_id=1` |
| `template_id` | integer | Filter by template ID | `?template_id=1` |

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "user_id": 1,
      "pharmacy_id": 1,
      "template_id": 1,
      "effective_from": "2025-09-01",
      "effective_to": null,        // null = open-ended
      "username": "john_doe",
      "pharmacy_name": "Main Pharmacy",
      "template_name": "Week A"
    }
  ]
}
```

**Access Control:**
- **Users**: Can only see their own assignments
- **Pharmacy Admins**: Can see all assignments in their pharmacy
- **System Admins**: Can see all assignments

---

### 5. Create Rotation Assignment

**Endpoint:** `POST /api/user-management/rotation-assignments`

**Description:** Assign a user to a rotation template.

**Request Body:**
```json
{
  "user_id": 1,
  "pharmacy_id": 1,
  "template_id": 1,
  "effective_from": "2025-09-01",
  "effective_to": "2025-12-31"     // Optional, null = open-ended
}
```

**Validation Rules:**
- All fields except `effective_to` are required
- User must belong to the specified pharmacy
- Template must be active and belong to the pharmacy
- No overlapping assignments for the same user

**Response:**
```json
{
  "message": "Caktimi i rotacionit u krijua me sukses.",
  "id": 1
}
```

**Access Control:**
- **Pharmacy Admins**: Can assign users in their pharmacy
- **System Admins**: Can assign users in any pharmacy

---

## Error Handling

### Common HTTP Status Codes

| Status | Description |
|--------|-------------|
| `200` | Success |
| `201` | Created successfully |
| `400` | Bad request (validation error) |
| `401` | Unauthorized (invalid/missing token) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not found |
| `409` | Conflict (overlapping data) |
| `500` | Internal server error |

### Error Response Format

```json
{
  "message": "Error description in Albanian"
}
```

### Common Error Messages

| Message | Description |
|---------|-------------|
| `"Data e fillimit dhe e mbarimit janë të detyrueshme."` | Start and end dates are required |
| `"start_date nuk mund të jetë pas end_date."` | Start date cannot be after end date |
| `"Keni pushime të mbivendosura për këtë periudhë."` | You have overlapping days off for this period |
| `"Përdoruesi mund të anulojë vetëm."` | User can only cancel |
| `"Mund të anuloni vetëm kërkesa PENDING."` | Can only cancel PENDING requests |
| `"Keni turne të mbivendosura për këtë periudhë."` | You have overlapping shifts for this period |
| `"Template me këtë emër ekziston tashmë për këtë farmaci."` | Template with this name already exists for this pharmacy |
| `"Përdoruesi ka një caktim të mbivendosur për këtë periudhë."` | User has an overlapping assignment for this period |

---

## Common Response Formats

### Success Response
```json
{
  "message": "Operation completed successfully",
  "id": 123  // Optional, for created resources
}
```

### Data Response
```json
{
  "data": [
    // Array of objects
  ]
}
```

### Pagination Response (Future Enhancement)
```json
{
  "data": [
    // Array of objects
  ],
  "page": 1,
  "limit": 20,
  "total": 100
}
```

---

## Frontend Implementation Tips

### 1. Authentication
```javascript
// Include JWT token in all requests
const headers = {
  'Authorization': `Bearer ${localStorage.getItem('token')}`,
  'Content-Type': 'application/json'
};
```

### 2. Date Handling
```javascript
// Use ISO date format for API calls
const startDate = '2025-09-10';  // YYYY-MM-DD
const startDateTime = '2025-09-03 09:00:00';  // YYYY-MM-DD HH:MM:SS
```

### 3. Error Handling
```javascript
try {
  const response = await fetch('/api/user-management/days-off', {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }
  
  const result = await response.json();
  // Handle success
} catch (error) {
  // Handle error
  console.error('API Error:', error.message);
}
```

### 4. Role-Based UI
```javascript
// Show/hide features based on user role
const userRole = getUserRole(); // 'user', 'pharmacy_admin', 'admin'

if (userRole === 'admin' || userRole === 'pharmacy_admin') {
  // Show admin features
  showApproveRejectButtons();
  showCreateShiftForOthers();
  showRotationManagement();
}

if (userRole === 'user') {
  // Show user-only features
  showCreateDayOffRequest();
  showCancelPendingRequest();
}
```

### 5. Form Validation
```javascript
// Validate dates before submission
const validateDateRange = (startDate, endDate) => {
  return new Date(startDate) <= new Date(endDate);
};

// Validate time format
const validateTime = (time) => {
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
  return timeRegex.test(time);
};
```

---

## Testing Examples

### Create Day Off Request
```bash
curl -X POST http://localhost:3000/api/user-management/days-off \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2025-09-10",
    "end_date": "2025-09-12",
    "start_half": "AM",
    "end_half": "PM",
    "reason": "Vacation"
  }'
```

### Get Shifts with Date Filter
```bash
curl -X GET "http://localhost:3000/api/user-management/shifts?start_date=2025-09-01&end_date=2025-09-30" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Create Rotation Template
```bash
curl -X POST http://localhost:3000/api/user-management/rotation-templates \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pharmacy_id": 1,
    "name": "Week A",
    "description": "Mon-Fri 9-17, Sat 9-13",
    "slots": [
      {"dow": 1, "start_time": "09:00:00", "end_time": "17:00:00", "label": "9-5"},
      {"dow": 2, "start_time": "09:00:00", "end_time": "17:00:00", "label": "9-5"}
    ]
  }'
```

This documentation should provide everything needed for frontend implementation! 🚀
