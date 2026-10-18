(function () {
  'use strict';

  // ===== 상태 변수 =====
  let token = localStorage.getItem('admin_token');
  let currentTab = 'list'; // 'list' | 'stats'
  let currentStatus = 'all';
  let reservations = [];
  let stats = null;
  let settings = null;
  let detailModalOpen = false;
  let detailTargetId = null;
  let settingsModalOpen = false;
  let idleTimer = null;

  const STATUS_LABELS = {
    requested: '신청됨', calling: '통화중', confirmed: '확정됨',
    completed: '완료', no_show: '미방문', cancelled: '취소됨'
  };

  const STATUSES = ['requested', 'calling', 'confirmed', 'completed', 'no_show', 'cancelled'];

  // ===== API =====
  const api = {
    post: (url, data) => fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    get: (url) => fetch(url, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
    patch: (url, data) => fetch(url, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (url) => fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
    put: (url, data) => fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
  };

  // ===== 유휴 로그아웃 =====
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      token = null;
      localStorage.removeItem('admin_token');
      showToast('20분간 활동이 없어 자동 로그아웃되었습니다.');
      render();
    }, 20 * 60 * 1000);
  }

  ['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
    document.addEventListener(evt, () => { if (token) resetIdleTimer(); }, { passive: true });
  });

  // ===== 시간 슬롯 =====
  function generateTimeSlots() {
    const slots = [];
    for (let m = 9 * 60; m <= 19 * 60; m += 30) {
      const h = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      slots.push(`${h}:${mm}`);
    }
    return slots;
  }

  const timeSlots = generateTimeSlots();

  // ===== 포맷팅 =====
  function maskContact(c) {
    const d = c.replace(/\D/g, '');
    return d.length === 11 ? `${d.slice(0, 3)}-****-${d.slice(7)}` : c;
  }

  function formatTimeLabel(v) {
    if (v === 'any') return '시간 무관';
    const [h, m] = v.split(':');
    const hour12 = ((parseInt(h) + 11) % 12) + 1;
    const ampm = parseInt(h) < 12 ? '오전' : '오후';
    return `${ampm} ${hour12}:${m}`;
  }

  // ===== UI 함수 =====
  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ===== 로그인 화면 =====
  function renderLogin() {
    return `
      <div class="page">
        <section class="hero" style="min-height: 100vh; display: flex; align-items: center; justify-content: center;">
          <div class="card form-card" style="max-width: 300px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 32px;">
              <i class="fas fa-calendar" style="font-size: 48px; color: var(--primary); margin-bottom: 16px;"></i>
              <h2>관리자 로그인</h2>
            </div>
            <form id="loginForm">
              <div class="form-group">
                <label>비밀번호</label>
                <input type="password" id="admin_password" required>
              </div>
              <button type="submit" class="btn btn-primary btn-full">로그인</button>
            </form>
            <div style="text-align: center; margin-top: 16px;">
              <a href="/" class="btn btn-outline btn-sm">홈페이지로</a>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  // ===== 대시보드 =====
  function renderDashboard() {
    const dash = localStorage.getItem('admin_dashboard') ? JSON.parse(localStorage.getItem('admin_dashboard')) : { today_requested: 0, not_called_yet: 0, confirmed: 0, completed_this_month: 0 };

    const statCards = [
      { label: '오늘 신청', value: dash.today_requested, icon: 'fa-plus-circle' },
      { label: '통화 전', value: dash.not_called_yet, icon: 'fa-phone-slash' },
      { label: '확정됨', value: dash.confirmed, icon: 'fa-check-circle' },
      { label: '이달 완료', value: dash.completed_this_month, icon: 'fa-check-double' }
    ];

    return `
      <div class="page">
        <div style="background-color: var(--card); border-bottom: 1px solid var(--border); padding: 16px 20px; display: flex; justify-content: space-between; align-items: center;">
          <h1 style="font-size: 20px; margin: 0;">방문예약 관리</h1>
          <div style="display: flex; gap: 12px;">
            <button class="btn btn-outline btn-sm" onclick="openSettings()">⚙️ 설정</button>
            <button class="btn btn-danger btn-sm" onclick="logout()">로그아웃</button>
          </div>
        </div>

        <div style="flex: 1; overflow-y: auto;">
          <div class="container">
            <div class="stat-grid" style="margin-top: 24px;">
              ${statCards.map(s => `
                <div class="stat-card">
                  <div class="stat-label"><i class="fas ${s.icon}"></i> ${s.label}</div>
                  <div class="stat-value">${s.value}</div>
                </div>
              `).join('')}
            </div>

            <div class="tabs" style="margin-top: 32px;">
              <button class="tab-button ${currentTab === 'list' ? 'active' : ''}" onclick="switchTab('list')">예약 목록</button>
              <button class="tab-button ${currentTab === 'stats' ? 'active' : ''}" onclick="switchTab('stats')">통계·분석</button>
            </div>

            <div class="tab-panel ${currentTab === 'list' ? 'active' : ''}">
              ${renderListTab()}
            </div>

            <div class="tab-panel ${currentTab === 'stats' ? 'active' : ''}">
              ${renderStatsTab()}
            </div>
          </div>
        </div>

        <div class="footer">
          <div style="font-size: 12px; color: var(--text-muted);">20분간 활동이 없으면 자동 로그아웃됩니다</div>
        </div>
      </div>

      ${renderDetailModal()}
      ${renderSettingsModal()}
    `;
  }

  function renderListTab() {
    const statusTabs = ['all', ...STATUSES];

    return `
      <div class="tabs" style="margin-bottom: 24px; border-bottom: 1px solid var(--border);">
        ${statusTabs.map(s => `
          <button class="tab-button ${currentStatus === s ? 'active' : ''}" onclick="filterStatus('${s}')">
            ${s === 'all' ? '전체' : STATUS_LABELS[s]}
          </button>
        `).join('')}
      </div>

      <div class="filter-bar">
        <div class="filter-group" style="flex: 1;">
          <label>검색</label>
          <input type="text" id="search_input" placeholder="이름/연락처">
        </div>
        <button class="btn btn-outline btn-sm" onclick="loadReservations()">🔍 검색</button>
        <button class="btn btn-outline btn-sm" onclick="loadReservations()">🔄 새로고침</button>
      </div>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>방문일 / 시간</th>
              <th>고객</th>
              <th>신청일</th>
              <th>상태</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            ${(reservations || []).map(r => {
              const visitDate = r.confirmed_date || r.preferred_date || '-';
              const visitTime = r.confirmed_time || r.preferred_time || '-';
              const dateLabel = r.confirmed_date ? '(확정)' : r.preferred_date ? '(희망)' : '';
              return `
                <tr>
                  <td>${visitDate} ${visitTime} ${dateLabel}</td>
                  <td>${r.customer_name}<br/><small style="color: var(--text-muted);">${r.contact_masked}</small></td>
                  <td>${r.created_at?.split('T')[0]}</td>
                  <td>
                    <select onchange="changeStatus(${r.id}, this.value)" style="background-color: var(--input-bg);">
                      ${STATUSES.map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <button class="btn btn-outline btn-sm" onclick="openDetail(${r.id})">상세</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteReservation(${r.id})">삭제</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderStatsTab() {
    if (!stats) return '<div style="text-align: center; padding: 40px;">통계 로딩 중...</div>';

    const convCard = stats.conversion || {};

    return `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">전체 예약</div>
          <div class="stat-value">${convCard.total || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">완료 전환율</div>
          <div class="stat-value">${(convCard.completion_rate || 0).toFixed(1)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">노쇼율</div>
          <div class="stat-value">${(convCard.no_show_rate || 0).toFixed(1)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">취소</div>
          <div class="stat-value">${convCard.cancelled || 0}</div>
        </div>
      </div>

      <div class="chart-card">
        <h3>월별 예약 추이</h3>
        <canvas id="monthlyChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>요일별 방문 분포</h3>
        <canvas id="weekdayChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>시간대별 방문 분포</h3>
        <canvas id="hourlyChart"></canvas>
      </div>

      <div class="card">
        <h3 style="margin-bottom: 16px;">미방문 고객 목록</h3>
        <table>
          <thead><tr><th>성명</th><th>연락처</th><th>확정일</th><th>시간</th></tr></thead>
          <tbody>
            ${(stats.no_show_list || []).map(r => `
              <tr>
                <td>${r.customer_name}</td>
                <td>${r.contact}</td>
                <td>${r.confirmed_date}</td>
                <td>${r.confirmed_time}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDetailModal() {
    if (!detailModalOpen || !detailTargetId) return '';

    const r = reservations.find(x => x.id === detailTargetId);
    if (!r) return '';

    const timeOptsHtml = timeSlots.map(t => `<option value="${t}" ${t === r.confirmed_time ? 'selected' : ''}>${formatTimeLabel(t)}</option>`).join('');

    return `
      <div class="modal-overlay" id="detailModal" onclick="if(event.target.id === 'detailModal') closeDetail()">
        <div class="modal-content">
          <div class="modal-header">
            <h2>예약 상세 (ID: ${r.id})</h2>
            <button class="modal-close" onclick="closeDetail()">✕</button>
          </div>
          <div class="modal-body">
            <!-- 고객 정보 -->
            <h3 style="margin-top: 0; font-size: 16px; margin-bottom: 12px;">고객 정보</h3>
            <div style="background-color: var(--input-bg); padding: 12px; border-radius: 4px; margin-bottom: 16px; font-size: 13px;">
              <div>성명: <strong>${r.customer_name}</strong></div>
              <div>연락처: <strong>${r.contact}</strong></div>
              <div>희망일시: <strong>${r.preferred_date || '-'} ${r.preferred_time || '-'}</strong></div>
              <div>신청일: <strong>${r.created_at?.split('T')[0]}</strong></div>
              <div>메모: ${r.customer_memo || '-'}</div>
              <div>상태: <strong>${STATUS_LABELS[r.status]}</strong></div>
            </div>

            <!-- 통화 기록 -->
            <h3 style="font-size: 16px; margin-bottom: 12px; margin-top: 24px;">통화 기록</h3>
            <div class="form-group">
              <label><input type="checkbox" id="called_check" ${r.call_at ? 'checked' : ''} onchange="toggleCallInfo()"> 통화함</label>
            </div>
            <div id="callInfo" style="${r.call_at ? '' : 'display: none;'}">
              <div class="form-group">
                <label>통화 일시</label>
                <input type="datetime-local" id="call_at" value="${r.call_at ? r.call_at.replace(' ', 'T').split('.')[0] : ''}">
              </div>
              <div class="form-group">
                <label>통화 메모</label>
                <textarea id="call_memo">${r.call_memo || ''}</textarea>
              </div>
              <button class="btn btn-outline btn-sm" onclick="saveCallInfo(${r.id})">저장</button>
            </div>

            <!-- 확정 정보 -->
            <h3 style="font-size: 16px; margin-bottom: 12px; margin-top: 24px;">확정 정보</h3>
            <div class="form-group">
              <label>확정 방문일</label>
              <input type="date" id="confirmed_date" value="${r.confirmed_date || ''}">
            </div>
            <div class="form-group">
              <label>확정 방문시간</label>
              <select id="confirmed_time">
                <option value="">선택 안 함</option>
                ${timeOptsHtml}
              </select>
            </div>
            <button class="btn btn-outline btn-sm" onclick="saveConfirmedInfo(${r.id})">저장</button>
            ${['confirmed', 'completed'].includes(r.status) ? `<button class="btn btn-primary btn-sm" onclick="generateCertificate(${r.id})" style="margin-left: 8px;">확인증 생성</button>` : ''}

            <!-- 상태 변경 -->
            <h3 style="font-size: 16px; margin-bottom: 12px; margin-top: 24px;">상태 변경</h3>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px;">
              ${STATUSES.map(s => `
                <button class="btn ${s === r.status ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="changeStatus(${r.id}, '${s}')">
                  ${STATUS_LABELS[s]}
                </button>
              `).join('')}
            </div>

            <!-- 내부 메모 -->
            <h3 style="font-size: 16px; margin-bottom: 12px; margin-top: 24px;">관리자 메모</h3>
            <textarea id="admin_note" style="margin-bottom: 12px;">${r.admin_note || ''}</textarea>
            <button class="btn btn-outline btn-sm" onclick="saveAdminNote(${r.id})">저장</button>

            <!-- 삭제 -->
            <h3 style="font-size: 16px; margin-bottom: 12px; margin-top: 24px;">위험 영역</h3>
            <button class="btn btn-danger btn-sm" onclick="deleteReservation(${r.id})">예약 삭제</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSettingsModal() {
    if (!settingsModalOpen) return '';

    return `
      <div class="modal-overlay" id="settingsModal" onclick="if(event.target.id === 'settingsModal') closeSettings()">
        <div class="modal-content">
          <div class="modal-header">
            <h2>설정</h2>
            <button class="modal-close" onclick="closeSettings()">✕</button>
          </div>
          <div class="modal-body">
            <h3 style="margin-top: 0; font-size: 16px; margin-bottom: 12px;">매장 설정</h3>
            <div class="form-group">
              <label>상호명</label>
              <input type="text" id="set_shop_name" value="${settings?.shop_name || ''}">
            </div>
            <div class="form-group">
              <label>소개 문구</label>
              <input type="text" id="set_shop_desc" value="${settings?.shop_desc || ''}">
            </div>
            <div class="form-group">
              <label>대표번호</label>
              <input type="text" id="set_contact_phone" placeholder="1555-3007" value="${settings?.contact_phone || ''}">
              <div class="phone-hint">고객 페이지 하단에 표시됩니다</div>
            </div>
            <div class="form-group">
              <label>영업시간</label>
              <input type="time" id="set_open_time" value="${settings?.open_time || '09:00'}">
              <input type="time" id="set_close_time" value="${settings?.close_time || '19:00'}" style="margin-left: 8px;">
            </div>
            <button class="btn btn-primary btn-sm" onclick="saveSettings()">저장</button>

            <hr style="border: 1px solid var(--border); margin: 24px 0;">

            <h3 style="font-size: 16px; margin-bottom: 12px;">비밀번호 변경</h3>
            <div class="form-group">
              <label>현재 비밀번호</label>
              <input type="password" id="pwd_current" required>
            </div>
            <div class="form-group">
              <label>새 비밀번호</label>
              <input type="password" id="pwd_new" required>
              <div class="phone-hint">4자 이상</div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="changePassword()">변경</button>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const app = document.getElementById('admin-app');
    app.innerHTML = token ? renderDashboard() : renderLogin();

    if (token && currentTab === 'stats') {
      setTimeout(() => renderCharts(), 100);
    }
  }

  function renderCharts() {
    if (!stats) return;

    const ctx1 = document.getElementById('monthlyChart');
    const ctx2 = document.getElementById('weekdayChart');
    const ctx3 = document.getElementById('hourlyChart');

    if (ctx1) {
      new Chart(ctx1, {
        type: 'line',
        data: {
          labels: (stats.monthly || []).map(m => m.month),
          datasets: [{
            label: '예약 수',
            data: (stats.monthly || []).map(m => m.count),
            borderColor: '#b3956a',
            backgroundColor: 'rgba(179, 149, 106, 0.1)',
            tension: 0.4
          }]
        },
        options: { responsive: true, plugins: { legend: { display: true } } }
      });
    }

    if (ctx2) {
      new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: ['일', '월', '화', '수', '목', '금', '토'],
          datasets: [{
            label: '예약 수',
            data: (stats.weekday || []).map(w => ({ x: parseInt(w.dow), y: w.count })).sort((a, b) => a.x - b.x).map(d => d.y),
            backgroundColor: '#8a8f99'
          }]
        },
        options: { responsive: true, plugins: { legend: { display: true } } }
      });
    }

    if (ctx3) {
      new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: (stats.hourly || []).map(h => `${h.hour}시`),
          datasets: [{
            label: '예약 수',
            data: (stats.hourly || []).map(h => h.count),
            backgroundColor: '#d4b483'
          }]
        },
        options: { responsive: true, plugins: { legend: { display: true } } }
      });
    }
  }

  // ===== 이벤트 핸들러 =====
  window.submitLogin = async (e) => {
    e.preventDefault();
    const pwd = document.getElementById('admin_password').value;
    try {
      const result = await api.post('/api/admin/login', { password: pwd });
      if (result.success) {
        token = result.token;
        localStorage.setItem('admin_token', token);
        resetIdleTimer();
        await loadDashboard();
        render();
      } else {
        alert(result.error || '로그인 실패');
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.logout = async () => {
    if (token) {
      try {
        await api.post('/api/admin/logout', {});
      } catch (e) { }
    }
    token = null;
    localStorage.removeItem('admin_token');
    render();
  };

  window.loadDashboard = async () => {
    if (!token) return;
    try {
      const dash = await api.get('/api/admin/dashboard');
      localStorage.setItem('admin_dashboard', JSON.stringify(dash));
      await loadReservations();
      await loadStats();
      await loadSettings();
    } catch (e) {
      console.error('대시보드 로드 오류:', e);
    }
  };

  window.loadReservations = async () => {
    if (!token) return;
    try {
      const search = document.getElementById('search_input')?.value || '';
      const result = await api.get(`/api/admin/reservations?status=${currentStatus}&search=${search}`);
      reservations = result.reservations || [];
      render();
    } catch (e) {
      console.error('예약 목록 로드 오류:', e);
    }
  };

  window.loadStats = async () => {
    if (!token) return;
    try {
      stats = await api.get('/api/admin/stats');
      render();
    } catch (e) {
      console.error('통계 로드 오류:', e);
    }
  };

  window.loadSettings = async () => {
    if (!token) return;
    try {
      settings = await api.get('/api/admin/settings');
    } catch (e) {
      console.error('설정 로드 오류:', e);
    }
  };

  window.switchTab = (tab) => {
    currentTab = tab;
    render();
  };

  window.filterStatus = (status) => {
    currentStatus = status;
    loadReservations();
  };

  window.changeStatus = async (id, status) => {
    try {
      await api.patch(`/api/admin/reservations/${id}`, { status });
      showToast('상태가 변경되었습니다');
      await loadDashboard();
      if (detailModalOpen && detailTargetId === id) {
        openDetail(id);
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.openDetail = (id) => {
    detailTargetId = id;
    detailModalOpen = true;
    render();
  };

  window.closeDetail = () => {
    detailModalOpen = false;
    detailTargetId = null;
    render();
  };

  window.toggleCallInfo = () => {
    const checked = document.getElementById('called_check').checked;
    document.getElementById('callInfo').style.display = checked ? 'block' : 'none';
  };

  window.saveCallInfo = async (id) => {
    const callAt = document.getElementById('call_at').value;
    const memo = document.getElementById('call_memo').value.trim();
    try {
      await api.patch(`/api/admin/reservations/${id}`, { call_at: callAt || null, call_memo: memo || null });
      showToast('저장되었습니다');
      await loadDashboard();
      openDetail(id);
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.saveConfirmedInfo = async (id) => {
    const date = document.getElementById('confirmed_date').value;
    const time = document.getElementById('confirmed_time').value;
    try {
      await api.patch(`/api/admin/reservations/${id}`, { confirmed_date: date || null, confirmed_time: time || null });
      showToast('저장되었습니다');
      await loadDashboard();
      openDetail(id);
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.generateCertificate = async (id) => {
    try {
      const result = await api.post(`/api/admin/reservations/${id}/generate-certificate`, {});
      showToast('확인증이 생성되었습니다');
      await loadDashboard();
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.saveAdminNote = async (id) => {
    const note = document.getElementById('admin_note').value.trim();
    try {
      await api.patch(`/api/admin/reservations/${id}`, { admin_note: note || null });
      showToast('저장되었습니다');
      await loadDashboard();
      openDetail(id);
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.deleteReservation = async (id) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await api.delete(`/api/admin/reservations/${id}`);
      showToast('삭제되었습니다');
      closeDetail();
      await loadDashboard();
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.openSettings = () => {
    settingsModalOpen = true;
    render();
  };

  window.closeSettings = () => {
    settingsModalOpen = false;
    render();
  };

  window.saveSettings = async () => {
    const data = {
      shop_name: document.getElementById('set_shop_name').value.trim(),
      shop_desc: document.getElementById('set_shop_desc').value.trim(),
      contact_phone: document.getElementById('set_contact_phone').value.trim(),
      open_time: document.getElementById('set_open_time').value,
      close_time: document.getElementById('set_close_time').value
    };
    try {
      await api.put('/api/admin/settings', data);
      showToast('설정이 저장되었습니다');
      await loadSettings();
      closeSettings();
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.changePassword = async () => {
    const current = document.getElementById('pwd_current').value;
    const newPwd = document.getElementById('pwd_new').value;
    if (newPwd.length < 4) {
      alert('새 비밀번호는 4자 이상이어야 합니다');
      return;
    }
    try {
      await api.put('/api/admin/password', { current_password: current, new_password: newPwd });
      showToast('비밀번호가 변경되었습니다');
      document.getElementById('pwd_current').value = '';
      document.getElementById('pwd_new').value = '';
    } catch (e) {
      alert(e.message?.includes('일치하지 않') ? '현재 비밀번호가 일치하지 않습니다' : '오류: ' + e.message);
    }
  };

  // ===== 초기화 =====
  async function init() {
    if (token) {
      resetIdleTimer();
      await loadDashboard();
    }
    render();

    if (token) {
      document.getElementById('loginForm')?.addEventListener('submit', submitLogin);
    }
  }

  init();
})();
