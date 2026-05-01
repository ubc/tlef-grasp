const JOIN_ENDPOINT = '/api/courses/join-by-code';
const STORAGE_SELECTED_COURSE = 'grasp-selected-course';

function setJoinMessage(el, message, type = 'info') {
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('student-join-message--error', type === 'error');
  el.classList.toggle('student-join-message--success', type === 'success');
}

async function joinByEnrollmentCode() {
  const input = document.getElementById('student-settings-join-code');
  const btn = document.getElementById('student-settings-join-submit');
  const msg = document.getElementById('student-settings-join-message');

  const code = String(input?.value || '').trim();
  if (!code) {
    setJoinMessage(msg, 'Enter the enrollment code from your instructor.', 'error');
    return;
  }

  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';
  }
  setJoinMessage(msg, '', 'info');

  try {
    const response = await fetch(JOIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentCode: code }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Could not join course');
    }

    sessionStorage.setItem(
      STORAGE_SELECTED_COURSE,
      JSON.stringify({ id: data.course?._id, name: data.course?.courseName })
    );

    setJoinMessage(msg, 'Joined course successfully. Opening your dashboard…', 'success');
    window.location.href = '/student-dashboard';
  } catch (error) {
    console.error('[StudentSettings] Join by code:', error);
    setJoinMessage(msg, error.message || 'Could not join course.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || '<i class="fas fa-right-to-bracket"></i> Join';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.GRASPNavigation) {
    new window.GRASPNavigation();
  }

  const input = document.getElementById('student-settings-join-code');
  const btn = document.getElementById('student-settings-join-submit');

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinByEnrollmentCode();
      }
    });
  }
  if (btn) {
    btn.addEventListener('click', () => joinByEnrollmentCode());
  }
});
