// A returning user's affiliation is refreshed from SAML on every login, so
// someone who left UBC or changed roles does not keep a stale affiliation (and
// role). The one exception is a TA promotion's staff affiliation, which SAML
// knows nothing about and must survive the refresh.
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const databaseService = require('../../src/services/database');
const { resolveLoginAffiliation, refreshLoginAffiliation } = require('../../src/services/user');

describe('resolveLoginAffiliation', () => {
  it('replaces a stale stored affiliation with the SAML one', () => {
    const result = resolveLoginAffiliation({ affiliation: ['faculty'] }, ['student']);
    expect(result).toEqual({ affiliation: ['student'], clearPromotion: false, setPromotion: false, changed: true });
  });

  it('drops an affiliation SAML no longer releases', () => {
    const result = resolveLoginAffiliation({ affiliation: ['staff', 'student'] }, ['student']);
    expect(result.affiliation).toEqual(['student']);
    expect(result.changed).toBe(true);
  });

  it('reports no change when the members match, in any order', () => {
    const result = resolveLoginAffiliation({ affiliation: ['student', 'staff'] }, ['staff', 'student']);
    expect(result.changed).toBe(false);
  });

  it('rewrites a comma-separated stored value as an array', () => {
    const result = resolveLoginAffiliation({ affiliation: 'staff,student' }, ['student', 'staff']);
    expect(result.affiliation).toEqual(['student', 'staff']);
    expect(result.changed).toBe(true);
  });

  it('accepts a comma-separated SAML value and de-duplicates it', () => {
    const result = resolveLoginAffiliation({ affiliation: ['student'] }, 'student, student');
    expect(result.affiliation).toEqual(['student']);
    expect(result.changed).toBe(false);
  });

  it('keeps the staff affiliation granted by a TA promotion', () => {
    const user = { affiliation: ['student', 'staff'], staffViaTaPromotion: true };
    const result = resolveLoginAffiliation(user, ['student']);
    expect(result).toEqual({ affiliation: ['student', 'staff'], clearPromotion: false, setPromotion: false, changed: false });
  });

  it('keeps the promoted staff affiliation even when the rest changes', () => {
    const user = { affiliation: ['student', 'staff'], staffViaTaPromotion: true };
    const result = resolveLoginAffiliation(user, ['affiliate']);
    expect(result.affiliation).toEqual(['affiliate', 'staff']);
    expect(result.clearPromotion).toBe(false);
  });

  it('clears the promotion marker once SAML releases staff itself', () => {
    const user = { affiliation: ['student', 'staff'], staffViaTaPromotion: true };
    const result = resolveLoginAffiliation(user, ['student', 'staff']);
    expect(result).toEqual({ affiliation: ['student', 'staff'], clearPromotion: true, setPromotion: false, changed: true });
  });

  // A TA who was already staff when promoted carries no promotion marker. If
  // SAML stops releasing staff while they are still a TA, dropping it would
  // lock them out of their TA course.
  it('keeps staff that SAML dropped while the user is still a TA, as promotion-granted', () => {
    const result = resolveLoginAffiliation({ affiliation: ['staff'] }, ['student'], { isStillTa: true });
    expect(result).toEqual({ affiliation: ['student', 'staff'], clearPromotion: false, setPromotion: true, changed: true });
  });

  it('drops staff that SAML dropped once the user is no longer a TA', () => {
    const result = resolveLoginAffiliation({ affiliation: ['staff'] }, ['student'], { isStillTa: false });
    expect(result).toEqual({ affiliation: ['student'], clearPromotion: false, setPromotion: false, changed: true });
  });

  it('upgrades a roster-sync placeholder to the real affiliation', () => {
    const result = resolveLoginAffiliation({ affiliation: ['student'] }, ['faculty', 'staff']);
    expect(result.affiliation).toEqual(['faculty', 'staff']);
    expect(result.changed).toBe(true);
  });
});

describe('refreshLoginAffiliation', () => {
  let userCollection;
  let membershipCollection;
  let taMemberships;

  beforeEach(() => {
    jest.clearAllMocks();
    userCollection = { updateOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
    taMemberships = 0;
    membershipCollection = { countDocuments: jest.fn(async () => taMemberships) };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => (name === 'grasp_user_course' ? membershipCollection : userCollection)),
    });
  });

  it('writes the refreshed affiliation by PUID', async () => {
    const result = await refreshLoginAffiliation({ puid: 'PUID1', affiliation: ['faculty'] }, ['student']);

    expect(result).toEqual({ affiliation: ['student'] });
    const [filter, update] = userCollection.updateOne.mock.calls[0];
    expect(filter).toEqual({ puid: 'PUID1' });
    expect(update.$set.affiliation).toEqual(['student']);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$unset).toBeUndefined();
  });

  it('does not write when nothing changed', async () => {
    const result = await refreshLoginAffiliation({ puid: 'PUID1', affiliation: ['student'] }, ['student']);

    expect(result).toBeNull();
    expect(userCollection.updateOne).not.toHaveBeenCalled();
  });

  it('unsets the promotion marker when SAML now releases staff', async () => {
    const user = { puid: 'PUID1', affiliation: ['student', 'staff'], staffViaTaPromotion: true };
    const result = await refreshLoginAffiliation(user, ['student', 'staff']);

    expect(result).toEqual({ affiliation: ['student', 'staff'], staffViaTaPromotion: undefined });
    const [, update] = userCollection.updateOne.mock.calls[0];
    expect(update.$unset).toEqual({ staffViaTaPromotion: '' });
  });

  it('marks staff kept for a TA course as promotion-granted', async () => {
    taMemberships = 1;
    const result = await refreshLoginAffiliation({ _id: 'u1', puid: 'PUID1', affiliation: ['staff'] }, ['student']);

    expect(result).toEqual({ affiliation: ['student', 'staff'], staffViaTaPromotion: true });
    const [, update] = userCollection.updateOne.mock.calls[0];
    expect(update.$set).toEqual(expect.objectContaining({ affiliation: ['student', 'staff'], staffViaTaPromotion: true }));
  });

  it('drops SAML-dropped staff for someone who is no longer a TA', async () => {
    taMemberships = 0;
    const result = await refreshLoginAffiliation({ _id: 'u1', puid: 'PUID1', affiliation: ['staff'] }, ['student']);

    expect(result).toEqual({ affiliation: ['student'] });
  });

  it('looks up TA roles only when SAML dropped staff that SAML gave', async () => {
    await refreshLoginAffiliation({ _id: 'u1', puid: 'PUID1', affiliation: ['faculty'] }, ['student']);
    await refreshLoginAffiliation({ _id: 'u1', puid: 'PUID1', affiliation: ['staff'] }, ['staff']);
    await refreshLoginAffiliation(
      { _id: 'u1', puid: 'PUID1', affiliation: ['student', 'staff'], staffViaTaPromotion: true },
      ['student']
    );

    expect(membershipCollection.countDocuments).not.toHaveBeenCalled();
  });

  it('rethrows a database failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    userCollection.updateOne.mockRejectedValue(new Error('db down'));

    await expect(refreshLoginAffiliation({ puid: 'PUID1', affiliation: ['faculty'] }, ['student']))
      .rejects.toThrow('db down');
    console.error.mockRestore();
  });
});
