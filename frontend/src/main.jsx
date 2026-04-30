import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8081`;

// HSFI 피킹 스테이션 — demand class는 미션 데이터에서 동적으로 계산
const STATIONS = [
  { id: "HSFI_PICK_STATION_1", label: "HSFI 1", x: 22, y: 26 },
  { id: "HSFI_PICK_STATION_2", label: "HSFI 2", x: 22, y: 64 },
  { id: "HSFI_PICK_STATION_3", label: "HSFI 3", x: 46, y: 26 },
  { id: "HSFI_PICK_STATION_4", label: "HSFI 4", x: 46, y: 64 },
];

const DEMAND_CLASSES = [
  { id: "A", label: "A 고회전", racks: 68, share: 58, color: "hot", note: "우선 출고 대상" },
  { id: "B", label: "B 중회전", racks: 157, share: 32, color: "steady", note: "일반 주문 처리" },
  { id: "C", label: "C 저회전", racks: 225, share: 10, color: "slow", note: "비정기 보충 출고" },
];

const RACK_WAVES = [
  { id: "WAVE-A1", demand: "A", rackGroup: "R001-R068", station: "HSFI_PICK_STATION_1", quantity: 30 },
  { id: "WAVE-B1", demand: "B", rackGroup: "R069-R180", station: "HSFI_PICK_STATION_2", quantity: 26 },
  { id: "WAVE-A2", demand: "A", rackGroup: "R181-R240", station: "HSFI_PICK_STATION_3", quantity: 28 },
  { id: "WAVE-C1", demand: "C", rackGroup: "R241-R450", station: "HSFI_PICK_STATION_4", quantity: 22 },
];

const PENDING_STATES = new Set(["RECEIVED", "ASSIGNED"]);
const ACTIVE_STATES = new Set(["NAVIGATING", "ARRIVED", "PICKING", "PLACING"]);
const ISSUE_STATES = new Set(["FAILED", "CANCELED"]);
const CANCELLABLE_STATES = new Set(["RECEIVED", "ASSIGNED", "NAVIGATING", "ARRIVED"]);

const DEMAND_PRIORITY = { a: 3, b: 2, c: 1, idle: 0 };

function stateLabel(state) {
  const labels = {
    offline: "오프라인", idle: "대기", assigned: "배정됨", moving: "이동 중",
    picking: "피킹 중", error: "장애",
    RECEIVED: "접수", ASSIGNED: "배정", NAVIGATING: "이동 중", ARRIVED: "도착",
    PICKING: "피킹", PLACING: "하차 중", COMPLETED: "완료", FAILED: "실패", CANCELED: "취소",
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

// ── Toast ──────────────────────────────────────────────────────────────────

function Toasts({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
      ))}
    </div>
  );
}

// ── Error banner ───────────────────────────────────────────────────────────

function ErrorBanner() {
  return (
    <div className="error-banner">
      API 서버에 연결할 수 없습니다 — 백엔드 상태를 확인하세요.
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({ activeTab, setActiveTab, openRobotModal, openWorkModal, onSampleData, refresh, lastUpdated, isConnected, loading }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = [
    { id: "dashboard", label: "대시보드" },
    { id: "robots", label: "로봇" },
    { id: "work", label: "작업 큐" },
    { id: "events", label: "이벤트" },
  ];
  const selectTab = (tab) => { setActiveTab(tab); setMenuOpen(false); };

  return (
    <header className="topbar">
      <button
        className={`hamburger ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="메뉴 열기"
        aria-expanded={menuOpen}
      >
        <span /><span /><span />
      </button>

      <div className="brand">
        <strong>HSFI Fleet</strong>
        <span>수요 기반 모바일 매니퓰레이터 피킹 관제</span>
      </div>

      <nav className={`tabs ${menuOpen ? "open" : ""}`}>
        {tabs.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => selectTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <span className={`live-dot ${isConnected ? "connected" : "disconnected"}`} title={isConnected ? "서버 연결됨" : "서버 연결 끊김"} />
        <span className="last-updated">{lastUpdated || "-"}</span>
        <button className="secondary-button" onClick={onSampleData}>샘플 데이터</button>
        <button className="secondary-button" onClick={openRobotModal}>로봇 추가</button>
        <button onClick={openWorkModal}>작업 지시</button>
        <button className={`icon-button ${loading ? "spinning" : ""}`} onClick={refresh} title="새로고침">↻</button>
      </div>
    </header>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

function Summary({ robots, missions }) {
  const completed = missions.filter((m) => m.state === "COMPLETED").length;
  const activeTarget = missions
    .filter((m) => !["COMPLETED", "FAILED", "CANCELED"].includes(m.state))
    .reduce((sum, m) => sum + (m.target_quantity || 0), 0);
  const issues = robots.filter((r) => r.state === "error" || r.estop).length
    + missions.filter((m) => ISSUE_STATES.has(m.state)).length;

  return (
    <section className="summary-grid">
      <SummaryCard label="운영 로봇" value={robots.length} />
      <SummaryCard label="대기 작업" value={missions.filter((m) => PENDING_STATES.has(m.state)).length} />
      <SummaryCard label="진행 작업" value={missions.filter((m) => ACTIVE_STATES.has(m.state)).length} />
      <SummaryCard label="완료 작업" value={completed} success />
      <SummaryCard label="피킹 목표" value={activeTarget} />
      <SummaryCard label="장애/실패" value={issues} danger />
    </section>
  );
}

function SummaryCard({ label, value, danger, success }) {
  const cls = danger ? "danger" : success ? "success" : "";
  return (
    <article className={`summary-card ${cls}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

// ── Map (실시간 작업 구역) ──────────────────────────────────────────────────

function MapPanel({ robots, missions }) {
  // 각 스테이션에서 가장 높은 우선도의 demand class 계산
  const stationDemand = useMemo(() => {
    const map = {};
    STATIONS.forEach((s) => { map[s.id] = "idle"; });
    missions.forEach((m) => {
      if (!ACTIVE_STATES.has(m.state) && !PENDING_STATES.has(m.state)) return;
      const dc = (m.demand_class || "").toLowerCase();
      if (!dc) return;
      missionStations(m).forEach((sid) => {
        if (!(sid in map)) return;
        if ((DEMAND_PRIORITY[dc] || 0) > (DEMAND_PRIORITY[map[sid]] || 0)) {
          map[sid] = dc;
        }
      });
    });
    return map;
  }, [missions]);

  const stationCount = useMemo(() => {
    const map = {};
    STATIONS.forEach((s) => { map[s.id] = 0; });
    missions.forEach((m) => {
      if (!ACTIVE_STATES.has(m.state) && !PENDING_STATES.has(m.state)) return;
      missionStations(m).forEach((sid) => {
        if (sid in map) map[sid]++;
      });
    });
    return map;
  }, [missions]);

  return (
    <section className="panel map-panel">
      <div className="panel-header">
        <div>
          <h2>작업 구역</h2>
          <p>HSFI 피킹 위치와 로봇 실시간 좌표 — 3초 자동 갱신</p>
        </div>
        <span className="live-badge">● LIVE</span>
      </div>
      <div className="fleet-map">
        {/* 렉 구역 배경 */}
        <div className="map-rack-zone" />

        {/* 이동 통로 */}
        <div className="map-path main" />
        <div className="map-path branch branch-left" />
        <div className="map-path branch branch-right" />

        {/* 고정 구역 */}
        <div className="map-zone dock"><strong>HOME</strong><span>대기 / 충전</span></div>
        <div className="map-zone drop"><strong>DROP</strong><span>BOX_DROP_ZONE_1</span></div>

        {/* HSFI 피킹 스테이션 — demand class 동적 색상 */}
        {STATIONS.map((station) => {
          const dc = stationDemand[station.id];
          const cnt = stationCount[station.id];
          return (
            <div
              key={station.id}
              className={`map-pick-station demand-${dc}`}
              style={{ left: `${station.x}%`, top: `${station.y}%` }}
            >
              <strong>{station.label}</strong>
              <span>{dc !== "idle" ? `${dc.toUpperCase()}등급` : "대기"}</span>
              {cnt > 0 && <em>{cnt}건</em>}
            </div>
          );
        })}

        {/* 로봇 마커 */}
        {robots.length ? robots.map((robot, index) => (
          <RobotMarker key={robot.robot_id} robot={robot} index={index} />
        )) : (
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
  const isActive = robot.state === "moving" || robot.state === "picking";

  return (
    <>
      <div
        className={`robot-marker ${stateClass(robot.state)} ${isActive ? "pulsing" : ""}`}
        style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) rotate(${heading}deg)` }}
        title={robot.robot_id}
      >
        <span />
      </div>
      <div className="marker-label" style={{ left: `${x}%`, top: `calc(${y}% + 18px)` }}>
        {robot.robot_id}
      </div>
    </>
  );
}

