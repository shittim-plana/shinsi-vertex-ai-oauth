# 출석 시스템 아키텍처 설계서

## 1. 개요

### 1.1 시스템 목적
- 사용자 일일 출석 체크 시스템 구현
- 연속 출석에 따른 포인트 보상 증가 메커니즘 제공
- KST(Asia/Seoul) 시간대 기준 일일 제한 및 월간 초기화

### 1.2 핵심 요구사항
- **기본 보상**: 첫 출석 30,000포인트 (배수 1.0)
- **배수 증가**: 같은 달 2번째 출석부터 0.1씩 증가 (1.1, 1.2, ..., 최대 2.0)
- **포인트 계산**: ⌊30,000 × 현재배수⌋ (1포인트 단위 내림)
- **제한**: 하루 1회, KST 00:00~23:59 기준
- **초기화**: 매월 1일 00:00 KST에 회차/배수 초기화
- **누적 유지**: 누락일이 있어도 해당 월 누적 회차는 유지

## 2. 데이터 모델 설계

### 2.1 출석 상태 문서 (Firestore)

**컬렉션 경로**: `users/{uid}/attendance/{yyyyMM}`

```typescript
interface AttendanceState {
  monthKey: string;           // 'yyyy-MM' 형식 (예: '2025-01')
  lastClaimedAt: Timestamp;   // 마지막 출석 시점 (서버시간)
  claimCount: number;         // 해당 월 총 출석 횟수
  currentMultiplier: number;  // 현재 배수 (1.0 ~ 2.0)
  totalAwarded: number;       // 해당 월 총 지급 포인트
  daySet: string[];           // 출석한 날짜들 ['2025-01-15', '2025-01-16', ...]
  createdAt: Timestamp;       // 문서 생성 시점
  updatedAt: Timestamp;       // 마지막 업데이트 시점
}
```

### 2.2 포인트 원장 확장

**기존 시스템 활용**: [`src/types/point.ts`](src/types/point.ts:10)의 `PointTransactionType`에 `'attendance'` 추가

```typescript
// 기존 PointTransaction 인터페이스 재사용
interface PointTransaction {
  id: string;
  userId: string;
  type: 'attendance';         // 새 타입 추가
  amount: number;             // 지급된 포인트 (양수)
  description: string;        // '출석 보상 (배수: 1.2, 월: 2025-01)'
  transactionDate: Date;
  relatedId?: string;         // 월키(yyyyMM) 또는 requestId
}
```

**컬렉션**: 기존 [`pointTransactions`](src/firebase/collections.ts:9) 재사용

### 2.3 포인트 잔액

**기존 시스템 재사용**: [`pointBalances`](src/firebase/collections.ts:8) 컬렉션과 [`PointBalance`](src/types/point.ts:4) 인터페이스

## 3. API 설계

### 3.1 출석 체크 API

**엔드포인트**: `POST /src/app/api/attendance/claim/route.ts`

#### 3.1.1 요청
```typescript
// Headers
Authorization: Firebase ID Token (기존 인증 흐름 재사용)
Content-Type: application/json
Idempotency-Key?: string // 선택적, 중복 요청 방지

// Body (선택적 파라미터들)
{
  requestId?: string  // 멱등성 키 (없으면 자동 생성)
}
```

#### 3.1.2 응답
```typescript
interface ClaimResponse {
  success: boolean;
  awardedAmount: number;      // 이번에 지급된 포인트
  multiplier: number;         // 현재 배수
  nextMultiplier: number;     // 다음 출석 시 배수
  claimCount: number;         // 이번 달 총 출석 횟수
  monthKey: string;           // 현재 월 키 (yyyy-MM)
  todayClaimed: boolean;      // 오늘 이미 출석했는지
  resetAtKST: string;         // 다음 월 리셋 시점 (ISO string)
  balance?: number;           // 현재 포인트 잔액 (선택적)
}
```

#### 3.1.3 에러 응답
```typescript
// 400: 이미 오늘 출석함
{ error: 'ALREADY_CLAIMED_TODAY', message: '오늘 이미 출석하셨습니다.' }

// 401: 인증 실패
{ error: 'UNAUTHORIZED', message: '인증이 필요합니다.' }

// 429: 속도 제한
{ error: 'RATE_LIMITED', message: '잠시 후 다시 시도해주세요.' }

// 500: 서버 오류
{ error: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' }
```

### 3.2 배수 계산 로직

