# SAML InResponseTo Cluster Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the intermittent `500 / Error: InResponseTo is not valid` on SAML login by giving node-saml a request-ID store that every cluster worker can see.

**Architecture:** node-saml's default `CacheProvider` is per-process, but `src/server.js` forks up to 4 workers and Node round-robins connections, so the worker that issues the AuthnRequest is usually not the worker that receives the IdP's POST. Replace the provider with a MongoDB-backed one in the database the app already uses, with a TTL index for expiry. Because `passport-ubcshib` whitelists the SAML options it forwards, the provider is attached to the underlying node-saml instance after construction.

**Tech Stack:** Node 22, Express, passport-saml 3.2.4 (vendored under passport-ubcshib 0.1.6), MongoDB driver 6.18, Jest 30.

**Spec:** No separate spec document — the diagnosis is captured in the "Background" section below.

## Background: the two findings this plan is built on

**1. The failure.** `passport-ubcshib` defaults `validateInResponseTo` to `true` (`node_modules/passport-ubcshib/index.js:150`). node-saml then saves each outbound request ID via `cacheProvider` (`saml.js:112`, `:183`, `:313`) and demands it back on the response (`saml.js:669`, `:840`), throwing `InResponseTo is not valid` on a miss. The default provider is in-process; its own docstring says it "will NOT be sufficient" for multiple processes. `src/server.js:13-27` forks up to 4 workers in production (commit `6a13052`, 2026-07-20). Result: ~3-in-4 cold logins hit a worker with no record of the request. It surfaces as a 500 rather than a redirect because a thrown error bypasses `failureRedirect` and lands in the handler at `src/server.js:280`.

**2. Why this is a Mongo collection and not the session.** Storing the ID in `req.session` looked cleaner — it is already shared across workers and would scope the ID to one browser. It does not work: `saml.js:313` saves a **logout** request ID unconditionally, and `src/controllers/auth.js` destroys `req.session` *before* redirecting to the IdP, so the LogoutResponse would arrive with nothing to validate against and SLO would start throwing the same error. A store independent of the session is required.

**3. Why the wiring is a post-construction assignment.** `passport-ubcshib/index.js:125-170` builds a fixed `samlOptions` object and never spreads the caller's `options`. Anything it does not name — including `cacheProvider` and `audience` — is silently dropped. The seam is `strategy._saml` (set in passport-saml's `AbstractStrategy` constructor); `saml.js:80` assigns `this.cacheProvider = this.options.cacheProvider` and every call site reads `this.cacheProvider`, so overwriting that property covers all paths.

## Global Constraints

- Node `>=22.0.0`; CommonJS (`require`), matching the rest of `src/`.
- Tests are Jest, `roots: tests/unit`, `maxWorkers: 1`, `clearMocks: true`. Unit tests mock MongoDB — do not add `mongodb-memory-server`.
- Collection naming follows the existing `grasp_*` convention (`grasp_user`, `grasp_course`, `grasp_session`).
- Index creation goes in `DatabaseService.initializeCollections()`, which only the first worker runs (`GRASP_SKIP_INDEX_INIT`).
- Do not change `validateInResponseTo`. It is the only replay protection in this flow — the request ID is consumed on success (`saml.js:846`, `:855`).

---

### Task 1: MongoDB-backed SAML request cache

**Files:**
- Create: `src/services/samlRequestCache.js`
- Test: `tests/unit/saml-request-cache.service.test.js`

**Interfaces:**
- Consumes: `src/services/database.js` → `databaseService.connect()` returning a `Db`.
- Produces: `module.exports = { samlRequestCache, SAML_REQUEST_COLLECTION }` where `samlRequestCache` implements node-saml's provider contract: `saveAsync(key, value)`, `getAsync(key)`, `removeAsync(key)`. `SAML_REQUEST_COLLECTION` is the string `'grasp_saml_request'`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/saml-request-cache.service.test.js`:

