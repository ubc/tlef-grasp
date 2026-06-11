// Onboarding JavaScript functionality

const SELECTORS = {
  loginTab: 'login-tab',
  setupTab: 'setup-tab',
  joinTab: 'join-tab',
  tabButton: '.tab-button',
  stepContent: '.step-content',
  courseSetupForm: 'course-setup-form',
  loadingCourses: 'loading-courses',
  coursesList: 'courses-list',
  noCoursesMessage: 'no-courses-message',
  stepComplete: 'step-complete',
};

const TAB_NAMES = { login: 'login', setup: 'setup', join: 'join' };

const API = {
  currentUser: '/api/current-user',
  myCourses: '/api/courses/my',
  newCourse: '/api/courses/new',
  joinByEnrollmentCode: '/api/courses/join-by-code',
  ubcCampuses: '/api/ubc/campuses',
  ubcAcademicPeriods: '/api/ubc/academic-periods',
  ubcInstructorSections: '/api/ubc/instructor-sections',
};

const STORAGE_KEYS = { selectedCourse: 'grasp-selected-course' };

class TabManager {
  constructor(onTabChange) {
    this.elements = {
      loginTab: document.getElementById(SELECTORS.loginTab),
      setupTab: document.getElementById(SELECTORS.setupTab),
      joinTab: document.getElementById(SELECTORS.joinTab),
      tabButtons: document.querySelectorAll(SELECTORS.tabButton),
    };
    this.onTabChange = onTabChange;
    this.currentTab = null;
  }

  setupListeners(canAccessTab) {
    this.elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        if (!canAccessTab(tab)) return;
        this.switchTo(tab);
      });
    });
  }

  switchTo(tabName) {
    if (this.currentTab === tabName) return;
    const { loginTab, setupTab, joinTab, tabButtons } = this.elements;

    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    this.hideTab(loginTab);
    this.hideTab(setupTab);
    this.hideTab(joinTab);

    if (tabName === TAB_NAMES.login) this.showTab(loginTab);
    else if (tabName === TAB_NAMES.setup) this.showTab(setupTab);
    else if (tabName === TAB_NAMES.join) this.showTab(joinTab);

    this.currentTab = tabName;
    if (this.onTabChange) this.onTabChange(tabName);
  }

  showTab(tab) {
    if (tab) { tab.style.display = 'block'; tab.classList.add('active'); }
  }
  hideTab(tab) {
    if (tab) { tab.style.display = 'none'; tab.classList.remove('active'); }
  }
  hideTabButton(tabName) {
    const button = document.querySelector(`${SELECTORS.tabButton}[data-tab="${tabName}"]`);
    if (button) button.style.display = 'none';
  }
}

class OnboardingManager {
  constructor() {
    this.courses = null;
    this.isFaculty = false;
    this.isStudent = false;
    this.cacheElements();
    this.tabManager = new TabManager((tab) => this.handleTabChange(tab));
    this.pendingCreatePayload = null;
    this.init();
  }

  cacheElements() {
    this.elements = {
      courseSetupForm: document.getElementById(SELECTORS.courseSetupForm),
      campusSelect: document.getElementById('setup-campus'),
      academicPeriodSelect: document.getElementById('setup-academic-period'),
      sectionsSelect: document.getElementById('setup-sections'),
      sectionsHelp: document.getElementById('setup-sections-help'),
      syncStudents: document.getElementById('setup-sync-students'),
      createBtn: document.getElementById('setup-create-btn'),
      loadingCourses: document.getElementById(SELECTORS.loadingCourses),
      coursesList: document.getElementById(SELECTORS.coursesList),
      noCoursesMessage: document.getElementById(SELECTORS.noCoursesMessage),
      joinEnrollmentCode: document.getElementById('join-enrollment-code'),
      joinSubmitCode: document.getElementById('join-submit-code'),
      existingShellModal: document.getElementById('existing-shell-modal'),
      existingShellName: document.getElementById('existing-shell-name'),
      existingShellInstructors: document.getElementById('existing-shell-instructors'),
      existingShellForce: document.getElementById('existing-shell-force'),
    };
  }

  async init() {
    await this.loadUserInfo();
    this.setupEventListeners();
    this.tabManager.setupListeners((tab) => this.canAccessTab(tab));
    this.updateUIForUserRole();
    await this.determineInitialTab();
  }

