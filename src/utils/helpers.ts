import { D1Database } from '@cloudflare/workers-types'

export type Bindings = {
  DB: D1Database
  SOLAPI_API_KEY?: string
  SOLAPI_API_SECRET?: string
  SOLAPI_SENDER_PHONE?: string
  SOLAPI_ADMIN_PHONE?: string
}

// ===== 전화번호 처리 =====

export function normalizePhoneContact(rawLast8: string): string {
  // 8자리 숫자면 010 붙이기
  const digits = rawLast8.replace(/\D/g, '')
  if (digits.length === 8) {
    return '010' + digits
  }
  // 이미 11자리 010으로 시작하면 그대로
  if (digits.length === 11 && digits.startsWith('010')) {
    return digits
  }
  // 그 외는 숫자만 반환
  return digits
}

export function isValidContact(contact: string): boolean {
  const digits = contact.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('010')
}

export function maskContact(contact: string): string {
  // 01012345678 → 010-****-5678
  const digits = contact.replace(/\D/g, '')
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-***-${digits.slice(6)}`
  }
  return contact
}

export function formatPhoneContact(contact: string): string {
  // 01012345678 → 010-1234-5678
  const digits = contact.replace(/\D/g, '')
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  return contact
}

export function detectContactType(_contact: string): string {
  return 'phone'
}

// ===== OTP & 인증 =====

export function generateOtpCode(): string {
  return String(Math.floor(Math.random() * 900000) + 100000)
}

export function generateToken(): string {
  return crypto.randomUUID()
}

// ===== 상태 레이블 =====

export const STATUS_LABELS: Record<string, string> = {
  requested: '신청됨',
  calling: '통화중',
  confirmed: '확정됨',
  completed: '완료',
  no_show: '미방문',
  cancelled: '취소됨'
}

export const VALID_STATUSES = Object.keys(STATUS_LABELS)

// ===== 감사 로그 =====

export async function writeAuditLog(
  db: D1Database,
  actor: string,
  action: string,
  targetId?: number,
  detail?: string
): Promise<void> {
  try {
    const query = `
      INSERT INTO audit_logs (actor, action, target_id, detail)
      VALUES (?, ?, ?, ?)
    `
    await db.prepare(query).bind(actor, action, targetId || null, detail || null).run()
  } catch (e) {
    console.error('[Audit Log Error]', e)
    // 감사 로그 실패해도 메인 로직은 계속
  }
}

// ===== Rate Limit (메모리 기반) =====

const rateLimitMap = new Map<string, number[]>()

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const requests = rateLimitMap.get(key) || []

  // 윈도우 밖의 요청 제거
  const filtered = requests.filter(t => now - t < windowMs)

  if (filtered.length >= maxRequests) {
    return false
  }

  filtered.push(now)
  rateLimitMap.set(key, filtered)
  return true
}

// ===== 시간 슬롯 생성 =====

export interface TimeSlot {
  value: string
  label: string
}

export function generateTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = []
  const startMinutes = 9 * 60  // 09:00
  const endMinutes = 19 * 60   // 19:00

  for (let m = startMinutes; m <= endMinutes; m += 30) {
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    const value = `${h}:${mm}`

    const hour12 = ((Math.floor(m / 60) + 11) % 12) + 1
    const ampm = Math.floor(m / 60) < 12 ? '오전' : '오후'
    const label = `${ampm} ${hour12}:${mm}`

    slots.push({ value, label })
  }

  return slots
}

// ===== 예약 포맷팅 (고객용) =====

export function formatReservationForCustomer(r: any): any {
  return {
    id: r.id,
    customer_name: r.customer_name,
    contact: maskContact(r.contact),
    preferred_date: r.preferred_date,
    preferred_time: r.preferred_time,
    customer_memo: r.customer_memo,
    status: r.status,
    status_label: STATUS_LABELS[r.status] || r.status,
    confirmed_date: r.confirmed_date,
    confirmed_time: r.confirmed_time,
    certificate_available: ['confirmed', 'completed'].includes(r.status),
    created_at: r.created_at,
    cancel_reason: r.cancel_reason
  }
}
