jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const {
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  DEFAULT_PROMPTS,
} = require('../../src/constants/app-constants');
const settingsService = require('../../src/services/settings');

function mockSettingsCollection(rows = []) {
  const collection = {
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) })),
    bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn(() => collection),
  });
  return collection;
}

describe('settings service', () => {
  beforeEach(() => {
    databaseService.connect.mockReset();
  });

  describe('getSettings', () => {
    it('hydrates hierarchical settings from flat database rows', async () => {
      mockSettingsCollection([
        { name: 'prompt_question_generation', value: 'Custom question prompt' },
        {
          name: 'bloom_type_preferences',
          value: JSON.stringify({ Remember: ['multiple-choice'] }),
        },
        {
          name: 'co_instructor_permissions',
          value: JSON.stringify({ settings: false, createQuiz: true }),
        },
      ]);

      await expect(settingsService.getSettings('course-1')).resolves.toMatchObject({
        prompts: {
          questionGeneration: 'Custom question prompt',
          objectiveGenerationAuto: DEFAULT_PROMPTS.objectiveGenerationAuto,
          objectiveGenerationManual: DEFAULT_PROMPTS.objectiveGenerationManual,
        },
        bloomTypePreferences: { Remember: ['multiple-choice'] },
        coInstructorPermissions: { settings: false, createQuiz: true },
      });
    });

    it('falls back to defaults when stored JSON is missing or malformed', async () => {
      mockSettingsCollection([
        { name: 'bloom_type_preferences', value: '{not json' },
        { name: 'co_instructor_permissions', value: '{also bad' },
      ]);

      await expect(settingsService.getSettings('course-1')).resolves.toMatchObject({
        prompts: DEFAULT_PROMPTS,
        bloomTypePreferences: DEFAULT_BLOOM_TYPE_PREFERENCES,
        coInstructorPermissions: {},
      });
    });
  });

  describe('updateSettings', () => {
    it('flattens supported hierarchical keys into bulk upserts', async () => {
      const collection = mockSettingsCollection();

      await expect(
        settingsService.updateSettings('course-1', {
          prompts: {
            questionGeneration: 'Updated question prompt',
            objectiveGenerationAuto: 'Updated objective prompt',
          },
          bloomTypePreferences: { Create: ['open-ended'] },
          coInstructorPermissions: { settings: false },
          ignored: { nested: 'value' },
        })
      ).resolves.toEqual({ success: true });

      expect(collection.bulkWrite).toHaveBeenCalledTimes(1);
      expect(collection.bulkWrite.mock.calls[0][0]).toEqual([
        {
          updateOne: {
            filter: { name: 'prompt_question_generation', courseId: 'course-1' },
            update: {
              $set: {
                name: 'prompt_question_generation',
                value: 'Updated question prompt',
                courseId: 'course-1',
                updatedAt: expect.any(Date),
              },
            },
            upsert: true,
          },
        },
        {
          updateOne: {
            filter: {
              name: 'prompt_objective_generation_auto',
              courseId: 'course-1',
            },
            update: {
              $set: {
                name: 'prompt_objective_generation_auto',
                value: 'Updated objective prompt',
                courseId: 'course-1',
                updatedAt: expect.any(Date),
              },
            },
            upsert: true,
          },
        },
        {
          updateOne: {
            filter: { name: 'bloom_type_preferences', courseId: 'course-1' },
            update: {
              $set: {
                name: 'bloom_type_preferences',
                value: JSON.stringify({ Create: ['open-ended'] }),
                courseId: 'course-1',
                updatedAt: expect.any(Date),
              },
            },
            upsert: true,
          },
        },
        {
          updateOne: {
            filter: { name: 'co_instructor_permissions', courseId: 'course-1' },
            update: {
              $set: {
                name: 'co_instructor_permissions',
                value: JSON.stringify({ settings: false }),
                courseId: 'course-1',
                updatedAt: expect.any(Date),
              },
            },
            upsert: true,
          },
        },
      ]);
    });

    it('skips bulk writes when no supported keys are present', async () => {
      const collection = mockSettingsCollection();

      await expect(
        settingsService.updateSettings('course-1', { ignored: { nested: 'value' } })
      ).resolves.toEqual({ success: true });

      expect(collection.bulkWrite).not.toHaveBeenCalled();
    });
  });
});
