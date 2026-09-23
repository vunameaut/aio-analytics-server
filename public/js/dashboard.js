// State Management
const AppState = {
  currentTab: 'overview',
  activeProjectId: null,
  activePlatformSnippet: 'web',
  projects: [],
  overview: null,
  chartInstance: null,
  sseConnection: null,
  searchQuery: ''
};

// Utilities
function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return new Intl.NumberFormat('vi-VN').format(num);
}

function timeAgo(dateString) {
  if (!dateString) return 'Chưa rõ';
  const diff = Date.now() - new Date(dateString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Vừa xong';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function getPlatformIcon(platform) {
  switch (platform) {
    case 'web': return '🌐';
    case 'mobile_android': return '🤖';
    case 'mobile_ios': return '🍎';
    case 'desktop': return '💻';
    case 'backend': return '⚙️';
    default: return '📦';
  }
}

function getPlatformLabel(platform) {
  switch (platform) {
    case 'web': return 'Web App';
    case 'mobile_android': return 'Android App';
    case 'mobile_ios': return 'iOS App';
    case 'desktop': return 'Desktop App';
    case 'backend': return 'Backend API';
    default: return platform;
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupIntegrationHub();
  setupSearch();
  loadOverview();
  loadProjects();
  initRealtimeSSE();
});

// Real-time Server-Sent Events (SSE)
function initRealtimeSSE() {
  if (window.EventSource) {
    AppState.sseConnection = new EventSource('/api/v1/dashboard/realtime');
    
    AppState.sseConnection.addEventListener('event', (e) => {
      try {
        const data = JSON.parse(e.data);
        handleLiveEvent(data);
      } catch (err) {
        console.error('Lỗi phân tích SSE:', err);
      }
    });

    AppState.sseConnection.onerror = () => {
      document.getElementById('liveStatusText').textContent = 'Live: Đang kết nối lại...';
      document.getElementById('liveStatusDot').style.backgroundColor = '#f59e0b';
    };

    AppState.sseConnection.onopen = () => {
      document.getElementById('liveStatusText').textContent = 'Live System: Trực tuyến';
      document.getElementById('liveStatusDot').style.backgroundColor = '#10b981';
    };
  }
}

function handleLiveEvent(data) {
  // 1. Thêm vào Live Stream Feed
  const streamContainer = document.getElementById('liveStreamFeed');
  if (streamContainer) {
    const item = document.createElement('div');
    item.className = 'stream-item';
    const isErr = data.isError;
    const icon = isErr ? '⚠️' : getPlatformIcon(data.platform);
    const timeStr = new Date(data.timestamp).toLocaleTimeString('vi-VN');

    item.innerHTML = `
      <div class="stream-left">
        <div class="stream-icon" style="background:${isErr ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.05)'}">
          ${icon}
        </div>
        <div class="stream-meta">
          <div class="stream-name">
            ${escapeHtml(data.projectName || data.projectId)} 
            <span class="platform-chip ${data.platform}" style="display:inline-flex;margin-left:6px;font-size:0.68rem;padding:1px 6px;">
              ${getPlatformLabel(data.platform)}
            </span>
          </div>
          <div class="stream-desc">
            ${escapeHtml(data.eventName)} &bull; <span style="font-family:monospace">${escapeHtml(data.pathOrScreen || '/')}</span>
          </div>
        </div>
      </div>
      <div class="stream-right">
        <span class="stream-time">${timeStr}</span>
      </div>
    `;

    streamContainer.insertBefore(item, streamContainer.firstChild);

    // Giữ tối đa 50 sự kiện trên feed
    if (streamContainer.children.length > 50) {
      streamContainer.removeChild(streamContainer.lastChild);
    }
  }

  // 2. Cập nhật số đếm nhanh trên KPI
  const kpiEvents = document.getElementById('kpiEvents24h');
  if (kpiEvents) {
    const current = parseInt(kpiEvents.getAttribute('data-val') || '0', 10);
    kpiEvents.setAttribute('data-val', current + 1);
    kpiEvents.textContent = formatNumber(current + 1);
  }

  // Nếu đang xem chi tiết dự án này, làm mới dự án
  if (AppState.currentTab === 'detail' && AppState.activeProjectId === data.projectId) {
    loadProjectDetail(data.projectId, false);
  }
}

// Load Overview Metrics
async function loadOverview() {
  try {
    const res = await fetch('/api/v1/dashboard/overview');
    const data = await res.json();
    AppState.overview = data;

    document.getElementById('kpiActiveNow').textContent = formatNumber(data.activeNow);
    document.getElementById('kpiTotalProjects').textContent = formatNumber(data.totalProjects);
    
    const kpiEvents = document.getElementById('kpiEvents24h');
    kpiEvents.textContent = formatNumber(data.events24h);
    kpiEvents.setAttribute('data-val', data.events24h);

    document.getElementById('kpiErrors24h').textContent = formatNumber(data.errors24h);

    // Platform distribution
    const distContainer = document.getElementById('platformDistributionBadges');
    if (distContainer && data.platformsDistribution) {
      distContainer.innerHTML = data.platformsDistribution.map(p => `
        <span class="platform-chip ${p.platform}">
          ${getPlatformIcon(p.platform)} ${getPlatformLabel(p.platform)}: <strong>${formatNumber(p.sessions_count)}</strong>
        </span>
      `).join('');
    }
  } catch (err) {
    console.error('Lỗi tải overview:', err);
  }
}

// Load All Projects
async function loadProjects() {
  try {
    const res = await fetch('/api/v1/dashboard/projects');
    const data = await res.json();
    AppState.projects = data;
    renderProjectsList();
  } catch (err) {
    console.error('Lỗi tải danh sách dự án:', err);
  }
}

function renderProjectsList() {
  const container = document.getElementById('projectsGrid');
  if (!container) return;

  const query = AppState.searchQuery.toLowerCase();
  const filtered = AppState.projects.filter(p => 
    p.name.toLowerCase().includes(query) || 
    p.id.toLowerCase().includes(query) ||
    (p.platform_type && p.platform_type.toLowerCase().includes(query))
  );

  document.getElementById('projectsCountBadge').textContent = `${filtered.length} dự án`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <p style="font-size:1.1rem;margin-bottom:8px">Chưa có dự án nào</p>
        <span style="font-size:0.85rem">Nhúng đoạn mã theo dõi vào ứng dụng của bạn để hệ thống tự động ghi nhận!</span>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const statusClass = `status-${p.status}`;
    const statusText = p.status === 'active' ? 'Đang chạy' : (p.status === 'idle' ? 'Hoạt động gần đây' : 'Tạm dừng');
    
    const platforms = p.platforms_seen || [p.platform_type];
    const platformChips = platforms.map(plat => `
      <span class="platform-chip ${plat}">
        ${getPlatformIcon(plat)} ${getPlatformLabel(plat)}
      </span>
    `).join('');

    return `
      <div class="project-card" onclick="viewProjectDetail('${escapeHtml(p.id)}')">
        <div>
          <div class="project-top">
            <div>
              <div class="project-name">${escapeHtml(p.name)}</div>
              <div class="project-id-badge">ID: ${escapeHtml(p.id)}</div>
            </div>
            <span class="status-badge ${statusClass}">
              <span class="pulse-dot" style="width:6px;height:6px;background:currentColor"></span>
              ${statusText}
            </span>
          </div>

          <div class="platform-chips">
            ${platformChips}
          </div>

          <div class="project-stats-row">
            <div class="pstat">
              <span class="pstat-label">Đang online</span>
              <span class="pstat-val" style="color:#34d399">${formatNumber(p.active_now || 0)}</span>
            </div>
            <div class="pstat">
              <span class="pstat-label">Sự kiện</span>
              <span class="pstat-val">${formatNumber(p.total_events || 0)}</span>
            </div>
            <div class="pstat">
              <span class="pstat-label">Lỗi</span>
              <span class="pstat-val" style="color:${(p.total_errors > 0 ? '#f43f5e' : '#94a3b8')}">${formatNumber(p.total_errors || 0)}</span>
            </div>
          </div>
        </div>

        <div class="project-card-footer">
          <span>Hoạt động: ${timeAgo(p.last_seen_at)}</span>
          <span style="color:var(--accent-cyan);font-weight:500">Xem chi tiết &rarr;</span>
        </div>
      </div>
    `;
  }).join('');
}

