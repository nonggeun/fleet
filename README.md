# Fleet MVP

모바일 매니퓰레이터와 한성FI 작업을 연결하기 위한 Fleet 웹 관제 MVP입니다.

## 목표

이 프로젝트는 처음부터 완성형 Fleet를 만들기보다, 아래 흐름을 먼저 안정화하는 것이 목표입니다.

```text
웹에서 작업 지시 생성
  -> 로봇 bridge가 미션 수신
  -> 한성FI / koras_system 작업 실행
  -> 성공/실패 결과를 웹 Fleet에 보고
```

## 역할

```text
Fleet Web
  - 로봇 목록 표시
  - 미션 생성
  - 미션 상태 표시
  - 결과 이력 확인

Robot Bridge
  - 로봇 PC에서 실행
  - Fleet 서버에서 미션 조회
  - 한성FI 작업 실행
  - 결과 보고

한성FI / koras_system
  - 카메라 캡처
  - factory3 추론
  - pick/place 실행
```

## 기술 스택

현업에서 많이 쓰는 구성을 기준으로 잡았습니다.

```text
Frontend: React + Vite
Backend: FastAPI
Main DB: PostgreSQL
Realtime State: Redis
Robot Event / Mission Queue: MQTT 우선, Kafka/Redpanda 확장
Robot: ROS2 Bridge
Deployment: Docker Compose
Monitoring: Prometheus + Grafana
```

현재 MVP 코드는 아직 메모리 저장소를 사용합니다. 전체 목표 구조는 `docs/architecture.md`에 정리했습니다.

현재 PC의 Node 버전이 v12라 Vite는 Node 12에서 동작 가능한 버전으로 고정했습니다.
운영 또는 장기 개발 전에는 Node 20 LTS로 올리고 최신 Vite로 업데이트하는 것이 좋습니다.

## 현재 구성

```text
backend/
  app.py              FastAPI 서버
  store.py            메모리 기반 로봇/미션 저장소
  requirements.txt    Python 의존성

frontend/
  package.json        React/Vite 의존성
  index.html          Vite 진입점
  src/main.jsx        React 관제 화면
  src/styles.css      화면 스타일

docs/
  architecture.md    현업형 전체 아키텍처
  workflow.md         전체 연동 흐름

infra/
  mosquitto/          MQTT 브로커 설정
  prometheus/         Prometheus 설정

scripts/
  run_dev.sh          개발 서버 실행
```

## 실행

```bash
cd /home/bp/fleet
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
npm --prefix frontend install
./scripts/run_dev.sh
```

브라우저에서 접속:

```text
http://127.0.0.1:5173
```

API 서버:

```text
http://127.0.0.1:8081
```

다른 포트를 쓰려면:

```bash
BACKEND_PORT=8090 FRONTEND_PORT=5174 ./scripts/run_dev.sh
```

## 인프라 실행 골격

PostgreSQL, Redis, MQTT, Kafka 호환 브로커, Prometheus, Grafana는 아래 compose 파일로 띄울 수 있게 골격을 잡았습니다.

```bash
cd /home/bp/fleet
cp .env.example .env
docker compose -f docker-compose.infra.yml up -d
```

접속 포트:

```text
PostgreSQL: 5432
Redis: 6379
MQTT: 1883
MQTT WebSocket: 9001
Kafka compatible broker: 19092
Prometheus: 9090
Grafana: 3000
```

Grafana 초기 계정은 `.env` 기준으로 `admin / admin`입니다. 운영에서는 반드시 바꿔야 합니다.

## MVP API

로봇 등록 또는 상태 업데이트:

```http
POST /api/robots/{robot_id}/state
```

로봇 위치는 bridge가 아래 값들을 보내면 웹 지도에 표시됩니다.

```json
{
  "state": "idle",
  "battery_percent": 92,
  "location": "HOME_DOCK",
  "map_id": "WAREHOUSE_A",
  "pose_x_m": 2.4,
  "pose_y_m": 1.8,
  "heading_deg": 90,
  "velocity_mps": 0.0,
  "mode": "AUTO"
}
```

미션 생성:

```http
POST /api/missions
```

현재 기본 작업 지시는 박스 단위 의류 피킹입니다.

```json
{
  "task_type": "box_batch_pick",
  "robot_id": "mobile_manipulator_01",
  "pickup_stations": [
    "HSFI_PICK_STATION_1",
    "HSFI_PICK_STATION_2",
    "HSFI_PICK_STATION_3",
    "HSFI_PICK_STATION_4"
  ],
  "box_id": "BOX-001",
  "target_quantity": 25,
  "target": "top_garment",
  "place_location": "BOX_DROP_ZONE_1"
}
```

웹에서는 `작업 지시` 버튼을 누르면 모달로 위 값을 입력합니다.
`로봇 추가`도 모달로 처리합니다.

다음 대기 미션 가져오기:

```http
GET /api/robots/{robot_id}/next-mission
```

미션 상태 업데이트:

```http
POST /api/missions/{mission_id}/state
```

## 다음 단계

1. `koras_fleet_bridge`에서 `/api/robots/{robot_id}/next-mission` polling
2. 미션을 한성FI local task로 변환
3. 작업 성공/실패를 `/api/missions/{mission_id}/state`로 보고
4. 이후 ROS 2 Action 방식으로 bridge 내부 구현 정리
