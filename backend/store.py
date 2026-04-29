from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from uuid import uuid4


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RobotRecord:
    robot_id: str
    state: str = "offline"
    battery_percent: int | None = None
    location: str | None = None
    map_id: str | None = None
    pose_x_m: float | None = None
    pose_y_m: float | None = None
    heading_deg: float | None = None
    velocity_mps: float | None = None
    mode: str | None = None
    estop: bool = False
    current_mission_id: str | None = None
    message: str | None = None
    updated_at: str = field(default_factory=utc_now_iso)


@dataclass
class MissionRecord:
    mission_id: str
    task_type: str
    station_id: str
    target: str
    place_location: str
    pickup_stations: list[str] = field(default_factory=list)
    target_quantity: int = 25
    picked_quantity: int = 0
    box_id: str | None = None
    bin_id: int | None = None
    rack_group: str | None = None
    demand_class: str | None = None
    priority: int = 3
    assignment_score: float | None = None
    robot_id: str | None = None
    state: str = "RECEIVED"
    success: bool | None = None
    error_code: str | None = None
    message: str | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    events: list[dict[str, Any]] = field(default_factory=list)


class FleetStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._robots: dict[str, RobotRecord] = {}
        self._missions: dict[str, MissionRecord] = {}

    def list_robots(self) -> list[RobotRecord]:
        with self._lock:
            return list(self._robots.values())

    def upsert_robot(self, robot_id: str, data: dict[str, Any]) -> RobotRecord:
        with self._lock:
            robot = self._robots.get(robot_id, RobotRecord(robot_id=robot_id))
            for key in (
                "state",
                "battery_percent",
                "location",
                "map_id",
                "pose_x_m",
                "pose_y_m",
                "heading_deg",
                "velocity_mps",
                "mode",
                "estop",
                "current_mission_id",
                "message",
            ):
                if key in data:
                    setattr(robot, key, data[key])
            robot.updated_at = utc_now_iso()
            self._robots[robot_id] = robot
            return robot

    def list_missions(self) -> list[MissionRecord]:
        with self._lock:
            return sorted(self._missions.values(), key=lambda mission: mission.created_at, reverse=True)

    def create_mission(self, data: dict[str, Any]) -> MissionRecord:
        with self._lock:
            mission_id = data.get("mission_id") or f"MIS-{uuid4().hex[:8].upper()}"
            pickup_stations = data.get("pickup_stations") or []
            if not pickup_stations and data.get("station_id"):
                pickup_stations = [data["station_id"]]
            station_id = data.get("station_id") or (pickup_stations[0] if pickup_stations else "HSFI_PICK_STATION_1")
            mission = MissionRecord(
                mission_id=mission_id,
                task_type=data.get("task_type", "box_batch_pick"),
                station_id=station_id,
                target=data["target"],
                place_location=data["place_location"],
                pickup_stations=pickup_stations,
                target_quantity=data.get("target_quantity", 25),
                box_id=data.get("box_id"),
                bin_id=data.get("bin_id"),
                rack_group=data.get("rack_group"),
                demand_class=data.get("demand_class"),
                priority=data.get("priority", 3),
                assignment_score=data.get("assignment_score"),
                robot_id=data.get("robot_id"),
                state="RECEIVED",
            )
            mission.events.append({"state": mission.state, "message": "mission created", "time": mission.created_at})
            self._missions[mission_id] = mission
            return mission

    def get_next_mission_for_robot(self, robot_id: str) -> MissionRecord | None:
        with self._lock:
            for mission in sorted(self._missions.values(), key=lambda item: item.created_at):
                if mission.state not in {"RECEIVED", "ASSIGNED"}:
                    continue
                if mission.robot_id not in {None, robot_id}:
                    continue

                mission.robot_id = robot_id
                mission.state = "ASSIGNED"
                mission.updated_at = utc_now_iso()
                mission.events.append({"state": mission.state, "message": f"assigned to {robot_id}", "time": mission.updated_at})

                robot = self._robots.get(robot_id, RobotRecord(robot_id=robot_id))
                robot.state = "assigned"
                robot.current_mission_id = mission.mission_id
                robot.updated_at = utc_now_iso()
                self._robots[robot_id] = robot
                return mission
            return None

    def update_mission_state(self, mission_id: str, data: dict[str, Any]) -> MissionRecord | None:
        with self._lock:
            mission = self._missions.get(mission_id)
            if mission is None:
                return None

            for key in ("state", "success", "error_code", "message", "picked_quantity"):
                if key in data:
                    setattr(mission, key, data[key])
            mission.updated_at = utc_now_iso()
            mission.events.append({
                "state": mission.state,
                "message": mission.message or "",
                "error_code": mission.error_code,
                "time": mission.updated_at,
            })

            if mission.robot_id:
                robot = self._robots.get(mission.robot_id)
                if robot and mission.state in {"COMPLETED", "FAILED", "CANCELED"}:
                    robot.state = "idle" if mission.state == "COMPLETED" else "error"
                    robot.current_mission_id = None
                    robot.message = mission.message
                    robot.updated_at = utc_now_iso()
            return mission