// Project Detail View
async function viewProjectDetail(projectId) {
  AppState.activeProjectId = projectId;
  switchTab('detail');
  loadProjectDetail(projectId, true);
}

async function loadProjectDetail(projectId, scrollToTop = true) {
  try {
    const res = await fetch(`/api/v1/dashboard/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error('Không tìm thấy dự án');
    const data = await res.json();
    renderProjectDetail(data);

    if (scrollToTop) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (err) {
    console.error('Lỗi tải chi tiết dự án:', err);
  }
}

function renderProjectDetail(data) {
  const { project, timeline, topPages, devices, operatingSystems, browsers, recentEvents, recentErrors } = data;

  document.getElementById('detailProjectTitle').textContent = project.name;
  document.getElementById('detailProjectId').textContent = `ID: ${project.id}`;
  document.getElementById('detailActiveNow').textContent = formatNumber(project.active_now);
  document.getElementById('detailTotalEvents').textContent = formatNumber(project.total_events);
  document.getElementById('detailTotalSessions').textContent = formatNumber(project.total_sessions);
  document.getElementById('detailTotalErrors').textContent = formatNumber(project.total_errors);

  // Platform chips
  const platforms = project.platforms_seen || [project.platform_type];
  document.getElementById('detailPlatforms').innerHTML = platforms.map(plat => `
    <span class="platform-chip ${plat}">
      ${getPlatformIcon(plat)} ${getPlatformLabel(plat)}
    </span>
  `).join('');

  // Timeline Chart
  renderTimelineChart(timeline);

  // Top Pages / Screens
  const topPagesContainer = document.getElementById('topPagesList');
  if (topPagesContainer) {
    if (topPages.length === 0) {
      topPagesContainer.innerHTML = '<tr><td colspan="3" style="text-align:center">Chưa có dữ liệu</td></tr>';
    } else {
      const maxViews = Math.max(...topPages.map(p => p.views), 1);
      topPagesContainer.innerHTML = topPages.map(p => {
        const pct = Math.round((p.views / maxViews) * 100);
        return `
          <tr>
            <td style="font-family:monospace;color:#fff">${escapeHtml(p.path_or_screen)}</td>
            <td style="width:160px">
              <div class="progress-container">
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
              </div>
            </td>
            <td style="text-align:right;font-weight:600">${formatNumber(p.views)}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Breakdown tables (Devices, OS, Browsers)
  renderBreakdownTable('devicesList', devices, 'device_type');
  renderBreakdownTable('osList', operatingSystems, 'os_name');
  renderBreakdownTable('browsersList', browsers, 'browser_name');

  // Recent Events
  const eventsTable = document.getElementById('recentEventsList');
  if (eventsTable) {
    if (recentEvents.length === 0) {
      eventsTable.innerHTML = '<tr><td colspan="4" style="text-align:center">Chưa có sự kiện nào</td></tr>';
    } else {
      eventsTable.innerHTML = recentEvents.map(evt => {
        let propsStr = '';
        try {
          if (evt.properties) propsStr = JSON.stringify(JSON.parse(evt.properties));
        } catch (e) {
          propsStr = evt.properties || '';
        }

        return `
          <tr>
            <td style="white-space:nowrap;font-family:monospace">${new Date(evt.created_at).toLocaleTimeString('vi-VN')}</td>
            <td><span class="badge" style="font-size:0.75rem">${escapeHtml(evt.event_type)}</span></td>
            <td style="color:#fff;font-weight:500">${escapeHtml(evt.event_name)}</td>
            <td style="font-family:monospace;font-size:0.78rem;color:var(--text-dim)">${escapeHtml(evt.path_or_screen || '/')} ${propsStr ? `(${escapeHtml(propsStr)})` : ''}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Error Logs
  const errorsContainer = document.getElementById('recentErrorsList');
  if (errorsContainer) {
    if (recentErrors.length === 0) {
      errorsContainer.innerHTML = '<div style="color:var(--text-dim);padding:1rem 0;text-align:center">Tuyệt vời! Không có lỗi nào được ghi nhận.</div>';
    } else {
      errorsContainer.innerHTML = recentErrors.map(err => `
        <div class="error-card">
          <div class="error-header">
            <span class="error-msg">⚠️ ${escapeHtml(err.message)}</span>
            <span style="font-size:0.75rem;color:var(--text-dim)">${timeAgo(err.created_at)}</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted)">Tại: <code style="color:#fff">${escapeHtml(err.url_or_screen || 'Unknown')}</code></div>
          ${err.stack ? `<div class="error-stack">${escapeHtml(err.stack)}</div>` : ''}
        </div>
      `).join('');
    }
  }
}

function renderBreakdownTable(elementId, items, keyName) {
  const container = document.getElementById(elementId);
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-dim)">Không có dữ liệu</td></tr>';
    return;
  }
  container.innerHTML = items.map(item => `
    <tr>
      <td style="color:#fff">${escapeHtml(item[keyName] || 'Không xác định')}</td>
      <td style="text-align:right;font-weight:600">${formatNumber(item.count)}</td>
    </tr>
  `).join('');
}

function renderTimelineChart(timeline) {
  const canvas = document.getElementById('timelineChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (AppState.chartInstance) {
    AppState.chartInstance.destroy();
  }

  const labels = timeline.map(t => t.date);
  const eventsData = timeline.map(t => t.count);
  const visitorsData = timeline.map(t => t.visitors);

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
  gradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

  const gradient2 = ctx.createLinearGradient(0, 0, 0, 300);
  gradient2.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
  gradient2.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  AppState.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Hôm nay'],
      datasets: [
        {
          label: 'Lượt sự kiện (Events)',
          data: eventsData.length ? eventsData : [0],
          borderColor: '#06b6d4',
          backgroundColor: gradient,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#06b6d4',
        },
        {
          label: 'Người dùng truy cập (Visitors)',
          data: visitorsData.length ? visitorsData : [0],
          borderColor: '#10b981',
          backgroundColor: gradient2,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleFont: { family: 'Inter', weight: 'bold' },
          bodyFont: { family: 'Inter' },
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter' } }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'Inter' }, precision: 0 }
        }
      }
    }
  });
}

// Delete Project
async function deleteCurrentProject() {
  if (!AppState.activeProjectId) return;
  const confirmed = confirm(`Bạn có chắc chắn muốn xóa dự án "${AppState.activeProjectId}" và toàn bộ dữ liệu thống kê liên quan?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/v1/dashboard/projects/${encodeURIComponent(AppState.activeProjectId)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      alert('Đã xóa dự án thành công');
      switchTab('overview');
      loadOverview();
      loadProjects();
    }
  } catch (err) {
    alert('Lỗi khi xóa dự án: ' + err.message);
  }
}

// Navigation & Tabs
function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });
}

function switchTab(tabName) {
  AppState.currentTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  const views = ['overview', 'detail', 'stream', 'integration'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      el.style.display = (v === tabName) ? 'block' : 'none';
    }
  });

  if (tabName === 'overview') {
    loadOverview();
    loadProjects();
  }
}

