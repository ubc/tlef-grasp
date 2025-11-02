# GRASP Troubleshooting Guide

## Server Won't Start on localhost:8070

### Problem: Missing SAML Configuration

**Error Message:**
```
Error: Missing SAML_IDP_CERT or SAML_CERT_PATH for IdP cert.
```

**Cause:** The application requires SAML configuration to initialize, but no `.env` file or certificate is configured.

**Solution:**

1. **Create a `.env` file** in the project root:
   ```bash
   cp env-template.txt .env
   ```

2. **Configure SAML settings** in the `.env` file. At minimum, you need:
   - `SAML_ENTRY_POINT` - Your IdP's SSO URL
   - `SAML_LOGOUT_URL` - Your IdP's logout URL
   - `SAML_IDP_CERT` or `SAML_CERT_PATH` - Your IdP's signing certificate

3. **For quick testing**, use these temporary values:
   ```env
   PORT=8070
   SESSION_SECRET=dev-secret-change-in-production
   SESSION_TIMEOUT_MS=7200000
   
   SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
   SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php
   SAML_CALLBACK_URL=http://localhost:8070/auth/saml/callback
   SAML_LOGOUT_CALLBACK_URL=http://localhost:8070/auth/logout/callback
   SAML_ISSUER=http://localhost:8070/metadata
   SAML_CERT_PATH=./certs/idp-signing.crt
   ```

4. **Add a certificate file** at `./certs/idp-signing.crt`

5. **Restart the server**:
   ```bash
   npm run dev
   ```

### Problem: Port Already in Use

**Error Message:**
```
Error: listen EADDRINUSE: address already in use :::8070
```

**Solution:**

1. **Check if another process is using port 8070:**
   ```bash
   # Windows PowerShell
   netstat -ano | findstr :8070
   
   # Find and kill the process
   taskkill /PID <PID> /F
   ```

2. **Or change the port** in your `.env` file:
   ```env
   PORT=3000
   ```

### Problem: Missing Dependencies

**Error Message:**
```
Error: Cannot find module 'passport-saml'
```

**Solution:**
```bash
npm install
```

### Problem: Module Not Found Errors

**Error Messages:**
```
Cannot find module './routes'
Cannot find module './routes/pages'
```

**Cause:** Old code was trying to import non-existent route files.

**Status:** ✅ FIXED - These imports have been removed from `src/server.js`

## Verification Steps

After fixing the above issues, verify your setup:

1. **Check server starts without errors:**
   ```bash
   npm run dev
   ```
   
   You should see:
   ```
   Server is running on http://localhost:8070
   GRASP Test
   ```

2. **Test basic endpoints:**
   - Dashboard: http://localhost:8070
   - SAML metadata: http://localhost:8070/auth/metadata
   - Auth status: http://localhost:8070/auth/me

3. **Check SAML flow** (if IdP is configured):
   - Visit: http://localhost:8070/auth/login
   - Should redirect to your IdP login page
   - After login, should redirect back to GRASP

## Common Configuration Issues

### Certificate Format Issues

**Problem:** Certificate not being read correctly

**Solutions:**

1. **Ensure proper PEM format:**
   ```
   -----BEGIN CERTIFICATE-----
   MIIDXTCCAkWgAwIBAgIJALmVVuDWu4NYMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
   ...
   -----END CERTIFICATE-----
   ```

2. **Check file path is correct:**
   ```env
   SAML_CERT_PATH=./certs/idp-signing.crt
   ```

3. **Or use inline certificate** (without BEGIN/END lines):
   ```env
   SAML_IDP_CERT=MIIDXTCCAkWgAwIBAgIJALmVVuDW...
   ```

### Session Issues

**Problem:** Login doesn't persist

**Solution:** Ensure session middleware is properly configured in `.env`:
```env
SESSION_SECRET=a-long-random-secret-string-here
SESSION_TIMEOUT_MS=7200000
```

## Quick Test Setup with Docker IdP

If you want to test SAML quickly with a local IdP:

1. **Check `docker-compose.yml`** exists in project root

2. **Start SimpleSAMLphp IdP:**
   ```bash
   docker-compose up -d
   ```

3. **Extract the certificate:**
   ```bash
   docker-compose exec simplesamlphp cat /var/simplesamlphp/cert/idp.crt > certs/idp-signing.crt
   ```

4. **Use the local IdP configuration** in your `.env` file (see example above)

5. **Register your SP** in the IdP configuration

## Need More Help?

- 📖 See [SAML_SETUP.md](SAML_SETUP.md) for complete SAML configuration
- 📖 See [README.md](README.md) for general setup and usage
- 🔍 Check the console output for specific error messages
- 🐛 Enable debug logging by setting `DEBUG=passport-saml` in your environment

## What Was Fixed

The following issues were resolved:

1. ✅ **Updated `src/middleware/passport.js`**
   - Proper error handling for missing certificates
   - Support for both inline and file-based certificates
   - Comprehensive attribute mapping from IdP

2. ✅ **Updated `src/routes/auth.js`**
   - Complete SAML endpoints (login, callback, logout, metadata)
   - Proper session management
   - User info endpoint for frontend

3. ✅ **Updated `src/server.js`**
   - Removed non-existent route imports
   - Proper middleware ordering
   - Correct passport initialization

4. ✅ **Added configuration files**
   - `env-template.txt` - Environment variable template
   - `SAML_SETUP.md` - Complete SAML setup guide
   - `certs/README.md` - Certificate management guide
   - Updated `.gitignore` - Prevent committing secrets

5. ✅ **Updated documentation**
   - Enhanced `README.md` with SAML information
   - Added security best practices
   - Updated technology stack

