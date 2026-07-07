// Thin adapter over the official UBC course-list-sync package
// (@ubc/ubc-genai-toolkit-course-list-sync). The package owns auth,
// pagination, retries and the raw API calls; this service only reshapes the
// results into the option/record shapes the rest of GRASP already consumes.

class UbcApiService {
  constructor() {
    this._module = null;
  }

  // Lazily require + instantiate so a missing-credential environment doesn't
  // throw at require-time, and so dotenv has populated process.env by first use.
  // The course-list-sync package is an OPTIONAL dependency (private UBC
  // registry), so environments without it installed — e.g. CI running tests
  // that never touch the UBC API — still boot; only an actual UBC API call
  // surfaces the missing package with a clear error.
  get module() {
    if (!this._module) {
      let CourseListSyncModule;
      try {
        ({ CourseListSyncModule } = require('@ubc/ubc-genai-toolkit-course-list-sync'));
      } catch (err) {
        throw new Error(
          'UBC API is unavailable: the optional package ' +
          '@ubc/ubc-genai-toolkit-course-list-sync is not installed.'
        );
      }

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

    const persons = await this.module.getPersonsBy('student_id', studentIds);

    return persons.map((p) => ({
      puid: p.puid,
      id: p.ID,
      displayName: p.preferredName,
      email: p.email,
      sectionIds: studentSections.has(p.ID) ? [...studentSections.get(p.ID)] : [],
    }));
  }
}

module.exports = new UbcApiService();
