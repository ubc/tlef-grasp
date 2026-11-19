/**
 * App administrators can put one prompt back to the default in every course.
 * A course that saved its settings stores its own copy of every prompt and
 * never sees a later change to the default; removing those copies is how the
 * default reaches it again. Only APP_ADMINISTRATOR may do it.
 */

const mockCollection = {
  find: jest.fn(),
  deleteMany: jest.fn(),
};
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(async () => ({ collection: () => mockCollection })),
}));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isAppAdministrator: jest.fn(),
}));

const { isAppAdministrator } = require('../../src/utils/auth');
const { requireAppAdministrator } = require('../../src/middleware/auth');
const settingsService = require('../../src/services/settings');
const { resetPromptForAllCoursesHandler } = require('../../src/controllers/admin');

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('requireAppAdministrator', () => {
  const request = (authenticated) => ({ isAuthenticated: () => authenticated, user: { _id: 'u1' } });

  it('refuses a signed-out request', async () => {
    const res = buildResponse();
    const next = jest.fn();
    await requireAppAdministrator(request(false), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses faculty who are not app administrators', async () => {
    isAppAdministrator.mockResolvedValue(false);
    const res = buildResponse();
    const next = jest.fn();
    await requireAppAdministrator(request(true), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets an app administrator through', async () => {
    isAppAdministrator.mockResolvedValue(true);
    const next = jest.fn();
    await requireAppAdministrator(request(true), buildResponse(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('resetting a prompt in every course', () => {
  it('removes every course copy of that prompt and nothing else', async () => {
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 5 });
    const res = buildResponse();

    await resetPromptForAllCoursesHandler({ params: { promptKey: 'questionGeneration' }, user: { _id: 'u1' } }, res);

    expect(mockCollection.deleteMany).toHaveBeenCalledWith({ name: 'prompt_question_generation' });
    expect(res.json).toHaveBeenCalledWith({ success: true, promptKey: 'questionGeneration', resetCourses: 5 });
  });

  it.each(['notAPrompt', 'constructor', 'coInstructorPermissions'])('refuses %s', async (promptKey) => {
    const res = buildResponse();

    await resetPromptForAllCoursesHandler({ params: { promptKey }, user: { _id: 'u1' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCollection.deleteMany).not.toHaveBeenCalled();
  });

  it('counts the copies per prompt, and how many still match the default', async () => {
    const { DEFAULT_PROMPTS } = settingsService;
    mockCollection.find.mockImplementation(({ name }) => ({
      toArray: async () =>
        name === 'prompt_question_generation'
          ? [{ value: DEFAULT_PROMPTS.questionGeneration }, { value: 'An older default' }]
          : [],
    }));

    const counts = await settingsService.getStoredPromptCounts();

    expect(counts.questionGeneration).toEqual({ courses: 2, matchingDefault: 1 });
    expect(counts.openEndedGrading).toEqual({ courses: 0, matchingDefault: 0 });
  });
});
