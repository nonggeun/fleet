import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8081`;

const STATIONS = [
  { id: "HSFI_PICK_STATION_1", label: "HSFI 1", x: 24, y: 28 },
  { id: "HSFI_PICK_STATION_2", label: "HSFI 2", x: 48, y: 28 },
  { id: "HSFI_PICK_STATION_3", label: "HSFI 3", x: 24, y: 62 },
  { id: "HSFI_PICK_STATION_4", label: "HSFI 4", x: 48, y: 62 },
];

const RACK_TOTAL = 450;
const SKU_PER_RACK = 28;
const ROBOT_TARGET = 4;

const DEMAND_CLASSES = [
  { id: "A", label: "A급 핫존", racks: 68, share: 58, color: "hot", note: "출고 빈도 높음" },
  { id: "B", label: "B급 표준존", racks: 157, share: 32, color: "steady", note: "일반 주문" },
  { id: "C", label: "C급 롱테일", racks: 225, share: 10, color: "slow", note: "저빈도 보충" },
];

const WORKFLOW_STEPS = [
  { label: "WMS 주문", text: "SKU, 수량, 납기, 렉 위치 수신" },
  { label: "수요 분류", text: "A/B/C 등급과 핫존 병목 확인" },
  { label: "배치 생성", text: "가까운 렉끼리 20~30장 박스 작업으로 묶음" },
  { label: "로봇 배정", text: "거리, 배터리, 큐, 혼잡도 점수로 4대에 분배" },
  { label: "피킹/하차", text: "렉에서 의류 피킹 후 BOX_DROP_ZONE에 완료" },
];

const RACK_WAVES = [
  { id: "WAVE-A1", demand: "A", rackGroup: "R001-R068", station: "HSFI_PICK_STATION_1", quantity: 30, load: 92 },
  { id: "WAVE-B1", demand: "B", rackGroup: "R069-R180", station: "HSFI_PICK_STATION_2", quantity: 26, load: 64 },
  { id: "WAVE-A2", demand: "A", rackGroup: "R181-R240", station: "HSFI_PICK_STATION_3", quantity: 28, load: 81 },
  { id: "WAVE-C1", demand: "C", rackGroup: "R241-R450", station: "HSFI_PICK_STATION_4", quantity: 22, load: 36 },
];

const PENDING_STATES = new Set(["RECEIVED", "ASSIGNED"]);
const ACTIVE_STATES = new Set(["NAVIGATING", "ARRIVED", "PICKING", "PLACING"]);
const ISSUE_STATES = new Set(["FAILED", "CANCELED"]);

function stateLabel(state) {
  const labels = {
    offline: "오프라인",
    idle: "대기",
    assigned: "배정됨",
    moving: "이동 중",
    picking: "피킹 중",
    error: "장애",
    RECEIVED: "접수",
    ASSIGNED: "배정",
    NAVIGATING: "이동 중",
    ARRIVED: "도착",
    PICKING: "피킹",
    PLACING: "하차 중",
    COMPLETED: "완료",
    FAILED: "실패",
    CANCELED: "취소",
  };
  return labels[state] || state || "-";
}

function stateClass(state) {
  return String(state || "unknown").toLowerCase();
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("ko-KR", { hour12: false });
}

function missionStations(mission) {
  if (Array.isArray(mission.pickup_stations) && mission.pickup_stations.length > 0) {
    return mission.pickup_stations;
  }
  return mission.station_id ? [mission.station_id] : [];
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function Header({ activeTab, setActiveTab, openRobotModal, openWorkModal, refresh, lastUpdated }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = [
    { id: "dashboard", label: "대시보드" },
    { id: "work", label: "작업 큐" },
    { id: "events", label: "이벤트" },
  ];

  const selectTab = (tab) => {
    setActiveTab(tab);
    setMenuOpen(false);
  };

  return (
    <header className="topbar">
      <button
        className={`hamburger ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="메뉴 열기"
        aria-expanded={menuOpen}
      >
        <span />
        <span />
        <span />
      </button>

      <div className="brand">
        <strong>HSFI Fleet</strong>
        <span>수요 기반 모바일 매니퓰레이터 피킹 관제</span>
      </div>

      <nav className={`tabs ${menuOpen ? "open" : ""}`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <span className="last-updated">{lastUpdated || "-"}</span>
        <button className="secondary-button" onClick={openRobotModal}>로봇 추가</button>
        <button onClick={openWorkModal}>작업 지시</button>
        <button className="icon-button" onClick={refresh} title="새로고침">↻</button>
      </div>
    </header>
  );
}

