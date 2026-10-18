# 🏢 방문예약 관리 시스템

Hono + Cloudflare Pages + D1(SQLite) + 순수 바닐라 JS로 만든 풀스택 웹앱

## 🎯 개요

- **서비스**: 모델하우스/매장 방문 예약 신청 및 관리 시스템
- **고객 기능**: 회원가입 없이 OTP 인증으로 예약 신청/조회/수정/취소
- **관리자 기능**: 예약 관리, 통화 기록, 확정 정보, 통계 분석
- **디자인**: 다크 모노톤 럭셔리 테마 (부동산/모델하우스 느낌)
- **배포**: Cloudflare Pages + Workers + D1

## 📋 기술 스택

| 분류 | 기술 |
|------|------|
| **백엔드** | Hono (TypeScript), Cloudflare Workers |
| **데이터베이스** | Cloudflare D1 (SQLite) |
| **프론트엔드** | 순수 JavaScript (프레임워크 없음), Vanilla HTML/CSS |
| **빌드** | Vite + @hono/vite-cloudflare-pages |
| **배포** | wrangler CLI, Cloudflare Pages |

## 🚀 빠른 시작

### 1. 환경 설정

```bash
cd /d/projects/webapp
npm install
```

### 2. D1 데이터베이스 설정

```bash
# Cloudflare에서 D1 데이터베이스 생성 후
# wrangler.jsonc의 database_id 업데이트

# 로컬에서 마이그레이션 실행
wrangler d1 migrations apply webapp-production --local
```

### 3. 로컬 개발

```bash
# Vite 개발 서버 시작 (http://localhost:5173)
npm run dev

# 또는 wrangler + D1로 시작
npm run dev:d1
```

### 4. 배포

```bash
npm run build
npm run deploy
```

## 📁 프로젝트 구조

```
webapp/
├── src/
│   ├── index.tsx              # 메인 라우팅 + HTML 셸
│   ├── renderer.tsx           # 공통 레이아웃
│   ├── routes/
│   │   ├── public.ts          # 고객용 API (/api/public/*)
│   │   └── admin.ts           # 관리자용 API (/api/admin/*)
│   └── utils/
│       └── helpers.ts         # 공통 유틸 (전화번호 처리, OTP 등)
├── public/static/
│   ├── customer.js            # 고객 페이지 프론트엔드
│   ├── admin.js               # 관리자 페이지 프론트엔드
│   └── style.css              # 전체 스타일 (다크 테마)
├── migrations/
│   └── 0001_initial_schema.sql # D1 스키마
├── wrangler.jsonc             # Cloudflare Workers 설정
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 🔐 인증 방식

### 고객 인증 (OTP)

1. 전화번호 입력 → 인증코드 요청
2. 인증코드 입력 → 검증 → 세션 발급 (2시간 유효)
3. 데모 모드: 발급된 코드를 API 응답에 직접 표시 (실제 SMS 발송 안 함)

### 관리자 인증

1. 비밀번호 입력 → 로그인
2. 세션 발급 (8시간 유효)
3. 20분 유휴시 자동 로그아웃 (서버+클라이언트)

## 📞 전화번호 처리

- **입력**: 고객은 뒷 8자리만 입력 (010은 고정 표시)
- **저장**: 11자리 숫자 문자열 (01012345678)
- **표시**: 010-1234-5678 (대시 구분)
- **마스킹**: 010-****-5678 (보안)

## 📊 예약 상태 (6단계)

```
requested(신청됨)
    ↓
calling(통화중)
    ↓
confirmed(확정됨)
    ├→ completed(완료)
    ├→ no_show(미방문)
    └→ cancelled(취소됨)
```

- **고객 수정 가능**: `requested`만 가능
- **고객 취소 가능**: `requested`, `calling`, `confirmed`에서 가능
- **확인증 발급 가능**: `confirmed`, `completed`에서 가능

## 🎨 디자인 특징

- **다크 모노톤** (`#121212` 배경, `#f2f0ec` 텍스트)
- **럭셔리 강조색** 골드 (`#c9ad7f`)
- **미니멀한 버튼** (outline 스타일, hover 반전)
- **거의 각진 모서리** (border-radius: 4px / 2px)
- **확인증만 예외** (흰 배경, 인쇄 가독성)

## 📱 주요 화면

### 고객 페이지 (/)

1. **예약 신청**: 성명, 연락처(010+8자리), 희망일시, 메모
2. **예약 완료**: 신청 내역 요약 + 돌아가기
3. **로그인**: 전화번호 + OTP 인증
4. **내 예약 목록**: 신청한 모든 예약 조회
5. **예약 수정**: 날짜/시간/메모만 수정 가능
6. **확인증**: 인쇄/PDF 저장

### 관리자 페이지 (/admin)

