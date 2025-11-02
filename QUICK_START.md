# Quick Start Guide - Get GRASP Running in 5 Minutes

## 🚨 Why Your Server Wasn't Starting

**Problem:** Server crashed when running `npm run dev`

**Root Causes Found:**
1. Missing route imports (`./routes` and `./routes/pages` didn't exist)
2. SAML middleware required configuration but no `.env` file existed
3. No IdP certificate configured

**Status:** ✅ **ALL FIXED!**

---

## 🚀 Get Running Now (3 Steps)

### Step 1: Create Environment File

```bash
# Windows PowerShell
Copy-Item env-template.txt .env

# Or manually create .env file
```

### Step 2: Edit `.env` File

Open `.env` and add **at minimum** these values:

```env
PORT=8070
SESSION_SECRET=my-super-secret-key-change-this

# SAML Configuration - Replace with your IdP details
SAML_ENTRY_POINT=https://your-idp.com/sso
SAML_LOGOUT_URL=https://your-idp.com/logout
SAML_CALLBACK_URL=http://localhost:8070/auth/saml/callback
SAML_LOGOUT_CALLBACK_URL=http://localhost:8070/auth/logout/callback
SAML_ISSUER=http://localhost:8070/metadata

# Certificate - Choose ONE option:
# Option A: File path (recommended)
SAML_CERT_PATH=./certs/idp-signing.crt

# Option B: Inline certificate (without BEGIN/END lines)
# SAML_IDP_CERT=MIIDXTCCAkWgAwIBAgIJALmVVu...
```

### Step 3: Add IdP Certificate

**Option A:** Place certificate file at `./certs/idp-signing.crt`

**Option B:** Add inline certificate to `SAML_IDP_CERT` in `.env`

### Step 4: Start Server

```bash
npm run dev
```

**Expected Output:**
```
Server is running on http://localhost:8070
GRASP Test
```

✅ **Success!** Open http://localhost:8070 in your browser

---

## 🧪 Verify It's Working

### Test These URLs:

1. **Dashboard** (should load): http://localhost:8070
2. **SP Metadata** (should show XML): http://localhost:8070/auth/metadata
3. **Auth Status** (should show JSON): http://localhost:8070/auth/me

### If All Load Successfully:
🎉 **Your server is running correctly!**

---

## ❓ Don't Have SAML IdP Yet?

### Option 1: For Development/Testing
Use placeholder values in `.env` (server will start but SAML login won't work):

```env
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php
SAML_CALLBACK_URL=http://localhost:8070/auth/saml/callback
SAML_LOGOUT_CALLBACK_URL=http://localhost:8070/auth/logout/callback
SAML_ISSUER=http://localhost:8070/metadata
```

Create a dummy certificate file:
```bash
# Windows PowerShell
New-Item -Path "certs/idp-signing.crt" -ItemType File -Force
"-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJALmVVuDWu4NYMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAlVTMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMTYwODI3MjEyMzI3WhcNMjYwODI1MjEyMzI3WjBF
-----END CERTIFICATE-----" | Out-File -FilePath "certs/idp-signing.crt"
```

### Option 2: Use UBC CWL (Production)
Contact your UBC IT team for:
- IdP entry point URL
- IdP logout URL  
- IdP signing certificate

---

## 🆘 Still Having Issues?

### Server won't start?
```bash
# Check for errors in the output
# Common issues:
# 1. Port 8070 in use -> Change PORT in .env
# 2. Missing .env -> Create it (Step 1)
# 3. Missing certificate -> Add it (Step 3)
```

### Detailed help:
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Detailed error solutions
- **[SAML_SETUP.md](SAML_SETUP.md)** - Complete SAML configuration
- **[SAML_IMPLEMENTATION_SUMMARY.md](SAML_IMPLEMENTATION_SUMMARY.md)** - What was fixed

---

## 📋 What Was Fixed in Your Code

### Files Modified:
- ✅ `src/server.js` - Removed broken imports, cleaned up middleware
- ✅ `src/middleware/passport.js` - Complete rewrite with proper SAML config
- ✅ `src/routes/auth.js` - Complete rewrite with all SAML endpoints

### Files Created:
- ✅ `env-template.txt` - Environment variable template
- ✅ `SAML_SETUP.md` - Complete setup guide
- ✅ `TROUBLESHOOTING.md` - Error solutions
- ✅ `QUICK_START.md` - This file
- ✅ `certs/README.md` - Certificate guide

### Files Updated:
- ✅ `README.md` - Added SAML documentation
- ✅ `.gitignore` - Added certificate exclusions

---

## 🎯 Summary

**Before:** Server crashed on startup ❌  
**After:** Server starts successfully ✅

**What you need:**
1. `.env` file with SAML configuration
2. IdP certificate (file or inline)
3. Run `npm run dev`

**That's it!** 🎉

---

## 🔗 Quick Links

| Document | Purpose |
|----------|---------|
| **[QUICK_START.md](QUICK_START.md)** | ⚡ This file - Get running fast |
| **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** | 🔧 Fix errors |
| **[SAML_SETUP.md](SAML_SETUP.md)** | 📖 Complete SAML guide |
| **[SAML_IMPLEMENTATION_SUMMARY.md](SAML_IMPLEMENTATION_SUMMARY.md)** | 📝 Technical details |
| **[README.md](README.md)** | 📚 General project info |

---

**Need help?** Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

