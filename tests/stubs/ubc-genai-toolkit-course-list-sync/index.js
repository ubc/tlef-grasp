class CourseListSyncModule {
  constructor() {
    this.raw = {
      getCourseRegistrations: async () => [],
    };
  }

  async getUnits() {
    return [];
  }

  async getAcademicPeriods() {
    return [];
  }

  async getInstructorSections() {
    return [];
  }

  async getCourseSectionsByIds() {
    return [];
  }

  async getPersonsBy() {
    return [];
  }
}

module.exports = { CourseListSyncModule };
