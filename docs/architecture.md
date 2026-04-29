# HSFI Fleet 전체 아키텍처

## 목표 구조

```text
React + Vite
  -> FastAPI
    -> PostgreSQL
    -> Redis
    -> MQTT / Kafka
    -> ROS2 Bridge
      -> 모바일 매니퓰레이터

Prometheus -> Grafana
```

## 서비스 역할

| 영역 | 기술 | 역할 |
| --- | --- | --- |
| Frontend | React + Vite | 관제 화면, 로봇 위치, 작업 큐, 렉 수요 현황 표시 |
| Backend API | FastAPI | WMS 주문 수신, 미션 생성, 로봇 배정, 상태 API 제공 |
| Main DB | PostgreSQL | 로봇, 미션, 렉, SKU, 주문, 작업 이력 저장 |
| Realtime State | Redis | 로봇 현재 위치, 배터리, 작업 상태처럼 자주 바뀌는 값 캐시 |
| Robot Event / Queue | MQTT | 로봇 명령, 상태 이벤트, 가벼운 실시간 메시지 |
| Event Stream | Kafka 또는 Redpanda | 작업 이벤트 로그, 분석용 스트림, 대량 이벤트 처리 |
| Robot | ROS2 | 실제 로봇 이동, 피킹, 하차 제어 |
| Deployment | Docker Compose | 개발/초기 운영 환경 실행 |
| Monitoring | Prometheus + Grafana | API, 로봇, 큐, DB, 작업 처리량 모니터링 |

## 핵심 데이터 흐름

```text
1. WMS 주문 생성
2. FastAPI가 주문을 받음
3. SKU, 수량, 렉 위치를 기준으로 피킹 배치 생성
4. PostgreSQL에 주문/미션 저장
5. Redis에 로봇 현재 상태 캐시
6. Fleet Scheduler가 로봇 4대 중 가장 유리한 로봇 선택
7. MQTT 또는 Kafka로 로봇 Bridge에 미션 전달
8. ROS2 Bridge가 모바일 매니퓰레이터에 이동/피킹 명령 실행
9. 로봇 상태와 이벤트를 Backend로 보고
10. 웹 화면은 REST + WebSocket으로 실시간 갱신
11. Prometheus가 지표 수집
12. Grafana가 대시보드로 표시
```

## 피킹 작업 기준

현재 HSFI 시나리오는 아래 기준으로 잡는다.

```text
렉 선반: 약 450개
선반당 SKU: 약 28개
로봇 수: 4대
한 번 이동당 피킹 수량: 20~30장
작업 방식: 박스 단위 배치 피킹
```

작업 생성 기준:

```text
WMS 주문
  -> SKU별 수요 등급 계산
  -> 가까운 렉끼리 묶음
  -> 20~30장 단위 박스 작업 생성
  -> 로봇 4대에 동적 배정
```

## 로봇 배정 점수

Fleet Scheduler는 아래 값을 점수화한다.

```text
배정 점수 =
  현재 로봇 위치에서 첫 렉까지 거리
  + 렉 사이 이동 거리
  + DROP_ZONE까지 거리
  + 현재 로봇 작업 큐 길이
  + 배터리 패널티
  + 같은 통로 혼잡도
  + 작업 우선순위 보정
```

점수가 가장 낮은 로봇에게 미션을 배정한다.

## PostgreSQL에 저장할 주요 테이블

초기에는 아래 정도면 충분하다.

```text
robots
  robot_id
  name
  model
  status
  battery_percent
  last_seen_at

robot_states
  robot_id
  x
  y
  heading
  location
  velocity
  updated_at

racks
  rack_id
  zone
  aisle
  station_id
  x
  y

skus
  sku_id
  name
  category
  demand_class

rack_skus
  rack_id
  sku_id
  quantity

orders
  order_id
  priority
  status
  created_at

missions
  mission_id
  robot_id
  order_id
  rack_group
  demand_class
  target_quantity
  picked_quantity
  station_id
  drop_zone
  status
  assignment_score
  created_at
  updated_at

mission_events
  mission_id
  event_type
  payload
  created_at
```

## Redis에 둘 데이터

