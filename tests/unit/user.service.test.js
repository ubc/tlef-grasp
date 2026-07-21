// Unit coverage for how the user service persists the two name fields:
//   - displayName: the student-editable preferred name, seeded once on insert
//     and never overwritten on re-login / roster re-sync.
//   - legalName: the authoritative CWL/IAM name shown to instructors, refreshed
//     whenever the identity source supplies it.
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const { createOrUpdateUser, updateUserLegalName } = require('../../src/services/user');

describe('user service name fields', () => {
  let userCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    userCollection = {
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => userCollection),
    });
  });

  describe('createOrUpdateUser', () => {
    it('seeds displayName only on insert but refreshes legalName every time', async () => {
      await createOrUpdateUser({
        puid: 'PUID-1',
        displayName: 'Jane Q. Legal',
        legalName: 'Jane Q. Legal',
        email: 'jane@ubc.ca',
        affiliation: ['student'],
      });

      const [filter, update] = userCollection.updateOne.mock.calls[0];
      expect(filter).toEqual({ puid: 'PUID-1' });

      // displayName is student-editable: only applied when the row is created.
      expect(update.$setOnInsert.displayName).toBe('Jane Q. Legal');
      expect(update.$set.displayName).toBeUndefined();

      // legalName is authoritative: refreshed on every upsert.
      expect(update.$set.legalName).toBe('Jane Q. Legal');
      expect(update.$setOnInsert.legalName).toBeUndefined();
    });

    it('omits legalName from $set when the caller does not supply one', async () => {
      // Roster sync only knows the preferred name, not the legal name.
      await createOrUpdateUser({
        puid: 'PUID-2',
        displayName: 'Preferred Only',
        email: 'pref@ubc.ca',
        affiliation: ['student'],
      });

      const [, update] = userCollection.updateOne.mock.calls[0];
      expect('legalName' in update.$set).toBe(false);
      expect(update.$setOnInsert.displayName).toBe('Preferred Only');
    });

    it('requires a puid', async () => {
      await expect(createOrUpdateUser({ displayName: 'No Puid' }))
        .rejects.toThrow('Puid is required');
      expect(userCollection.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('updateUserLegalName', () => {
    it('updates only legalName without touching displayName, email, or affiliation', async () => {
      await updateUserLegalName('PUID-3', 'Refreshed Legal Name');

      const [filter, update] = userCollection.updateOne.mock.calls[0];
      expect(filter).toEqual({ puid: 'PUID-3' });
      expect(update.$set.legalName).toBe('Refreshed Legal Name');
      expect(update.$set).not.toHaveProperty('displayName');
      expect(update.$set).not.toHaveProperty('email');
      expect(update.$set).not.toHaveProperty('affiliation');
    });

    it('requires a puid', async () => {
      await expect(updateUserLegalName('', 'X')).rejects.toThrow('Puid is required');
      expect(userCollection.updateOne).not.toHaveBeenCalled();
    });
  });
});
