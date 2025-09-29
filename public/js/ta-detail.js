(function(){
  const DASH_KEY = 'grasp_ta_dashboards';
  const seed = {
    "u1": {
      name: "Alex Rivera",
      role: "TA",
      metrics: { reviewed: 72, prepared: 40, resolved: 55 },
      weeks: [
        {
          title: "Week 1 — Photosynthesis",
          items: [
            { id:"m1", title:"Lecture 1 Slides", status:"Reviewed", due:"Aug 05", type:"material" },
            { id:"qsetA", title:"Question Set A", status:"In progress", due:"Aug 06", type:"quiz" }
          ]
        },
        {
          title: "Week 2 — Forces & Motion",
          items: [
            { id:"m2", title:"Lecture 2 Notes", status:"Not started", due:"Aug 12", type:"material" },
            { id:"qz1", title:"Quiz Draft #1", status:"In progress", due:"Aug 13", type:"quiz" }
          ]
        }
      ]
    }
  };

  function getStore(){
    try {
      const raw = localStorage.getItem(DASH_KEY);
      if (!raw) { localStorage.setItem(DASH_KEY, JSON.stringify(seed)); return seed; }
      return JSON.parse(raw);
    } catch {
      localStorage.setItem(DASH_KEY, JSON.stringify(seed));
      return seed;
    }
  }

  function parseId(){
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('users');
    if (idx !== -1 && parts[idx+2] === 'ta') return parts[idx+1];
    const q = new URLSearchParams(window.location.search);
    return q.get('id') || 'u1';
  }

  function setMetric(el, pct, pctEl){
    const bar = el.querySelector('.fill');
    el.setAttribute('aria-valuenow', String(pct));
    bar.style.width = pct + '%';
    pctEl.textContent = pct + '%';
  }

  function openPlaceholder(title, status){
    const modal = document.getElementById('placeholder-modal');
    const body = document.getElementById('placeholder-body');
    document.getElementById('placeholder-title').textContent = title;
    body.textContent = `Status: ${status}. This is a placeholder.`;
    modal.classList.add('open');
    const close = () => modal.classList.remove('open');
    document.getElementById('placeholder-close').onclick = close;
    document.getElementById('placeholder-ok').onclick = close;
    trapModal(modal);
  }

  function trapModal(modal){
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    function onKey(e){
      if (e.key === 'Escape') { modal.classList.remove('open'); modal.removeEventListener('keydown', onKey); }
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
    modal.addEventListener('keydown', onKey);
    setTimeout(() => first.focus(), 0);
  }

  function renderWeeks(ta){
    const container = document.getElementById('weeks-container');
    container.innerHTML = ta.weeks.map(week => `
      <div class="card section-card">
        <h2 class="section-header">${week.title}</h2>
        <div class="items">
          ${week.items.map(it => `
            <div class="item-row" data-id="${it.id}" data-type="${it.type||''}">
              <div class="item-left">
                <div class="item-title">${it.title}</div>
                <div class="item-sub">Status: ${it.status} • Due: ${it.due}</div>
              </div>
              <button class="btn btn-small">View Details</button>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.item-row .btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.item-row');
        const id = row.getAttribute('data-id');
        const type = row.getAttribute('data-type');
        const title = row.querySelector('.item-title').textContent;
        const status = row.querySelector('.item-sub').textContent.replace(/^Status:\s*/, '');
        if (type === 'material') {
          window.location.href = `/course-materials/${encodeURIComponent(id)}`;
        } else if (type === 'quiz' || type === 'question') {
          // Use existing review routes if present; otherwise show placeholder
          openPlaceholder(title, status);
        } else {
          openPlaceholder(title, status);
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.GRASPNavigation) new window.GRASPNavigation();
    const id = parseId();
    const store = getStore();
    const ta = store[id] || store['u1'];

    document.getElementById('ta-name').textContent = `${ta.name} — ${ta.role}`;

    setMetric(document.getElementById('m-reviewed'), ta.metrics.reviewed, document.getElementById('m-reviewed-pct'));
    setMetric(document.getElementById('m-prepared'), ta.metrics.prepared, document.getElementById('m-prepared-pct'));
    setMetric(document.getElementById('m-resolved'), ta.metrics.resolved, document.getElementById('m-resolved-pct'));

    renderWeeks(ta);
  });
})(); 