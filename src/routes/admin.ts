import { Hono } from 'hono'
import { Bindings, generateToken, writeAuditLog, maskContact, STATUS_LABELS, VALID_STATUSES, formatReservationForCustomer } from '../utils/helpers'

export const adminApi = new Hono<{ Bindings: Bindings }>()

// ===== 미들웨어: 관리자 인증 + 유휴 로그아웃 =====

async function requireAdminAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '관리자 로그인이 필요합니다.' }, 401)
  }

  const token = authHeader.slice(7)
  const db = c.env.DB

  try {
    const session = await db
      .prepare('SELECT * FROM admin_sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP')
      .bind(token)
      .first()

    if (!session) {
      return c.json({ error: '세션이 만료되었습니다.' }, 401)
    }

    // 20분 유휴 체크
    const lastActivity = new Date(session.last_activity_at)
    const now = new Date()
    const idleMs = now.getTime() - lastActivity.getTime()

    if (idleMs > 20 * 60 * 1000) {
      // 세션 삭제
      await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run()
      return c.json({ error: '유휴 시간이 초과되어 자동 로그아웃되었습니다.' }, 401)
    }

    // last_activity_at 갱신
    await db
      .prepare('UPDATE admin_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE token = ?')
      .bind(token)
      .run()

    c.set('adminToken', token)
    await next()
  } catch (e) {
    return c.json({ error: '인증 오류' }, 500)
  }
}

// ===== POST /api/admin/login =====

