jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const {
  getSectionLmsLink,
  setCanvasSectionLink,
  setMoodleSectionLink,
  removeSectionLmsLink,
} = require('../../src/services/lms-section-link');

const COURSE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';

describe('LMS section-link persistence', () => {
  let collection;

  beforeEach(() => {
    collection = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => collection),
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('returns only browser-safe provider and external-section metadata', async () => {
    collection.findOne.mockResolvedValue({
      lmsLink: {
        provider: 'canvas',
        externalCourseId: '42',
        externalCourseName: 'Biology 302',
        externalCourseCode: 'BIOC 302',
        externalSectionId: '501',
        externalSectionName: 'Section 1',
        linkedAt: new Date('2026-08-07T12:00:00.000Z'),
        linkedBy: USER_ID,
      },
    });

    const link = await getSectionLmsLink(COURSE_ID, '101');

    expect(link).toEqual(expect.objectContaining({
      provider: 'canvas',
      externalCourseId: '42',
      externalSectionId: '501',
    }));
    expect(link).not.toHaveProperty('linkedBy');
  });

  it('stores the link on the owned GRASP section', async () => {
    collection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const link = await setCanvasSectionLink(
      COURSE_ID,
      '101',
      { id: '42', name: 'Biology 302', code: 'BIOC 302' },
      { id: '501', name: 'Section 1' },
      USER_ID
    );

    expect(collection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: '101' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          lmsLink: expect.objectContaining({
            provider: 'canvas',
            externalCourseId: '42',
            externalSectionId: '501',
            linkedBy: expect.any(Object),
          }),
        }),
      })
    );
    expect(link).not.toHaveProperty('linkedBy');
  });

  it('stores a Moodle course and group using the provider-neutral link shape', async () => {
    collection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const link = await setMoodleSectionLink(
      COURSE_ID,
      '102',
      { id: '84', name: 'Moodle Biology', code: 'BIO-M' },
      { id: '901', name: 'Tutorial Group A' },
      USER_ID
    );

    expect(collection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: '102' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          lmsLink: expect.objectContaining({
            provider: 'moodle',
            externalCourseId: '84',
            externalSectionId: '901',
          }),
        }),
      })
    );
    expect(link).toEqual(expect.objectContaining({
      provider: 'moodle',
      externalCourseName: 'Moodle Biology',
      externalSectionName: 'Tutorial Group A',
    }));
    expect(link).not.toHaveProperty('linkedBy');
  });

  it('removes only the LMS link, leaving personal tokens untouched', async () => {
    collection.updateOne.mockResolvedValue({ matchedCount: 1 });

    await expect(removeSectionLmsLink(COURSE_ID, '101')).resolves.toBe(true);
    expect(collection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: '101' }),
      expect.objectContaining({ $unset: { lmsLink: '' } })
    );
  });
  // Issue #113: the roster-sync state carried on a link.
  describe('roster-sync state on the link', () => {
    const originalEnv = { CANVAS_DOMAIN: process.env.CANVAS_DOMAIN, MOODLE_DOMAIN: process.env.MOODLE_DOMAIN };

    afterEach(() => {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('exposes the instance and last-sync counts, but not who ran the sync', async () => {
      const at = new Date('2026-09-01T10:00:00.000Z');
      collection.findOne.mockResolvedValue({
        lmsLink: {
          provider: 'canvas',
          instance: 'https://canvas.example.test',
          externalCourseId: '42',
          externalSectionId: '501',
          linkedBy: USER_ID,
          dropsReviewedAt: at,
          lastSync: {
            at, by: USER_ID, added: 3, restored: 1, dropped: 2, kept: 20,
            unmatched: 1, dropsSkipped: null, coverage: 0.96,
          },
        },
      });

      const link = await getSectionLmsLink(COURSE_ID, '101');

      expect(link.instance).toBe('https://canvas.example.test');
      expect(link.lastSync).toEqual({
        at, added: 3, restored: 1, dropped: 2, kept: 20,
        unmatched: 1, dropsSkipped: null, coverage: 0.96,
      });
      expect(JSON.stringify(link)).not.toContain(USER_ID);
    });

    it('reports a legacy link as having no instance and no sync yet', async () => {
      collection.findOne.mockResolvedValue({
        lmsLink: { provider: 'canvas', externalCourseId: '42', externalSectionId: '501' },
      });

      const link = await getSectionLmsLink(COURSE_ID, '101');

      expect(link.instance).toBeNull();
      expect(link.lastSync).toBeNull();
    });

    it('stamps a new link with the normalized Canvas instance and no sync history, so the next sync is a first sync', async () => {
      process.env.CANVAS_DOMAIN = 'Canvas.Example.test/';
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      await setCanvasSectionLink(
        COURSE_ID, '101', { id: '42', name: 'Biology 302' }, { id: '501', name: 'Section 1' }, USER_ID
      );

      const [, update] = collection.updateOne.mock.calls[0];
      // The whole link is replaced: lastSync / dropsReviewedAt of a previous
      // link cannot survive a re-link.
      expect(update.$set.lmsLink.instance).toBe('https://canvas.example.test');
      expect(update.$set.lmsLink).not.toHaveProperty('lastSync');
      expect(update.$set.lmsLink).not.toHaveProperty('dropsReviewedAt');
      expect(Object.keys(update.$set).filter((key) => key.startsWith('lmsLink.'))).toEqual([]);
    });

    it('stamps a Moodle link with the Moodle instance', async () => {
      process.env.MOODLE_DOMAIN = 'http://moodle.example.test:9200';
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      await setMoodleSectionLink(COURSE_ID, '102', { id: '84', name: 'M' }, { id: '901', name: 'G' }, USER_ID);

      expect(collection.updateOne.mock.calls[0][1].$set.lmsLink.instance).toBe('http://moodle.example.test:9200');
    });
  });
});
