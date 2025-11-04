# GRASP Docker Guide

Complete guide for running GRASP with Docker, including MongoDB and SAML authentication.

---

## 🚀 Quick Start

### **One-Line Setup:**

```powershell
# Windows PowerShell - Interactive setup
.\docker-start.ps1
```

**Or manually:**

```powershell
# 1. Copy environment template (first time only)
cp env-docker.template .env
# Edit .env with your values

# 2. Start all services
docker-compose up -d

# 3. Access GRASP
# Open: http://localhost:8070
```

---

## 📦 What's Included

Your complete Docker stack includes:

| Service | Container | Port | URL |
|---------|-----------|------|-----|
| **GRASP App** | grasp-app | 8070 | http://localhost:8070 |
| **MongoDB** | grasp-mongodb | 27017 | mongodb://localhost:27017 |
| **Mongo Express** | grasp-mongo-express | 8081 | http://localhost:8081 |
| **SAML IdP** | docker-simple-saml-saml-idp-1 | 8080 | http://localhost:8080/simplesaml |

---

## ⚙️ Setup

### **Step 1: Environment Configuration**

```powershell
# Copy template
cp env-docker.template .env
```

**Required variables to change in `.env`:**
```env
# MongoDB credentials
MONGO_INITDB_ROOT_PASSWORD=strong-password-here

# Session security
SESSION_SECRET=random-64-char-string

# SAML configuration
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php
SAML_ISSUER=https://tlef-grasp
SAML_CERT_PATH=./certs/cert.crt
```

### **Step 2: Extract SAML Certificate**

Your custom SAML IdP should already be running. Extract the certificate:

```powershell
# Extract certificate from your running custom IdP
docker exec docker-simple-saml-saml-idp-1 cat /var/www/simplesamlphp/cert/idp.crt > certs/cert.crt
```

### **Step 3: Start Services**

```powershell
# Start all GRASP services (connects to your existing IdP)
docker-compose up -d
```

---

## 🎯 Common Commands

### **Start/Stop**

```powershell
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View status
docker-compose ps

# View logs
docker-compose logs -f grasp-app
```

### **Development**

```powershell
# Rebuild after code changes
docker-compose up --build -d

# Restart just the app
docker-compose restart grasp-app

# Access app container shell
docker-compose exec grasp-app sh
```

### **MongoDB**

```powershell
# Access MongoDB shell
docker-compose exec mongodb mongosh -u mongoadmin -p <password> --authenticationDatabase admin

# View MongoDB logs
docker-compose logs -f mongodb

# Access web UI
# Browser: http://localhost:8081 (admin/admin)
```

---

## 🧪 Testing

### **Verify Services are Running:**

```powershell
docker-compose ps
```

**Expected output:**
- grasp-app (healthy)
- grasp-mongodb (healthy)
- grasp-mongo-express (Up)

### **Test GRASP Application:**

1. **Visit:** http://localhost:8070
2. **Should redirect to:** http://localhost:8080 (SAML login)
3. **Login with test credentials**
4. **Should redirect back to appropriate dashboard**

### **Test MongoDB:**

1. **Visit:** http://localhost:8081
2. **Login:** admin/admin
3. **Should see:** MongoDB databases and collections

---

## 🐛 Troubleshooting

### **Port Already in Use**

**Error:** `Bind for 0.0.0.0:8080 failed: port is already allocated`

**Solution:** This means your custom SAML IdP is already running (which is good!). This is the expected configuration - GRASP connects to your existing IdP.

### **MongoDB Connection Failed**

```powershell
# Check if MongoDB is running
docker-compose ps mongodb

# View MongoDB logs
docker-compose logs mongodb

# Test connectivity from app
docker-compose exec grasp-app ping mongodb
```

### **App Won't Start**

```powershell
# Check logs for errors
docker-compose logs grasp-app

# Common issues:
# - Missing SAML certificate → Extract from IdP
# - Wrong MONGO_URI → Check .env file
# - Port conflict → Change PORT in .env
```

### **Certificate Issues**

```powershell
# Verify certificate exists
Test-Path certs/cert.crt

# Re-extract from IdP
docker exec docker-simple-saml-saml-idp-1 cat /var/www/simplesamlphp/cert/idp.crt > certs/cert.crt

# Check certificate content
Get-Content certs/cert.crt
```

---

## 🔧 Maintenance

### **Update Application Code**

```powershell
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose up --build -d
```

### **Backup MongoDB**

```powershell
# Create backup
docker-compose exec mongodb mongodump --out=/data/backup

# Copy backup to host
docker cp grasp-mongodb:/data/backup ./mongodb-backup-$(Get-Date -Format 'yyyyMMdd')
```

### **View Resource Usage**

```powershell
# Monitor all containers
docker stats

# Check disk usage
docker system df
```

---

## 🧹 Cleanup

### **Remove Services (Keep Data)**

```powershell
docker-compose down
```

### **Remove Everything (Delete Data)**

```powershell
# WARNING: This deletes all MongoDB data!
docker-compose down -v
```

### **Clean Docker System**

```powershell
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Clean everything
docker system prune -a --volumes
```

---

## 📖 Environment Variables

### **Complete .env Template:**

```env
# MongoDB
MONGO_INITDB_ROOT_USERNAME=mongoadmin
MONGO_INITDB_ROOT_PASSWORD=change-this-password
MONGO_EXPRESS_LOGIN=admin
MONGO_EXPRESS_PASSWORD=change-this-password

# Server
PORT=8070
NODE_ENV=development
SESSION_SECRET=change-this-to-random-string
SESSION_TIMEOUT_MS=7200000

# SAML (using existing custom IdP)
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php
SAML_CALLBACK_URL=http://localhost:8070/auth/saml/callback
SAML_LOGOUT_CALLBACK_URL=http://localhost:8070/auth/logout/callback
SAML_ISSUER=https://tlef-grasp
SAML_CERT_PATH=./certs/cert.crt

# Optional: Force specific emails to be instructors
INSTRUCTOR_EMAILS=prof1@ubc.ca,prof2@ubc.ca
```

---

## 🎓 Test Users (SimpleSAMLphp IdP)

**Instructor Login:**
- Username: `user1`
- Password: `user1pass`
- → Lands on `/dashboard`

**Student Login:**
- Username: `user2`
- Password: `user2pass`
- → Lands on `/student-dashboard`

---

## 📊 Architecture

### **Service Dependencies:**

```
Custom SAML IdP (existing)
    ↓
MongoDB starts
    ↓
Mongo Express starts (depends on MongoDB)
    ↓
GRASP App starts (depends on MongoDB + IdP)
```

### **Networking:**

All GRASP services communicate through `grasp-network`. The app connects to your existing SAML IdP through the host network.

---

## ✅ Summary

**Your Complete Setup:**
- ✅ GRASP Application (containerized, hot reload enabled)
- ✅ MongoDB (running, healthy, persistent storage)
- ✅ Mongo Express (web UI for MongoDB)
- ✅ SAML IdP (your existing custom setup)

**Start Command:**
```powershell
docker-compose up -d
```

**Access URLs:**
- GRASP: http://localhost:8070
- MongoDB UI: http://localhost:8081
- SAML IdP: http://localhost:8080/simplesaml

**Everything runs in Docker!** 🐳🎉

