// revokePromotedStaffIfNoTaCourses: the one place that decides whether taking
// a TA role away also takes away the staff affiliation the promotion granted.
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/user', () => ({
  getUsersByIds: jest.fn(),
  getUserById: jest.fn(),
  revokePromotedStaffAffiliation: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const userService = require('../../src/services/user');
const { revokePromotedStaffIfNoTaCourses } = require('../../src/services/user-course');

let taMemberships;

beforeEach(() => {
  jest.clearAllMocks();
  taMemberships = 0;
  databaseService.connect.mockResolvedValue({
    collection: () => ({ countDocuments: jest.fn(async () => taMemberships) }),
  });
});

it('revokes a promoted TA left with no TA course', async () => {
  userService.getUserById.mockResolvedValue({ _id: 'u1', staffViaTaPromotion: true });

  const user = await revokePromotedStaffIfNoTaCourses('u1');

  expect(userService.revokePromotedStaffAffiliation).toHaveBeenCalledWith('u1');
  expect(user).toEqual({ _id: 'u1', staffViaTaPromotion: true });
});

it('keeps staff while the user is still a TA somewhere', async () => {
  userService.getUserById.mockResolvedValue({ _id: 'u1', staffViaTaPromotion: true });
  taMemberships = 1;

  await revokePromotedStaffIfNoTaCourses('u1');

  expect(userService.revokePromotedStaffAffiliation).not.toHaveBeenCalled();
});

it('never touches staff that came from SAML', async () => {
  userService.getUserById.mockResolvedValue({ _id: 'u1', affiliation: ['staff'] });

  await revokePromotedStaffIfNoTaCourses('u1');

  expect(userService.revokePromotedStaffAffiliation).not.toHaveBeenCalled();
});

it('does nothing for a user that no longer exists', async () => {
  userService.getUserById.mockResolvedValue(null);

  await expect(revokePromotedStaffIfNoTaCourses('gone')).resolves.toBeNull();
  expect(userService.revokePromotedStaffAffiliation).not.toHaveBeenCalled();
});
