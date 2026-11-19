jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => ({
  createMongoTokenStore: jest.fn(),
}));
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const { createMongoTokenStore } = require('@ubc/ubc-genai-toolkit-lms-integration');
const databaseService = require('../../src/services/database');
const { createLmsTokenStore, undefinedAsNull } = require('../../src/lms/token-store');

function mockToolkitStore() {
  const store = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  createMongoTokenStore.mockReturnValue(store);
  return store;
}

describe('LMS token store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the toolkit store on GRASP\'s database and collection', async () => {
    mockToolkitStore();
    databaseService.connect.mockResolvedValue('protected-db');

    createLmsTokenStore('grasp_lms_canvas_tokens');

    const [getDb, options] = createMongoTokenStore.mock.calls[0];
    expect(options).toEqual({ collectionName: 'grasp_lms_canvas_tokens' });
    await expect(getDb()).resolves.toBe('protected-db');
  });

  it('stores an undefined token member as null, which encryption accepts', async () => {
    const store = mockToolkitStore();
    const tokenStore = createLmsTokenStore('grasp_lms_canvas_tokens');

    await tokenStore.set('user-1', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 1700000000000,
      canvasUserId: undefined,
    });

    expect(store.set).toHaveBeenCalledWith('user-1', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 1700000000000,
      canvasUserId: null,
    });
  });

  it('passes get and delete straight through', async () => {
    const store = mockToolkitStore();
    store.get.mockResolvedValue({ token: 't' });
    const tokenStore = createLmsTokenStore('grasp_lms_moodle_tokens');

    await expect(tokenStore.get('user-2')).resolves.toEqual({ token: 't' });
    await tokenStore.delete('user-2');

    expect(store.get).toHaveBeenCalledWith('user-2');
    expect(store.delete).toHaveBeenCalledWith('user-2');
  });

  it('leaves values that are not token objects alone', () => {
    expect(undefinedAsNull(null)).toBeNull();
    expect(undefinedAsNull('opaque')).toBe('opaque');
  });
});