```typescript
// 배수 계산 함수
function calculateMultiplier(claimCount: number): number {
  return Math.min(1.0 + 0.1 * claimCount, 2.0);
}

// 포인트 계산 함수  
function calculateReward(claimCount: number): number {
  const baseAmount = 20000;
  const multiplier = calculateMultiplier(claimCount);
  return Math.floor(baseAmount * multiplier);
}
```

## 4. 트랜잭션 처리 순서도

```
1. 요청 수신 및 인증 확인
   ↓
2. KST 기준 '오늘' 날짜 계산 (yyyy-MM-dd)
   ↓
3. 현재 월키(yyyy-MM) 계산
   ↓
4. [Firestore Transaction 시작]
   ↓
5. 사용자 출석 상태 문서 조회 (users/{uid}/attendance/{yyyyMM})
   ↓
6. 문서 존재 여부 및 월 경계 검사
   - 없거나 다른 월이면: 새 월 상태로 초기화
   ↓
7. 오늘 출석 여부 검사 (lastClaimedAt의 KST 날짜)
   - 이미 출석했으면: 멱등 응답 반환 또는 에러
   ↓
8. 출석 처리
   - claimCount 증가
   - currentMultiplier 재계산
   - 지급 포인트 계산
   - daySet에 오늘 날짜 추가
   - lastClaimedAt 업데이트
   ↓
9. 포인트 잔액 업데이트 (기존 pointBalances 활용)
   ↓
10. 포인트 거래 내역 생성 (기존 pointTransactions 활용)
    ↓
11. [Firestore Transaction 커밋]
    ↓
12. 성공 응답 반환
```

## 5. 시간대 처리 규칙

### 5.1 시간대 유틸리티 확장

**기존**: [`src/utils/dateUtils.ts`](src/utils/dateUtils.ts:1)
**추가 필요**: KST 변환 및 월 경계 계산 함수

```typescript
// 추가할 함수들
export function getCurrentKSTDate(): string;           // 'yyyy-MM-dd'
export function getCurrentKSTMonth(): string;          // 'yyyy-MM'
export function getNextMonthResetKST(): Date;          // 다음 월 1일 00:00 KST
export function isSameKSTDay(date1: Date, date2: Date): boolean;
export function formatKSTDateTime(date: Date): string; // 디버깅용
```

### 5.2 서버 시간 정책
- **신뢰 원칙**: 서버 시간만 신뢰, 클라이언트 시간 무시
- **구현**: `serverTimestamp()`를 KST로 변환 후 처리
- **라이브러리**: `date-fns-tz` 활용 권장

## 6. 보안 및 권한

### 6.1 Firestore Rules 추가

```javascript
// firestore.rules에 추가
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 기존 규칙들...
    
    // 포인트 잔액: 본인만 읽기 가능
    match /pointBalances/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false; // 서버에서만 쓰기
    }
    
    // 포인트 거래 내역: 본인 것만 읽기 가능
    match /pointTransactions/{transactionId} {
      allow read: if request.auth != null 
                  && request.auth.uid == resource.data.userId;
      allow write: if false; // 서버에서만 쓰기
    }
    
    // 출석 상태: 본인만 읽기 가능
    match /users/{userId}/attendance/{monthKey} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false; // 서버에서만 쓰기
    }
  }
}
```

### 6.2 인증 미들웨어

**재사용**: 기존 Firebase Admin SDK 패턴 ([`src/firebase/firebaseAdmin.ts`](src/firebase/firebaseAdmin.ts:1))
```typescript
// API 라우트에서 uid 추출 패턴
const authHeader = req.headers.authorization;
const token = authHeader?.replace('Bearer ', '');
const decodedToken = await admin.auth().verifyIdToken(token);
const uid = decodedToken.uid;
```

## 7. Firestore 인덱스

### 7.1 필요한 인덱스

[`firestore.indexes.json`](firestore.indexes.json:1)에 추가:

```json
{
  "indexes": [
    {
      "collectionGroup": "attendance",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "monthKey", "order": "ASCENDING" },
        { "fieldPath": "lastClaimedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "pointTransactions", 
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "transactionDate", "order": "DESCENDING" }
      ]
    }
  ]
}
```

## 8. 클라이언트 UI 연동

### 8.1 프로필 페이지 출석 카드

**위치**: [`src/app/profile/page.tsx`](src/app/profile/page.tsx:1)

