# HSFI Fleet — CLAUDE.md

## 프로젝트 개요

한성FI 창고에서 모바일 매니퓰레이터 4대가 의류 피킹 작업을 수행하는 Fleet 웹 관제 시스템.  
WMS 주문 → 로봇 미션 배정 → 피킹 실행 → 결과 보고 흐름을 안정화하는 것이 MVP 목표.

## 개발 환경 실행

```bash
# 인프라 (PostgreSQL, Redis, MQTT, Redpanda, Prometheus, Grafana)
docker compose -f docker-compose.infra.yml up -d

# 백엔드 + 프론트엔드
source .venv/bin/activate
./scripts/run_dev.sh
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8081
- Grafana: http://localhost:3000 (admin / admin)

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | React 18, Vite 2.x (Node 12 호환 고정) |
| Backend | FastAPI + uvicorn |
| 저장소 | 메모리 (FleetStore) — PostgreSQL 전환 예정 |
| Infra | Docker Compose (PostgreSQL, Redis, MQTT, Redpanda, Prometheus, Grafana) |

> Node 버전이 v12라 Vite는 2.x로 고정. 운영 전에 Node 20 LTS + Vite 최신으로 업그레이드 필요.

## 파일 구조

```
backend/
  app.py        FastAPI 라우터
  store.py      메모리 기반 로봇/미션 저장소 (FleetStore)

frontend/src/
  main.jsx      단일 파일 React 앱 (컴포넌트 분리 예정)
  styles.css    CSS (CSS variables 기반 디자인 토큰)

infra/
  mosquitto/    MQTT 브로커 설정
  prometheus/   Prometheus scrape 설정

scripts/
  run_dev.sh    백엔드(uvicorn) + 프론트엔드(vite) 동시 실행
```

## API 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| GET | /api/robots | 로봇 전체 목록 |
| POST | /api/robots | 로봇 생성 |
| POST | /api/robots/{id}/state | 로봇 상태 업데이트 (bridge가 주기적으로 호출) |
| GET | /api/robots/{id}/next-mission | 다음 대기 미션 조회 및 ASSIGNED 전환 |
| GET | /api/missions | 미션 전체 목록 (최신순) |
| POST | /api/missions | 미션 생성 |
| POST | /api/missions/{id}/state | 미션 상태 업데이트 |

## 미션 상태 흐름

```
RECEIVED → ASSIGNED → NAVIGATING → ARRIVED → PICKING → PLACING → COMPLETED
                                                                 → FAILED
                                                                 → CANCELED
```

## 프론트엔드 구조 (main.jsx)

| 컴포넌트 | 역할 |
|---|---|
| `Header` | 탭, 로봇 추가/작업 지시 버튼, 라이브 연결 dot |
| `Summary` | 운영 로봇, 대기/진행/완료 작업, 피킹 목표, 장애 수 카드 |
| `DemandPanel` | A/B/C 수요 등급별 렉 분류 및 웨이브 설정 (현재 정적) |
| `AllocationPanel` | 4대 로봇 배정 점수 계산 및 표시 |
| `RobotGrid` | 전체 로봇 카드 그리드 (auto-fit) |
| `MapPanel` | 창고 평면도 + 로봇 마커 |
| `StationGrid` | HSFI 피킹 위치 4곳 2×2 그리드 |
| `WorkQueue` | 필터(전체/대기/진행/완료/실패) + 취소 버튼 |
| `EventLog` | 최근 미션 이벤트 12건 |

## 폴링 및 실시간

- 3초 간격 자동 폴링 (`setInterval`)
- 연결 상태: 헤더의 녹색 pulse dot (연결 끊기면 빨간색 + 에러 배너)
- Toast 알림: API 성공/실패 시 우측 하단 4초 표시

## 다음 단계

1. `koras_fleet_bridge` 에서 `/next-mission` 폴링 구현
2. PostgreSQL + Redis로 저장소 교체 (`store.py` 인터페이스 유지)
3. MQTT 로봇 이벤트 수신 → 미션 상태 자동 업데이트
4. Node 20 LTS 업그레이드 후 Vite 최신 버전으로 교체
5. WebSocket 또는 SSE로 폴링 대체 (실시간 지연 개선)


## 참고

1. 계획 및 생각은 opus 4.6, 코드 작성은 sonnet 4.6 으로 구현