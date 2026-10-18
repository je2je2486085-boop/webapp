-- =====================================================
-- 방문예약 관리 시스템 - 스키마
-- =====================================================

-- 예약 테이블 (핵심)
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 고객 정보 (필수, 생성 이후 고객은 수정 불가)
  customer_name TEXT NOT NULL,
  contact TEXT NOT NULL,                 -- 전화번호 (01012345678 형식, 11자리)
  contact_type TEXT NOT NULL DEFAULT 'phone', -- 'phone' 고정

  -- 고객 희망사항
  preferred_date TEXT,                   -- YYYY-MM-DD, NULL 가능(선택)
  preferred_time TEXT,                   -- HH:MM, 필수 입력 (빈값/무관 옵션 없음)
  customer_memo TEXT,

  -- 상태: requested(신청됨) -> calling(통화중) -> confirmed(확정됨) -> completed(완료) / no_show(미방문) / cancelled(취소됨)
  status TEXT NOT NULL DEFAULT 'requested',

  -- 관리자 통화 기록
  call_at DATETIME,
  call_memo TEXT,

  -- 확정 정보 (관리자가 입력)
  confirmed_date TEXT,
  confirmed_time TEXT,
  certificate_sent_at DATETIME,

  -- 관리자 내부 메모 (고객에게 노출 안 됨)
  admin_note TEXT,

  -- 취소 정보
  cancel_reason TEXT,
  cancelled_by TEXT,                     -- 'customer' | 'admin'
  cancelled_at DATETIME,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_contact ON reservations(contact);
CREATE INDEX IF NOT EXISTS idx_reservations_created ON reservations(created_at);
CREATE INDEX IF NOT EXISTS idx_reservations_preferred_date ON reservations(preferred_date);
CREATE INDEX IF NOT EXISTS idx_reservations_confirmed_date ON reservations(confirmed_date);

-- 고객 로그인용 인증코드(OTP)
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'customer_login',
  verified INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_contact ON otp_codes(contact);

-- 고객 세션 (인증코드 검증 후 발급)
CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY,
  contact TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_contact ON customer_sessions(contact);

-- 관리자 세션 (20분 유휴 자동 로그아웃을 위해 last_activity_at 추적)
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 사업장 설정 (key-value 구조, 유연하게 확장 가능)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shop_name', '모델하우스 예약신청'),
  ('shop_desc', '편안하고 특별한 시간을 예약하세요'),
  ('open_time', '09:00'),
  ('close_time', '19:00'),
  ('contact_phone', ''),
  ('admin_password', 'admin1234');

-- 감사 로그 (모든 수정/삭제 기록)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                   -- 'admin' | 'customer:<contact>'
  action TEXT NOT NULL,                  -- 'create' | 'update' | 'delete' | 'cancel' | 'status_change' ...
  target_type TEXT NOT NULL DEFAULT 'reservation',
  target_id INTEGER,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
