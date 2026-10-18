import { Hono } from 'hono'
import { Bindings, normalizePhoneContact, isValidContact, generateOtpCode, generateToken, writeAuditLog, maskContact, formatReservationForCustomer, STATUS_LABELS, checkRateLimit } from '../utils/helpers'

export const publicApi = new Hono<{ Bindings: Bindings }>()

// ===== 미들웨어: 고객 인증 =====

async function requireCustomerAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '인증이 필요합니다.' }, 401)
  }

  const token = authHeader.slice(7)
  const db = c.env.DB

  try {
    const session = await db
      .prepare('SELECT * FROM customer_sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP')
      .bind(token)
      .first()

    if (!session) {
      return c.json({ error: '인증이 만료되었습니다.' }, 401)
    }

    c.set('customerContact', session.contact)
    await next()
  } catch (e) {
    return c.json({ error: '인증 오류' }, 500)
  }
}

// ===== GET /api/public/settings =====

publicApi.get('/settings', async c => {
  const db = c.env.DB

  try {
    const rows = await db.prepare('SELECT key, value FROM settings').all()
    const settings: any = {}
    const defaults: Record<string, string> = {
      shop_name: '모델하우스 예약신청',
      shop_desc: '편안하고 특별한 시간을 예약하세요',
      open_time: '09:00',
      close_time: '19:00',
      contact_phone: ''
    }

    for (const [key, defaultValue] of Object.entries(defaults)) {
      const row = (rows.results as any[]).find(r => r.key === key)
      settings[key] = row?.value || defaultValue
    }

    return c.json(settings)
  } catch (e) {
    return c.json({ error: '설정 조회 실패' }, 500)
  }
})

// ===== POST /api/public/reservations =====

publicApi.post('/reservations', async c => {
  const db = c.env.DB
  const body = await c.req.json()
  const { customer_name, contact, preferred_date, preferred_time, customer_memo } = body

  // 검증
  if (!customer_name?.trim()) {
    return c.json({ error: '성명을 입력해주세요.' }, 400)
  }

  const normalizedContact = normalizePhoneContact(contact)
  if (!isValidContact(normalizedContact)) {
    return c.json({ error: '연락처 뒷 8자리를 올바르게 입력해주세요.' }, 400)
  }

  if (preferred_date && !/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) {
    return c.json({ error: '방문 희망일 형식이 잘못되었습니다.' }, 400)
  }

  if (!preferred_time) {
    return c.json({ error: '방문 희망시간을 선택해주세요.' }, 400)
  }

  try {
    // DB에 예약 생성
    const result = await db
      .prepare(`
        INSERT INTO reservations (customer_name, contact, preferred_date, preferred_time, customer_memo, status)
        VALUES (?, ?, ?, ?, ?, 'requested')
      `)
      .bind(customer_name.trim(), normalizedContact, preferred_date || null, preferred_time, customer_memo || null)
      .run()

    const id = result.meta.last_row_id

    // 감사 로그
    await writeAuditLog(db, `customer:${normalizedContact}`, 'create', id as number, `신청됨`)

    // (선택) SMS 알림 — 백그라운드로 처리
    const adminPhone = c.env.SOLAPI_ADMIN_PHONE || c.env.SOLAPI_SENDER_PHONE
    if (adminPhone && c.env.SOLAPI_API_KEY && c.env.SOLAPI_API_SECRET) {
      // executionCtx.waitUntil 대신 비동기로 처리 (이 데모에서는 스킵)
      // sendSms(c.env, adminPhone, smsText).catch(e => console.error('SMS 발송 실패', e))
    }

    return c.json({
      success: true,
      id,
      message: '예약 신청이 완료되었습니다. 관리자가 확인 후 연락드리겠습니다.'
    }, 201)
  } catch (e) {
    console.error('예약 생성 오류:', e)
    return c.json({ error: '예약 생성 실패' }, 500)
  }
})

// ===== POST /api/public/auth/request-code =====