// Integration Hub
function setupIntegrationHub() {
  const platformBtns = document.querySelectorAll('.platform-nav-btn');
  platformBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      platformBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.activePlatformSnippet = btn.getAttribute('data-platform');
      updateCodeSnippet();
    });
  });

  const pidInput = document.getElementById('snippetProjectIdInput');
  if (pidInput) {
    pidInput.addEventListener('input', () => {
      updateCodeSnippet();
    });
  }

  updateCodeSnippet();
}

function updateCodeSnippet() {
  const pidInput = document.getElementById('snippetProjectIdInput');
  const customId = pidInput ? pidInput.value.trim() : 'my-awesome-app';
  const code = SnippetGenerator.getSnippet(AppState.activePlatformSnippet, window.location.origin, customId || 'my-awesome-app');
  
  const pre = document.getElementById('snippetCodePre');
  if (pre) {
    pre.textContent = code;
  }
}

function copyCodeSnippet() {
  const pre = document.getElementById('snippetCodePre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    const btn = document.getElementById('copySnippetBtn');
    if (btn) {
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '✓ Đã sao chép!';
      btn.style.color = '#34d399';
      setTimeout(() => {
        btn.innerHTML = oldHtml;
        btn.style.color = '';
      }, 2000);
    }
  });
}

// Search
function setupSearch() {
  const input = document.getElementById('projectSearchInput');
  if (input) {
    input.addEventListener('input', (e) => {
      AppState.searchQuery = e.target.value;
      renderProjectsList();
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
