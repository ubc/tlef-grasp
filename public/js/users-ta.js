(function(){
  // TA Dashboard Data Store
  const taDash = {
    "u1": {
      name: "Alex Rivera", 
      role: "TA",
      metrics: { reviewed: 72, prepared: 40, resolved: 55 },
      weeks: [
        { 
          title: "Week 1 — Photosynthesis",
          items: [
            { id: "m1", type: "material", title: "Lecture 1 Slides", status: "Reviewed", due: "Aug 05" },
            { id: "qsetA", type: "quiz", title: "Question Set A", status: "In progress", due: "Aug 06" }
          ]
        },
        { 
          title: "Week 2 — Forces & Motion",
          items: [
            { id: "m2", type: "material", title: "Lecture 2 Notes", status: "Not started", due: "Aug 12" },
            { id: "qz1", type: "quiz", title: "Quiz Draft #1", status: "In progress", due: "Aug 13" }
          ]
        }
      ]
    },
    "u2": {
      name: "Priya Shah", 
      role: "TA",
      metrics: { reviewed: 41, prepared: 25, resolved: 30 },
      weeks: [
        { 
          title: "Week 1 — Photosynthesis",
          items: [
            { id: "m1", type: "material", title: "Lecture 1 Slides", status: "In progress", due: "Aug 05" },
            { id: "qsetA", type: "quiz", title: "Question Set A", status: "Not started", due: "Aug 06" }
          ]
        }
      ]
    },
    "u4": {
      name: "Mina K.", 
      role: "TA",
      metrics: { reviewed: 0, prepared: 0, resolved: 0 },
      weeks: [
        { 
          title: "Week 1 — Photosynthesis",
          items: [
            { id: "m1", type: "material", title: "Lecture 1 Slides", status: "Not started", due: "Aug 05" }
          ]
        }
      ]
    }
  };

  function initTADashboard(){
    console.log('initTADashboard called');
    console.log('Current URL:', window.location.href);
    console.log('Current pathname:', window.location.pathname);
    
    // Initialize navigation
    if (window.GRASPNavigation) {
      new window.GRASPNavigation();
    }
    
    const pageElement = document.getElementById('ta-dashboard-page');
    if (!pageElement) {
      console.log('ta-dashboard-page element not found');
      return;
    }

    // Extract TA ID from URL
    const pathParts = window.location.pathname.split('/');
    const taId = pathParts[pathParts.length - 1];
    
    console.log('Full pathname:', window.location.pathname);
    console.log('Path parts:', pathParts);
    console.log('TA ID extracted:', taId);
    console.log('Available TAs:', Object.keys(taDash));
    
    const taData = taDash[taId];
    
    if (!taData) {
      console.log('TA data not found for ID:', taId);
      console.log('Using fallback data for testing...');
      // Use fallback data for testing
      const fallbackData = {
        name: "Alex Rivera",
        metrics: { reviewed: 72, prepared: 40, resolved: 55 },
        weeks: [
          { 
            title: "Week 1 — Photosynthesis",
            items: [
              { id: "m1", type: "material", title: "Lecture 1 Slides", status: "Reviewed", due: "Aug 05" },
              { id: "qsetA", type: "quiz", title: "Question Set A", status: "In progress", due: "Aug 06" }
            ]
          },
          { 
            title: "Week 2 — Forces & Motion",
            items: [
              { id: "m2", type: "material", title: "Lecture 2 Notes", status: "Not started", due: "Aug 12" },
              { id: "qz1", type: "quiz", title: "Quiz Draft #1", status: "In progress", due: "Aug 13" }
            ]
          }
        ]
      };
      updateDashboard(fallbackData);
      return;
    }
    
    console.log('TA data found:', taData);
    updateDashboard(taData);
  }
  
  function updateDashboard(taData) {
    // Update page title
    const titleElement = document.getElementById('ta-name');
    if (titleElement) {
      titleElement.textContent = `${taData.name} — TA`;
      console.log('Updated title to:', titleElement.textContent);
    }
    
    // Update metrics
    updateMetrics(taData.metrics);
    
    // Render week cards
    renderWeekCards(taData.weeks);
  }

  function updateMetrics(metrics) {
    console.log('Updating metrics with:', metrics);
    
    // Questions Reviewed
    const reviewedProgress = document.querySelector('#reviewed-pct').parentElement.querySelector('.progress');
    const reviewedFill = reviewedProgress.querySelector('.fill');
    const reviewedPct = document.getElementById('reviewed-pct');
    
    reviewedProgress.setAttribute('aria-valuenow', metrics.reviewed);
    reviewedFill.style.width = `${metrics.reviewed}%`;
    reviewedPct.textContent = `${metrics.reviewed}%`;

    // Quizzes Prepared
    const preparedProgress = document.querySelector('#prepared-pct').parentElement.querySelector('.progress');
    const preparedFill = preparedProgress.querySelector('.fill');
    const preparedPct = document.getElementById('prepared-pct');
    
    preparedProgress.setAttribute('aria-valuenow', metrics.prepared);
    preparedFill.style.width = `${metrics.prepared}%`;
    preparedPct.textContent = `${metrics.prepared}%`;

    // Flagged Items Resolved
    const resolvedProgress = document.querySelector('#resolved-pct').parentElement.querySelector('.progress');
    const resolvedFill = resolvedProgress.querySelector('.fill');
    const resolvedPct = document.getElementById('resolved-pct');
    
    resolvedProgress.setAttribute('aria-valuenow', metrics.resolved);
    resolvedFill.style.width = `${metrics.resolved}%`;
    resolvedPct.textContent = `${metrics.resolved}%`;
  }

  function renderWeekCards(weeks) {
    const container = document.getElementById('weeks-container');
    
    container.innerHTML = weeks.map(week => `
      <div class="week-card">
        <h2 class="week-header">${week.title}</h2>
        <div class="week-items">
          ${week.items.map((item, index) => `
            <div class="week-item">
              <div class="item-left">
                <div class="item-title">${item.title}</div>
                <div class="item-sub">
                  Status: <span class="status-${item.status.toLowerCase().replace(/\s+/g, '-')}">${item.status}</span> • Due: ${item.due}
                </div>
              </div>
              <button class="btn btn-small" onclick="handleViewDetails('${item.type}', '${item.id}')">
                View Details
              </button>
            </div>
            ${index < week.items.length - 1 ? '<div class="divider"></div>' : ''}
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  function showEmptyState() {
    console.log('Showing empty state');
    const weeksContainer = document.getElementById('weeks-container');
    const emptyState = document.getElementById('empty-state');
    if (weeksContainer) weeksContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
  }

  // Handle View Details button clicks
  window.handleViewDetails = function(type, id) {
    if (type === 'material') {
      // Navigate to course materials
      window.location.href = `/course-materials/${id}`;
    } else if (type === 'quiz') {
      // Navigate to quiz review or show placeholder
      showToast('Quiz review functionality coming soon');
    }
  };

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', function() {
    console.log('TA Dashboard script loaded');
    // Force update the page immediately
    setTimeout(() => {
      initTADashboard();
    }, 100);
  });
  
  // Also try to initialize immediately if DOM is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTADashboard);
  } else {
    initTADashboard();
  }
})();
