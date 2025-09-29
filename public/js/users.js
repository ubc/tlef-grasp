(function(){
  const STORE_KEY = 'grasp_users';
  const TEMPLATES_KEY = 'grasp_role_templates';

  const defaultUsers = [
    { id:'u1', name:'Alex Rivera', email:'alex.rivera@example.ca', role:'TA', section:'L1', permissions:['Review','Comment'], progress:72, status:'Active', joined:'2024-08-12' },
    { id:'u2', name:'Priya Shah', email:'priya.shah@example.ca', role:'TA', section:'L2', permissions:['Review','Publish'], progress:41, status:'Active', joined:'2024-08-10' },
    { id:'u3', name:'Dr. Kim', email:'kim@example.ca', role:'Instructor', section:'—', permissions:['Admin'], progress:null, status:'Active', joined:'2023-09-01' },
    { id:'u4', name:'Mina K.', email:'mina.k@example.ca', role:'TA', section:'L3', permissions:['Review'], progress:0, status:'Inactive', joined:'2024-07-01' }
  ];

  const defaultTemplates = { TA:['Review'], Instructor:['Admin'] };

  const Store = {
    getUsers(){
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) { localStorage.setItem(STORE_KEY, JSON.stringify(defaultUsers)); return [...defaultUsers]; }
        return JSON.parse(raw);
      } catch { localStorage.setItem(STORE_KEY, JSON.stringify(defaultUsers)); return [...defaultUsers]; }
    },
    saveUsers(list){ localStorage.setItem(STORE_KEY, JSON.stringify(list)); },
    getTemplates(){
      try {
        const raw = localStorage.getItem(TEMPLATES_KEY);
        if (!raw) { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(defaultTemplates)); return {...defaultTemplates}; }
        return JSON.parse(raw);
      } catch { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(defaultTemplates)); return {...defaultTemplates}; }
    },
    saveTemplates(map){ localStorage.setItem(TEMPLATES_KEY, JSON.stringify(map)); }
  };

  function showToast(msg){
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function initials(name){
    return (name||'').split(/\s+/).filter(Boolean).slice(0,2).map(s => s[0].toUpperCase()).join('');
  }

  function debounce(fn, ms){ let id; return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); }; }

  function initUsers(){
    if (!document.getElementById('users-page')) return;
    if (window.GRASPNavigation) new window.GRASPNavigation();

    let users = Store.getUsers();
    let templates = Store.getTemplates();
    let filters = { q:'', role:'All', section:'All', status:'All' };

    // Elements
    const searchInput = document.getElementById('search-input');
    const roleSel = document.getElementById('filter-role');
    const sectionSel = document.getElementById('filter-section');
    const statusSel = document.getElementById('filter-status');
    const adjustBtn = document.getElementById('btn-adjust');
    const addBtn = document.getElementById('btn-add');
    const tbody = document.getElementById('users-tbody');
    const profilePanel = document.getElementById('profile-panel');

    // Populate sections from users
    function unique(arr){ return Array.from(new Set(arr)); }
    const sections = ['All', ...unique(users.map(u => u.section)).filter(Boolean)];
    sectionSel.innerHTML = sections.map(s => `<option value="${s}">${s}</option>`).join('');

    // Filtering logic
    function matches(u){
      if (filters.role !== 'All' && u.role !== filters.role) return false;
      if (filters.section !== 'All' && u.section !== filters.section) return false;
      if (filters.status !== 'All' && u.status !== filters.status) return false;
      if (filters.q){
        const q = filters.q.toLowerCase();
        const hay = `${u.name} ${u.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }

    function render(){
      users = Store.getUsers();
      const rows = users.filter(matches);
      tbody.innerHTML = rows.map(u => `
        <tr class="${u.status==='Inactive' ? 'status-inactive' : ''}" data-id="${u.id}">
          <td>
            <div class="user-cell">
              <span class="avatar" aria-hidden="true">${initials(u.name)}</span>
              <div>
                <div class="name" role="button" tabindex="0">${u.name}</div>
                <div class="email">${u.email}</div>
              </div>
            </div>
          </td>
          <td>${u.email}</td>
          <td>${u.role}</td>
          <td>${(u.permissions||[]).join(', ') || '—'}</td>
          <td>
            ${u.progress==null ? '—' : `
              <div class="progress-wrap">
                <div class="progress" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${u.progress}"><div class="fill" style="width:${u.progress}%"></div></div>
                <span class="pct">${u.progress}%</span>
              </div>`}
          </td>
          <td class="actions">
            <button class="menu-btn" aria-haspopup="true" aria-expanded="false" aria-label="Open actions"><i class="fas fa-ellipsis-h"></i></button>
            <div class="menu" role="menu">
              <ul>
                <li data-action="view">View profile</li>
                <li data-action="edit">Edit role & permissions</li>
                <li data-action="move">Move to section…</li>
                <li data-action="reset" ${u.status==='Inactive'?'aria-disabled="true" style="opacity:.5;pointer-events:none;"':''}>Reset password</li>
                <li data-action="toggle">${u.status==='Inactive' ? 'Activate' : 'Deactivate'}</li>
                <li class="danger" data-action="remove">Remove user</li>
              </ul>
            </div>
          </td>
        </tr>
      `).join('');

      // Bind per-row actions
      tbody.querySelectorAll('tr').forEach(row => {
        const id = row.getAttribute('data-id');
        const user = users.find(u => u.id === id);
        // name click -> profile panel
        const nameEl = row.querySelector('.name');
        const openProfile = () => openProfilePanel(user);
        nameEl.addEventListener('click', () => {
          if (user.role === 'TA') {
            window.location.href = `/users/${encodeURIComponent(user.id)}`;
          } else {
            openProfile();
          }
        });
        nameEl.addEventListener('keydown', (e) => {
          if (e.key==='Enter' || e.key===' ') {
            if (user.role === 'TA') {
              window.location.href = `/users/${encodeURIComponent(user.id)}`;
            } else {
              openProfile();
            }
          }
        });

        const menuBtn = row.querySelector('.menu-btn');
        const menu = row.querySelector('.menu');
        function openMenu(){
          closeAllMenus();
          menu.classList.add('open');
          menuBtn.setAttribute('aria-expanded', 'true');
        }
        function closeMenu(){
          menu.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        }
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.contains('open') ? closeMenu() : openMenu(); });
        document.addEventListener('click', closeMenu);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

        menu.querySelectorAll('li').forEach(item => {
          item.addEventListener('click', () => {
            const action = item.getAttribute('data-action');
            closeMenu();
            handleRowAction(action, user);
          });
        });
      });
    }

    function closeAllMenus(){ document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); }

    function openProfilePanel(user){
      profilePanel.innerHTML = `
        <div class="profile-row"><strong>${user.name}</strong></div>
        <div class="profile-row">${user.email}</div>
        <div class="profile-row">Section: ${user.section}</div>
        <div class="profile-row">Joined: ${user.joined || '—'}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;"><button id="close-profile" class="btn btn-small">Close</button></div>
      `;
      profilePanel.classList.add('open');
      document.getElementById('close-profile').addEventListener('click', () => profilePanel.classList.remove('open'));
      document.addEventListener('keydown', escCloseProfile);
      function escCloseProfile(e){ if (e.key==='Escape') { profilePanel.classList.remove('open'); document.removeEventListener('keydown', escCloseProfile); } }
    }

    function handleRowAction(action, user){
      switch(action){
        case 'view':
          openProfilePanel(user);
          break;
        case 'edit':
          openEditUserModal(user);
          break;
        case 'move':
          openMoveSectionModal(user);
          break;
        case 'reset':
          if (user.status === 'Inactive') return;
          showToast('Password reset link sent');
          break;
        case 'toggle':
          toggleStatus(user);
          break;
        case 'remove':
          if (confirm(`Remove ${user.name}?`)){
            const list = Store.getUsers().filter(u => u.id !== user.id);
            Store.saveUsers(list);
            render();
          }
          break;
      }
    }

    function toggleStatus(user){
      const list = Store.getUsers();
      const idx = list.findIndex(u => u.id === user.id);
      if (idx > -1){
        list[idx].status = list[idx].status === 'Inactive' ? 'Active' : 'Inactive';
        Store.saveUsers(list);
        render();
      }
    }

    // Adjust Permissions (role templates)
    const tplModal = document.getElementById('templates-modal');
    const tplBody = document.getElementById('templates-body');
    const tplSave = document.getElementById('templates-save');
    const tplCancel = document.getElementById('templates-cancel');
    const segInst = document.getElementById('seg-instructor');
    const segTA = document.getElementById('seg-ta');

    function renderTemplateView(role){
      const current = (templates[role] || []);
      function cb(id,label){
        const checked = current.includes(label) ? 'checked' : '';
        const disabled = label==='Admin' ? '' : '';
        return `<label><input type="checkbox" data-role="${role}" value="${label}" ${checked}> ${label}</label>`;
      }
      tplBody.innerHTML = `
        <div class="checkbox-list">
          ${cb('rev','Review')}
          ${cb('pub','Publish')}
          ${cb('com','Comment')}
          ${cb('adm','Admin')}
        </div>
      `;
      // Mutual exclusivity: Admin overrides others
      tplBody.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.addEventListener('change', () => {
          const role = box.getAttribute('data-role');
          let set = new Set(templates[role] || []);
          if (box.value === 'Admin' && box.checked){
            set = new Set(['Admin']);
          } else {
            set.delete('Admin');
            if (box.checked) set.add(box.value); else set.delete(box.value);
          }
          templates[role] = Array.from(set);
          renderTemplateView(role); // re-render to reflect exclusivity
        });
      });
    }

    function openTemplates(role){
      tplModal.classList.add('open');
      (role==='Instructor' ? segInst : segTA).classList.add('active');
      renderTemplateView(role);
      trapModal(tplModal);
    }

    segInst.addEventListener('click', () => { segTA.classList.remove('active'); segInst.classList.add('active'); renderTemplateView('Instructor'); });
    segTA.addEventListener('click', () => { segInst.classList.remove('active'); segTA.classList.add('active'); renderTemplateView('TA'); });

    tplSave.addEventListener('click', () => { Store.saveTemplates(templates); tplModal.classList.remove('open'); showToast('Templates saved'); });
    tplCancel.addEventListener('click', () => { templates = Store.getTemplates(); tplModal.classList.remove('open'); });

    adjustBtn.addEventListener('click', () => openTemplates('Instructor'));

    // Edit per-user modal
    const userModal = document.getElementById('user-modal');
    const userRoleSel = document.getElementById('user-role');
    const userDefaultChk = document.getElementById('user-use-default');
    const userPerms = document.getElementById('user-permissions');
    const userSave = document.getElementById('user-save');
    const userCancel = document.getElementById('user-cancel');
    let editingUserId = null;

    function renderUserPerms(values){
      userPerms.innerHTML = ['Review','Publish','Comment','Admin'].map(p => {
        const checked = values.includes(p) ? 'checked' : '';
        return `<label><input type="checkbox" value="${p}" ${checked}> ${p}</label>`;
      }).join('');
      userPerms.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.addEventListener('change', () => {
          if (box.value === 'Admin' && box.checked){
            userPerms.querySelectorAll('input[type="checkbox"]').forEach(b => { if (b!==box) b.checked = false; });
          } else if (box.value !== 'Admin' && box.checked){
            const admin = userPerms.querySelector('input[value="Admin"]');
            admin.checked = false;
          }
        });
      });
    }

    function openEditUserModal(user){
      editingUserId = user.id;
      userModal.classList.add('open');
      userRoleSel.value = user.role;
      const tpl = templates[user.role] || [];
      const usingDefault = JSON.stringify(user.permissions||[]) === JSON.stringify(tpl);
      userDefaultChk.checked = usingDefault;
      renderUserPerms(usingDefault ? tpl : (user.permissions||[]));
      trapModal(userModal);
    }

    userRoleSel.addEventListener('change', () => {
      const tpl = templates[userRoleSel.value] || [];
      if (userDefaultChk.checked) renderUserPerms(tpl);
    });

    userDefaultChk.addEventListener('change', () => {
      const tpl = templates[userRoleSel.value] || [];
      renderUserPerms(userDefaultChk.checked ? tpl : []);
    });

    userSave.addEventListener('click', () => {
      const list = Store.getUsers();
      const idx = list.findIndex(u => u.id === editingUserId);
      if (idx > -1){
        list[idx].role = userRoleSel.value;
        const tpl = templates[list[idx].role] || [];
        const selected = Array.from(userPerms.querySelectorAll('input[type="checkbox"]:checked')).map(b => b.value);
        list[idx].permissions = userDefaultChk.checked ? tpl : selected;
        Store.saveUsers(list);
        userModal.classList.remove('open');
        render();
      }
    });
    userCancel.addEventListener('click', () => userModal.classList.remove('open'));

    // Move to section modal
    const moveModal = document.getElementById('move-modal');
    const moveSelect = document.getElementById('move-section');
    const moveSave = document.getElementById('move-save');
    const moveCancel = document.getElementById('move-cancel');
    let movingUserId = null;

    function openMoveSectionModal(user){
      movingUserId = user.id;
      const secs = ['L1','L2','L3','—'];
      moveSelect.innerHTML = secs.map(s => `<option value="${s}">${s}</option>`).join('');
      moveSelect.value = user.section;
      moveModal.classList.add('open');
      trapModal(moveModal);
    }

    moveSave.addEventListener('click', () => {
      const list = Store.getUsers();
      const idx = list.findIndex(u => u.id === movingUserId);
      if (idx > -1){
        list[idx].section = moveSelect.value;
        Store.saveUsers(list);
        moveModal.classList.remove('open');
        render();
      }
    });
    moveCancel.addEventListener('click', () => moveModal.classList.remove('open'));

    // Add TA modal
    const addModal = document.getElementById('add-modal');
    const addName = document.getElementById('add-name');
    const addEmail = document.getElementById('add-email');
    const addSection = document.getElementById('add-section');
    const addPerms = document.getElementById('add-perms');
    const addSave = document.getElementById('add-save');
    const addCancel = document.getElementById('add-cancel');

    function openAddTA(){
      const secs = ['L1','L2','L3','—'];
      addSection.innerHTML = secs.map(s => `<option value="${s}">${s}</option>`).join('');
      const tpl = templates['TA'] || [];
      addPerms.innerHTML = ['Review','Publish','Comment','Admin'].map(p => {
        const checked = tpl.includes(p) ? 'checked' : '';
        return `<label><input type="checkbox" value="${p}" ${checked}> ${p}</label>`;
      }).join('');
      addModal.classList.add('open');
      trapModal(addModal);
    }

    addBtn.addEventListener('click', openAddTA);

    addSave.addEventListener('click', () => {
      const name = addName.value.trim();
      const email = addEmail.value.trim();
      if (!name || !email) return;
      const perms = Array.from(addPerms.querySelectorAll('input[type="checkbox"]:checked')).map(b => b.value);
      const newUser = {
        id: 'u' + Date.now(),
        name, email,
        role: 'TA',
        section: addSection.value,
        permissions: perms,
        progress: 0,
        status: 'Pending',
        joined: new Date().toISOString().slice(0,10)
      };
      const list = Store.getUsers();
      list.unshift(newUser);
      Store.saveUsers(list);
      addModal.classList.remove('open');
      render();
      showToast('Invite sent');
    });
    addCancel.addEventListener('click', () => addModal.classList.remove('open'));

    // Filters
    searchInput.addEventListener('input', debounce(e => { filters.q = e.target.value; render(); }, 200));
    roleSel.addEventListener('change', e => { filters.role = e.target.value; render(); });
    sectionSel.addEventListener('change', e => { filters.section = e.target.value; render(); });
    statusSel.addEventListener('change', e => { filters.status = e.target.value; render(); });

    // Close menus on escape globally
    document.addEventListener('keydown', (e) => { if (e.key==='Escape') closeAllMenus(); });

    // Modal focus trap
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

    render();
  }

  document.addEventListener('DOMContentLoaded', initUsers);
})(); 