document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const sectionsList = document.getElementById('sections-list');
    const loadingState = document.getElementById('sections-loading');
    const tableWrapper = document.getElementById('sections-table-wrapper');
    const emptyState = document.getElementById('sections-empty');

    const addSectionContainer = document.getElementById('add-section-container');
    const addSectionForm = document.getElementById('add-section-form');
    const academicPeriodSelect = document.getElementById('add-academic-period');
    const sectionsSelect = document.getElementById('add-sections');
    const submitBtn = document.getElementById('add-section-btn');
    const syncCheckbox = document.getElementById('add-sync-students');

    // Modal Elements
    const modal = document.getElementById('confirm-modal');
    const modalClose = document.getElementById('modal-close');
    const modalCancel = document.getElementById('modal-cancel');
    const modalConfirm = document.getElementById('modal-confirm');

    // State
    let sectionToRecycle = null;
    let currentCourse = null;
    let existingSectionIds = new Set();

    let courseId = null;
    try {
        const storedCourse = sessionStorage.getItem('grasp-selected-course');
        if (storedCourse) {
            // It might be a JSON object like {"id":"...", "name":"..."}
            if (storedCourse.startsWith('{')) {
                const parsed = JSON.parse(storedCourse);
                courseId = parsed.id;
            } else {
                courseId = storedCourse;
            }
        }
    } catch (e) {
        console.warn('Could not parse grasp-selected-course', e);
    }

    // Initialize
    new GRASPNavigation();

    if (!courseId || courseId === 'null' || courseId === 'undefined') {
        showNotification('No course selected. Please select a course from the sidebar first.', true);
        showEmptyState(true);
    } else {
        loadSections();
    }

    // Event Listeners
    modalClose.addEventListener('click', closeModal);
    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', handleRecycleConfirm);

    // Click outside to close modal
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    academicPeriodSelect.addEventListener('change', async (e) => {
        const period = e.target.value;
        if (!period) {
            sectionsSelect.innerHTML = '<option value="">Select academic period first</option>';
            sectionsSelect.disabled = true;
            submitBtn.disabled = true;
            return;
        }

        sectionsSelect.innerHTML = '<option value="">Loading sections...</option>';
        sectionsSelect.disabled = true;
        submitBtn.disabled = true;

        try {
            const response = await fetch(`/api/ubc/instructor-sections?academicPeriod=${period}`);
            const data = await response.json();

            if (data.success && data.data) {
                populateSectionsList(data.data);
            } else {
                throw new Error('Failed to load sections');
            }
        } catch (error) {
            console.error('Error loading instructor sections:', error);
            sectionsSelect.innerHTML = '<option value="">Error loading sections</option>';
        }
    });

    sectionsSelect.addEventListener('change', () => {
        submitBtn.disabled = Array.from(sectionsSelect.selectedOptions).length === 0;
    });

    addSectionForm.addEventListener('submit', handleAddSections);

    /**
     * Load sections and course info from API
     */
    async function loadSections() {
        showLoading(true);

        try {
            if (!currentCourse) {
                const courseRes = await fetch(`/api/courses/${courseId}`);
                if (courseRes.status === 404) {
                    sessionStorage.removeItem('grasp-selected-course');
                    showNotification('Selected course no longer exists. Please select a course from the sidebar.', true);
                    showEmptyState(true);
                    return;
                }
                const courseData = await courseRes.json();
                if (courseData.success) {
                    currentCourse = courseData.course;
                    addSectionContainer.style.display = 'block';
                    await loadAcademicPeriods(currentCourse.campus);
                } else {
                    throw new Error('Failed to load course details');
                }
            }

            const response = await fetch(`/api/courses/${courseId}/my-sections`);
            const data = await response.json();

            if (data.success) {
                existingSectionIds = new Set((data.sections || []).map(s => s.sectionId));
                renderSections(data.sections || []);
            } else {
                throw new Error(data.error || 'Failed to load sections');
            }
        } catch (error) {
            console.error('Error:', error);
            showEmptyState(true);
        } finally {
            showLoading(false);
        }
    }

    async function loadAcademicPeriods(campus) {
        try {
            const response = await fetch(`/api/ubc/academic-periods?campus=${campus}`);
            const data = await response.json();

            if (data.success && data.data) {
                academicPeriodSelect.innerHTML = '<option value="">-- Select Period --</option>';
                data.data.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p.key;
                    option.textContent = p.title;
                    academicPeriodSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error loading academic periods:', error);
            academicPeriodSelect.innerHTML = '<option value="">Error loading periods</option>';
        }
    }

    function populateSectionsList(instructorSections) {
        sectionsSelect.innerHTML = '';

        if (!currentCourse) return;

        const expectedUbcCourseId = currentCourse.ubcCourseId;

        let addedCount = 0;
        instructorSections.forEach(section => {
            const sectionUbcCourseId = `${section.courseSubject}|${section.courseNumber}`;

            // 1. Enforce same UBC Course ID (if available on the course shell)
            if (!expectedUbcCourseId || sectionUbcCourseId === expectedUbcCourseId || section.ubcCourseId === expectedUbcCourseId) {
                // 2. Exclude already-added sections
                if (!existingSectionIds.has(section.key)) {
                    const option = document.createElement('option');
                    option.value = section.key;
                    option.textContent = section.title;
                    sectionsSelect.appendChild(option);
                    addedCount++;
                }
            }
        });

        if (addedCount === 0) {
            sectionsSelect.innerHTML = '<option value="" disabled>No new sections available for this course</option>';
            sectionsSelect.disabled = true;
            submitBtn.disabled = true;
        } else {
            sectionsSelect.disabled = false;
        }
    }

    async function handleAddSections(e) {
        e.preventDefault();

        const period = academicPeriodSelect.value;
        const periodName = academicPeriodSelect.options[academicPeriodSelect.selectedIndex].text;
        const selectedOptions = Array.from(sectionsSelect.selectedOptions);
        const sectionIds = selectedOptions.map(opt => opt.value);
        const syncStudents = syncCheckbox.checked;

        if (!period || sectionIds.length === 0) return;

        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
        submitBtn.disabled = true;

        try {
            const response = await fetch(`/api/courses/${courseId}/sections`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sectionIds,
                    academicPeriod: period,
                    academicPeriodName: periodName,
                    syncStudents
                })
            });

            const data = await response.json();

            if (data.success) {
                showNotification(`Successfully added ${sectionIds.length} section(s).`, false);

                academicPeriodSelect.value = '';
                sectionsSelect.innerHTML = '<option value="">Select academic period first</option>';
                sectionsSelect.disabled = true;

                loadSections();
            } else {
                throw new Error(data.error || 'Failed to add sections');
            }
        } catch (error) {
            console.error('Error adding sections:', error);
            showNotification(error.message, true);
        } finally {
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Section(s)';
            submitBtn.disabled = true;
        }
    }

    /**
     * Render the sections table
     */
    function renderSections(sections) {
        sectionsList.innerHTML = '';

        if (!sections || sections.length === 0) {
            showEmptyState(true);
            return;
        }

        showEmptyState(false);

        sections.forEach(section => {
            let periodName = section.academicPeriodName || section.academicPeriod || 'Unknown';
            if (!section.academicPeriodName && periodName.length >= 5) {
                const year = periodName.substring(0, 4);
                const term = periodName.substring(4);
                if (term.startsWith('W')) periodName = year + ' Winter' + term.substring(1);
                else if (term.startsWith('S')) periodName = year + ' Summer' + term.substring(1);
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="user-info">
                        <div class="user-details">
                            <span class="user-name">${escapeHtml(periodName)}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="section-badge">${escapeHtml(section.sectionNumber || 'N/A')}</span>
                </td>
                <td class="actions-column">
                    <button class="btn btn-secondary btn-sm action-btn recycle-btn" 
                            title="Recycle Section" 
                            data-course-id="${section.courseId}" 
                            data-section-id="${section.sectionId}">
                        <i class="fas fa-recycle" style="color: #e74c3c;"></i> Recycle
                    </button>
                </td>
            `;
            sectionsList.appendChild(tr);
        });

        document.querySelectorAll('.recycle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sectionId = e.currentTarget.dataset.sectionId;
                openRecycleModal(courseId, sectionId);
            });
        });
    }

    /**
     * Open confirmation modal for recycling
     */
    function openRecycleModal(courseId, sectionId) {
        sectionToRecycle = { courseId, sectionId };
        modal.style.display = 'flex';
    }

    /**
     * Close modal
     */
    function closeModal() {
        modal.style.display = 'none';
        sectionToRecycle = null;
    }

    /**
     * Handle confirm recycle
     */
    async function handleRecycleConfirm() {
        if (!sectionToRecycle) return;

        const originalBtnText = modalConfirm.innerHTML;
        modalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        modalConfirm.disabled = true;

        try {
            const response = await fetch(`/api/courses/${sectionToRecycle.courseId}/sections/${sectionToRecycle.sectionId}/recycle`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                closeModal();
                showNotification('Section successfully recycled and removed.', false);

                // If we recycle the currently selected section in the dropdown (just in case), we should probably reload the dropdowns
                // but reloading sections is enough since they can just reselect the period.
                academicPeriodSelect.value = '';
                sectionsSelect.innerHTML = '<option value="">Select academic period first</option>';
                sectionsSelect.disabled = true;

                loadSections(); // reload list
            } else {
                throw new Error(data.error || 'Failed to recycle section');
            }
        } catch (error) {
            console.error('Error recycling section:', error);
            showNotification('Failed to recycle section: ' + error.message, true);
        } finally {
            modalConfirm.innerHTML = originalBtnText;
            modalConfirm.disabled = false;
        }
    }

    /**
     * Show toast notification
     */
    function showNotification(message, isError = false) {
        const div = document.createElement('div');
        div.style.position = 'fixed';
        div.style.top = '20px';
        div.style.right = '20px';
        div.style.padding = '15px 25px';
        div.style.background = isError ? '#e74c3c' : '#27ae60';
        div.style.color = 'white';
        div.style.borderRadius = '8px';
        div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        div.style.zIndex = '9999';
        div.style.fontFamily = "'Open Sans', sans-serif";
        div.style.fontSize = '14px';
        div.style.transition = 'opacity 0.3s ease';
        div.textContent = message;
        document.body.appendChild(div);

        setTimeout(() => {
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 300);
        }, 4000);
    }

    /**
     * Helper to show/hide loading state
     */
    function showLoading(show) {
        if (show) {
            loadingState.style.display = 'flex';
            tableWrapper.style.display = 'none';
            emptyState.style.display = 'none';
        } else {
            loadingState.style.display = 'none';
        }
    }

    /**
     * Helper to show/hide empty state
     */
    function showEmptyState(show) {
        if (show) {
            tableWrapper.style.display = 'none';
            emptyState.style.display = 'flex';
        } else {
            tableWrapper.style.display = 'block';
            emptyState.style.display = 'none';
        }
    }

    /**
     * Helper to escape HTML and prevent XSS
     */
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
