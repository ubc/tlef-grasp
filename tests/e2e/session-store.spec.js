const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');

// What the session store holds after real SAML logins (saml.setup.js signs in
// every persona first): the user's id and the SAML logout fields, never a
// copy of the user's name, email or PUID (src/middleware/session-user.js).
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';
const ALLOWED_USER_KEYS = ['id', 'nameID', 'nameIDFormat', 'nameIDNameQualifier', 'nameIDSPNameQualifier'];

async function readStore() {
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'grasp_db');
    const [sessions, users] = await Promise.all([
      db.collection('grasp_session').find({}).toArray(),
      db.collection('grasp_user').find({}, { projection: { puid: 1, email: 1, legalName: 1 } }).toArray(),
    ]);
    return {
      sessions: sessions.map((doc) => (typeof doc.session === 'string' ? JSON.parse(doc.session) : doc.session)),
      users,
    };
  } finally {
    await client.close();
  }
}

test.describe('Session store contents', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP — run with E2E_SAML=1');

  test('a signed-in session holds only the user id and the SAML logout fields', async () => {
    const { sessions } = await readStore();
    const signedIn = sessions.filter((session) => session.passport?.user);
    expect(signedIn.length).toBeGreaterThan(0);

    for (const session of signedIn) {
      const keys = Object.keys(session.passport.user);
      expect(keys).toContain('id');
      expect(keys.filter((key) => !ALLOWED_USER_KEYS.includes(key))).toEqual([]);
    }
  });

  test('no session contains a user\'s email, PUID or legal name', async () => {
    const { sessions, users } = await readStore();
    const stored = sessions.map((session) => JSON.stringify(session)).join('\n');
    const identities = users
      .flatMap((user) => [user.email, user.puid, user.legalName])
      .filter((value) => typeof value === 'string' && value.length >= 4);
    expect(identities.length).toBeGreaterThan(0);

    for (const value of identities) {
      expect(stored).not.toContain(value);
    }
  });
});
