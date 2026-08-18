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