// ── Demand ─────────────────────────────────────────────────────────────────

function DemandPanel({ missions }) {
  const activeCount = missions.filter((m) => ACTIVE_STATES.has(m.state)).length;

  return (
    <section className="panel demand-panel">
      <div className="panel-header">
        <div>
          <h2>수요 기반 렉 분류</h2>
          <p>출고 빈도로 나눈 A/B/C 등급 — 고회전 렉부터 묶어 이동 낭비를 줄입니다.</p>
        </div>
        <span className="panel-note">진행 {activeCount}건</span>
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

// ── Allocation (실제 데이터 기반) ──────────────────────────────────────────

function AllocationPanel({ robots, missions }) {
  const unassigned = missions.filter(
    (m) => PENDING_STATES.has(m.state) && !m.robot_id,
  ).length;

  const robotStats = robots.map((robot) => {
    const own = missions.filter(
      (m) => m.robot_id === robot.robot_id && !["COMPLETED", "FAILED", "CANCELED"].includes(m.state),
    );
    const active = own.find((m) => ACTIVE_STATES.has(m.state)) || null;
    const pending = own.filter((m) => PENDING_STATES.has(m.state)).length;
    return { robot, active, pending };
  });

  return (
    <section className="panel allocation-panel">
      <div className="panel-header">
        <div>
          <h2>로봇 배정 현황</h2>
          <p>각 로봇의 현재 작업과 대기 큐</p>
        </div>
        {unassigned > 0 && <span className="panel-note warn">미배정 {unassigned}건</span>}
      </div>
      {robots.length ? (
        <div className="allocation-list">
          {robotStats.map(({ robot, active, pending }) => (
            <article className="allocation-lane" key={robot.robot_id}>
              <div className="alloc-header">
                <div>
                  <strong className="alloc-name">{robot.robot_id}</strong>
                  <span className={`badge ${stateClass(robot.state)}`}>{stateLabel(robot.state)}</span>
                </div>
                <div className="alloc-battery">
                  <div className="battery-track small">
                    <span
                      className={robot.battery_percent < 20 ? "low" : robot.battery_percent < 50 ? "mid" : "high"}
                      style={{ width: `${Math.max(0, Math.min(100, robot.battery_percent ?? 0))}%` }}
                    />
                  </div>
                  <span className="alloc-pct">{robot.battery_percent ?? "-"}%</span>
                </div>
              </div>
              <dl>
                <div>
                  <dt>진행 작업</dt>
                  <dd>{active ? active.mission_id : <span className="muted">없음</span>}</dd>
                </div>
                <div>
                  <dt>수요 등급</dt>
                  <dd>
                    {active?.demand_class ? (
                      <em className={`demand-pill ${active.demand_class.toLowerCase()}`}>
                        {active.demand_class}등급
                      </em>
                    ) : <span className="muted">-</span>}
                  </dd>
                </div>
                <div><dt>대기 중</dt><dd>{pending}건</dd></div>
                <div><dt>위치</dt><dd>{robot.location || "-"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">등록된 로봇이 없습니다.</p>
      )}
    </section>
  );
}

// ── Robot card ─────────────────────────────────────────────────────────────

function RobotCard({ robot, onDelete }) {
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
        <div className="battery-track">
          <span className={batteryClass} style={{ width: `${Math.max(0, Math.min(100, battery))}%` }} />
        </div>
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

      <div className="chip-row">
        {robot.estop ? <span className="chip danger">E-STOP</span> : null}
        {battery < 20 ? <span className="chip warn">배터리 부족</span> : null}
        {onDelete && (
          <button className="cancel-button robot-delete-btn" onClick={() => onDelete(robot.robot_id)}>
            삭제
          </button>
        )}
      </div>
    </article>
  );
}

// ── Robot panel (대시보드용) ────────────────────────────────────────────────

function RobotPanel({ robots }) {
  return (
    <section className="panel robot-panel">
      <div className="panel-header">
        <div>
          <h2>로봇 카드</h2>
          <p>위치·배터리·현재 작업 상태</p>
        </div>
        <span className="panel-note">{robots.length}대</span>
      </div>
      {robots.length ? (
        <div className="robot-grid">
          {robots.map((robot) => (
            <RobotCard key={robot.robot_id} robot={robot} />
          ))}
        </div>
      ) : (
        <p className="empty">등록된 로봇이 없습니다.</p>
      )}
    </section>
  );
}

// ── Robots tab (로봇 관리) ──────────────────────────────────────────────────

function RobotsTab({ robots, openRobotModal, onDelete }) {
  return (
    <section className="panel robots-panel">
      <div className="panel-header">
        <div>
          <h2>로봇 관리</h2>
          <p>모바일 매니퓰레이터 등록 및 현재 상태</p>
        </div>
        <button onClick={openRobotModal}>로봇 추가</button>
      </div>
      {robots.length ? (
        <div className="robot-grid">
          {robots.map((robot) => (
            <RobotCard key={robot.robot_id} robot={robot} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <p className="empty robots-empty">
          등록된 로봇이 없습니다. 로봇 추가를 눌러 등록하세요.
        </p>
      )}
    </section>
  );
}

// ── Station grid ───────────────────────────────────────────────────────────

function StationGrid({ missions }) {
  return (
    <section className="panel station-panel">
      <div className="panel-header">
        <div>
          <h2>HSFI 피킹 위치</h2>
          <p>한 번 이동 후 박스에 20~30장을 담는 작업 기준</p>
        </div>
      </div>
      <div className="station-grid">
        {STATIONS.map((station) => (
          <StationCard key={station.id} station={station} missions={missions} />
        ))}
      </div>
    </section>
  );
}

function StationCard({ station, missions }) {
  const related = missions.filter((m) => missionStations(m).includes(station.id));
  const waiting = related.filter((m) => PENDING_STATES.has(m.state)).length;
  const active = related.filter((m) => ACTIVE_STATES.has(m.state)).length;
  const failed = related.filter((m) => ISSUE_STATES.has(m.state)).length;
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

// ── Work queue ─────────────────────────────────────────────────────────────

const WORK_FILTERS = [
  { id: "all", label: "전체" },
  { id: "pending", label: "대기" },
  { id: "active", label: "진행 중" },
  { id: "done", label: "완료" },
  { id: "issue", label: "실패/취소" },
];

function WorkQueue({ missions, onCancel }) {
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    if (filter === "pending") return missions.filter((m) => PENDING_STATES.has(m.state));
    if (filter === "active") return missions.filter((m) => ACTIVE_STATES.has(m.state));
    if (filter === "done") return missions.filter((m) => m.state === "COMPLETED");
    if (filter === "issue") return missions.filter((m) => ISSUE_STATES.has(m.state));
    return missions;
  }, [missions, filter]);

  return (
    <section className="panel queue-panel">
      <div className="panel-header">
        <div>
          <h2>작업 큐</h2>
          <p>작업 지시와 진행 상태 — 접수~완료 전체 이력</p>
        </div>
      </div>
      <div className="filter-tabs">
        {WORK_FILTERS.map((f) => (
          <button key={f.id} className={`filter-tab ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>작업 ID</th><th>상태</th><th>로봇</th><th>수요</th>
              <th>렉 그룹</th><th>피킹 위치</th><th>박스</th><th>수량</th>
              <th>우선</th><th>하차 위치</th><th>메시지</th><th />
            </tr>
          </thead>
          <tbody>
            {filtered.length ? filtered.map((mission) => (
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
                <td>{mission.place_location}</td>
                <td>{mission.error_code || mission.message || "-"}</td>
                <td>
                  {CANCELLABLE_STATES.has(mission.state) && (
                    <button className="cancel-button" onClick={() => onCancel(mission.mission_id)}>취소</button>
                  )}
                </td>
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

// ── Event log ──────────────────────────────────────────────────────────────

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
        <div><h2>최근 이벤트</h2><p>작업 접수, 배정, 실패 이력</p></div>
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

// ── Modals ─────────────────────────────────────────────────────────────────

function Modal({ open, title, description, children, onClose, wide }) {
  if (!open) return null;
  return (
    <div className="modal" aria-modal="true" role="dialog">
      <div className="modal-backdrop" onClick={onClose} />
      <section className={`modal-dialog ${wide ? "wide-dialog" : ""}`}>
        <div className="modal-header">
          <div><h2>{title}</h2><p>{description}</p></div>
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
        <label>
          모드
          <select name="mode" defaultValue="AUTO">
            <option value="AUTO">AUTO</option>
            <option value="MANUAL">MANUAL</option>
            <option value="MAINTENANCE">MAINTENANCE</option>
          </select>
        </label>
        <label>
          상태
          <select name="state" defaultValue="idle">
            <option value="idle">대기</option>
            <option value="offline">오프라인</option>
            <option value="moving">이동 중</option>
            <option value="picking">피킹 중</option>
            <option value="error">장애</option>
          </select>
        </label>
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
        <label>
          수요 등급
          <select name="demand_class" defaultValue="A">
            <option value="A">A 고회전</option>
            <option value="B">B 중회전</option>
            <option value="C">C 저회전</option>
          </select>
        </label>
        <label>렉 그룹<input name="rack_group" defaultValue="R001-R068" required /></label>
        <label>
          우선순위
          <select name="priority" defaultValue="1">
            <option value="1">1 긴급</option>
            <option value="2">2 높음</option>
            <option value="3">3 일반</option>
            <option value="4">4 낮음</option>
            <option value="5">5 보류</option>
          </select>
        </label>
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

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  const [robots, setRobots] = useState([]);
  const [missions, setMissions] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [robotModalOpen, setRobotModalOpen] = useState(false);
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const [isConnected, setIsConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [robotRows, missionRows] = await Promise.all([
        apiRequest("/api/robots"),
        apiRequest("/api/missions"),
      ]);
      setRobots(robotRows);
      setMissions(missionRows);
      setIsConnected(true);
      setLastUpdated(`갱신 ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`);
    } catch {
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setRobotModalOpen(false); setWorkModalOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const addSampleRobots = async () => {
    const samples = [
      { robot_id: "mobile_manipulator_01", state: "moving", battery_percent: 92, location: "A_고회전_통로", pose_x_m: 2.8, pose_y_m: 8.1, heading_deg: 35 },
      { robot_id: "mobile_manipulator_02", state: "idle", battery_percent: 87, location: "HSFI_PICK_STATION_2", pose_x_m: 5.2, pose_y_m: 6.4, heading_deg: 90 },
      { robot_id: "mobile_manipulator_03", state: "picking", battery_percent: 76, location: "B_중회전_통로", pose_x_m: 7.6, pose_y_m: 4.2, heading_deg: 180 },
      { robot_id: "mobile_manipulator_04", state: "idle", battery_percent: 69, location: "HOME_DOCK", pose_x_m: 8.4, pose_y_m: 1.8, heading_deg: 0 },
    ];
    try {
      await Promise.all(samples.map((r) =>
        apiRequest(`/api/robots/${r.robot_id}/state`, {
          method: "POST",
          body: JSON.stringify({ ...r, map_id: "WAREHOUSE_A", velocity_mps: r.state === "moving" ? 0.7 : 0, mode: "AUTO" }),
        }),
      ));
      addToast("샘플 로봇 4대 등록 완료");
      await refresh();
    } catch (err) {
      addToast(`샘플 등록 실패: ${err.message}`, "error");
    }
  };

  const submitRobot = async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const robotId = fd.get("robot_id");
    try {
      await apiRequest(`/api/robots/${encodeURIComponent(robotId)}/state`, {
        method: "POST",
        body: JSON.stringify({
          state: fd.get("state"),
          battery_percent: Number(fd.get("battery_percent")) || null,
          location: fd.get("location"),
          map_id: "WAREHOUSE_A",
          pose_x_m: Number(fd.get("pose_x_m")) || 0,
          pose_y_m: Number(fd.get("pose_y_m")) || 0,
          heading_deg: Number(fd.get("heading_deg")) || 0,
          velocity_mps: 0,
          mode: fd.get("mode"),
          message: "registered from web",
        }),
      });
      setRobotModalOpen(false);
      addToast(`${robotId} 등록 완료`);
      await refresh();
    } catch (err) {
      addToast(`등록 실패: ${err.message}`, "error");
    }
  };

  const submitWorkOrder = async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const pickupStations = fd.getAll("pickup_stations");
    if (!pickupStations.length) {
      addToast("피킹 위치를 하나 이상 선택하세요.", "error");
      return;
    }
    try {
      const mission = await apiRequest("/api/missions", {
        method: "POST",
        body: JSON.stringify({
          robot_id: fd.get("robot_id") || null,
          task_type: "box_batch_pick",
          station_id: pickupStations[0],
          pickup_stations: pickupStations,
          box_id: fd.get("box_id") || null,
          target_quantity: Number(fd.get("target_quantity")) || 25,
          rack_group: fd.get("rack_group") || null,
          demand_class: fd.get("demand_class") || null,
          priority: Number(fd.get("priority")) || 3,
          target: fd.get("target"),
          place_location: fd.get("place_location"),
        }),
      });
      setWorkModalOpen(false);
      addToast(`${mission.mission_id} 생성 완료`);
      await refresh();
    } catch (err) {
      addToast(`작업 생성 실패: ${err.message}`, "error");
    }
  };

  const cancelMission = async (missionId) => {
    try {
      await apiRequest(`/api/missions/${encodeURIComponent(missionId)}/state`, {
        method: "POST",
        body: JSON.stringify({ state: "CANCELED", message: "canceled from web" }),
      });
      addToast(`${missionId} 취소됨`);
      await refresh();
    } catch (err) {
      addToast(`취소 실패: ${err.message}`, "error");
    }
  };

  const deleteRobot = async (robotId) => {
    try {
      await apiRequest(`/api/robots/${encodeURIComponent(robotId)}`, { method: "DELETE" });
      addToast(`${robotId} 삭제됨`);
      await refresh();
    } catch (err) {
      addToast(`삭제 실패: ${err.message}`, "error");
    }
  };

  return (
    <>
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openRobotModal={() => setRobotModalOpen(true)}
        openWorkModal={() => setWorkModalOpen(true)}
        onSampleData={addSampleRobots}
        refresh={refresh}
        lastUpdated={lastUpdated}
        isConnected={isConnected}
        loading={loading}
      />

      {!isConnected && <ErrorBanner />}

      <main className="layout">
        <Summary robots={robots} missions={missions} />

        {activeTab === "dashboard" && (
          <>
            <MapPanel robots={robots} missions={missions} />
            <DemandPanel missions={missions} />
            <AllocationPanel robots={robots} missions={missions} />
            <RobotPanel robots={robots} />
            <StationGrid missions={missions} />
          </>
        )}

        {activeTab === "robots" && (
          <RobotsTab
            robots={robots}
            openRobotModal={() => setRobotModalOpen(true)}
            onDelete={deleteRobot}
          />
        )}

        {activeTab === "work" && <WorkQueue missions={missions} onCancel={cancelMission} />}
        {activeTab === "events" && <EventLog missions={missions} />}
      </main>

      <Toasts toasts={toasts} />
      <RobotModal open={robotModalOpen} onClose={() => setRobotModalOpen(false)} onSubmit={submitRobot} />
      <WorkOrderModal open={workModalOpen} onClose={() => setWorkModalOpen(false)} onSubmit={submitWorkOrder} />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