function Summary({ robots, missions }) {
  const activeTarget = missions
    .filter((mission) => !["COMPLETED", "FAILED", "CANCELED"].includes(mission.state))
    .reduce((sum, mission) => sum + (mission.target_quantity || 0), 0);
  const issues = robots.filter((robot) => robot.state === "error" || robot.estop).length
    + missions.filter((mission) => ISSUE_STATES.has(mission.state)).length;

  return (
    <section className="summary-grid">
      <SummaryCard label="운영 로봇" value={robots.length} />
      <SummaryCard label="대기 작업" value={missions.filter((mission) => PENDING_STATES.has(mission.state)).length} />
      <SummaryCard label="진행 작업" value={missions.filter((mission) => ACTIVE_STATES.has(mission.state)).length} />
      <SummaryCard label="피킹 목표" value={activeTarget} />
      <SummaryCard label="장애/실패" value={issues} danger />
    </section>
  );
}

function SummaryCard({ label, value, danger }) {
  return (
    <article className={`summary-card ${danger ? "danger" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function CommandPanel({ robots, missions, openWorkModal }) {
  const activeMissions = missions.filter((mission) => !["COMPLETED", "FAILED", "CANCELED"].includes(mission.state));
  const robotReady = robots.filter((robot) => robot.state !== "offline" && !robot.estop).length;
  const utilization = Math.round((Math.min(robotReady, ROBOT_TARGET) / ROBOT_TARGET) * 100);

  return (
    <section className="command-panel">
      <div className="command-copy">
        <span className="eyebrow">HSFI PICKING CONTROL</span>
        <h1>수요가 몰리는 렉부터 4대 로봇에 자동 분배</h1>
        <p>450개 렉 선반, 렉당 28개 의류 SKU를 WMS 수요 기준으로 묶고 20~30장 박스 피킹 미션으로 전환합니다.</p>
      </div>
      <div className="command-metrics">
        <div><span>렉 선반</span><strong>{RACK_TOTAL}</strong></div>
        <div><span>SKU 적치 슬롯</span><strong>{RACK_TOTAL * SKU_PER_RACK}</strong></div>
        <div><span>로봇 가동률</span><strong>{utilization}%</strong></div>
        <div><span>열린 배치</span><strong>{activeMissions.length}</strong></div>
      </div>
      <button onClick={openWorkModal}>배치 피킹 작업 생성</button>
    </section>
  );
}

function DemandPanel({ missions }) {
  const activeCount = missions.filter((mission) => ACTIVE_STATES.has(mission.state)).length;

  return (
    <section className="panel demand-panel">
      <div className="panel-header">
        <div>
          <h2>수요 기반 렉 분류</h2>
          <p>많이 나가는 SKU가 있는 렉을 먼저 묶어 이동 낭비를 줄입니다.</p>
        </div>
        <span className="panel-note">ACTIVE {activeCount}</span>
      </div>
      <div className="demand-board">
        {DEMAND_CLASSES.map((item) => (
          <article className={`demand-card ${item.color}`} key={item.id}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.note}</span>
            </div>
            <div className="demand-bar"><span style={{ width: `${item.share}%` }} /></div>
            <dl>
              <div><dt>렉 수</dt><dd>{item.racks}</dd></div>
              <div><dt>출고 비중</dt><dd>{item.share}%</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="wave-strip">
        {RACK_WAVES.map((wave) => (
          <div key={wave.id}>
            <span>{wave.id}</span>
            <strong>{wave.rackGroup}</strong>
            <em>{wave.quantity}장 / {wave.station.replace("HSFI_PICK_STATION_", "HSFI ")}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function AllocationPanel({ robots, missions }) {
  const lanes = Array.from({ length: ROBOT_TARGET }, (_, index) => {
    const robot = robots[index] || null;
    const wave = RACK_WAVES[index];
    const queueCount = robot ? missions.filter((mission) => mission.robot_id === robot.robot_id).length : 0;
    const battery = robot?.battery_percent ?? 0;
    const batteryPenalty = robot ? Math.round((100 - battery) * 0.3) : 30;
    const queuePenalty = queueCount * 12;
    const distancePenalty = robot?.pose_x_m == null ? 18 : Math.round(Math.abs(Number(robot.pose_x_m) - (index + 1) * 2.4) * 1.8);
    const score = 40 + batteryPenalty + queuePenalty + distancePenalty;
    return { robot, wave, queueCount, score };
  });

  return (
    <section className="panel allocation-panel">
      <div className="panel-header">
        <div>
          <h2>4대 로봇 분배안</h2>
          <p>거리, 배터리, 대기 큐, 통로 혼잡도를 점수화합니다.</p>
        </div>
      </div>
      <div className="allocation-list">
        {lanes.map((lane, index) => (
          <article className="allocation-lane" key={lane.robot?.robot_id || lane.wave.id}>
            <div>
              <span>ROBOT {index + 1}</span>
              <strong>{lane.robot?.robot_id || "미등록"}</strong>
            </div>
            <em className={`demand-pill ${lane.wave.demand.toLowerCase()}`}>{lane.wave.demand}급</em>
            <dl>
              <div><dt>다음 렉</dt><dd>{lane.wave.rackGroup}</dd></div>
              <div><dt>목표</dt><dd>{lane.wave.quantity}장</dd></div>
              <div><dt>큐</dt><dd>{lane.queueCount}</dd></div>
              <div><dt>점수</dt><dd>{lane.score}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function Carousel({ title, description, items, renderItem, emptyText }) {
  const [index, setIndex] = useState(0);
  const hasItems = items.length > 0;
  const activeIndex = hasItems ? Math.min(index, items.length - 1) : 0;

  useEffect(() => {
    if (index > items.length - 1) {
      setIndex(Math.max(items.length - 1, 0));
    }
  }, [index, items.length]);

  const previous = () => {
    if (!hasItems) return;
    setIndex((value) => (value - 1 + items.length) % items.length);
  };

  const next = () => {
    if (!hasItems) return;
    setIndex((value) => (value + 1) % items.length);
  };

  return (
    <>
      <div className="carousel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="carousel-actions" aria-label={`${title} 회전목마 제어`}>
          <button className="icon-button" type="button" onClick={previous} disabled={!hasItems} title="이전">‹</button>
          <span>{hasItems ? `${activeIndex + 1} / ${items.length}` : "0 / 0"}</span>
          <button className="icon-button" type="button" onClick={next} disabled={!hasItems} title="다음">›</button>
        </div>
      </div>

      {hasItems ? (
        <>
          <div className="carousel-viewport">
            <div className="carousel-track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
              {items.map((item) => (
                <div className="carousel-slide" key={item.robot_id || item.id}>
                  {renderItem(item)}
                </div>
              ))}
            </div>
          </div>
          <div className="carousel-dots">
            {items.map((item, dotIndex) => (
              <button
                key={item.robot_id || item.id}
                className={`carousel-dot ${dotIndex === activeIndex ? "active" : ""}`}
                type="button"
                onClick={() => setIndex(dotIndex)}
                aria-label={`${dotIndex + 1}번 보기`}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="empty">{emptyText}</p>
      )}
    </>
  );
}

function RobotCards({ robots }) {
  return (
    <section className="panel robot-panel">
      <Carousel
        title="로봇 카드"
        description="위치, 배터리, 현재 작업을 한 장씩 넘겨 확인합니다."
        items={robots}
        renderItem={(robot) => <RobotCard robot={robot} />}
        emptyText="등록된 로봇이 없습니다."
      />
    </section>
  );
}

function RobotCard({ robot }) {
  const battery = robot.battery_percent == null ? 0 : robot.battery_percent;
  const batteryClass = battery < 20 ? "low" : battery < 50 ? "mid" : "high";
  const pose = robot.pose_x_m == null || robot.pose_y_m == null
    ? robot.location || "-"
    : `x ${Number(robot.pose_x_m).toFixed(2)} / y ${Number(robot.pose_y_m).toFixed(2)} / ${robot.heading_deg == null ? "-" : Number(robot.heading_deg).toFixed(0)}°`;

  return (
    <article className={`robot-card ${stateClass(robot.state)}`}>
      <div className="robot-card-top">
        <div>
          <strong>{robot.robot_id}</strong>
          <span>{robot.mode || "AUTO"}</span>
        </div>
        <span className={`badge ${stateClass(robot.state)}`}>{stateLabel(robot.state)}</span>
      </div>

      <div className="battery-row">
        <div className="battery-track"><span className={batteryClass} style={{ width: `${Math.max(0, Math.min(100, battery))}%` }} /></div>
        <strong>{robot.battery_percent == null ? "-" : robot.battery_percent}%</strong>
      </div>

      <dl className="robot-facts">
        <div><dt>위치</dt><dd>{robot.location || "-"}</dd></div>
        <div><dt>좌표</dt><dd>{pose}</dd></div>
        <div><dt>속도</dt><dd>{robot.velocity_mps == null ? "-" : `${Number(robot.velocity_mps).toFixed(2)} m/s`}</dd></div>
        <div><dt>작업</dt><dd>{robot.current_mission_id || "-"}</dd></div>
        <div><dt>갱신</dt><dd>{formatTime(robot.updated_at)}</dd></div>
        <div><dt>상태</dt><dd>{robot.message || "-"}</dd></div>
      </dl>

      <div className="chip-row">{robot.estop ? <span className="chip danger">E-STOP</span> : null}</div>
    </article>
  );
}

function MapPanel({ robots }) {
  return (
    <section className="panel map-panel">
      <div className="panel-header">
        <div>
          <h2>작업 구역</h2>
          <p>HSFI 피킹 위치 4곳과 모바일 매니퓰레이터 위치</p>
        </div>
        <span className="panel-note">WAREHOUSE_A</span>
      </div>
      <div className="fleet-map">
        <div className="map-zone dock"><strong>HOME</strong><span>대기/충전</span></div>
        <div className="map-zone drop"><strong>DROP</strong><span>BOX_DROP_ZONE_1</span></div>
        <div className="rack-bank hot"><strong>A HOT</strong><span>68 racks</span></div>
        <div className="rack-bank steady"><strong>B STANDARD</strong><span>157 racks</span></div>
        <div className="rack-bank slow"><strong>C LONGTAIL</strong><span>225 racks</span></div>
        <div className="map-path main" />
        <div className="map-path branch branch-a" />
        <div className="map-path branch branch-b" />
        {STATIONS.map((station) => (
          <div key={station.id} className="map-zone pick-station" style={{ left: `${station.x}%`, top: `${station.y}%` }}>
            <strong>{station.label}</strong>
            <span>{station.id}</span>
          </div>
        ))}
        {robots.length ? robots.map((robot, index) => <RobotMarker key={robot.robot_id} robot={robot} index={index} />) : (
          <p className="map-empty">로봇 위치 데이터 없음</p>
        )}
      </div>
    </section>
  );
}

function RobotMarker({ robot, index }) {
  const hasPose = robot.pose_x_m != null && robot.pose_y_m != null;
  const x = hasPose ? Math.max(4, Math.min(96, Number(robot.pose_x_m) * 9)) : 72 + index * 5;
  const y = hasPose ? Math.max(4, Math.min(96, 100 - Number(robot.pose_y_m) * 9)) : 78;
  const heading = robot.heading_deg == null ? 0 : robot.heading_deg;

  return (
    <>
      <div
        className={`robot-marker ${stateClass(robot.state)}`}
        style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) rotate(${heading}deg)` }}
      >
        <span />
      </div>
      <div className="marker-label" style={{ left: `${x}%`, top: `calc(${y}% + 18px)` }}>{robot.robot_id}</div>
    </>
  );
}

