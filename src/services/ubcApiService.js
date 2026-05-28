// Thin wrapper around the UBC public APIs (Mulesoft Exchange). Uses global
// fetch (Node 18+).

const IDENTIFIER_TYPES = {
  puid:       { queryKey: 'puid',        identifierType: null },
  studentId:  { queryKey: 'student_id',  identifierType: 'Student_ID' },
  employeeId: { queryKey: 'employee_id', identifierType: 'Employee_ID' },
};

class UbcApiService {
  constructor() {
    this.env = process.env.UBC_API_ENV || 'prod';
    this.clientId = process.env.UBC_API_CLIENT_ID || process.env.UBC_COUSE_AFFILIATION_API_CLIENT_ID;
    this.clientSecret = process.env.UBC_API_CLIENT_SECRET || process.env.UBC_COUSE_AFFILIATION_API_CLIENT_SECRET;

    if (this.env !== 'prod') {
      this.baseUrl = `https://${this.env}.api.ubc.ca`;
    } else {
      this.baseUrl = 'https://api.ubc.ca';
    }
  }

  getAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      console.warn('UBC API credentials not configured in environment variables.');
    }
    const token = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    return `Basic ${token}`;
  }

  async _fetchFromApi(collection, version, endpoint, queryParams = {}, page = 1) {
    let allItems = [];
    let currentPage = page;
    let hasNext = true;

    while (hasNext) {
      const url = new URL(`${this.baseUrl}/${collection}/${version}/${endpoint}`);
      url.searchParams.append('pageSize', '500');
      url.searchParams.append('page', currentPage.toString());

      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            value.forEach(v => url.searchParams.append(key, v));
          } else {
            url.searchParams.append(key, value);
          }
        }
      }

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Accept': 'application/json'
          },
          // timeout handling might be needed, but native fetch doesn't have a simple timeout option without AbortController
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`UBC API Error (${response.status}):`, errorText);
          return false;
        }

        const body = await response.json();

        if (!body || !body.pageItems) {
          break;
        }

        allItems = allItems.concat(body.pageItems);
        hasNext = body.hasNextPage === true;
        currentPage++;

        if (currentPage > 50) {
          break; // Safety break
        }
      } catch (error) {
        console.error('UBC API fetch error:', error);
        return false;
      }
    }

    return allItems;
  }

  async getCampuses() {
    const units = await this._fetchFromApi('academic', 'v4', 'academic-unit-hierarchies', { type: 'Campus/Senate' });
    if (!units) return [];

    return units
      .filter(unit => unit.isActive)
      .map(unit => ({
        value: unit.referenceId,
        label: unit.name
      }));
  }

  async getAcademicPeriods(campusCode = '') {
    // Convert GRASP campus unit to 'V' or 'O' if needed, or filter by it.
    let code = campusCode;
    if (code === 'ACADEMIC_UNIT-UBC-V') code = 'V';
    else if (code === 'ACADEMIC_UNIT-UBC-O') code = 'O';

    const currentYear = new Date().getFullYear();
    const years = [(currentYear - 1).toString(), currentYear.toString(), (currentYear + 1).toString()];

    let periods = await this._fetchFromApi('academic', 'v4', 'academic-periods', {
      academicYear: years,
      isStandardPeriod: 'true'
    });

    if (!periods) return [];

    // Sort by start date
    periods.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    if (code) {
      periods = periods.filter(p => p.curriculumApprovingBody && p.curriculumApprovingBody.code === code);
    }

    return periods.map(p => {
      const periodData = p.academicPeriod || p;
      return {
        key: periodData.academicPeriodId,
        title: periodData.academicPeriodName
      };
    });
  }

  async getPersonInformationByPuid(puid) {
    return this._fetchFromApi('person', 'v2', 'persons', { puid });
  }

  async getInstructorSections(instructorPuid, academicPeriod) {
    if (!instructorPuid || !academicPeriod) return [];

    const persons = await this.getPersonInformationByPuid(instructorPuid);
    if (!persons || persons.length === 0) return [];

    const instructor = persons[0];

    const employeeIdObj = (instructor.identifiers || []).find(id => id.identifierType === 'Employee_ID');
    if (!employeeIdObj) return [];

    const employeeId = employeeIdObj.identifier;

    const sections = await this._fetchFromApi('academic-exp', 'v2', 'course-section-details', {
      academicPeriodId: academicPeriod,
      employeeId: employeeId
    });

    if (!sections) return [];

    // Format them similarly to the PHP code for the dropdown
    return sections.map(section => {
      const courseSubject = section.course?.courseSubject?.code || '';
      const courseNumber = section.course?.courseNumber || '';
      const sectionNumber = section.sectionNumber || '';
      const sectionId = section.courseSectionId;

      return {
        key: sectionId,
        title: `${courseSubject} ${courseNumber} ${sectionNumber}`,
        courseSubject,
        courseNumber,
        sectionNumber,
        academicPeriod: academicPeriod,
        courseName: section.course?.title || section.course?.abbreviatedTitle || `${courseSubject} ${courseNumber}`,
        ubcCourseId: section.courseId || section.course?.id
      };
    });
  }

  /**
   * Fetch full course-section detail records for a set of section IDs. Used
   * server-side to validate (and re-derive display info for) the sections
   * the client claims it picked.
   */
  async getCourseSectionsByIds(sectionIds = []) {
    if (!Array.isArray(sectionIds) || sectionIds.length === 0) return [];
    const sections = await this._fetchFromApi('academic-exp', 'v2', 'course-section-details', {
      courseSectionId: sectionIds,
    });
    return sections || [];
  }

  /**
   * Pull every student registered in the given sections for the given period,
   * then enrich with person info (puid, name, email).
   */
  async getStudentsFromSections(sectionIds = [], academicPeriod = '') {
    if (!Array.isArray(sectionIds) || sectionIds.length === 0 || !academicPeriod) return [];

    const registrations = await this._fetchFromApi('academic', 'v4', 'course-registrations', {
      academicPeriodId: academicPeriod,
      courseSectionId: sectionIds,
      registrationStatus: ['REGISTERED'],
    });

    if (!registrations || registrations.length === 0) return [];

    const studentIds = [...new Set(
      registrations
        .map(r => r.studentId)
        .filter(Boolean)
    )];

    if (studentIds.length === 0) return [];

    return this.getPersonsByIdentifier('studentId', studentIds);
  }

  /**
   * Like getStudentsFromSections, but preserves which section each student belongs to.
   * Returns an array of person records each with a `sectionIds` field.
   */
  async getStudentsWithSectionsByIds(sectionIds = [], academicPeriod = '') {
    if (!Array.isArray(sectionIds) || sectionIds.length === 0 || !academicPeriod) return [];

    const registrations = await this._fetchFromApi('academic', 'v4', 'course-registrations', {
      academicPeriodId: academicPeriod,
      courseSectionId: sectionIds,
      registrationStatus: ['REGISTERED'],
    });

    if (!registrations || registrations.length === 0) return [];

    // Build map: studentId -> Set of sectionIds from the registration records
    const studentSections = new Map();
    for (const r of registrations) {
      if (!r.studentId) continue;
      if (!studentSections.has(r.studentId)) studentSections.set(r.studentId, new Set());
      if (r.courseSectionId) studentSections.get(r.studentId).add(r.courseSectionId);
    }

    const studentIds = [...studentSections.keys()];
    if (studentIds.length === 0) return [];

    const persons = await this.getPersonsByIdentifier('studentId', studentIds);

    return persons.map(p => ({
      ...p,
      sectionIds: studentSections.has(p.id) ? [...studentSections.get(p.id)] : [],
    }));
  }

  /**
   * Look up persons by an identifier type ("puid", "studentId", "employeeId").
   * Chunks requests at 50 ids to stay under URL length limits. Returns an
   * array of normalized records with puid / id / firstName / lastName / email.
   */
  async getPersonsByIdentifier(identifierType, ids = []) {
    if (!ids || ids.length === 0) return [];

    const id = IDENTIFIER_TYPES[identifierType] || IDENTIFIER_TYPES.puid;
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const persons = await this._fetchFromApi('person', 'v2', 'persons', { [id.queryKey]: chunk });
      if (!persons) continue;
      for (const p of persons) {
        const normalized = this._normalizePerson(p, id.identifierType);
        if (normalized.puid) out.push(normalized);
      }
    }
    return out;
  }

  _normalizePerson(personData, matchType) {
    const identifiers = personData.identifiers || [];

    let typedId = '';
    if (matchType) {
      const hit = identifiers.find(i => i.identifierType === matchType);
      typedId = hit ? hit.identifier : '';
    }

    let firstName = '';
    let lastName = '';
    const names = personData.personNames || [];
    const preferred = names.find(n => n.nameType === 'Preferred Name');
    const chosen = preferred || names[0];
    if (chosen) {
      firstName = chosen.givenName || '';
      lastName = chosen.familyName || '';
    }

    let email = '';
    let personalEmail = '';
    const emails = personData.communicationChannels?.emails || [];
    for (const e of emails) {
      if (e.channelType === 'Work' && !email) email = e.emailAddress;
      else if (e.channelType === 'Personal' && !personalEmail) personalEmail = e.emailAddress;
    }

    return {
      puid: personData.puid || '',
      id: typedId || personData.puid || '',
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`.trim() || personData.puid || '',
      email: email || personalEmail || '',
    };
  }
}

module.exports = new UbcApiService();