```typescript
// 출석 상태 조회 훅
const useAttendanceStatus = (uid: string) => {
  // GET /api/attendance/status 또는 claim API의 상태 정보 활용
};

// 출석 카드 컴포넌트
const AttendanceCard = () => {
  const { claimAttendance, loading, status } = useAttendance();
  
  return (
    <Card>
      <Text>이번 달 출석: {status.claimCount}회</Text>
      <Text>현재 배수: {status.multiplier}배</Text>
      <Text>다음 보상: {calculateReward(status.claimCount)} 포인트</Text>
      <Button onClick={claimAttendance} disabled={status.todayClaimed}>
        {status.todayClaimed ? '출석 완료' : '오늘 출석하기'}
      </Button>
    </Card>
  );
};
```

### 8.2 헤더 출석 배지

**위치**: [`src/components/layout/AppShell.tsx`](src/components/layout/AppShell.tsx:1)

```typescript
// 기존 포인트 표시 로직 옆에 출석 배지 추가
const AttendanceBadge = () => {
  const { status } = useAttendance();
  
  if (status.todayClaimed) return null;
  
  return (
    <Badge color="green" variant="dot">
      오늘 출석
    </Badge>
  );
};
```

## 9. 멱등성 및 동시성 처리

### 9.1 멱등성 보장
- **Request ID**: 클라이언트에서 UUID 생성 또는 서버에서 자동 생성
- **중복 검사**: `relatedId` 필드에 requestId 저장하여 중복 거래 방지
- **응답 캐시**: 동일 requestId로 재요청 시 이전 결과 반환

### 9.2 동시성 제어
- **Firestore Transaction**: 모든 출석 처리를 단일 트랜잭션으로 처리
- **Retry Logic**: 트랜잭션 실패 시 3회까지 재시도
- **Rate Limiting**: 동일 사용자 5초 내 중복 요청 방지

## 10. 코드 재사용 지점

### 10.1 기존 시스템 활용
- **포인트 잔액 관리**: [`pointBalanceDoc`](src/firebase/config.ts:61), [`PointBalance`](src/types/point.ts:4) 재사용
- **포인트 거래 생성**: [`pointTransactionsCol`](src/firebase/config.ts:64), [`PointTransaction`](src/types/point.ts:18) 재사용  
- **Firebase Admin**: [`adminApp`](src/firebase/firebaseAdmin.ts:4) 재사용
- **인증 컨텍스트**: [`AuthContext`](src/contexts/AuthContext.tsx:1)의 uid 추출 패턴 재사용

### 10.2 신규 생성 필요
- **출석 상태 관리**: 새 컬렉션 및 인터페이스
- **KST 시간 유틸**: [`dateUtils.ts`](src/utils/dateUtils.ts:1) 확장
- **출석 API**: 새 엔드포인트 생성
- **UI 컴포넌트**: 출석 카드 및 배지

## 11. 테스트 시나리오

### 11.1 기본 시나리오
1. **첫 출석**: 30,000포인트 지급, 배수 1.0
2. **연속 출석**: 2일차 33,000포인트 (배수 1.1), 3일차 36,000포인트 (배수 1.2)
3. **최대 배수**: 11일차부터 60,000포인트 (배수 2.0) 유지
4. **월 경계**: 2월 1일 00:00 KST에 배수 1.0으로 초기화

### 11.2 예외 시나리오
1. **중복 출석**: 같은 날 2회 시도 시 에러 또는 멱등 응답
2. **월 건너뛰기**: 1월에 5회 출석 → 3월 첫 출석 시 배수 1.0부터 시작
3. **누락일**: 1일, 3일, 5일 출석 시 claimCount=3, 배수 1.3
4. **시간대 경계**: KST 23:59와 00:01 출석이 다른 날로 처리

### 11.3 동시성 테스트
1. **동시 출석**: 같은 사용자가 동시에 여러 요청
2. **멱등성**: 동일 requestId로 재요청
3. **트랜잭션 충돌**: Firestore 트랜잭션 재시도 동작

### 11.4 성능 테스트
1. **대량 동시 사용자**: 1000명 동시 출석 처리
2. **응답 시간**: 평균 응답 시간 < 2초
3. **DB 부하**: 트랜잭션 처리량 모니터링

## 12. 모니터링 및 로깅

### 12.1 로그 수준
- **INFO**: 성공적인 출석 처리
- **WARN**: 중복 출석 시도, 시간대 이슈
- **ERROR**: 트랜잭션 실패, DB 에러

### 12.2 메트릭
- 일일 출석 사용자 수
- 평균 출석 연속 일수
- 월별 포인트 지급량
- API 응답 시간 및 에러율

---

**최종 수정**: 2025-01-08
**담당자**: System Architect
**승인 대기**: 사용자 검토 필요