function StationPanel({ missions }) {
  return (
    <section className="panel station-panel">
      <Carousel
        title="HSFI 피킹 위치"
        description="한 번 이동 후 박스에 20~30장을 담는 작업 기준"
        items={STATIONS}
        renderItem={(station) => <StationCard station={station} missions={missions} />}
        emptyText="등록된 피킹 위치가 없습니다."
      />
    </section>
  );
}

function StationCard({ station, missions }) {
  const related = missions.filter((mission) => missionStations(mission).includes(station.id));
  const waiting = related.filter((mission) => PENDING_STATES.has(mission.state)).length;
  const active = related.filter((mission) => ACTIVE_STATES.has(mission.state)).length;
  const failed = related.filter((mission) => ISSUE_STATES.has(mission.state)).length;
  const status = active ? "작업 중" : waiting ? "대기 있음" : failed ? "확인 필요" : "대기";
  const statusClass = active ? "active" : failed ? "danger" : waiting ? "waiting" : "idle";

  return (
    <article className={`station-card ${statusClass}`}>
      <div>
        <strong>{station.label}</strong>
        <span>{station.id}</span>
      </div>
      <em>{status}</em>
      <dl>
        <div><dt>대기</dt><dd>{waiting}</dd></div>
        <div><dt>진행</dt><dd>{active}</dd></div>
        <div><dt>실패</dt><dd>{failed}</dd></div>
      </dl>
    </article>
  );
}