```js
const databaseService = require('../../src/services/database');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { samlRequestCache, SAML_REQUEST_COLLECTION } =
  require('../../src/services/samlRequestCache');

function mockCollection(collection) {
  databaseService.connect.mockResolvedValue({
    collection: jest.fn().mockReturnValue(collection),
  });
}

describe('samlRequestCache', () => {
  it('stores a request id with a createdAt stamp for the TTL index', async () => {
    const collection = { insertOne: jest.fn().mockResolvedValue({}) };
    mockCollection(collection);

    const result = await samlRequestCache.saveAsync('_abc', '2026-08-18T20:00:00Z');

    const inserted = collection.insertOne.mock.calls[0][0];
    expect(inserted._id).toBe('_abc');
    expect(inserted.value).toBe('2026-08-18T20:00:00Z');
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(result.value).toBe('2026-08-18T20:00:00Z');
  });

  it('returns null instead of throwing when the id already exists', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
    const collection = { insertOne: jest.fn().mockRejectedValue(duplicate) };
    mockCollection(collection);

    await expect(samlRequestCache.saveAsync('_abc', 'instant')).resolves.toBeNull();
  });

  it('propagates database errors that are not duplicate keys', async () => {
    const failure = Object.assign(new Error('no primary'), { code: 10107 });
    const collection = { insertOne: jest.fn().mockRejectedValue(failure) };
    mockCollection(collection);

    await expect(samlRequestCache.saveAsync('_abc', 'instant')).rejects.toBe(failure);
  });

  it('returns the stored value for a known id', async () => {
    const collection = {
      findOne: jest.fn().mockResolvedValue({ _id: '_abc', value: 'instant' }),
    };
    mockCollection(collection);

    await expect(samlRequestCache.getAsync('_abc')).resolves.toBe('instant');
    expect(collection.findOne).toHaveBeenCalledWith({ _id: '_abc' });
  });

  it('returns null for an id written by no worker', async () => {
    const collection = { findOne: jest.fn().mockResolvedValue(null) };
    mockCollection(collection);

    await expect(samlRequestCache.getAsync('_missing')).resolves.toBeNull();
  });

  it('consumes an id exactly once so a response cannot be replayed', async () => {
    const collection = {
      deleteOne: jest.fn()
        .mockResolvedValueOnce({ deletedCount: 1 })
        .mockResolvedValueOnce({ deletedCount: 0 }),
    };
    mockCollection(collection);

    await expect(samlRequestCache.removeAsync('_abc')).resolves.toBe('_abc');
    await expect(samlRequestCache.removeAsync('_abc')).resolves.toBeNull();
  });

  it('reads and writes the grasp_saml_request collection', async () => {
    const collection = { findOne: jest.fn().mockResolvedValue(null) };
    const db = { collection: jest.fn().mockReturnValue(collection) };
    databaseService.connect.mockResolvedValue(db);

    await samlRequestCache.getAsync('_abc');

    expect(db.collection).toHaveBeenCalledWith(SAML_REQUEST_COLLECTION);
    expect(SAML_REQUEST_COLLECTION).toBe('grasp_saml_request');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/saml-request-cache.service.test.js`
Expected: FAIL — `Cannot find module '../../src/services/samlRequestCache'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/samlRequestCache.js`:

```js
/**
 * Shared SAML request-ID cache.
 *
 * node-saml records every outbound AuthnRequest/LogoutRequest ID and requires
 * it back when the IdP responds (the InResponseTo attribute). Its default
 * CacheProvider keeps those IDs in process memory, which cannot work here:
 * server.js forks one worker per core in production and Node round-robins
 * incoming connections, so the IdP's POST almost always lands on a worker
 * other than the one that started the login. Backing the IDs with MongoDB
 * makes them visible to every worker and survives worker restarts.
 *
 * Implements the provider contract node-saml expects (saveAsync/getAsync/
 * removeAsync). Entries are expired by a TTL index created in
 * services/database.js, not by a timer in this process.
 */

const databaseService = require('./database');

const SAML_REQUEST_COLLECTION = 'grasp_saml_request';

async function requestCollection() {
	const db = await databaseService.connect();
	return db.collection(SAML_REQUEST_COLLECTION);
}

const samlRequestCache = {
	/**
	 * Record an outbound request ID. Mirrors the in-memory provider: a key that
	 * already exists is left alone and reported as null rather than overwritten.
	 */
	async saveAsync(key, value) {
		const createdAt = new Date();
		try {
			await (await requestCollection()).insertOne({ _id: key, value, createdAt });
			return { createdAt: createdAt.getTime(), value };
		} catch (error) {
			if (11000 === error.code) {
				return null;
			}
			throw error;
		}
	},

	async getAsync(key) {
		const entry = await (await requestCollection()).findOne({ _id: key });
		return entry ? entry.value : null;
	},

	/**
	 * Consume an ID. node-saml calls this after a successful validation, which
	 * is what makes each SAML response single-use.
	 */
	async removeAsync(key) {
		const result = await (await requestCollection()).deleteOne({ _id: key });
		return result.deletedCount > 0 ? key : null;
	},
};

module.exports = { samlRequestCache, SAML_REQUEST_COLLECTION };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/saml-request-cache.service.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/samlRequestCache.js tests/unit/saml-request-cache.service.test.js
git commit -m "Add MongoDB-backed SAML request-ID cache"
```

---

### Task 2: TTL index so request IDs expire

**Files:**
- Modify: `src/services/database.js` (inside `initializeCollections()`)
- Test: `tests/unit/saml-request-cache.service.test.js` (append a describe block)

**Interfaces:**
- Consumes: `SAML_REQUEST_COLLECTION` from Task 1.
- Produces: a `createdAt_1` TTL index on `grasp_saml_request` with `expireAfterSeconds: 600`.