adminApi.post('/login', async c => {
  const db = c.env.DB
  const body = await c.req.json()
  const { password } = body

  try {
    const setting = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('admin_password').first()
    const adminPassword = setting?.value || 'admin1234'

    if (password !== adminPassword) {
      return c.json({ error: '비밀번호가 일치하지 않습니다.' }, 401)
    }

    // 세션 발급 (8시간 유효)
    const token = generateToken()
    const expiresAt = new Date(Date.now() + 8 * 60 * 60000).toISOString()

    await db
      .prepare(`
        INSERT INTO admin_sessions (token, expires_at, last_activity_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(token, expiresAt)
      .run()

    return c.json({ success: true, token }, 201)
  } catch (e) {
    return c.json({ error: '로그인 실패' }, 500)
  }
})

// ===== POST /api/admin/logout (인증 필요) =====

adminApi.post('/logout', requireAdminAuth, async c => {
  const db = c.env.DB
  const token = c.get('adminToken')

  try {
    await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run()
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: '로그아웃 실패' }, 500)
  }
})

// ===== GET /api/admin/dashboard (인증 필요) =====

adminApi.get('/dashboard', requireAdminAuth, async c => {
  const db = c.env.DB

  try {
    const today = new Date().toISOString().split('T')[0]

    const todayRequested = await db
      .prepare("SELECT COUNT(*) as cnt FROM reservations WHERE DATE(created_at) = ?")
      .bind(today)
      .first()

    const notCalledYet = await db
      .prepare("SELECT COUNT(*) as cnt FROM reservations WHERE status = 'requested'")
      .first()

    const confirmed = await db
      .prepare("SELECT COUNT(*) as cnt FROM reservations WHERE status = 'confirmed'")
      .first()

    const currentMonth = today.slice(0, 7) // YYYY-MM
    const completedThisMonth = await db
      .prepare("SELECT COUNT(*) as cnt FROM reservations WHERE strftime('%Y-%m', updated_at) = ? AND status = 'completed'")
      .bind(currentMonth)
      .first()

    return c.json({
      today_requested: (todayRequested as any)?.cnt || 0,
      not_called_yet: (notCalledYet as any)?.cnt || 0,
      confirmed: (confirmed as any)?.cnt || 0,
      completed_this_month: (completedThisMonth as any)?.cnt || 0
    })
  } catch (e) {
    return c.json({ error: '대시보드 조회 실패' }, 500)
  }
})

// ===== GET /api/admin/reservations (인증 필요) =====

adminApi.get('/reservations', requireAdminAuth, async c => {
  const db = c.env.DB
  const status = c.req.query('status')
  const dateFrom = c.req.query('date_from')
  const dateTo = c.req.query('date_to')
  const search = c.req.query('search')
  const sort = c.req.query('sort') || 'latest'

  try {
    let query = 'SELECT * FROM reservations WHERE 1=1'
    const params: any[] = []

    if (status && status !== 'all') {
      query += ' AND status = ?'
      params.push(status)
    }

    if (dateFrom || dateTo) {
      query += ' AND (preferred_date BETWEEN ? AND ? OR confirmed_date BETWEEN ? AND ?)'
      const from = dateFrom || '2000-01-01'
      const to = dateTo || '2099-12-31'
      params.push(from, to, from, to)
    }

    if (search) {
      query += ' AND (customer_name LIKE ? OR contact LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    if (sort === 'priority') {
      // requested → calling → confirmed → 기타, 각 안에서 오래된순
      query += ` ORDER BY CASE WHEN status='requested' THEN 1 WHEN status='calling' THEN 2 WHEN status='confirmed' THEN 3 ELSE 4 END, created_at ASC`
    } else {
      query += ' ORDER BY created_at DESC'
    }

    const result = await db.prepare(query).bind(...params).all()

    const reservations = (result.results as any[]).map(r => ({
      ...formatReservationForCustomer(r),
      contact_masked: maskContact(r.contact)
    }))

    return c.json({ reservations })
  } catch (e) {
    return c.json({ error: '예약 목록 조회 실패' }, 500)
  }
})

// ===== GET /api/admin/reservations/:id (인증 필요) =====

adminApi.get('/reservations/:id', requireAdminAuth, async c => {
  const db = c.env.DB
  const id = c.req.param('id')

  try {
    const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    return c.json({
      ...formatReservationForCustomer(reservation),
      contact_masked: maskContact(reservation.contact)
    })
  } catch (e) {
    return c.json({ error: '예약 조회 실패' }, 500)
  }
})

// ===== PATCH /api/admin/reservations/:id (인증 필요) =====

adminApi.patch('/reservations/:id', requireAdminAuth, async c => {
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json()
  const { status, call_at, call_memo, confirmed_date, confirmed_time, admin_note, cancel_reason } = body

  try {
    const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    // 동적 UPDATE 생성
    const updates: string[] = []
    const params: any[] = []

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return c.json({ error: '유효하지 않은 상태입니다.' }, 400)
      }
      updates.push('status = ?')
      params.push(status)

      if (status === 'cancelled') {
        updates.push('cancelled_by = ?')
        params.push('admin')
        updates.push('cancelled_at = CURRENT_TIMESTAMP')
      }

      // 감사 로그: 상태 변경
      await writeAuditLog(db, 'admin', 'status_change', parseInt(id), `${STATUS_LABELS[reservation.status]} → ${STATUS_LABELS[status]}`)
    }

    if (call_at !== undefined) {
      updates.push('call_at = ?')
      params.push(call_at || null)
    }

    if (call_memo !== undefined) {
      updates.push('call_memo = ?')
      params.push(call_memo || null)
    }

    if (confirmed_date !== undefined) {
      updates.push('confirmed_date = ?')
      params.push(confirmed_date || null)
    }

    if (confirmed_time !== undefined) {
      updates.push('confirmed_time = ?')
      params.push(confirmed_time || null)
    }

    if (admin_note !== undefined) {
      updates.push('admin_note = ?')
      params.push(admin_note || null)
    }

    if (cancel_reason !== undefined) {
      updates.push('cancel_reason = ?')
      params.push(cancel_reason || null)
    }

    if (updates.length === 0) {
      return c.json({ error: '변경할 내용이 없습니다.' }, 400)
    }

    updates.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)

    const query = `UPDATE reservations SET ${updates.join(', ')} WHERE id = ?`
    await db.prepare(query).bind(...params).run()

    // 감사 로그: 일반 업데이트
    if (status === undefined && (call_at !== undefined || confirmed_date !== undefined)) {
      await writeAuditLog(db, 'admin', 'update', parseInt(id), '예약 정보 수정')
    }

    const updated = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()
    return c.json({
      ...formatReservationForCustomer(updated),
      contact_masked: maskContact(updated.contact)
    })
  } catch (e) {
    return c.json({ error: '수정 실패' }, 500)
  }
})

// ===== DELETE /api/admin/reservations/:id (인증 필요) =====

adminApi.delete('/reservations/:id', requireAdminAuth, async c => {
  const db = c.env.DB
  const id = c.req.param('id')

  try {
    const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    await db.prepare('DELETE FROM reservations WHERE id = ?').bind(id).run()
    await writeAuditLog(db, 'admin', 'delete', parseInt(id), `${reservation.customer_name} 예약 삭제`)

    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: '삭제 실패' }, 500)
  }
})

// ===== POST /api/admin/reservations/:id/generate-certificate (인증 필요) =====

adminApi.post('/reservations/:id/generate-certificate', requireAdminAuth, async c => {
  const db = c.env.DB
  const id = c.req.param('id')

  try {
    const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first()

    if (!reservation) {
      return c.json({ error: '예약을 찾을 수 없습니다.' }, 404)
    }

    if (!['confirmed', 'completed'].includes(reservation.status)) {
      return c.json({ error: '확인증은 확정/완료된 예약에서만 생성됩니다.' }, 400)
    }

    await db
      .prepare('UPDATE reservations SET certificate_sent_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(id)
      .run()

    const settings = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('shop_name').first()

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
    return c.json({ error: '확인증 생성 실패' }, 500)
  }
})

// ===== GET /api/admin/stats (인증 필요) =====

adminApi.get('/stats', requireAdminAuth, async c => {
  const db = c.env.DB

  try {
    // 월별 추이 (최근 6개월)
    const monthlyResult = await db
      .prepare(`
        SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
        FROM reservations
        WHERE created_at >= date('now', '-6 months')
        GROUP BY month
        ORDER BY month
      `)
      .all()

    // 요일별 분포
    const weekdayResult = await db
      .prepare(`
        SELECT strftime('%w', confirmed_date) as dow, COUNT(*) as count
        FROM reservations
        WHERE confirmed_date IS NOT NULL
        GROUP BY dow
        ORDER BY dow
      `)
      .all()

    // 시간대별 분포
    const hourlyResult = await db
      .prepare(`
        SELECT substr(confirmed_time, 1, 2) as hour, COUNT(*) as count
        FROM reservations
        WHERE confirmed_time IS NOT NULL AND confirmed_time != 'any'
        GROUP BY hour
        ORDER BY hour
      `)
      .all()

    // 전환율 통계
    const conversionResult = await db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM reservations
      `)
      .first()

    const total = (conversionResult as any)?.total || 0
    const completed = (conversionResult as any)?.completed || 0
    const noShow = (conversionResult as any)?.no_show || 0
    const cancelled = (conversionResult as any)?.cancelled || 0

    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0
    const noShowRate = total > 0 ? Math.round((noShow / total) * 1000) / 10 : 0

    // 미방문 고객 리스트
    const noShowList = await db
      .prepare(`
        SELECT customer_name, contact, confirmed_date, confirmed_time
        FROM reservations
        WHERE status = 'no_show'
        ORDER BY confirmed_date DESC
        LIMIT 50
      `)
      .all()

    return c.json({
      monthly: (monthlyResult.results as any[]).map(r => ({ month: r.month, count: r.count })),
      weekday: (weekdayResult.results as any[]).map(r => ({ dow: r.dow, count: r.count })),
      hourly: (hourlyResult.results as any[]).map(r => ({ hour: r.hour, count: r.count })),
      conversion: {
        total,
        completed,
        no_show: noShow,
        cancelled,
        completion_rate: completionRate,
        no_show_rate: noShowRate
      },
      no_show_list: (noShowList.results as any[]).map(r => ({
        customer_name: r.customer_name,
        contact: maskContact(r.contact),
        confirmed_date: r.confirmed_date,
        confirmed_time: r.confirmed_time
      }))
    })
  } catch (e) {
    return c.json({ error: '통계 조회 실패' }, 500)
  }
})

