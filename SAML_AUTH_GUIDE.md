# GRASP SAML Authentication Guide

Complete guide for SAML authentication setup and role-based access control.

---

## 🔐 SAML Authentication Overview

GRASP uses SAML 2.0 for secure single sign-on with automatic role detection.

**Features:**
- ✅ Automatic role detection (Instructor vs Student)
- ✅ Role-based page access
- ✅ Single Logout (SLO) support
- ✅ UBC CWL compatible

---

## ⚙️ Configuration

### **Required Environment Variables:**

```env
# SAML IdP URLs
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php

# Service Provider URLs
SAML_CALLBACK_URL=http://localhost:8070/auth/saml/callback
SAML_LOGOUT_CALLBACK_URL=http://localhost:8070/auth/logout/callback
SAML_ISSUER=https://tlef-grasp

# IdP Certificate
SAML_CERT_PATH=./certs/cert.crt
```

### **Optional: Role Override**

```env
# Force specific emails to be instructors (for testing)
INSTRUCTOR_EMAILS=prof1@ubc.ca,prof2@ubc.ca
```

---

## 🔑 Role Detection

Roles are automatically assigned based on SAML affiliation attribute:

**Instructor:** `faculty`, `staff`, or `employee`
**Student:** `student` or default

**Override:** Emails in `INSTRUCTOR_EMAILS` are always instructors.

---

## 🛡️ Protected Routes

### **Instructor-Only Routes:**
- `/dashboard` - Instructor dashboard
- `/question-generation` - Generate questions
- `/question-bank` - Question library
- `/question-review` - Review questions
- `/settings` - Application settings
- `/users` - User management
- `/course-materials` - Course content

### **Student-Only Routes:**
- `/student-dashboard` - Student dashboard
- `/quiz` - Take quizzes
- `/quiz-summary` - View results
- `/achievements` - Student badges

### **Smart Redirects:**

- Students trying instructor pages → Redirected to `/student-dashboard`
- Instructors trying student pages → Redirected to `/dashboard`
- Unauthenticated users → Redirected to `/auth/login`

---

## 🔄 SAML Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/login` | GET | Start SAML login |
| `/auth/saml/callback` | POST | Assertion Consumer Service |
| `/auth/logout` | GET | Single Logout |
| `/auth/logout/callback` | GET | SLO callback |
| `/auth/me` | GET | Get user info & role |
| `/auth/metadata` | GET | SP metadata XML |

---

## 🧪 Testing

### **Test Instructor Login:**

1. Visit: http://localhost:8070
2. Login with: `user1` / `user1pass`
3. Should land on: `/dashboard`
4. Can access: All instructor routes
5. Cannot access: Student routes (redirects back)

### **Test Student Login:**

1. Visit: http://localhost:8070
2. Login with: `user2` / `user2pass`
3. Should land on: `/student-dashboard`
4. Can access: All student routes
5. Cannot access: Instructor routes (redirects back)

### **Check Your Role:**

```
http://localhost:8070/auth/me
```

**Response:**
```json
{
  "authenticated": true,
  "user": {
    "role": "instructor",
    "email": "user1@example.com",
    "displayName": "Test User 1",
    "affiliation": ["faculty"]
  }
}
```

---

## 🚪 Logout

Click the red **Logout** button at the bottom of the sidebar to:
1. Trigger SAML Single Logout
2. End IdP session
3. Destroy local session
4. Redirect to login page

---

## 🐛 Troubleshooting

### **Server Won't Start**

**Error:** `Missing SAML_IDP_CERT or SAML_CERT_PATH`

**Solution:** Extract certificate from your IdP:
```powershell
docker exec docker-simple-saml-saml-idp-1 cat /var/www/simplesamlphp/cert/idp.crt > certs/cert.crt
```

### **Login Redirects in a Loop**

**Check:**
1. SAML_CALLBACK_URL matches what's registered in IdP
2. SAML_ISSUER matches what's registered in IdP
3. Certificate is correct and not expired

### **Wrong Dashboard After Login**

**Check role detection:**
```
http://localhost:8070/auth/me
```

Look at the `role` field. If incorrect, check:
1. SAML affiliation attribute
2. `INSTRUCTOR_EMAILS` override in .env

---

## ✅ Summary

**Authentication:** SAML 2.0 with automatic role detection
**Roles:** Instructor and Student
**Access Control:** Route-level protection
**Logout:** Full SAML Single Logout support

**Setup:** Add SAML config to `.env`, extract certificate, start services
**Test:** Login with different credentials, verify role-based access

For Docker setup, see [DOCKER_GUIDE.md](DOCKER_GUIDE.md)