Ten minutes comfortably covers a CWL login including a Duo prompt, and is far tighter than node-saml's 8-hour default. MongoDB's TTL monitor sweeps every 60s, so expiry is approximate — that is fine, the IDs are single-use anyway.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/saml-request-cache.service.test.js`:

```js
describe('grasp_saml_request TTL index', () => {
  it('expires request ids ten minutes after they are written', async () => {
    const realDatabase = jest.requireActual('../../src/services/database');
    const createIndex = jest.fn().mockResolvedValue('createdAt_1');
    const collection = jest.fn().mockReturnValue({ createIndex, dropIndex: jest.fn() });

    await realDatabase.createSamlRequestIndexes({ collection });

    expect(collection).toHaveBeenCalledWith('grasp_saml_request');
    expect(createIndex).toHaveBeenCalledWith(
      { createdAt: 1 },
      { expireAfterSeconds: 600 }
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/saml-request-cache.service.test.js -t 'TTL index'`
Expected: FAIL — `realDatabase.createSamlRequestIndexes is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/services/database.js`, add a method to the `DatabaseService` class (place it directly after `initializeCollections`):

```js
  /**
   * TTL index for the shared SAML request-ID cache. Ten minutes covers a CWL
   * login including a Duo prompt; node-saml's own 8-hour default would leave
   * consumed IDs lying around far longer than they are useful.
   */
  async createSamlRequestIndexes(db) {
    await db.collection("grasp_saml_request").createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 600 }
    );
  }
```

Then call it from `initializeCollections()`, alongside the other `createIndex` calls:

```js
      await this.createSamlRequestIndexes(this.db);
```

Confirm the export surface: `database.js` exports a singleton instance, so `createSamlRequestIndexes` is reachable as `databaseService.createSamlRequestIndexes`. If the file exports the instance (`module.exports = new DatabaseService()`), no export change is needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/saml-request-cache.service.test.js tests/unit/database-indexes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/database.js tests/unit/saml-request-cache.service.test.js
git commit -m "Expire SAML request ids after ten minutes via TTL index"
```

---

### Task 3: Attach the shared cache to the SAML strategy

**Files:**
- Modify: `src/middleware/passport.js:17-141`
- Test: `tests/unit/saml-strategy-cache.test.js`

**Interfaces:**
- Consumes: `samlRequestCache` from Task 1.
- Produces: `module.exports` gains `strategy` alongside the existing `{ passport, VALID_AFFILIATIONS, ROLES }`, so the wiring is assertable without reaching into passport internals.

This is the fix. Everything before it was groundwork.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/saml-strategy-cache.test.js`:

```js
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----'),
}));
jest.mock('../../src/services/user', () => ({
  createOrUpdateUser: jest.fn(),
  getUserByPuid: jest.fn(),
  updateUserNames: jest.fn(),
}));
jest.mock('../../src/services/ubcApiService', () => ({ getPersonByPuid: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { samlRequestCache } = require('../../src/services/samlRequestCache');

describe('ubcshib strategy request-ID cache', () => {
  let strategy;

  beforeAll(() => {
    process.env.SAML_ISSUER = 'https://grasp.example.ubc.ca';
    process.env.SAML_CALLBACK_URL = 'https://grasp.example.ubc.ca/Shibboleth.sso/SAML2/POST';
    process.env.SAML_PRIVATE_KEY_PATH = '/stub/key.pem';
    process.env.SAML_CERT_PATH = '/stub/cert.crt';
    ({ strategy } = require('../../src/middleware/passport'));
  });

  it('validates InResponseTo — the check that makes a shared cache necessary', () => {
    expect(strategy._saml.options.validateInResponseTo).toBe(true);
  });

  it('uses the shared MongoDB cache, not node-saml per-process memory', () => {
    expect(strategy._saml.cacheProvider).toBe(samlRequestCache);
  });

  it('stores request ids where another worker can read them back', async () => {
    const store = new Map();
    const collection = {
      insertOne: jest.fn(async (doc) => { store.set(doc._id, doc); }),
      findOne: jest.fn(async ({ _id }) => store.get(_id) || null),
      deleteOne: jest.fn(async ({ _id }) => ({ deletedCount: store.delete(_id) ? 1 : 0 })),
    };
    require('../../src/services/database').connect.mockResolvedValue({
      collection: () => collection,
    });

    // Worker A issues the AuthnRequest.
    await strategy._saml.cacheProvider.saveAsync('_worker_a_id', 'instant');
    // Worker B receives the IdP POST and looks the id up.
    await expect(strategy._saml.cacheProvider.getAsync('_worker_a_id')).resolves.toBe('instant');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/saml-strategy-cache.test.js`
Expected: FAIL — the second test reports the strategy is using node-saml's `CacheProvider` instance, not `samlRequestCache`. (The first test should already pass; it documents the precondition.)

- [ ] **Step 3: Write the implementation**

In `src/middleware/passport.js`, add the import beside the existing requires:

```js
const { samlRequestCache } = require('../services/samlRequestCache');
```

Then change the registration. Replace `passport.use(new Strategy({...}, verify))` so the strategy is held in a variable — keep the options object and the whole verify callback exactly as they are, and change only the surrounding lines:

```js
const strategy = new Strategy(
	{
		// ...existing options unchanged...
	},
	// ...existing verify callback unchanged...
);

// passport-ubcshib copies a fixed whitelist of SAML options into the strategy
// (see its index.js) and silently drops anything else, so cacheProvider cannot
// be passed through the constructor. node-saml reads this.cacheProvider on
// every path, so replacing it after construction covers login and SLO alike.
// Without this, request IDs live in one worker's heap and the IdP's POST —
// round-robined to a different worker — fails with "InResponseTo is not valid".
strategy._saml.cacheProvider = samlRequestCache;

passport.use(strategy);
```

Update the export at the bottom of the file:

```js
module.exports = { passport, strategy, VALID_AFFILIATIONS, ROLES };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/saml-strategy-cache.test.js`
Expected: PASS, 3 tests.

Then run the full unit suite to confirm nothing that imports `middleware/passport` broke:

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/passport.js tests/unit/saml-strategy-cache.test.js
git commit -m "Share SAML request ids across workers to fix InResponseTo 500s"
```

---

### Task 4: Validate the assertion audience

**Files:**
- Modify: `src/middleware/passport.js` (immediately after the `cacheProvider` assignment from Task 3)
- Test: `tests/unit/saml-strategy-cache.test.js` (append a test)

**Interfaces:**
- Consumes: `strategy` export from Task 3, `process.env.SAML_ISSUER`.
- Produces: no new exports.

**Why this is here:** while checking what protection would remain if `validateInResponseTo` were simply disabled, I found `audience` is never set, so `AudienceRestriction` is never checked — `saml.js:874` gates the entire check on `this.options.audience != null`, and neither `passport.js` nor `passport-ubcshib` passes it. There is no inbound `Destination` check in node-saml v3 either. So nothing currently ties an assertion to grasp specifically; an in-window assertion signed by the UBC IdP for a *different* UBC service provider would be accepted. Exploiting it requires first obtaining such an assertion, so this is defence-in-depth rather than an open door — but it is one line.

**Deploy this separately from Task 3 and in that order.** If the IdP's `Audience` value does not equal `SAML_ISSUER`, every login breaks. It should match by construction — Shibboleth sets `Audience` to the SP entityID, which is the `issuer` grasp sends — but verify against the staging IdP (`SAML_ENVIRONMENT=STAGING`) before production. Keeping it as its own commit makes it revertable without losing the cluster fix.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/saml-strategy-cache.test.js`:

```js
  it('binds assertions to this service provider via AudienceRestriction', () => {
    expect(strategy._saml.options.audience).toBe('https://grasp.example.ubc.ca');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/saml-strategy-cache.test.js -t 'AudienceRestriction'`
Expected: FAIL — `expected "https://grasp.example.ubc.ca", received undefined`.

- [ ] **Step 3: Write the implementation**

In `src/middleware/passport.js`, directly below the `cacheProvider` line:

```js
// node-saml skips the AudienceRestriction check entirely unless `audience` is
// set (saml.js checks `this.options.audience != null`), and it never checks the
// inbound Destination. Without this, any in-window assertion signed by the UBC
// IdP is accepted, including one issued for a different UBC service provider.
// Same whitelist problem as above, so it is set post-construction.
strategy._saml.options.audience = process.env.SAML_ISSUER;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/saml-strategy-cache.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify against a real IdP before merging**

Run the app against the staging IdP with `SAML_ENVIRONMENT=STAGING` and complete one full login. Expected: login succeeds. A failure with `SAML assertion audience mismatch` means the IdP's `Audience` differs from `SAML_ISSUER` — read the expected value from the error, and either correct `SAML_ISSUER` or set `audience` to the IdP's value rather than reverting the check.

- [ ] **Step 6: Commit**

```bash
git add src/middleware/passport.js tests/unit/saml-strategy-cache.test.js
git commit -m "Validate SAML assertion audience against the SP issuer"
```

---

### Task 5: Return a redirect, not a 500, for stale logins

**Files:**
- Modify: `src/server.js:145-153`, `src/routes/auth.js:14-19`
- Test: `tests/unit/saml-callback-errors.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new exports.

**Why this is here and why it is last:** Tasks 1–3 fix the cross-worker miss, but they do not make every `InResponseTo` failure disappear, and the remaining ones will still be 500s. A user who leaves the CWL page open past the 10-minute TTL, or who uses the back button onto a consumed request ID, still throws — correctly. A 500 error page is the wrong answer to "your login went stale"; a redirect back to login is. This is a separable improvement — drop the task if you only want the outage fixed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/saml-callback-errors.test.js`:

```js
const { samlErrorHandler } = require('../../src/middleware/samlErrorHandler');

describe('samlErrorHandler', () => {
  function res() {
    return { redirect: jest.fn() };
  }

  it('sends a stale request id back to login instead of a 500', () => {
    const response = res();
    const next = jest.fn();

    samlErrorHandler(new Error('InResponseTo is not valid'), {}, response, next);

    expect(response.redirect).toHaveBeenCalledWith('/auth/login?error=stale_login');
    expect(next).not.toHaveBeenCalled();
  });

  it('sends a missing request id back to login', () => {
    const response = res();
    const next = jest.fn();

    samlErrorHandler(new Error('InResponseTo is missing from response'), {}, response, next);

    expect(response.redirect).toHaveBeenCalledWith('/auth/login?error=stale_login');
  });

  it('passes a signature failure through so it is logged as a real error', () => {
    const response = res();
    const next = jest.fn();
    const error = new Error('Invalid signature');

    samlErrorHandler(error, {}, response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/saml-callback-errors.test.js`
Expected: FAIL — `Cannot find module '../../src/middleware/samlErrorHandler'`.

- [ ] **Step 3: Write the implementation**

Create `src/middleware/samlErrorHandler.js`:

```js
/**
 * Turns an expired or already-used SAML request ID into a redirect back to
 * login rather than a 500. node-saml throws for these, and a thrown error
 * bypasses passport's failureRedirect, so without this the user sees an error
 * page for what is really just a stale login attempt. Anything else — a bad
 * signature, an audience mismatch — is passed through to the real error
 * handler, which logs it.
 */

const STALE_REQUEST_ERRORS = [
	'InResponseTo is not valid',
	'InResponseTo is missing from response',
];

function samlErrorHandler(err, req, res, next) {
	if (err && STALE_REQUEST_ERRORS.includes(err.message)) {
		console.warn('Stale SAML login attempt:', err.message);
		return res.redirect('/auth/login?error=stale_login');
	}
	return next(err);
}

module.exports = { samlErrorHandler };
```

Wire it into both callback routes. In `src/server.js`, add it as the error handler on the Shibboleth POST route (error-handling middleware must come after the handler, with four arguments):

```js
app.post(
  '/Shibboleth.sso/SAML2/POST',
  express.json(),
  express.urlencoded({ extended: true }),
  passport.authenticate('ubcshib', { failureRedirect: '/auth/login' }),
  (req, res) => {
    res.redirect('/onboarding');
  },
  samlErrorHandler
);
```

with the import beside the other middleware requires:

```js
const { samlErrorHandler } = require('./middleware/samlErrorHandler');
```

And in `src/routes/auth.js`, after the callback route:

```js
const { samlErrorHandler } = require('../middleware/samlErrorHandler');

router.all(
	'/saml/callback',
	authController.callback,
	authController.callbackSuccess,
	samlErrorHandler
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/saml-callback-errors.test.js`
Expected: PASS, 3 tests.

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/samlErrorHandler.js src/server.js src/routes/auth.js tests/unit/saml-callback-errors.test.js
git commit -m "Redirect stale SAML logins to login instead of returning 500"
```

---

## Verifying the fix in the real deployment

Unit tests prove the wiring; they cannot prove the cross-worker path, because Jest runs one process. Confirm in staging with clustering actually on:

1. Start with `GRASP_WEB_CONCURRENCY=4` and `NODE_ENV=production`.
2. Complete a cold login (fresh incognito window) at least six times. Before the fix roughly three in four fail; after it all six should succeed.
3. Confirm `db.grasp_saml_request.countDocuments()` stays near zero between logins — entries are consumed on success, and the TTL sweeps abandoned ones within ~11 minutes.
4. Confirm `db.grasp_saml_request.getIndexes()` shows `createdAt_1` with `expireAfterSeconds: 600`.
5. Complete one full single-logout round trip, which exercises the `_generateLogoutRequest` path (`saml.js:313`) that ruled out session-scoped storage.
6. Watch the log for `InResponseTo is not valid`. It should be absent; if it appears, note whether it coincides with a login older than 10 minutes before treating it as a regression.

## Rollback

Each task is a standalone commit. Reverting Task 3 alone restores the old behaviour; Task 4 is independently revertable if the audience value turns out to be wrong. As an emergency stopgap without a deploy, `GRASP_WEB_CONCURRENCY=1` eliminates the errors at the cost of the throughput work from `6a13052`.
