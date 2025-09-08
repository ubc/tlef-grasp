// Course Materials - Client-side store and controllers
(function(){
  const STORE_KEY = 'grasp_course_materials';
  const SAVED_FLAG = 'grasp_course_materials_saved';

  const defaultMaterials = [
    { id:'m1', course:'CHEM 121', week:'Week 1', lecture:'L1', type:'slides',
      title:'Photosynthesis Overview (Slides)', description:'High-level summary...', loTags:['LO 2.1','LO 2.2'],
      relatedQuestionsCount:12, pages:5, summary:'High-level summary of light-dependent reactions and Calvin cycle.' },
    { id:'m2', course:'CHEM 121', week:'Week 2', lecture:'L1', type:'video', title:'Forces & Motion Intro', description:'Intro lecture recording: net force, acceleration, vectors.', loTags:['LO 1.1'], relatedQuestionsCount:8, pages:1, summary:'Intro lecture recording: net force, acceleration, vectors.' },
    { id:'m3', course:'CHEM 121', week:'Week 3', lecture:'L2', type:'textbook', title:'Cell Division Reading', description:'Chapter on mitosis vs meiosis with diagrams.', loTags:['LO 3.2'], relatedQuestionsCount:15, pages:1, summary:'Chapter on mitosis vs meiosis with diagrams.' },
    { id:'m4', course:'CHEM 121', week:'Week 2', lecture:'L2', type:'link', title:'Velocity-Time Graphs', description:'External resource explaining V-T graphs and area under curve.', loTags:['LO 1.2','LO 1.3'], relatedQuestionsCount:6, pages:1, summary:'External resource explaining V-T graphs and area under curve.' }
  ];

  const Store = {
    getAll() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) {
          localStorage.setItem(STORE_KEY, JSON.stringify(defaultMaterials));
          return [...defaultMaterials];
        }
        return JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to read store, seeding defaults', e);
        localStorage.setItem(STORE_KEY, JSON.stringify(defaultMaterials));
        return [...defaultMaterials];
      }
    },
    saveAll(list) {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    },
    add(material) {
      const list = this.getAll();
      list.unshift(material);
      this.saveAll(list);
    },
    getById(id) {
      return this.getAll().find(m => m.id === id) || null;
    }
  };

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    const live = document.getElementById('live-region');
    if (live) live.textContent = message;
    setTimeout(() => toast.remove(), 2500);
  }

  function parseQuery() {
    const params = new URLSearchParams(window.location.search);
    const obj = {};
    params.forEach((v,k) => { obj[k] = v; });
    return obj;
  }

  function typeLabel(type){
    const map = { pdf:'PDF', video:'Video', textbook:'Textbook', link:'Link', slides:'Slides', text:'Text' };
    return map[type] || type;
  }

  function typeIcon(type){
    switch(type){
      case 'pdf': return '<i class="fas fa-file-pdf"></i>';
      case 'video': return '<i class="fas fa-video"></i>';
      case 'textbook': return '<i class="fas fa-book"></i>';
      case 'slides': return '<i class="fas fa-file-powerpoint"></i>';
      case 'link': return '<i class="fas fa-link"></i>';
      case 'text': return '<i class="fas fa-file-alt"></i>';
      default: return '<i class="fas fa-file"></i>';
    }
  }

  function firstSentence(text){
    if (!text) return '';
    const m = text.match(/[^.!?]*[.!?]/);
    return m ? m[0].trim() : text.slice(0, 120);
  }

  // Index Page Controller
  function initIndex(){
    if (!document.getElementById('materials-index')) return;
    if (window.GRASPNavigation) new window.GRASPNavigation();

    const materials = Store.getAll();
    const state = { course:'all', week:'all', objective:'all', type:'all', q:'' };

    // Elements
    const courseSel = document.getElementById('course-select');
    const weekSel = document.getElementById('week-select');
    const objSel = document.getElementById('objective-select');
    const typeSel = document.getElementById('type-select');
    const searchInput = document.getElementById('search-input');
    const grid = document.getElementById('materials-grid');
    const uploadBtn = document.getElementById('upload-btn');

    function unique(arr){ return Array.from(new Set(arr)); }

    // Populate filter options
    const courses = ['all', ...unique(materials.map(m => m.course))];
    const weeks = ['all', ...unique(materials.map(m => m.week))];
    const objectives = ['all', ...unique(materials.flatMap(m => m.loTags || [])
      .map(tag => tag.trim()).filter(Boolean))];
    const types = ['all','pdf','video','textbook','link','slides','text'];

    function fill(sel, options){
      sel.innerHTML = options.map(v => `<option value="${v}">${v === 'all' ? 'All' : v.replace(/^LO /,'LO ')}</option>`).join('');
    }

    fill(courseSel, courses);
    fill(weekSel, weeks);
    fill(objSel, objectives);
    fill(typeSel, types);

    function matches(m){
      if (state.course !== 'all' && m.course !== state.course) return false;
      if (state.week !== 'all' && m.week !== state.week) return false;
      if (state.objective !== 'all' && !(m.loTags||[]).includes(state.objective)) return false;
      if (state.type !== 'all' && m.type !== state.type) return false;
      if (state.q){
        const q = state.q.toLowerCase();
        const hay = [m.title, m.description, ...(m.loTags||[])].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }

    function render(){
      const list = Store.getAll().filter(matches);
      if (list.length === 0){
        grid.innerHTML = `
          <div class="card" style="grid-column: 1 / -1; text-align:center; padding: 40px;">
            <h3 style="margin:0 0 8px 0;">No materials found</h3>
            <button class="btn btn-primary btn-small" id="empty-upload">Upload</button>
          </div>`;
        const btn = document.getElementById('empty-upload');
        if (btn) btn.addEventListener('click', () => { window.location.href = 'course-materials-upload.html'; });
        return;
      }
      grid.innerHTML = list.map(m => `
        <button class="material-card" data-id="${m.id}" aria-label="Open ${m.title}">
          <div class="card-header">
            <h3 class="material-title">${m.title}</h3>
            <span class="type-chip">${typeIcon(m.type)} ${typeLabel(m.type)}</span>
          </div>
          <div class="material-meta">${m.week} • ${m.lecture}</div>
          <div class="material-desc">${m.description || ''}</div>
          <div class="lo-chips">${(m.loTags||[]).map(t => `<span class="lo-chip">${t}</span>`).join('')}</div>
          <div class="card-footer">${m.relatedQuestionsCount||0} related questions</div>
        </button>
      `).join('');

      grid.querySelectorAll('.material-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-id');
          window.location.href = 'course-materials-detail.html?id=' + encodeURIComponent(id);
        });
      });
    }

    // Events
    courseSel.addEventListener('change', e => { state.course = e.target.value; render(); });
    weekSel.addEventListener('change', e => { state.week = e.target.value; render(); });
    objSel.addEventListener('change', e => { state.objective = e.target.value; render(); });
    typeSel.addEventListener('change', e => { state.type = e.target.value; render(); });
    searchInput.addEventListener('input', e => { state.q = e.target.value; render(); });
    uploadBtn.addEventListener('click', () => { window.location.href = 'course-materials-upload.html'; });

    // Saved flag
    if (sessionStorage.getItem(SAVED_FLAG) === '1'){
      showToast('Material saved');
      sessionStorage.removeItem(SAVED_FLAG);
    }

    render();
  }

  // Detail Page Controller
  function initDetail(){
    if (!document.getElementById('materials-detail')) return;
    if (window.GRASPNavigation) new window.GRASPNavigation();
    const q = parseQuery();
    const mat = Store.getById(q.id);
    if (!mat) return;

    // Header
    document.getElementById('detail-title').textContent = mat.title;
    document.getElementById('detail-chip').innerHTML = typeIcon(mat.type) + ' ' + typeLabel(mat.type);
    document.getElementById('detail-subtitle').textContent = `${mat.week} • ${mat.lecture}`;

    // Summary
    const summaryArea = document.getElementById('summary-text');
    const saveSummaryBtn = document.getElementById('save-summary');
    summaryArea.value = mat.summary || '';
    let dirty = false;
    summaryArea.addEventListener('input', () => {
      dirty = true;
      saveSummaryBtn.disabled = false;
    });
    saveSummaryBtn.addEventListener('click', () => {
      const all = Store.getAll();
      const idx = all.findIndex(m => m.id === mat.id);
      if (idx > -1){
        all[idx].summary = summaryArea.value;
        if (!all[idx].description) all[idx].description = firstSentence(summaryArea.value);
        Store.saveAll(all);
        dirty = false;
        saveSummaryBtn.disabled = true;
        showToast('Summary saved');
      }
    });

    // Preview
    const tabs = document.getElementById('preview-tabs');
    const total = mat.pages || 1;
    const content = document.getElementById('preview-content');
    const totalPagesEl = document.getElementById('preview-total-pages');
    totalPagesEl.textContent = `Total pages: ${total}`;

    function selectTab(n){
      Array.from(tabs.children).forEach((el, i) => {
        el.setAttribute('aria-selected', String(i+1 === n));
        el.tabIndex = i+1 === n ? 0 : -1;
      });
      content.textContent = `Preview content for Page ${n} of "${mat.title}".`;
    }

    for (let i=1; i<=total; i++){
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.setAttribute('role','tab');
      btn.setAttribute('aria-selected', 'false');
      btn.textContent = `Page ${i}`;
      btn.addEventListener('click', () => selectTab(i));
      tabs.appendChild(btn);
    }
    selectTab(1);

    // LO Tags
    const chips = document.getElementById('lo-chips');
    const addInput = document.getElementById('add-tag-input');
    const addBtn = document.getElementById('add-tag-btn');

    function renderTags(){
      const current = (Store.getById(mat.id)?.loTags) || [];
      chips.innerHTML = current.map((t, idx) => `
        <span class="chip">${t} <span class="remove" data-idx="${idx}" aria-label="Remove ${t}">×</span></span>
      `).join('');
      chips.querySelectorAll('.remove').forEach(el => {
        el.addEventListener('click', () => {
          const all = Store.getAll();
          const i = all.findIndex(m => m.id === mat.id);
          if (i > -1){
            all[i].loTags.splice(Number(el.getAttribute('data-idx')), 1);
            Store.saveAll(all);
            renderTags();
            showToast('Tag removed');
            const live = document.getElementById('live-region'); if (live) live.textContent = 'Tag removed';
          }
        });
      });
    }

    function isValidTag(val){
      return /^LO\s*\d+\.\d+$/i.test(val.trim());
    }

    addBtn.addEventListener('click', () => {
      const val = addInput.value.trim();
      if (!val) return;
      const all = Store.getAll();
      const i = all.findIndex(m => m.id === mat.id);
      if (i > -1){
        all[i].loTags = all[i].loTags || [];
        all[i].loTags.push(val);
        Store.saveAll(all);
        addInput.value = '';
        renderTags();
        showToast('Tag added');
        const live = document.getElementById('live-region'); if (live) live.textContent = 'Tag added';
      }
    });

    renderTags();

    // Linked Questions (mock rows)
    const qTableBody = document.getElementById('linked-questions-body');
    const mockRows = [
      { id:1, title:'Define Microstate', bloom:'Understand', status:'Draft' },
      { id:2, title:'Entropy in Reactions', bloom:'Analyze', status:'Draft' },
      { id:3, title:'Compare Reversibility', bloom:'Understand', status:'Approved' }
    ];
    qTableBody.innerHTML = mockRows.map(r => `
      <tr data-qid="${r.id}" role="button" tabindex="0">
        <td>${r.title}</td>
        <td class="muted">${r.bloom}</td>
        <td class="muted">${r.status}</td>
      </tr>
    `).join('');
    qTableBody.querySelectorAll('tr').forEach(row => {
      const go = () => { window.location.href = `../question-review.html?questionId=${row.getAttribute('data-qid')}`; };
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(); });
    });

    // Buttons
    const downloadBtn = document.getElementById('download-btn');
    const editBtn = document.getElementById('edit-btn');
    downloadBtn.addEventListener('click', () => showToast('Download started'));
    editBtn.addEventListener('click', () => { summaryArea.focus(); });
  }

  // Upload Page Controller
  function initUpload(){
    if (!document.getElementById('materials-upload')) return;
    if (window.GRASPNavigation) new window.GRASPNavigation();

    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const nextBtn = document.getElementById('next-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const backBtn = document.getElementById('back-btn');
    const saveBtn = document.getElementById('save-btn');

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const pendingList = document.getElementById('pending-list');

    const tiles = document.querySelectorAll('.tile');
    let selectedTile = 'pdf';
    let pending = [];

    function setStep(n){
      document.getElementById('s1').classList.toggle('active', n===1);
      document.getElementById('s2').classList.toggle('active', n===2);
      step1.style.display = n===1 ? 'block' : 'none';
      step2.style.display = n===2 ? 'block' : 'none';
    }

    tiles.forEach(t => {
      t.addEventListener('click', () => {
        tiles.forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        selectedTile = t.getAttribute('data-type');
      });
    });

    function renderPending(){
      pendingList.innerHTML = pending.map((p, idx) => `
        <div class="pending-item"><span>${p.name}</span><span>${p.type.toUpperCase()} • ${(p.size||0)} KB</span></div>
      `).join('');
      nextBtn.disabled = pending.length === 0;
    }

    function guessType(name){
      const n = (name||'').toLowerCase();
      if (n.endsWith('.pdf')) return 'pdf';
      if (n.endsWith('.mp4') || n.endsWith('.mov')) return 'video';
      if (n.endsWith('.ppt') || n.endsWith('.pptx')) return 'slides';
      if (n.endsWith('.txt')) return 'text';
      return selectedTile;
    }

    // Dropzone interactions
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('focus'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('focus'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault(); dropzone.classList.remove('focus');
      const files = Array.from(e.dataTransfer.files || []);
      files.forEach(f => pending.push({ name: f.name, size: Math.round(f.size/1024), type: guessType(f.name) }));
      renderPending();
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(f => pending.push({ name: f.name, size: Math.round(f.size/1024), type: guessType(f.name) }));
      fileInput.value = '';
      renderPending();
    });

    // Step navigation
    nextBtn.addEventListener('click', () => setStep(2));
    cancelBtn.addEventListener('click', () => { window.location.href = 'course-materials.html'; });
    backBtn.addEventListener('click', () => setStep(1));

    // Step 2
    const summaryArea = document.getElementById('summary-area');
    const regenBtn = document.getElementById('regen-btn');
    regenBtn.title = 'Connect AI later';

    saveBtn.addEventListener('click', () => {
      if (pending.length === 0) return;
      const now = Date.now();
      const items = pending.map((p, i) => {
        const title = (p.name || 'Untitled').replace(/\.[^/.]+$/, '');
        const type = p.type || 'pdf';
        const pages = type === 'pdf' ? 5 : 1;
        return {
          id: 'm' + (now + i),
          course: 'CHEM 121',
          week: 'Week 1',
          lecture: 'L1',
          type,
          title,
          description: firstSentence(summaryArea.value || 'High-level summary of the material.'),
          loTags: [],
          relatedQuestionsCount: Math.floor(Math.random()*12)+3,
          pages,
          summary: summaryArea.value || 'High-level summary of the material.'
        };
      });
      const all = Store.getAll();
      Store.saveAll([...items, ...all]);
      sessionStorage.setItem(SAVED_FLAG, '1');
      window.location.href = 'course-materials.html';
    });

    renderPending();
    setStep(1);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Attach to window for debugging if needed
    window.CourseMaterialsStore = Store;
    initIndex();
    initDetail();
    initUpload();
  });
})(); 