publicApi.post('/auth/request-code', async c => {
  const db = c.env.DB
  const body = await c.req.json()
  const { contact } = body

  const normalizedContact = normalizePhoneContact(contact)
  if (!isValidContact(normalizedContact)) {
    return c.json({ error: '연락처 뒷 8자리를 올바르게 입력해주세요.' }, 400)
  }

  // Rate limit: 1분 내 3개 이상이면 거부
  if (!checkRateLimit(`otp:${normalizedContact}`, 3, 60000)) {
    return c.json({ error: '잠시 후 다시 시도해주세요.' }, 429)
  }

  try {
    // 해당 연락처로 신청된 예약이 있는지 확인
    const reservation = await db
      .prepare('SELECT id FROM reservations WHERE contact = ? LIMIT 1')
      .bind(normalizedContact)
      .first()

    if (!reservation) {
      return c.json({ error: '해당 연락처로 신청된 예약이 없습니다.' }, 404)
    }

    // OTP 코드 생성 및 저장
    const code = generateOtpCode()
    const expiresAt = new Date(Date.now() + 5 * 60000).toISOString()

    await db
      .prepare(`
        INSERT INTO otp_codes (contact, code, expires_at, purpose)
        VALUES (?, ?, ?, 'customer_login')
      `)
      .bind(normalizedContact, code, expiresAt)
      .run()

    return c.json({
      success: true,
      message: '인증코드를 발송했습니다.',
      contact: normalizedContact,
      contact_formatted: formatPhoneContact(normalizedContact),
      demo_code: code // 데모 모드: 실제 발송 대신 응답에 포함
    }, 201)
  } catch (e) {
    console.error('OTP 요청 오류:', e)
    return c.json({ error: 'OTP 발급 실패' }, 500)
  }
})

function formatPhoneContact(contact: string): string {
  const digits = contact.replace(/\D/g, '')
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  return contact
}

// ===== POST /api/public/auth/verify-code =====

