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