// ===== GET /api/admin/settings (인증 필요) =====

adminApi.get('/settings', requireAdminAuth, async c => {
  const db = c.env.DB

  try {
    const rows = await db.prepare('SELECT key, value FROM settings').all()
    const settings: any = {}

    for (const row of rows.results as any[]) {
      if (row.key !== 'admin_password') {
        settings[row.key] = row.value
      }
    }

    return c.json(settings)
  } catch (e) {
    return c.json({ error: '설정 조회 실패' }, 500)
  }
})

// ===== PUT /api/admin/settings (인증 필요) =====

adminApi.put('/settings', requireAdminAuth, async c => {
  const db = c.env.DB
  const body = await c.req.json()

  const whitelist = ['shop_name', 'shop_desc', 'open_time', 'close_time', 'contact_phone']

  try {
    for (const [key, value] of Object.entries(body)) {
      if (whitelist.includes(key)) {
        await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run()
      }
    }

    const rows = await db.prepare('SELECT key, value FROM settings').all()
    const settings: any = {}

    for (const row of rows.results as any[]) {
      if (row.key !== 'admin_password') {
        settings[row.key] = row.value
      }
    }

    return c.json({ success: true, settings })
  } catch (e) {
    return c.json({ error: '설정 업데이트 실패' }, 500)
  }
})

// ===== PUT /api/admin/password (인증 필요) =====

adminApi.put('/password', requireAdminAuth, async c => {
  const db = c.env.DB
  const body = await c.req.json()
  const { current_password, new_password } = body

  if (!new_password || new_password.length < 4) {
    return c.json({ error: '새 비밀번호는 4자 이상이어야 합니다.' }, 400)
  }

  try {
    const setting = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('admin_password').first()
    const adminPassword = setting?.value || 'admin1234'

    if (current_password !== adminPassword) {
      return c.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, 401)
    }

    await db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind('admin_password', new_password)
      .run()

    return c.json({ success: true, message: '비밀번호가 변경되었습니다.' })
  } catch (e) {
    return c.json({ error: '비밀번호 변경 실패' }, 500)
  }
})

// ===== GET /api/admin/reservations/:id/logs (인증 필요) =====

adminApi.get('/reservations/:id/logs', requireAdminAuth, async c => {
  const db = c.env.DB
  const id = c.req.param('id')

  try {
    const logs = await db
      .prepare(`
        SELECT * FROM audit_logs
        WHERE target_type = 'reservation' AND target_id = ?
        ORDER BY created_at DESC
      `)
      .bind(id)
      .all()

    return c.json({ logs: logs.results || [] })
  } catch (e) {
    return c.json({ error: '감사 로그 조회 실패' }, 500)
  }
})
