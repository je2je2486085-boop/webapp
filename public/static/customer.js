(function () {
  'use strict';

  // ===== 상태 변수 =====
  let view = 'form'; // 'form' | 'success' | 'login' | 'myList' | 'editReservation' | 'certificate'
  let settings = { shop_name: '', shop_desc: '', open_time: '09:00', close_time: '19:00', contact_phone: '' };
  let token = localStorage.getItem('customer_token');
  let myContact = localStorage.getItem('customer_contact');
  let lastReservation = null;
  let myReservations = [];
  let editTarget = null;
  let certificateData = null;
  let otpRequested = false;
  let otpContact = '';
  let otpContactDisplay = '';
  let demoCode = '';

  // ===== API 클라이언트 =====
  const api = {
    get: (url) => fetch(url).then(r => r.json()),
    post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (url, data) => fetch(url, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    withAuth: (method, url, data) => {
      const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
      if (data) opts.body = JSON.stringify(data);
      return fetch(url, opts).then(r => r.json());
    }
  };

  // ===== 시간 슬롯 생성 =====
  function generateTimeSlots() {
    const slots = [];
    const startMin = 9 * 60, endMin = 19 * 60;
    for (let m = startMin; m <= endMin; m += 30) {
      const h = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const value = `${h}:${mm}`;
      const hour12 = ((Math.floor(m / 60) + 11) % 12) + 1;
      const ampm = Math.floor(m / 60) < 12 ? '오전' : '오후';
      slots.push({ value, label: `${ampm} ${hour12}:${mm}` });
    }
    return slots;
  }

  const timeSlots = generateTimeSlots();

  // ===== 상태 정보 =====
  const STATUS_INFO = {
    requested: { label: '신청됨', badge: 'badge-pending', icon: 'fa-hourglass-half', message: '관리자가 확인 중입니다. 곧 연락드리겠습니다.' },
    calling: { label: '통화중', badge: 'badge-calling', icon: 'fa-phone', message: '관리자가 곧 전화/연락드릴 예정입니다.' },
    confirmed: { label: '확정됨', badge: 'badge-confirmed', icon: 'fa-check', message: '예약이 확정되었습니다! 예약확인증을 다운로드하세요.' },
    completed: { label: '완료', badge: 'badge-completed', icon: 'fa-check-double', message: '방문해주셔서 감사합니다.' },
    no_show: { label: '미방문', badge: 'badge-noshow', icon: 'fa-user-xmark', message: '미방문으로 기록되었습니다.' },
    cancelled: { label: '취소됨', badge: 'badge-cancelled', icon: 'fa-ban', message: '예약이 취소되었습니다.' }
  };

  // ===== 플레이스홀더 관리 =====
  function managePlaceholder(elem, originalPlaceholder) {
    elem.addEventListener('focus', () => elem.placeholder = '');
    elem.addEventListener('blur', () => { if (!elem.value) elem.placeholder = originalPlaceholder; });
  }

  // ===== 렌더 함수들 =====
  function renderForm() {
    const today = new Date().toISOString().split('T')[0];
    const timeOptsHtml = timeSlots.map(s => `<option value="${s.value}">${s.label}</option>`).join('');

    return `
      <div class="page">
        <section class="hero">
          <div class="hero-badge">온라인 방문예약</div>
          <h1>${settings.shop_name}</h1>
          <p>${settings.shop_desc}</p>
        </section>
        <div class="container">
          <div class="card form-card">
            <form id="reserveForm">
              <div class="form-group">
                <label>성명 *</label>
                <input type="text" id="f_name" class="f-name-input" required>
                <div class="phone-hint" style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">예약 확인 시 필요합니다</div>
              </div>
              <div class="form-group">
                <label>연락처 *</label>
                <div class="phone-input-group">
                  <span class="phone-prefix">010</span>
                  <input type="text" maxlength="8" pattern="[0-9]{8}" class="phone-last8" id="f_phone" required>
                </div>
                <div class="phone-hint">뒷 8자리 숫자만 입력해주세요</div>
              </div>
              <div class="form-group">
                <label>방문 희망일 (선택)</label>
                <input type="date" id="f_date" min="${today}">
              </div>
              <div class="form-group">
                <label>방문 희망시간 *</label>
                <select id="f_time" required>
                  <option value="">시간 선택</option>
                  ${timeOptsHtml}
                </select>
              </div>
              <div class="form-group">
                <label>메모 (선택)</label>
                <textarea id="f_memo" placeholder="특별한 요청사항이 있으신가요?"></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-full">예약 신청하기</button>
            </form>
            <div style="text-align: center; margin-top: 24px;">
              <button class="btn btn-outline btn-sm" onclick="showLogin()">내 예약 확인</button>
            </div>
          </div>
        </div>
        <div class="footer">
          <div>영업시간 ${settings.open_time}~${settings.close_time}</div>
          ${settings.contact_phone ? `<div style="margin-top: 8px;">대표번호 <a href="tel:${settings.contact_phone}">${settings.contact_phone}</a></div>` : ''}
          <div style="margin-top: 12px; font-size: 11px;">예약 조회는 로그인 후 확인 가능합니다</div>
        </div>
        <a href="/admin" class="admin-link">관리자</a>
      </div>
    `;
  }

  function renderSuccess() {
    if (!lastReservation) return renderForm();
    const dateStr = lastReservation.preferred_date ? `${lastReservation.preferred_date} ${lastReservation.preferred_time}` : `${lastReservation.preferred_time} (날짜 미정)`;

    return `
      <div class="page">
        <section class="hero">
          <div class="hero-badge">예약 완료</div>
          <h1>✓ 예약 신청 완료</h1>
        </section>
        <div class="container">
          <div class="card form-card">
            <div style="text-align: center; margin-bottom: 32px;">
              <i class="fas fa-check-circle" style="font-size: 64px; color: var(--success); margin-bottom: 16px;"></i>
            </div>
            <div class="reservation-card">
              <div class="reservation-card-title">신청하신 예약정보</div>
              <div class="reservation-card-meta" style="margin-top: 12px;">
                <div>성명: <strong>${lastReservation.customer_name}</strong></div>
                <div>방문일시: <strong>${dateStr}</strong></div>
                <div style="margin-top: 8px; color: var(--text-muted); font-size: 12px;">
                  관리자가 확인 후 연락드리겠습니다.<br/>
                  로그인하여 예약 상태를 언제든 확인할 수 있습니다.
                </div>
              </div>
            </div>
            <button class="btn btn-primary btn-full" onclick="resetForm()">돌아가기</button>
          </div>
        </div>
        <div class="footer">
          <div>영업시간 ${settings.open_time}~${settings.close_time}</div>
          ${settings.contact_phone ? `<div style="margin-top: 8px;">대표번호 <a href="tel:${settings.contact_phone}">${settings.contact_phone}</a></div>` : ''}
        </div>
      </div>
    `;
  }

  function renderLogin() {
    if (!otpRequested) {
      return `
        <div class="page">
          <section class="hero">
            <div class="hero-badge">온라인 예약조회</div>
            <h1>로그인</h1>
            <p>전화번호로 인증하세요</p>
          </section>
          <div class="container">
            <div class="card form-card">
              <div class="form-group">
                <label>연락처 *</label>
                <div class="phone-input-group">
                  <span class="phone-prefix">010</span>
                  <input type="text" maxlength="8" pattern="[0-9]{8}" id="login_phone" required>
                </div>
                <div class="phone-hint">뒷 8자리 숫자만 입력해주세요</div>
              </div>
              <button type="button" class="btn btn-primary btn-full" onclick="requestOtp()">인증코드 받기</button>
              <div style="text-align: center; margin-top: 16px;">
                <button class="btn btn-outline btn-sm" onclick="resetForm()">처음으로</button>
              </div>
            </div>
          </div>
          <div class="footer">
            <div>영업시간 ${settings.open_time}~${settings.close_time}</div>
          </div>
        </div>
      `;
    } else {
      let demoAlert = '';
      if (demoCode) {
        demoAlert = `<div class="alert alert-demo"><strong>데모 모드:</strong> 인증코드는 <b>${demoCode}</b>입니다</div>`;
      }

      return `
        <div class="page">
          <section class="hero">
            <div class="hero-badge">온라인 예약조회</div>
            <h1>인증</h1>
            <p>${otpContactDisplay}(으)로 인증코드를 보냈습니다</p>
          </section>
          <div class="container">
            <div class="card form-card">
              ${demoAlert}
              <div class="form-group">
                <label>인증코드 (6자리) *</label>
                <input type="text" maxlength="6" pattern="[0-9]{6}" id="otp_code" required autofocus>
              </div>
              <button type="button" class="btn btn-primary btn-full" onclick="verifyOtp()">확인</button>
              <div style="text-align: center; margin-top: 16px;">
                <button class="btn btn-outline btn-sm" onclick="requestOtp()">인증코드 다시 받기</button>
                <button class="btn btn-outline btn-sm" onclick="resetForm()">처음으로</button>
              </div>
            </div>
          </div>
          <div class="footer">
            <div>영업시간 ${settings.open_time}~${settings.close_time}</div>
          </div>
        </div>
      `;
    }
  }

  function renderMyList() {
    if (myReservations.length === 0) {
      return `
        <div class="page">
          <section class="hero">
            <div class="hero-badge">예약 조회</div>
            <h1>내 예약</h1>
          </section>
          <div class="container">
            <div class="card form-card">
              <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>신청하신 예약이 없습니다</p>
                <button class="btn btn-outline btn-sm" onclick="resetForm()">예약 신청하기</button>
              </div>
            </div>
          </div>
          <div class="footer">
            <button class="btn btn-outline btn-sm" onclick="logout()">로그아웃</button>
          </div>
        </div>
      `;
    }

    const cardsHtml = myReservations.map(r => renderMyReservationCard(r)).join('');

    return `
      <div class="page">
        <section class="hero">
          <div class="hero-badge">예약 조회</div>
          <h1>내 예약</h1>
        </section>
        <div class="container">
          ${cardsHtml}
          <div style="text-align: center; margin-top: 32px;">
            <button class="btn btn-outline" onclick="resetForm()">새로운 예약 신청</button>
            <button class="btn btn-primary" onclick="logout()">로그아웃</button>
          </div>
        </div>
        <div class="footer">
          <div style="font-size: 12px;">로그아웃하면 다시 로그인해야 합니다</div>
        </div>
      </div>
    `;
  }

  function renderMyReservationCard(r) {
    const info = STATUS_INFO[r.status] || {};
    const visitDate = r.confirmed_date || r.preferred_date || '미정';
    const visitTime = r.confirmed_time || r.preferred_time || '미정';
    const dateLabel = r.confirmed_date ? '확정' : '희망';

    let actions = '';
    if (r.status === 'requested') {
      actions += `<button class="btn btn-outline btn-sm" onclick="showEditReservation(${r.id})">수정</button>`;
      actions += `<button class="btn btn-danger btn-sm" onclick="cancelReservation(${r.id})">취소</button>`;
    }
    if (['requested', 'calling', 'confirmed'].includes(r.status)) {
      actions += `<button class="btn btn-danger btn-sm" onclick="cancelReservation(${r.id})">취소</button>`;
    }
    if (r.certificate_available) {
      actions += `<button class="btn btn-primary btn-sm" onclick="viewCertificate(${r.id})">확인증</button>`;
    }

    return `
      <div class="card reservation-card">
        <div class="reservation-card-header">
          <div>
            <div class="reservation-card-title">${visitDate} ${visitTime}</div>
            <div style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">${dateLabel}</div>
          </div>
          <span class="badge ${info.badge}">${info.label}</span>
        </div>
        <div class="reservation-card-meta">
          <div>${r.customer_name}님 · 신청일 ${r.created_at?.split('T')[0]}</div>
          ${r.customer_memo ? `<div>메모: ${r.customer_memo}</div>` : ''}
          ${r.cancel_reason ? `<div style="color: var(--danger);">취소사유: ${r.cancel_reason}</div>` : ''}
        </div>
        ${info.message ? `
          <div class="status-info">
            <i class="fas ${info.icon} status-icon"></i>
            <div class="status-message">${info.message}</div>
          </div>
        ` : ''}
        <div class="reservation-card-actions">
          ${actions}
        </div>
      </div>
    `;
  }

  function renderEditReservation() {
    if (!editTarget) return renderMyList();
    const today = new Date().toISOString().split('T')[0];
    const timeOptsHtml = timeSlots.map(s => `<option value="${s.value}" ${s.value === editTarget.preferred_time ? 'selected' : ''}>${s.label}</option>`).join('');

    return `
      <div class="page">
        <section class="hero">
          <div class="hero-badge">예약 수정</div>
          <h1>예약 정보 수정</h1>
        </section>
        <div class="container">
          <div class="card form-card">
            <div style="background-color: var(--input-bg); padding: 12px; border-radius: 4px; margin-bottom: 24px; font-size: 13px;">
              성명과 연락처는 수정할 수 없습니다
            </div>
            <form id="editForm">
              <div class="form-group">
                <label>성명</label>
                <input type="text" value="${editTarget.customer_name}" disabled>
              </div>
              <div class="form-group">
                <label>연락처</label>
                <input type="text" value="${editTarget.contact}" disabled>
              </div>
              <div class="form-group">
                <label>방문 희망일</label>
                <input type="date" id="edit_date" value="${editTarget.preferred_date || ''}" min="${today}">
              </div>
              <div class="form-group">
                <label>방문 희망시간 *</label>
                <select id="edit_time" required>
                  ${timeOptsHtml}
                </select>
              </div>
              <div class="form-group">
                <label>메모</label>
                <textarea id="edit_memo">${editTarget.customer_memo || ''}</textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-full">저장</button>
              <button type="button" class="btn btn-outline btn-full" onclick="loadMyReservations()" style="margin-top: 8px;">취소</button>
            </form>
          </div>
        </div>
        <div class="footer">
          <button class="btn btn-outline btn-sm" onclick="logout()">로그아웃</button>
        </div>
      </div>
    `;
  }

  function renderCertificate() {
    if (!certificateData) return renderMyList();

    const printDate = new Date(certificateData.issued_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

    return `
      <div class="page">
        <section class="hero">
          <div class="hero-badge">예약 확인증</div>
          <h1>방문 확인증</h1>
        </section>
        <div class="container">
          <div id="certificate-print">
            <div class="certificate-box">
              <div class="certificate-header">
                <h1>${certificateData.shop_name}</h1>
                <p>방문 예약 확인증</p>
              </div>
              <table class="certificate-table">
                <tr>
                  <td>예약번호</td>
                  <td>${certificateData.reservation_id}</td>
                </tr>
                <tr>
                  <td>성명</td>
                  <td>${certificateData.customer_name}</td>
                </tr>
                <tr>
                  <td>연락처</td>
                  <td>${certificateData.contact}</td>
                </tr>
                <tr>
                  <td>방문일시</td>
                  <td>${certificateData.confirmed_date} ${certificateData.confirmed_time}</td>
                </tr>
                <tr>
                  <td>발급일시</td>
                  <td>${printDate}</td>
                </tr>
              </table>
              <div class="certificate-footer">
                본 확인증은 예약 확인을 위한 문서입니다.<br/>
                방문 시 제시해주세요.
              </div>
            </div>
          </div>

          <div class="card form-card">
            <div style="background-color: var(--input-bg); padding: 16px; border-radius: 4px; margin-bottom: 16px;">
              <table style="width: 100%; font-size: 13px;">
                <tr style="border-bottom: 1px solid var(--border); padding: 8px 0;">
                  <td style="padding: 8px 0; color: var(--text-muted);">예약번호</td>
                  <td style="padding: 8px 0; text-align: right;"><strong>${certificateData.reservation_id}</strong></td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border); padding: 8px 0;">
                  <td style="padding: 8px 0; color: var(--text-muted);">성명</td>
                  <td style="padding: 8px 0; text-align: right;"><strong>${certificateData.customer_name}</strong></td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border); padding: 8px 0;">
                  <td style="padding: 8px 0; color: var(--text-muted);">연락처</td>
                  <td style="padding: 8px 0; text-align: right;"><strong>${certificateData.contact}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: var(--text-muted);">방문일시</td>
                  <td style="padding: 8px 0; text-align: right;"><strong>${certificateData.confirmed_date} ${certificateData.confirmed_time}</strong></td>
                </tr>
              </table>
            </div>
            <button class="btn btn-primary btn-full" onclick="window.print()">인쇄 / PDF 저장</button>
            <button class="btn btn-outline btn-full" onclick="loadMyReservations()" style="margin-top: 8px;">목록으로</button>
          </div>
        </div>
        <div class="footer">
          <button class="btn btn-outline btn-sm" onclick="logout()">로그아웃</button>
        </div>
      </div>
    `;
  }

  function render() {
    const app = document.getElementById('customer-app');
    let html;
    switch (view) {
      case 'success': html = renderSuccess(); break;
      case 'login': html = renderLogin(); break;
      case 'myList': html = renderMyList(); break;
      case 'editReservation': html = renderEditReservation(); break;
      case 'certificate': html = renderCertificate(); break;
      default: html = renderForm();
    }
    app.innerHTML = html;
    bindEvents();
  }

  function bindEvents() {
    if (view === 'form') {
      managePlaceholder(document.querySelector('.f-name-input'), '홍길동');
      managePlaceholder(document.querySelector('.phone-last8'), '12345678');
      document.getElementById('reserveForm')?.addEventListener('submit', submitReservation);
    }
    if (view === 'login' && !otpRequested) {
      managePlaceholder(document.getElementById('login_phone'), '12345678');
    }
    if (view === 'editReservation') {
      document.getElementById('editForm')?.addEventListener('submit', submitEdit);
    }
  }

  // ===== 이벤트 핸들러 =====
  window.submitReservation = async (e) => {
    e.preventDefault();
    const name = document.getElementById('f_name').value.trim();
    const phone = document.getElementById('f_phone').value.trim();
    const date = document.getElementById('f_date').value || null;
    const time = document.getElementById('f_time').value;
    const memo = document.getElementById('f_memo').value.trim() || null;

    if (!name || !phone || !time) {
      alert('필수 항목을 입력해주세요');
      return;
    }

    try {
      const result = await api.post('/api/public/reservations', { customer_name: name, contact: phone, preferred_date: date, preferred_time: time, customer_memo: memo });
      if (result.success) {
        lastReservation = { customer_name: name, preferred_date: date, preferred_time: time };
        view = 'success';
        render();
      } else {
        alert(result.error || '신청 실패');
      }
    } catch (e) {
      alert('오류 발생: ' + e.message);
    }
  };

  window.resetForm = () => {
    view = 'form';
    otpRequested = false;
    render();
  };

  window.showLogin = () => {
    view = 'login';
    otpRequested = false;
    render();
  };

  window.requestOtp = async () => {
    const phone = (document.getElementById('login_phone') || {}).value?.trim();
    if (!phone || phone.length !== 8) {
      alert('뒷 8자리를 올바르게 입력해주세요');
      return;
    }
    try {
      const result = await api.post('/api/public/auth/request-code', { contact: phone });
      if (result.success) {
        otpContact = phone;
        otpContactDisplay = '010-' + phone.slice(0, 4) + '-' + phone.slice(4);
        demoCode = result.demo_code || '';
        otpRequested = true;
        view = 'login';
        render();
        setTimeout(() => document.getElementById('otp_code')?.focus(), 100);
      } else {
        alert(result.error || 'OTP 요청 실패');
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.verifyOtp = async () => {
    const code = document.getElementById('otp_code')?.value?.trim();
    if (!code || code.length !== 6) {
      alert('6자리 인증코드를 입력해주세요');
      return;
    }
    try {
      const result = await api.post('/api/public/auth/verify-code', { contact: otpContact, code });
      if (result.success) {
        token = result.token;
        myContact = otpContact;
        localStorage.setItem('customer_token', token);
        localStorage.setItem('customer_contact', myContact);
        await loadMyReservations();
        view = 'myList';
        render();
      } else {
        alert(result.error || '인증 실패');
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.loadMyReservations = async () => {
    if (!token) return;
    try {
      const result = await api.withAuth('GET', '/api/public/my-reservations');
      myReservations = result.reservations || [];
    } catch (e) {
      console.error('예약 목록 조회 오류:', e);
    }
  };

  window.showEditReservation = async (id) => {
    try {
      const result = await api.withAuth('GET', `/api/public/my-reservations/${id}`);
      editTarget = result;
      view = 'editReservation';
      render();
    } catch (e) {
      alert('예약 조회 실패: ' + e.message);
    }
  };

  window.submitEdit = async (e) => {
    e.preventDefault();
    const date = document.getElementById('edit_date').value || null;
    const time = document.getElementById('edit_time').value;
    const memo = document.getElementById('edit_memo').value.trim() || null;

    if (!time) {
      alert('방문 희망시간을 선택해주세요');
      return;
    }

    try {
      const result = await api.patch(`/api/public/my-reservations/${editTarget.id}`, { preferred_date: date, preferred_time: time, customer_memo: memo });
      if (result.id) {
        await loadMyReservations();
        view = 'myList';
        render();
      } else {
        alert(result.error || '저장 실패');
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.cancelReservation = async (id) => {
    if (!confirm('정말 취소하시겠습니까?')) return;
    try {
      const result = await api.withAuth('POST', `/api/public/my-reservations/${id}/cancel`, {});
      if (result.success) {
        await loadMyReservations();
        view = 'myList';
        render();
      } else {
        alert(result.error || '취소 실패');
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.viewCertificate = async (id) => {
    try {
      const result = await api.withAuth('GET', `/api/public/my-reservations/${id}/certificate`);
      if (result.reservation_id) {
        certificateData = result;
        view = 'certificate';
        render();
      } else {
        alert(result.error || '확인증 조회 실패');
      }
    } catch (e) {
      alert('오류: ' + e.message);
    }
  };

  window.logout = () => {
    token = null;
    myContact = null;
    localStorage.removeItem('customer_token');
    localStorage.removeItem('customer_contact');
    view = 'form';
    render();
  };

  // ===== 초기화 =====
  async function init() {
    try {
      const s = await api.get('/api/public/settings');
      settings = s;
    } catch (e) {
      console.error('설정 로드 실패:', e);
    }

    if (token) {
      await loadMyReservations();
      view = 'myList';
    }

    render();
  }

  init();
})();
