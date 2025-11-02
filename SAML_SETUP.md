# SAML Authentication Setup for GRASP

This guide will help you set up SAML authentication for the GRASP application.

## Prerequisites

1. Node.js and npm installed
2. An Identity Provider (IdP) such as:
   - SimpleSAMLphp (for local testing)
   - UBC CWL
   - Azure AD
   - Other SAML 2.0 compliant IdP

## Quick Start

### 1. Create Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Server Configuration
PORT=8070

# Session Configuration
SESSION_SECRET=please-change-me-to-a-random-string
SESSION_TIMEOUT_MS=7200000

# SAML Configuration
# IdP URLs
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php

# Service Provider URLs
SAML_CALLBACK_URL=http://localhost:8070/auth/saml/callback
SAML_LOGOUT_CALLBACK_URL=http://localhost:8070/auth/logout/callback
SAML_ISSUER=http://localhost:8070/metadata

# IdP Certificate - Choose ONE:
# Option 1: Inline certificate (single line or \n-separated, no BEGIN/END lines)
# SAML_IDP_CERT=MIIDXTCCAkWgAwIBAgIJALmVVuDWu4NYMA0GCSqGSIb3DQ...

# Option 2: Path to certificate file
SAML_CERT_PATH=./certs/idp-signing.crt
```

### 2. Set Up IdP Certificate

**Option A: Using Certificate File (Recommended)**

1. Obtain the IdP signing certificate from your Identity Provider
2. Save it to `./certs/idp-signing.crt`
3. Set `SAML_CERT_PATH=./certs/idp-signing.crt` in your `.env` file

**Option B: Using Inline Certificate**

1. Copy the certificate content (without the BEGIN/END lines)
2. Set `SAML_IDP_CERT=<certificate_content>` in your `.env` file

### 3. Configure Your IdP

Register GRASP as a Service Provider in your IdP with these settings:

- **Entity ID / Issuer**: `http://localhost:8070/metadata` (or your production URL)
- **Assertion Consumer Service (ACS) URL**: `http://localhost:8070/auth/saml/callback`
- **Single Logout Service (SLS) URL**: `http://localhost:8070/auth/logout/callback`

You can also use the auto-generated SP metadata:
```bash
# Start the server and visit:
http://localhost:8070/auth/metadata
```

### 4. Start the Application

```bash
npm install
npm run dev
```

## SAML Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | GET | Initiate SAML login flow |
| `/auth/saml/callback` | POST | Assertion Consumer Service (ACS) |
| `/auth/logout` | GET | Initiate Single Logout |
| `/auth/logout/callback` | GET | SLO callback from IdP |
| `/auth/me` | GET | Get current user info |
| `/auth/metadata` | GET | Service Provider metadata XML |

## Testing the Setup

1. Visit `http://localhost:8070/auth/login`
2. You should be redirected to your IdP login page
3. After successful login, you'll be redirected back to GRASP dashboard
4. Check your session: `http://localhost:8070/auth/me`

## Troubleshooting

### Server won't start

**Issue**: Missing IdP certificate
```
Error: Missing SAML_IDP_CERT or SAML_CERT_PATH for IdP cert.
```

**Solution**: Make sure you've configured one of the certificate options in your `.env` file.

### SAML login fails

1. Check IdP configuration matches SP settings
2. Verify certificate is correct and not expired
3. Check logs for specific SAML errors
4. Ensure clock synchronization (acceptedClockSkewMs is set to 5000ms)

### Port conflicts

If port 8070 is already in use:
```bash
# Change PORT in .env to a different port
PORT=3000
```

## Using with Docker SimpleSAMLphp (for testing)

See the included `docker-compose.yml` for a local IdP setup using SimpleSAMLphp.

```bash
docker-compose up -d
```

Then configure your `.env` to use:
- `SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php`
- `SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php`

## Production Deployment

For production:

1. Use HTTPS for all URLs
2. Generate a strong `SESSION_SECRET`
3. Use proper certificate management
4. Consider using Redis or database for session storage
5. Update all URLs to production domain
6. Ensure proper firewall and security settings

## User Attributes

The SAML implementation extracts these user attributes:

- `nameID` - Unique identifier
- `email` - User email
- `givenName` - First name
- `familyName` - Last name (sn)
- `displayName` - Full display name
- `eppn` - eduPersonPrincipalName
- `sessionIndex` - SAML session identifier

These are normalized from various IdP formats including OID attributes.

