// Unit coverage for reshapePerson: how a raw academic-API person record is
// flattened into the preferred name (seeds the editable displayName) and the
// authoritative legal name (shown to instructors, issue #75).
const { reshapePerson } = require('../../src/services/ubcApiService');

function person(overrides = {}) {
  return {
    puid: 'PUID-1',
    identifiers: [
      { identifier: 'S-100', identifierType: 'Student_ID' },
      { identifier: 'PUID-1', identifierType: 'PUID' },
    ],
    personNames: [],
    communicationChannels: { emails: [] },
    ...overrides,
  };
}

describe('reshapePerson', () => {
  it('keeps the preferred name and the legal name separately', () => {
    const result = reshapePerson(
      person({
        personNames: [
          { nameType: 'Preferred Name', givenName: 'Robbie', familyName: 'Sage' },
          { nameType: 'Legal Name', givenName: 'Robin', familyName: 'Sageata' },
        ],
      }),
      'student_id'
    );

    expect(result.preferredName).toBe('Robbie Sage');
    expect(result.legalName).toBe('Robin Sageata');
    expect(result.id).toBe('S-100');
  });

  it('falls back to the legal name as preferred when no Preferred Name entry exists', () => {
    const result = reshapePerson(
      person({
        personNames: [
          { nameType: 'Legal Name', givenName: 'Robin', familyName: 'Sageata' },
        ],
      }),
      'student_id'
    );

    // A legal-name-only person: displayName seed and legalName are the same.
    expect(result.preferredName).toBe('Robin Sageata');
    expect(result.legalName).toBe('Robin Sageata');
  });

  it('leaves legalName empty when the record has no Legal Name entry', () => {
    const result = reshapePerson(
      person({
        personNames: [
          { nameType: 'Preferred Name', givenName: 'Ali', familyName: 'Abdi' },
          { nameType: 'Plain Preferred Name', givenName: 'Ali', familyName: 'Abdi' },
        ],
      }),
      'student_id'
    );

    expect(result.preferredName).toBe('Ali Abdi');
    expect(result.legalName).toBe('');
  });

  it('prefers the Work email, falling back to Personal', () => {
    const workFirst = reshapePerson(
      person({
        communicationChannels: {
          emails: [
            { channelType: 'Personal', emailAddress: 'home@example.com' },
            { channelType: 'Work', emailAddress: 'work@ubc.ca' },
          ],
        },
      }),
      'student_id'
    );
    expect(workFirst.email).toBe('work@ubc.ca');

    const personalOnly = reshapePerson(
      person({
        communicationChannels: {
          emails: [{ channelType: 'Personal', emailAddress: 'home@example.com' }],
        },
      }),
      'student_id'
    );
    expect(personalOnly.email).toBe('home@example.com');
  });

  it('handles missing name/email arrays without throwing', () => {
    const result = reshapePerson({ puid: 'P', identifiers: [] }, 'puid');
    expect(result.preferredName).toBe('');
    expect(result.legalName).toBe('');
    expect(result.email).toBe('');
    expect(result.id).toBe('P');
  });
});