  canAccessTab(tab) {
    if (tab === TAB_NAMES.setup && !this.isFaculty) return false;
    if (tab === TAB_NAMES.join && !this.isStudent) return false;
    return true;
  }

  async handleTabChange(tab) {
    if (tab === TAB_NAMES.login) {
      this.loadExistingCourses(this.courses);
    } else if (tab === TAB_NAMES.setup) {
      await this.loadCampuses();
    } else if (tab === TAB_NAMES.join) {
      this.resetJoinSelection();
      this.elements.joinEnrollmentCode?.focus();
    }
  }

  async loadUserInfo() {
    try {
      const response = await fetch(API.currentUser);
      if (!response.ok) return;
      const data = await response.json();
      if (!data.success || !data.user) return;
      this.isFaculty = !!data.user.isFaculty;
      this.isStudent = !!data.user.isStudent;
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  }

  updateUIForUserRole() {
    const joinTabButton = document.getElementById('join-tab-button');

    if (this.isFaculty) {
      if (joinTabButton) joinTabButton.style.display = 'none';
      return;
    }

    if (this.isStudent) {
      this.tabManager.hideTabButton(TAB_NAMES.setup);
      if (joinTabButton) joinTabButton.style.display = '';
    } else {
      this.tabManager.hideTabButton(TAB_NAMES.setup);
      if (joinTabButton) joinTabButton.style.display = 'none';
    }

    // Hide custom course input groups for non-faculty
    const { customCourseGroup, customCourseNameGroup, noCoursesMessage } = this.elements;

    if (customCourseGroup) {
      customCourseGroup.style.display = 'none';
    }
    if (customCourseNameGroup) {
      customCourseNameGroup.style.display = 'none';
    }

    // Update no-courses message based on role
    if (noCoursesMessage) {
      const createButton = noCoursesMessage.querySelector('button');
      const messageText = noCoursesMessage.querySelector('p');
      if (createButton) createButton.style.display = 'none';
      if (this.isStudent) {
        const heading = noCoursesMessage.querySelector('h3');
        if (heading) heading.textContent = 'No Course Found';
        if (messageText) messageText.textContent = "You haven't been added to any course yet. Ask your instructor for an enrollment code, then use the \"Join a course\" tab to enroll.";
      } else {
        // Staff
        if (messageText) messageText.textContent = "You don't have any courses set up yet. Please contact a faculty member to add you to a course.";
      }
    }
  }

  setupEventListeners() {
    const {
      courseSetupForm, campusSelect, academicPeriodSelect, sectionsSelect,
      joinEnrollmentCode, joinSubmitCode, existingShellForce,
    } = this.elements;

    if (courseSetupForm) {
      courseSetupForm.addEventListener('submit', (e) => this.handleCreateCourse(e));
    }
    if (campusSelect) campusSelect.addEventListener('change', () => this.onCampusChange());
    if (academicPeriodSelect) academicPeriodSelect.addEventListener('change', () => this.onAcademicPeriodChange());
    if (sectionsSelect) sectionsSelect.addEventListener('change', () => this.updateCreateButton());

    const coursesListElement = this.elements.coursesList;
    if (coursesListElement) {
      coursesListElement.addEventListener('click', (e) => {
        const accessBtn = e.target.closest('.access-btn');
        if (accessBtn) this.accessCourseDashboard(accessBtn);
      });
    }

    if (joinEnrollmentCode) {
      joinEnrollmentCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.submitJoinCourse(); }
      });
    }
    if (joinSubmitCode) joinSubmitCode.addEventListener('click', () => this.submitJoinCourse());

    if (existingShellForce) existingShellForce.addEventListener('click', () => this.confirmCreateAnyway());
  }

  async determineInitialTab() {
    try {
      const response = await fetch(API.myCourses);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      const hasCourses = data.success && data.courses && data.courses.length > 0;
      this.courses = data.success && data.courses ? data.courses : [];

      let initialTab;
      if (this.isStudent) initialTab = hasCourses ? TAB_NAMES.login : TAB_NAMES.join;
      else if (this.isFaculty) initialTab = hasCourses ? TAB_NAMES.login : TAB_NAMES.setup;
      else initialTab = TAB_NAMES.login;

      this.tabManager.switchTo(initialTab);
      if (initialTab === TAB_NAMES.login) this.loadExistingCourses(this.courses);
      else if (initialTab === TAB_NAMES.setup) await this.loadCampuses();
      else if (initialTab === TAB_NAMES.join) this.resetJoinSelection();
    } catch (error) {
      console.error('Error checking for existing courses:', error);
      const fallbackTab = this.isStudent ? TAB_NAMES.join : this.isFaculty ? TAB_NAMES.setup : TAB_NAMES.login;
      this.tabManager.switchTo(fallbackTab);
      if (fallbackTab === TAB_NAMES.login) this.loadExistingCourses(null);
      else if (fallbackTab === TAB_NAMES.setup) this.loadCampuses();
      else this.resetJoinSelection();
    }
  }

  // -------- Setup tab: cascading UBC API lookups --------

  async loadCampuses() {
    const { campusSelect } = this.elements;
    if (!campusSelect || campusSelect.dataset.loaded === '1') return;

    try {
      const r = await fetch(API.ubcCampuses);
      const json = await r.json();
      const campuses = (json.success && json.data) ? json.data : [];

      campusSelect.innerHTML = '<option value="">Select campus…</option>' +
        campuses.map(c => `<option value="${this.escapeAttr(c.value)}">${this.escapeHTML(c.label)}</option>`).join('');
      campusSelect.dataset.loaded = '1';
    } catch (error) {
      console.error('Error loading campuses:', error);
      campusSelect.innerHTML = '<option value="">Failed to load campuses</option>';
    }
  }

  async onCampusChange() {
    const { campusSelect, academicPeriodSelect, sectionsSelect } = this.elements;
    this.resetSelect(academicPeriodSelect, 'Select academic period…');
    this.resetSelect(sectionsSelect, 'Select academic period first');
    sectionsSelect.disabled = true;
    this.updateCreateButton();

    const campus = campusSelect.value;
    if (!campus) {
      academicPeriodSelect.disabled = true;
      return;
    }
    academicPeriodSelect.disabled = false;
    academicPeriodSelect.innerHTML = '<option value="">Loading…</option>';

    try {
      const url = `${API.ubcAcademicPeriods}?campus=${encodeURIComponent(campus)}`;
      const r = await fetch(url);
      const json = await r.json();
      const periods = (json.success && json.data) ? json.data : [];

      academicPeriodSelect.innerHTML = '<option value="">Select academic period…</option>' +
        periods.map(p => `<option value="${this.escapeAttr(p.key)}">${this.escapeHTML(p.title)}</option>`).join('');
    } catch (error) {
      console.error('Error loading academic periods:', error);
      academicPeriodSelect.innerHTML = '<option value="">Failed to load periods</option>';
    }
  }

  async onAcademicPeriodChange() {
    const { academicPeriodSelect, sectionsSelect, sectionsHelp } = this.elements;
    this.resetSelect(sectionsSelect, 'Loading sections…');
    sectionsSelect.disabled = true;
    sectionsHelp.textContent = '';
    this.updateCreateButton();

    const academicPeriod = academicPeriodSelect.value;
    if (!academicPeriod) {
      this.resetSelect(sectionsSelect, 'Select academic period first');
      sectionsHelp.textContent = 'Hold ⌘ (Mac) or Ctrl (Windows) to select more than one section. All selected sections must belong to the same course.';
      return;
    }

    try {
      const url = `${API.ubcInstructorSections}?academicPeriod=${encodeURIComponent(academicPeriod)}`;
      const r = await fetch(url);
      const json = await r.json();
      const sections = (json.success && json.data) ? json.data : [];

      if (sections.length === 0) {
        sectionsSelect.innerHTML = '';
        sectionsSelect.disabled = true;
        sectionsHelp.textContent = 'No sections found for your CWL in this academic period. If you believe this is wrong, contact lt.hub@ubc.ca.';
        return;
      }

      sectionsSelect.innerHTML = sections.map(s =>
        `<option value="${this.escapeAttr(s.key)}">${this.escapeHTML(s.title)}</option>`
      ).join('');
      sectionsSelect.disabled = false;
      sectionsHelp.textContent = 'Hold ⌘ (Mac) or Ctrl (Windows) to select more than one section. All selected sections must belong to the same course.';
    } catch (error) {
      console.error('Error loading instructor sections:', error);
      sectionsSelect.innerHTML = '';
      sectionsSelect.disabled = true;
      sectionsHelp.textContent = 'Failed to load sections. Please refresh and try again.';
    }
  }

  resetSelect(selectEl, placeholderText) {
    if (!selectEl) return;
    selectEl.innerHTML = `<option value="">${this.escapeHTML(placeholderText)}</option>`;
  }

  updateCreateButton() {
    const { campusSelect, academicPeriodSelect, sectionsSelect, createBtn } = this.elements;
    const ok =
      !!campusSelect.value &&
      !!academicPeriodSelect.value &&
      Array.from(sectionsSelect.selectedOptions).some(o => o.value);
    createBtn.disabled = !ok;
  }

  selectedSectionIds() {
    return Array.from(this.elements.sectionsSelect.selectedOptions)
      .map(o => o.value)
      .filter(Boolean);
  }

  buildCreatePayload(force = false) {
    const { campusSelect, academicPeriodSelect, syncStudents } = this.elements;
    const academicPeriodName = academicPeriodSelect.options[academicPeriodSelect.selectedIndex]?.text || '';
    return {
      campus: campusSelect.value,
      academicPeriod: academicPeriodSelect.value,
      academicPeriodName,
      sectionIds: this.selectedSectionIds(),
      syncStudents: !!(syncStudents && syncStudents.checked),
      force,
    };
  }

  async handleCreateCourse(e) {
    e.preventDefault();
    if (!this.isFaculty) {
      this.showError('Only faculty can create new courses');
      return;
    }
    const payload = this.buildCreatePayload(false);
    if (payload.sectionIds.length === 0) {
      this.showError('Select at least one section');
      return;
    }
    await this.submitCreate(payload);
  }

  async submitCreate(payload) {
    const { createBtn } = this.elements;
    const originalText = createBtn.innerHTML;
    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…';

    try {
      const r = await fetch(API.newCourse, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));

      if (r.status === 409 && data.error === 'existing_shell') {
        this.pendingCreatePayload = payload;
        this.openExistingShellModal(data.existing);
        return;
      }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

      sessionStorage.setItem(
        STORAGE_KEYS.selectedCourse,
        JSON.stringify({ id: data.course._id, name: data.course.courseName })
      );
      this.showCompletion();
    } catch (error) {
      console.error('Create course failed:', error);
      this.showError(error.message || 'Failed to create course.');
    } finally {
      createBtn.disabled = false;
      createBtn.innerHTML = originalText;
      this.updateCreateButton();
    }
  }

  openExistingShellModal(existing) {
    const { existingShellModal, existingShellName, existingShellInstructors } = this.elements;
    existingShellName.textContent = existing?.courseName || 'Unnamed course';
    const instructors = Array.isArray(existing?.instructors) ? existing.instructors : [];
    existingShellInstructors.innerHTML = instructors.length
      ? instructors.map(n => `<li>${this.escapeHTML(n)}</li>`).join('')
      : '<li class="muted">No instructor contacts available.</li>';
    existingShellModal.hidden = false;
  }

  closeExistingShellModal() {
    this.elements.existingShellModal.hidden = true;
    this.pendingCreatePayload = null;
  }

  async confirmCreateAnyway() {
    if (!this.pendingCreatePayload) {
      this.closeExistingShellModal();
      return;
    }
    const payload = { ...this.pendingCreatePayload, force: true };
    this.elements.existingShellModal.hidden = true;
    this.pendingCreatePayload = null;
    await this.submitCreate(payload);
  }

  // -------- Login tab (existing courses) --------

  async loadExistingCourses(coursesFromState = null) {
    const { loadingCourses, coursesList, noCoursesMessage } = this.elements;
    try {
      if (!coursesFromState) {
        this.setElementVisibility(loadingCourses, true, 'flex');
        this.setElementVisibility(coursesList, false);
        this.setElementVisibility(noCoursesMessage, false);
      }
      let courses = coursesFromState;
      if (!courses) {
        const response = await fetch(API.myCourses);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        courses = data.success && data.courses ? data.courses : [];
        this.courses = courses;
      }
      if (courses && courses.length > 0) this.displayCourses(courses);
      else this.showNoCoursesMessage();
    } catch (error) {
      console.error('Error loading courses:', error);
      this.showNoCoursesMessage();
    } finally {
      this.setElementVisibility(loadingCourses, false);
    }
  }

  setElementVisibility(element, visible, displayType = 'block') {
    if (element) element.style.display = visible ? displayType : 'none';
  }

  displayCourses(courses) {
    const { coursesList, noCoursesMessage } = this.elements;
    if (!coursesList) return;
    coursesList.innerHTML = courses.map((course) => this.createCourseItemHTML(course)).join('');
    this.setElementVisibility(coursesList, true, 'flex');
    this.setElementVisibility(noCoursesMessage, false);
  }

  createCourseItemHTML(course) {
    const escapedName = this.escapeHTML(course.courseName || 'Unnamed course');
    return `
      <div class="course-item" data-course-id="${course._id}">
        <div class="course-icon">
          <i class="fas fa-graduation-cap"></i>
        </div>
        <div class="course-info">
          <div class="course-name">${escapedName}</div>
        </div>
        <div class="course-actions">
          <button class="access-btn" data-course-id="${course._id}" data-course-name="${escapedName}" title="Access Dashboard">
            <i class="fas fa-arrow-right"></i>
            <span>Access</span>
          </button>
        </div>
      </div>
    `;
  }

  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
  escapeAttr(str) {
    return this.escapeHTML(str).replace(/"/g, '&quot;');
  }

  showNoCoursesMessage() {
    const { coursesList, noCoursesMessage } = this.elements;
    this.setElementVisibility(coursesList, false);
    this.setElementVisibility(noCoursesMessage, true);
  }

  accessCourseDashboard(buttonElement) {
    try {
      const courseId = buttonElement.dataset.courseId;
      const courseName = buttonElement.dataset.courseName;
      sessionStorage.setItem(
        STORAGE_KEYS.selectedCourse,
        JSON.stringify({ id: courseId, name: courseName })
      );
      window.location.href = this.isStudent ? '/student-dashboard' : '/dashboard';
    } catch (error) {
      console.error('Error accessing course dashboard:', error);
      this.showError('Failed to access dashboard. Please try again.');
    }
  }

  // -------- Join tab --------

  resetJoinSelection() {
    const { joinEnrollmentCode } = this.elements;
    if (joinEnrollmentCode) joinEnrollmentCode.value = '';
  }

  showJoinError(message) {
    const wrap = document.querySelector('.join-course-content');
    if (!wrap) return;
    const existing = wrap.querySelector('.error-message');
    if (existing) existing.remove();
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    const first = wrap.querySelector('h2');
    if (first && first.nextSibling) wrap.insertBefore(errorElement, first.nextSibling);
    else wrap.prepend(errorElement);
    setTimeout(() => errorElement.remove(), 6000);
  }

  async submitJoinCourse() {
    const { joinEnrollmentCode, joinSubmitCode } = this.elements;
    const code = joinEnrollmentCode?.value?.trim();
    if (!code) {
      this.showJoinError('Enter the enrollment code from your instructor.');
      return;
    }
    const original = joinSubmitCode?.innerHTML;
    if (joinSubmitCode) {
      joinSubmitCode.disabled = true;
      joinSubmitCode.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';
    }
    try {
      const response = await fetch(API.joinByEnrollmentCode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentCode: code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not join course');

      sessionStorage.setItem(
        STORAGE_KEYS.selectedCourse,
        JSON.stringify({ id: data.course._id, name: data.course.courseName })
      );
      window.location.href = '/student-dashboard';
    } catch (error) {
      console.error('Join course error:', error);
      this.showJoinError(error.message || 'Could not join course.');
    } finally {
      if (joinSubmitCode) {
        joinSubmitCode.disabled = false;
        joinSubmitCode.innerHTML = original || '<i class="fas fa-check"></i> Join course';
      }
    }
  }

  // -------- Completion / errors --------

  showCompletion() {
    const currentStepElement = document.querySelector(`${SELECTORS.stepContent}.active`);
    if (currentStepElement) currentStepElement.classList.remove('active');
    const completionElement = document.getElementById(SELECTORS.stepComplete);
    if (completionElement) completionElement.classList.add('active', 'success-animation');
  }

  showError(message) {
    const existingError = document.querySelector('.error-message');
    if (existingError) existingError.remove();
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    const currentForm = document.querySelector(`${SELECTORS.stepContent}.active .onboarding-form`);
    if (currentForm) currentForm.insertBefore(errorElement, currentForm.firstChild);
    setTimeout(() => errorElement.remove(), 5000);
  }
}

function redirectToDashboard() {
  window.location.href = '/dashboard';
}

function switchToSetupTab() {
  const setupButton = document.querySelector(`${SELECTORS.tabButton}[data-tab="${TAB_NAMES.setup}"]`);
  if (setupButton && setupButton.style.display !== 'none') setupButton.click();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.onboardingManager) {
    window.onboardingManager = new OnboardingManager();
  }
});
