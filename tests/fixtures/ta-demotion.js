// Stand-in for services/user-course's revokePromotedStaffIfNoTaCourses in
// controller tests that mock both user services. It follows the real helper
// through the mocked getUserById, countTaMemberships and
// revokePromotedStaffAffiliation, so tests can keep driving and asserting
// those (a promoted TA left with no TA course loses staff; anyone else keeps it).
async function revokeViaMocks(userId) {
  const userService = require('../../src/services/user');
  const userCourseService = require('../../src/services/user-course');
  const user = await userService.getUserById(userId);
  if (!user?.staffViaTaPromotion) return user;
  if ((await userCourseService.countTaMemberships(userId)) > 0) return user;
  await userService.revokePromotedStaffAffiliation(userId);
  return user;
}

module.exports = { revokeViaMocks };