Redis는 오래 보관할 데이터가 아니라 빠르게 바뀌는 상태값에 쓴다.

```text
robot:{robot_id}:state
  현재 위치
  배터리
  속도
  현재 미션
  마지막 업데이트 시간

zone:{zone_id}:traffic
  현재 통로 혼잡도

mission:{mission_id}:progress
  실시간 진행률
```

## MQTT와 Kafka 사용 기준

### MQTT

로봇 제어와 상태 메시지에 적합하다.

```text
fleet/robots/{robot_id}/command
fleet/robots/{robot_id}/state
fleet/robots/{robot_id}/event
fleet/missions/{mission_id}/status
```

장점:

```text
가볍다
로봇/IoT 장비에서 많이 쓴다
네트워크가 불안정해도 운용하기 쉽다
명령/상태 전달 구조가 단순하다
```

초기 HSFI Fleet에서는 MQTT를 먼저 쓰는 것이 좋다.

### Kafka

대량 이벤트 저장과 분석에 적합하다.

```text
mission.created
mission.assigned
mission.started
mission.completed
robot.state.changed
rack.demand.updated
```

장점:

```text
이벤트를 오래 보관할 수 있다
처리량이 크다
나중에 분석, 리포트, 장애 추적에 좋다
여러 시스템이 같은 이벤트를 구독하기 좋다
```

초기에는 Kafka를 필수로 두지 말고, 이벤트 이력과 분석 요구가 커질 때 붙이는 것이 현실적이다.

## Grafana 설명

Grafana는 관제 데이터를 예쁜 차트로 보여주는 도구다.

Grafana 자체가 데이터를 직접 수집하는 것은 아니고, 보통 아래 저장소에서 데이터를 읽는다.

```text
Prometheus
PostgreSQL
Loki
InfluxDB
```

Fleet에서 Grafana로 볼 지표:

```text
시간당 피킹 수
미션 완료율
미션 평균 소요 시간
로봇별 가동률
로봇별 배터리 추이
장애 발생 횟수
렉 존별 작업량
MQTT/Kafka 메시지 처리량
API 응답 시간
DB 커넥션 상태
```

웹 관제 화면은 “현재 작업을 조작하는 화면”이고, Grafana는 “운영 지표를 분석하는 화면”으로 나누면 된다.

## Kafka 설명

Kafka는 이벤트를 순서대로 쌓아두는 메시지 스트리밍 시스템이다.

일반 API 호출은 한 번 요청하고 끝난다.

```text
Frontend -> Backend -> DB
```

Kafka는 이벤트를 로그처럼 계속 쌓는다.

```text
Backend -> Kafka Topic -> 여러 Consumer
```

예를 들어 미션 완료 이벤트가 생기면:

```text
mission.completed 이벤트 발생
  -> Kafka에 저장
  -> 통계 서비스가 읽음
  -> 알림 서비스가 읽음
  -> 리포트 서비스가 읽음
  -> 장애 분석 서비스가 나중에 다시 읽음
```

Kafka가 좋은 경우:

```text
이벤트가 많다
여러 서비스가 같은 이벤트를 봐야 한다
나중에 과거 이벤트를 다시 재처리해야 한다
분석/리포트/모니터링이 중요하다
```

Kafka가 과한 경우:

```text
로봇 4대 정도의 초기 MVP
단순 명령 전달
팀원이 Kafka 운영 경험이 없음
서버 리소스가 작음
```

그래서 현재 추천은:

```text
로봇 명령/상태: MQTT
이벤트 이력/분석: Kafka 또는 Redpanda
초기 MVP: MQTT + PostgreSQL + Redis
확장 단계: Kafka 추가
```

## 단계별 도입 순서

```text
1단계
React + FastAPI + PostgreSQL

2단계
Redis로 로봇 실시간 상태 캐시

3단계
WebSocket으로 웹 실시간 갱신

4단계
MQTT로 로봇 Bridge 연동

5단계
Prometheus + Grafana로 운영 지표 모니터링

6단계
Kafka 또는 Redpanda로 이벤트 스트림 확장

7단계
Docker Compose에서 Kubernetes로 확장
```