function SequencePanel() {
  return (
    <section className="panel flow-panel">
      <div className="panel-header">
        <div>
          <h2>배치 피킹 시퀀스</h2>
          <p>WMS 주문을 로봇 미션으로 바꾸는 실제 흐름</p>
        </div>
      </div>
      <ol className="sequence">
        {WORKFLOW_STEPS.map((step, index) => (
          <li key={step.label}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <em>{step.text}</em>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function OperationsStrip({ robots, missions }) {
  const activeRobot = robots.find((robot) => robot.current_mission_id)
    || robots.find((robot) => robot.state !== "offline")
    || robots[0];
  const nextMission = missions.find((mission) => ACTIVE_STATES.has(mission.state))
    || missions.find((mission) => PENDING_STATES.has(mission.state));
  const stations = nextMission ? missionStations(nextMission) : [];

  return (
    <section className="ops-strip">
      <div>
        <span>현재 로봇</span>
        <strong>{activeRobot ? activeRobot.robot_id : "-"}</strong>
      </div>
      <div>
        <span>현재 위치</span>
        <strong>{activeRobot ? activeRobot.location || "-" : "-"}</strong>
      </div>
      <div>
        <span>다음 작업</span>
        <strong>{nextMission ? nextMission.mission_id : "-"}</strong>
      </div>
      <div>
        <span>피킹 위치</span>
        <strong>{stations.length ? stations.join(" / ") : "-"}</strong>
      </div>
    </section>
  );
}

function WorkQueue({ missions }) {
  return (
    <section className="panel queue-panel">
      <div className="panel-header">
        <div>
          <h2>작업 큐</h2>
          <p>작업 지시와 진행 상태</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>작업 ID</th>
              <th>상태</th>
              <th>로봇</th>
              <th>수요</th>
              <th>렉 그룹</th>
              <th>피킹 위치</th>
              <th>박스</th>
              <th>수량</th>
              <th>우선</th>
              <th>점수</th>
              <th>하차 위치</th>
              <th>메시지</th>
            </tr>
          </thead>
          <tbody>
            {missions.length ? missions.map((mission) => (
              <tr key={mission.mission_id}>
                <td><strong>{mission.mission_id}</strong></td>
                <td><span className={`badge ${stateClass(mission.state)}`}>{stateLabel(mission.state)}</span></td>
                <td>{mission.robot_id || "-"}</td>
                <td>{mission.demand_class || "-"}</td>
                <td>{mission.rack_group || "-"}</td>
                <td>{missionStations(mission).join(", ")}</td>
                <td>{mission.box_id || "-"}</td>
                <td>{mission.picked_quantity || 0} / {mission.target_quantity || "-"}</td>
                <td>{mission.priority || "-"}</td>
                <td>{mission.assignment_score || "-"}</td>
                <td>{mission.place_location}</td>
                <td>{mission.error_code || mission.message || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan="12" className="empty">작업 지시가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventLog({ missions }) {
  const events = useMemo(() => {
    const rows = [];
    missions.forEach((mission) => {
      (mission.events || []).forEach((event) => rows.push({ ...event, mission_id: mission.mission_id }));
    });
    return rows.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 12);
  }, [missions]);

  return (
    <section className="panel log-panel">
      <div className="panel-header">
        <div>
          <h2>최근 이벤트</h2>
          <p>작업 접수, 배정, 실패 이력</p>
        </div>
      </div>
      <div className="event-log">
        {events.length ? events.map((event, index) => (
          <article className="event" key={`${event.mission_id}-${event.time}-${index}`}>
            <time>{formatTime(event.time)}</time>
            <strong>{event.mission_id}</strong>
            <span>{stateLabel(event.state)}</span>
            <p>{event.error_code || event.message || "-"}</p>
          </article>
        )) : <p className="empty">이벤트가 없습니다.</p>}
      </div>
    </section>
  );
}

function Modal({ open, title, description, children, onClose, wide }) {
  if (!open) return null;
  return (
    <div className="modal" aria-modal="true" role="dialog">
      <div className="modal-backdrop" onClick={onClose} />
      <section className={`modal-dialog ${wide ? "wide-dialog" : ""}`}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>닫기</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function RobotModal({ open, onClose, onSubmit }) {
  return (
    <Modal open={open} onClose={onClose} title="로봇 추가" description="관제에 표시할 모바일 매니퓰레이터를 등록합니다.">
      <form className="modal-form" onSubmit={onSubmit}>
        <label>로봇 ID<input name="robot_id" defaultValue="mobile_manipulator_01" required /></label>
        <label>현재 위치명<input name="location" defaultValue="HOME_DOCK" /></label>
        <label>배터리 %<input name="battery_percent" type="number" min="0" max="100" defaultValue="92" /></label>
        <label>X 좌표 m<input name="pose_x_m" type="number" step="0.1" defaultValue="2.4" /></label>
        <label>Y 좌표 m<input name="pose_y_m" type="number" step="0.1" defaultValue="1.8" /></label>
        <label>방향 deg<input name="heading_deg" type="number" step="1" defaultValue="90" /></label>
        <label>모드<select name="mode" defaultValue="AUTO"><option value="AUTO">AUTO</option><option value="MANUAL">MANUAL</option><option value="MAINTENANCE">MAINTENANCE</option></select></label>
        <label>상태<select name="state" defaultValue="idle"><option value="idle">대기</option><option value="offline">오프라인</option><option value="moving">이동 중</option><option value="picking">피킹 중</option><option value="error">장애</option></select></label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>취소</button>
          <button type="submit">로봇 등록</button>
        </div>
      </form>
    </Modal>
  );
}

function WorkOrderModal({ open, onClose, onSubmit }) {
  return (
    <Modal open={open} onClose={onClose} wide title="배치 피킹 작업 생성" description="WMS 주문을 20~30장 박스 피킹 미션으로 만듭니다.">
      <form className="modal-form work-order-form" onSubmit={onSubmit}>
        <label>로봇 ID<input name="robot_id" defaultValue="mobile_manipulator_01" /></label>
        <label>박스 ID<input name="box_id" defaultValue="BOX-001" /></label>
        <label>목표 수량<input name="target_quantity" type="number" min="20" max="30" defaultValue="28" required /></label>
        <label>수요 등급<select name="demand_class" defaultValue="A"><option value="A">A급 핫존</option><option value="B">B급 표준존</option><option value="C">C급 롱테일</option></select></label>
        <label>렉 그룹<input name="rack_group" defaultValue="R001-R068" required /></label>
        <label>우선순위<select name="priority" defaultValue="1"><option value="1">1 긴급</option><option value="2">2 높음</option><option value="3">3 일반</option><option value="4">4 낮음</option><option value="5">5 보류</option></select></label>
        <label>배정 점수<input name="assignment_score" type="number" min="0" defaultValue="42" /></label>
        <label>하차 위치<input name="place_location" defaultValue="BOX_DROP_ZONE_1" required /></label>
        <label>대상<input name="target" defaultValue="top_garment" required /></label>
        <fieldset className="station-selector">
          <legend>피킹 위치 선택</legend>
          {STATIONS.map((station, index) => (
            <label key={station.id}>
              <input type="checkbox" name="pickup_stations" value={station.id} defaultChecked={index === 0} />
              {station.label}
            </label>
          ))}
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>취소</button>
          <button type="submit">작업 지시 생성</button>
        </div>
      </form>
    </Modal>
  );
}

function App() {
  const [robots, setRobots] = useState([]);
  const [missions, setMissions] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [robotModalOpen, setRobotModalOpen] = useState(false);
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  const refresh = async () => {
    const [robotRows, missionRows] = await Promise.all([
      apiRequest("/api/robots"),
      apiRequest("/api/missions"),
    ]);
    setRobots(robotRows);
    setMissions(missionRows);
    setLastUpdated(`마지막 갱신 ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`);
  };

  useEffect(() => {
    refresh().catch(console.error);
    const timer = setInterval(() => refresh().catch(console.error), 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        setRobotModalOpen(false);
        setWorkModalOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const addSampleRobots = async () => {
    const sampleRobots = [
      { robot_id: "mobile_manipulator_01", state: "moving", battery_percent: 92, location: "A_HOT_AISLE", pose_x_m: 2.8, pose_y_m: 8.1, heading_deg: 35 },
      { robot_id: "mobile_manipulator_02", state: "idle", battery_percent: 87, location: "HSFI_PICK_STATION_2", pose_x_m: 5.2, pose_y_m: 6.4, heading_deg: 90 },
      { robot_id: "mobile_manipulator_03", state: "picking", battery_percent: 76, location: "B_STANDARD_AISLE", pose_x_m: 7.6, pose_y_m: 4.2, heading_deg: 180 },
      { robot_id: "mobile_manipulator_04", state: "idle", battery_percent: 69, location: "HOME_DOCK", pose_x_m: 8.4, pose_y_m: 1.8, heading_deg: 0 },
    ];
    await Promise.all(sampleRobots.map((robot) => apiRequest(`/api/robots/${robot.robot_id}/state`, {
      method: "POST",
      body: JSON.stringify({
        state: robot.state,
        battery_percent: robot.battery_percent,
        location: robot.location,
        map_id: "WAREHOUSE_A",
        pose_x_m: robot.pose_x_m,
        pose_y_m: robot.pose_y_m,
        heading_deg: robot.heading_deg,
        velocity_mps: robot.state === "moving" ? 0.7 : 0,
        mode: "AUTO",
        message: "demand allocation ready",
      }),
    })));
    await refresh();
  };

  const submitRobot = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const robotId = formData.get("robot_id");
    await apiRequest(`/api/robots/${encodeURIComponent(robotId)}/state`, {
      method: "POST",
      body: JSON.stringify({
        state: formData.get("state"),
        battery_percent: Number(formData.get("battery_percent")) || null,
        location: formData.get("location"),
        map_id: "WAREHOUSE_A",
        pose_x_m: Number(formData.get("pose_x_m")) || 0,
        pose_y_m: Number(formData.get("pose_y_m")) || 0,
        heading_deg: Number(formData.get("heading_deg")) || 0,
        velocity_mps: 0,
        mode: formData.get("mode"),
        message: "registered from web",
      }),
    });
    setRobotModalOpen(false);
    await refresh();
  };

  const submitWorkOrder = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const pickupStations = formData.getAll("pickup_stations");
    if (!pickupStations.length) {
      alert("피킹 위치를 하나 이상 선택하세요.");
      return;
    }

    await apiRequest("/api/missions", {
      method: "POST",
      body: JSON.stringify({
        robot_id: formData.get("robot_id") || null,
        task_type: "box_batch_pick",
        station_id: pickupStations[0],
        pickup_stations: pickupStations,
        box_id: formData.get("box_id") || null,
        target_quantity: Number(formData.get("target_quantity")) || 25,
        rack_group: formData.get("rack_group") || null,
        demand_class: formData.get("demand_class") || null,
        priority: Number(formData.get("priority")) || 3,
        assignment_score: Number(formData.get("assignment_score")) || null,
        target: formData.get("target"),
        place_location: formData.get("place_location"),
      }),
    });
    setWorkModalOpen(false);
    await refresh();
  };

  return (
    <>
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openRobotModal={() => setRobotModalOpen(true)}
        openWorkModal={() => setWorkModalOpen(true)}
        refresh={refresh}
        lastUpdated={lastUpdated}
      />

      <main className="layout">
        {activeTab === "dashboard" && <CommandPanel robots={robots} missions={missions} openWorkModal={() => setWorkModalOpen(true)} />}

        <Summary robots={robots} missions={missions} />

        {activeTab === "dashboard" && (
          <>
            <OperationsStrip robots={robots} missions={missions} />
            <DemandPanel missions={missions} />
            <AllocationPanel robots={robots} missions={missions} />
            <RobotCards robots={robots} />
            <MapPanel robots={robots} />
            <StationPanel missions={missions} />
            <SequencePanel />
          </>
        )}

        {activeTab === "work" && <WorkQueue missions={missions} />}
        {activeTab === "events" && <EventLog missions={missions} />}

        {activeTab === "dashboard" && (
          <section className="panel quick-panel">
            <div className="panel-header">
              <div>
                <h2>빠른 작업</h2>
                <p>개발 중 테스트용 작업</p>
              </div>
            </div>
            <div className="quick-actions">
              <button className="secondary-button" onClick={addSampleRobots}>4대 로봇 샘플 등록</button>
              <button onClick={() => setWorkModalOpen(true)}>배치 피킹 작업 생성</button>
            </div>
          </section>
        )}
      </main>

      <RobotModal open={robotModalOpen} onClose={() => setRobotModalOpen(false)} onSubmit={submitRobot} />
      <WorkOrderModal open={workModalOpen} onClose={() => setWorkModalOpen(false)} onSubmit={submitWorkOrder} />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
