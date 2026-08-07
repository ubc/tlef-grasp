jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const {
  getSectionLmsLink,
  setCanvasSectionLink,
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

  it('removes only the LMS link, leaving personal tokens untouched', async () => {
    collection.updateOne.mockResolvedValue({ matchedCount: 1 });

    await expect(removeSectionLmsLink(COURSE_ID, '101')).resolves.toBe(true);
    expect(collection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: '101' }),
      expect.objectContaining({ $unset: { lmsLink: '' } })
    );
  });
});