publicApi.post('/auth/verify-code', async c => {
  const db = c.env.DB
  const body = await c.req.json()
  const { contact, code } = body

  const normalizedContact = normalizePhoneContact(contact)
  if (!isValidContact(normalizedContact)) {
    return c.json({ error: '연락처가 유효하지 않습니다.' }, 400)
  }

  try {
    // 가장 최근 OTP 조회
    const otp = await db
      .prepare(`
        SELECT * FROM otp_codes
        WHERE contact = ? AND purpose = 'customer_login'
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(normalizedContact)
      .first()

    if (!otp) {
      return c.json({ error: '발급된 인증코드가 없습니다.' }, 404)
    }

    if (new Date(otp.expires_at) < new Date()) {
      return c.json({ error: '인증코드가 만료되었습니다.' }, 410)
    }

    if (otp.attempts >= 5) {
      return c.json({ error: '시도 횟수를 초과했습니다.' }, 429)
    }

    if (otp.code !== code) {
      // 시도 횟수 증가
      await db
        .prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')
        .bind(otp.id)
        .run()

      return c.json({ error: '인증코드가 일치하지 않습니다.' }, 401)
    }

    // 검증 성공: verified = 1
    await db.prepare('UPDATE otp_codes SET verified = 1 WHERE id = ?').bind(otp.id).run()

    // 세션 발급 (2시간 유효)
    const token = generateToken()
    const expiresAt = new Date(Date.now() + 2 * 60 * 60000).toISOString()

    await db
      .prepare(`
        INSERT INTO customer_sessions (token, contact, expires_at)
        VALUES (?, ?, ?)
      `)
      .bind(token, normalizedContact, expiresAt)
      .run()

    return c.json({ success: true, token }, 200)
  } catch (e) {
    console.error('인증 오류:', e)
    return c.json({ error: '인증 처리 실패' }, 500)
  }
})

// ===== GET /api/public/my-reservations (인증 필요) =====

publicApi.get('/my-reservations', requireCustomerAuth, async c => {
  const db = c.env.DB
  const contact = c.get('customerContact')

  try {
    const rows = await db
      .prepare(`
        SELECT * FROM reservations
        WHERE contact = ?
        ORDER BY created_at DESC
      `)
      .bind(contact)
      .all()

    const reservations = (rows.results as any[]).map(formatReservationForCustomer)
    return c.json({ reservations })
  } catch (e) {
    return c.json({ error: '예약 목록 조회 실패' }, 500)
  }
})

// ===== GET /api/public/my-reservations/:id (인증 필요) =====

publicApi.get('/my-reservations/:id', requireCustomerAuth, async c => {
  const db = c.env.DB
  const contact = c.get('customerContact')
  const id = c.req.param('id')

  try {
    const reservation = await db
      .prepare(`
        SELECT * FROM reservations
        WHERE id = ? AND contact = ?
      `)
      .bind(id, contact)
      .first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    return c.json(formatReservationForCustomer(reservation))
  } catch (e) {
    return c.json({ error: '예약 조회 실패' }, 500)
  }
})

// ===== PATCH /api/public/my-reservations/:id (인증 필요) =====

publicApi.patch('/my-reservations/:id', requireCustomerAuth, async c => {
  const db = c.env.DB
  const contact = c.get('customerContact')
  const id = c.req.param('id')
  const body = await c.req.json()
  const { preferred_date, preferred_time, customer_memo } = body

  if (!preferred_time) {
    return c.json({ error: '방문 희망시간을 선택해주세요.' }, 400)
  }

  try {
    const reservation = await db
      .prepare('SELECT * FROM reservations WHERE id = ? AND contact = ?')
      .bind(id, contact)
      .first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    if (reservation.status !== 'requested') {
      return c.json({ error: '신청됨 상태에서만 수정 가능합니다.' }, 400)
    }

    await db
      .prepare(`
        UPDATE reservations
        SET preferred_date = ?, preferred_time = ?, customer_memo = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(preferred_date || null, preferred_time, customer_memo || null, id)
      .run()

    await writeAuditLog(db, `customer:${contact}`, 'update', parseInt(id), '예약 수정')

    const updated = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()
    return c.json(formatReservationForCustomer(updated))
  } catch (e) {
    return c.json({ error: '수정 실패' }, 500)
  }
})

// ===== POST /api/public/my-reservations/:id/cancel (인증 필요) =====

publicApi.post('/my-reservations/:id/cancel', requireCustomerAuth, async c => {
  const db = c.env.DB
  const contact = c.get('customerContact')
  const id = c.req.param('id')
  const body = await c.req.json()
  const { reason } = body

  try {
    const reservation = await db
      .prepare('SELECT * FROM reservations WHERE id = ? AND contact = ?')
      .bind(id, contact)
      .first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    if (!['requested', 'calling', 'confirmed'].includes(reservation.status)) {
      return c.json({ error: '이 상태에서는 취소할 수 없습니다.' }, 400)
    }

    await db
      .prepare(`
        UPDATE reservations
        SET status = 'cancelled', cancelled_by = 'customer', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(reason || null, id)
      .run()

    await writeAuditLog(db, `customer:${contact}`, 'cancel', parseInt(id), reason || '')

    const updated = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()
    return c.json({ success: true, reservation: formatReservationForCustomer(updated) })
  } catch (e) {
    return c.json({ error: '취소 실패' }, 500)
  }
})

// ===== GET /api/public/my-reservations/:id/certificate (인증 필요) =====

publicApi.get('/my-reservations/:id/certificate', requireCustomerAuth, async c => {
  const db = c.env.DB
  const contact = c.get('customerContact')
  const id = c.req.param('id')

  try {
    const reservation = await db
      .prepare('SELECT * FROM reservations WHERE id = ? AND contact = ?')
      .bind(id, contact)
      .first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    if (!['confirmed', 'completed'].includes(reservation.status)) {
      return c.json({ error: '확인증은 확정/완료된 예약에서만 발급됩니다.' }, 400)
    }

    const settings = await db.prepare('SELECT key, value FROM settings WHERE key = ?').bind('shop_name').first()

    return c.json({
      shop_name: settings?.value || '모델하우스 예약신청',
      customer_name: reservation.customer_name,
      contact: maskContact(reservation.contact),
      confirmed_date: reservation.confirmed_date,
      confirmed_time: reservation.confirmed_time,
      reservation_id: reservation.id,
      issued_at: new Date().toISOString()
    })
  } catch (e) {
    return c.json({ error: '확인증 조회 실패' }, 500)
  }
})
