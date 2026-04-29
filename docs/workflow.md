# Fleet MVP 워크플로우

## 핵심 구조

```text
WMS -> Fleet Web -> koras_fleet_bridge -> 한성FI -> factory3 -> koras_system -> 로봇
```

## 처음 만들 기능

```text
1. 웹에서 작업 지시 생성
2. 로봇 bridge가 대기 미션 조회
3. bridge가 한성FI 작업 실행
4. 작업 결과를 Fleet Web에 보고
5. 웹에서 상태 확인
```

## 현재 작업 기준

모바일 매니퓰레이터는 박스를 싣고 한 번 이동한 뒤, HSFI 피킹 위치에서 의류를 20~30장 담고 지정 장소에 내려놓는다.

피킹 위치:

```text
HSFI_PICK_STATION_1
HSFI_PICK_STATION_2
HSFI_PICK_STATION_3
HSFI_PICK_STATION_4
```

작업 타입:

```text
box_batch_pick
```

## 미션 상태

```text
RECEIVED
ASSIGNED
PICKING
COMPLETED
FAILED
CANCELED
```

## 로봇 상태

```text
offline
idle
assigned
moving
picking
error
```

## Bridge 동작 예시

```text
1. 로봇 상태를 서버에 등록한다.
2. /api/robots/{robot_id}/next-mission을 주기적으로 호출한다.
3. 미션이 있으면 한성FI 작업을 시작한다.
4. 진행 중 상태를 /api/missions/{mission_id}/state로 보낸다.
5. 성공하면 COMPLETED, 실패하면 FAILED로 보고한다.
```

## 한성FI 작업 순서

```text
빈 박스 적재 확인
HSFI 피킹 위치로 이동
capture
predict
pick point 계산
tf2 변환
approach pose 이동
pick pose 이동
gripper close
retreat
박스에 적재
목표 수량까지 반복
BOX_DROP_ZONE으로 이동
박스 하차
완료 보고
```
