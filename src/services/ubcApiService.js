// Thin adapter over the official UBC course-list-sync package
// (@ubc/ubc-genai-toolkit-course-list-sync). The package owns auth,
// pagination, retries and the raw API calls; this service only reshapes the
// results into the option/record shapes the rest of GRASP already consumes.

const { CourseListSyncModule } = require('@ubc/ubc-genai-toolkit-course-list-sync');

class UbcApiService {
  constructor() {
    this._module = null;
  }

  // Lazily instantiate so a missing-credential environment doesn't throw at
  // require-time, and so dotenv has populated process.env by first use.
  get module() {
    if (!this._module) {
      const clientId =
        process.env.UBC_API_CLIENT_ID || process.env.UBC_COUSE_AFFILIATION_API_CLIENT_ID;
      const clientSecret =
        process.env.UBC_API_CLIENT_SECRET || process.env.UBC_COUSE_AFFILIATION_API_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        console.warn('UBC API credentials not configured in environment variables.');
      }

      this._module = new CourseListSyncModule({
        clientId,
        clientSecret,
        env: process.env.UBC_API_ENV || 'prod',
      });
    }
    return this._module;
  }

  // Campuses for the first dropdown. Note: returns { value, label } (not the
  // { key, title } the other lookups use) to match the existing frontend.
  async getCampuses() {
    const units = await this.module.getUnits('Campus/Senate');
    return units.map((unit) => ({
      value: unit.referenceId,
      label: unit.name,
    }));
  }

  // Academic periods for the chosen campus. The package normalises the campus
  // unit reference id (e.g. ACADEMIC_UNIT-UBC-V) to a campus code, filters to
  // standard periods across last/this/next year, and sorts by start date.
  async getAcademicPeriods(campusCode = '') {
    const periods = await this.module.getAcademicPeriods(campusCode);
    return periods.map((p) => ({
      key: p.academicPeriod.academicPeriodId,
      title: p.academicPeriod.academicPeriodName,
    }));
  }

  // The logged-in instructor's own sections for a period (faculty self-service).
  // puid comes from the server-side session at the call site, never the client.
  async getInstructorSections(instructorPuid, academicPeriod) {
    if (!instructorPuid || !academicPeriod) return [];

    const sections = await this.module.getInstructorSections(instructorPuid, academicPeriod);

    return sections.map((section) => {
      const courseSubject = section.course?.courseSubject?.code || '';
      const courseNumber = section.course?.courseNumber || '';
      const sectionNumber = section.sectionNumber || '';

      return {
        key: section.courseSectionId,
        title: `${courseSubject} ${courseNumber} ${sectionNumber}`,
        courseSubject,
        courseNumber,
        sectionNumber,
        academicPeriod,
        courseName:
          section.course?.title ||
          section.course?.abbreviatedTitle ||
          `${courseSubject} ${courseNumber}`,
        ubcCourseId: section.course?.courseId || section.courseId,
      };
    });
  }

  // Full section detail records for an explicit set of section IDs. Used
  // server-side to validate (and re-derive the authoritative course title for)
  // the sections the client claims it picked.
  async getCourseSectionsByIds(sectionIds = []) {
    if (!Array.isArray(sectionIds) || sectionIds.length === 0) return [];
    return this.module.getCourseSectionsByIds(sectionIds);
  }

  // Registered students across the given sections, each tagged with the
  // section(s) they're registered in. The package's getStudentsFromSections
  // drops the section attribution, so we reconstruct it from the raw
  // registrations and then resolve people by student id.
  async getStudentsWithSectionsByIds(sectionIds = [], academicPeriod = '') {
    if (!Array.isArray(sectionIds) || sectionIds.length === 0 || !academicPeriod) return [];

    const registrations = await this.module.raw.getCourseRegistrations({
      academicPeriodId: academicPeriod,
      courseSectionId: sectionIds,
      registrationStatus: ['REGISTERED'],
    });

    if (!registrations || registrations.length === 0) return [];

    // studentId -> Set of section ids they're registered in
    const studentSections = new Map();
    for (const r of registrations) {
      if (!r.studentId) continue;
      if (!studentSections.has(r.studentId)) studentSections.set(r.studentId, new Set());
      if (r.courseSectionId) studentSections.get(r.studentId).add(r.courseSectionId);
    }

    const studentIds = [...studentSections.keys()];
    if (studentIds.length === 0) return [];

    // The toolkit's getPersonsBy collapses every name into a single
    // preferredName and drops the person's Legal Name. We read the raw person
    // records instead so we can keep BOTH: the preferred name (seeds the
    // student-editable displayName) and the authoritative legal name (shown to
    // instructors, issue #75).
    const persons = await this.getRawPersonsBy('student_id', studentIds);

    return persons.map((p) => reshapePerson(p, 'student_id')).map((p) => ({
      puid: p.puid,
      id: p.id,
      displayName: p.preferredName,
      legalName: p.legalName,
      email: p.email,
      sectionIds: studentSections.has(p.id) ? [...studentSections.get(p.id)] : [],
    }));
  }

  // A single person's names/email by PUID, reshaped to expose the legal name.
  // Used to enrich a user's authoritative name at login (CWL releases no usable
  // name to this app). Returns null when the person can't be resolved.
  async getPersonByPuid(puid) {
    if (!puid) return null;
    const persons = await this.module.getPersonsByPuid(puid);
    if (!Array.isArray(persons) || persons.length === 0) return null;
    return reshapePerson(persons[0], 'puid');
  }

  // Raw person lookup by identifier, chunked to the API's batch limit. Returns
  // unnormalised Person records so callers can read fields (like the Legal Name
  // entry) that the toolkit's normalized shape discards.
  async getRawPersonsBy(idType, ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const CHUNK_SIZE = 50;
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const persons = await this.module.raw.getPersons({ [idType]: chunk });
      if (Array.isArray(persons)) out.push(...persons);
    }
    return out;
  }
}

// Flatten a raw person record, keeping the preferred name (Preferred Name entry,
// else the first available name) and the legal name (Legal Name entry) as
// separate values. Mirrors the toolkit's email (Work, then Personal) and ID
// resolution so the reshaped record is a superset of the normalized one.
function reshapePerson(person, idType) {
  const names = Array.isArray(person.personNames) ? person.personNames : [];
  const joinName = (n) => (n ? `${n.givenName || ''} ${n.familyName || ''}`.trim() : '');
  const preferred = names.find((n) => n.nameType === 'Preferred Name');
  const legal = names.find((n) => n.nameType === 'Legal Name');

  let id = person.puid;
  if (idType === 'student_id') {
    id = person.identifiers?.find((i) => i.identifierType === 'Student_ID')?.identifier || '';
  } else if (idType === 'employee_id') {
    id = person.identifiers?.find((i) => i.identifierType === 'Employee_ID')?.identifier || '';
  }

  let email = '';
  let personalEmail = '';
  for (const e of person.communicationChannels?.emails || []) {
    if (e.channelType === 'Work') { email = e.emailAddress; break; }
    if (e.channelType === 'Personal') personalEmail = e.emailAddress;
  }

  return {
    puid: person.puid,
    id,
    // Preferred name if the person set one, otherwise the first available name
    // (which, for a legal-name-only record, is the legal name).
    preferredName: joinName(preferred) || joinName(names[0]),
    legalName: joinName(legal),
    email: email || personalEmail,
  };
}

module.exports = new UbcApiService();
// Exported for unit testing the name-splitting logic in isolation.
module.exports.reshapePerson = reshapePerson;