1. **대시보드**: 4개 통계 카드
2. **예약 목록 탭**:
   - 상태 필터 (전체/신청/통화/확정/완료/미방문/취소)
   - 검색 (이름/연락처)
   - 상태 즉시 변경 (select)
   - 상세보기 모달
3. **통계·분석 탭**:
   - Chart.js 차트 3개 (월별/요일별/시간대별)
   - 미방문 고객 리스트
4. **설정 모달**:
   - 매장 정보 (상호명, 소개, 대표번호, 영업시간)
   - 비밀번호 변경

## 🔧 API 사양

### 고객용 (/api/public)

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | /settings | ❌ | 매장 기본 정보 조회 |
| POST | /reservations | ❌ | 예약 신청 |
| POST | /auth/request-code | ❌ | OTP 코드 발급 |
| POST | /auth/verify-code | ❌ | OTP 검증 및 로그인 |
| GET | /my-reservations | ✅ | 내 예약 목록 |
| GET | /my-reservations/:id | ✅ | 예약 상세 조회 |
| PATCH | /my-reservations/:id | ✅ | 예약 수정 (requested만) |
| POST | /my-reservations/:id/cancel | ✅ | 예약 취소 |
| GET | /my-reservations/:id/certificate | ✅ | 확인증 데이터 |

### 관리자용 (/api/admin)

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | /login | ❌ | 로그인 |
| POST | /logout | ✅ | 로그아웃 |
| GET | /dashboard | ✅ | 대시보드 통계 |
| GET | /reservations | ✅ | 예약 목록 (필터/검색) |
| GET | /reservations/:id | ✅ | 예약 상세 |
| PATCH | /reservations/:id | ✅ | 예약 수정 (상태/통화/확정/메모) |
| DELETE | /reservations/:id | ✅ | 예약 삭제 |
| POST | /reservations/:id/generate-certificate | ✅ | 확인증 생성 |
| GET | /stats | ✅ | 통계 분석 (월별/요일별/시간대별) |
| GET | /settings | ✅ | 설정 조회 |
| PUT | /settings | ✅ | 설정 수정 |
| PUT | /password | ✅ | 비밀번호 변경 |

## 📝 데이터베이스 스키마

### 주요 테이블

```
reservations        # 예약 정보
├── id
├── customer_name
├── contact          # 01012345678 (11자리)
├── preferred_date / preferred_time
├── status           # requested/calling/confirmed/completed/no_show/cancelled
├── call_at / call_memo
├── confirmed_date / confirmed_time
├── admin_note
├── cancel_reason / cancelled_by / cancelled_at
└── created_at / updated_at

otp_codes           # 인증코드
├── contact
├── code
├── verified / attempts
└── expires_at

customer_sessions   # 고객 세션
├── token
├── contact
└── expires_at

admin_sessions      # 관리자 세션
├── token
├── last_activity_at
└── expires_at

settings            # 매장 설정 (key-value)
audit_logs          # 감사 로그
```

## 🌐 환경변수

### .dev.vars (로컬)

```
DB=<local>
SOLAPI_API_KEY=<선택>
SOLAPI_API_SECRET=<선택>
SOLAPI_SENDER_PHONE=<선택>
SOLAPI_ADMIN_PHONE=<선택>
```

### wrangler secret (프로덕션)

```bash
wrangler secret put SOLAPI_API_KEY
wrangler secret put SOLAPI_API_SECRET
```

## 📦 선택 기능

### SMS 알림 (Solapi)

신규 예약 접수 시 관리자에게 알림 SMS 발송:

```bash
wrangler secret put SOLAPI_API_KEY <key>
wrangler secret put SOLAPI_API_SECRET <secret>
```

환경변수 미설정 시 자동 skip (예약 처리 영향 없음)

## 🧪 테스트 시나리오

1. **예약 신청**: 성명 + 010 + 8자리 + 시간 선택 → 완료 화면
2. **OTP 인증**: 발급된 코드 입력 → 내 예약 조회 가능
3. **수정 & 취소**: 신청됨 상태에서만 수정 가능
4. **관리자**: 상태 변경 → 통화 기록 → 확정 정보 입력 → 확인증 생성
5. **통계**: 월별/요일별/시간대별 예약 분포 확인

## 📌 주의사항

- 전화번호는 010으로 시작하는 11자리만 지원 (이메일 없음)
- 방문 희망시간은 필수 선택 (09:00~19:00, 30분 단위)
- 성명/연락처는 생성 후 수정 불가
- 관리자 비밀번호는 평문 저장 (데모 수준, 실제는 bcrypt 권장)
- 실제 SMS 발송은 Solapi API 키 설정 필요

## 🔗 배포 후 주소

```
고객 페이지:   https://<project>.pages.dev
관리자 페이지: https://<project>.pages.dev/admin
```

## 📞 지원

- Cloudflare Docs: https://developers.cloudflare.com
- Hono Docs: https://hono.dev
- Vite Docs: https://vitejs.dev
