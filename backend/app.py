from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from store import FleetStore


BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Fleet MVP", version="0.1.0")
store = FleetStore()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


class RobotStateUpdate(BaseModel):
    state: str = Field(default="online")
    battery_percent: int | None = Field(default=None, ge=0, le=100)
    location: str | None = None
    map_id: str | None = None
    pose_x_m: float | None = None
    pose_y_m: float | None = None
    heading_deg: float | None = None
    velocity_mps: float | None = None
    mode: str | None = None
    estop: bool | None = None
    current_mission_id: str | None = None
    message: str | None = None


class RobotCreate(RobotStateUpdate):
    robot_id: str


class MissionCreate(BaseModel):
    mission_id: str | None = None
    robot_id: str | None = None
    task_type: str = "box_batch_pick"
    station_id: str | None = None
    pickup_stations: list[str] = Field(default_factory=lambda: ["HSFI_PICK_STATION_1"])
    target_quantity: int = Field(default=25, ge=1, le=50)
    box_id: str | None = None
    bin_id: int | None = None
    target: str = "top_garment"
    rack_group: str | None = None
    demand_class: str | None = None
    priority: int = Field(default=3, ge=1, le=5)
    assignment_score: float | None = None
    place_location: str


class MissionStateUpdate(BaseModel):
    state: str
    success: bool | None = None
    picked_quantity: int | None = Field(default=None, ge=0)
    error_code: str | None = None
    message: str | None = None


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/robots")
def list_robots() -> list[dict[str, Any]]:
    return [robot.__dict__ for robot in store.list_robots()]


@app.post("/api/robots")
def create_robot(payload: RobotCreate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    robot_id = data.pop("robot_id")
    robot = store.upsert_robot(robot_id, data)
    return robot.__dict__


@app.post("/api/robots/{robot_id}/state")
def update_robot_state(robot_id: str, payload: RobotStateUpdate) -> dict[str, Any]:
    robot = store.upsert_robot(robot_id, payload.model_dump(exclude_unset=True))
    return robot.__dict__


@app.get("/api/missions")
def list_missions() -> list[dict[str, Any]]:
    return [mission.__dict__ for mission in store.list_missions()]


@app.post("/api/missions")
def create_mission(payload: MissionCreate) -> dict[str, Any]:
    mission = store.create_mission(payload.model_dump(exclude_unset=True))
    return mission.__dict__


@app.get("/api/robots/{robot_id}/next-mission")
def next_mission(robot_id: str) -> dict[str, Any]:
    mission = store.get_next_mission_for_robot(robot_id)
    if mission is None:
        return {"mission": None}
    return {"mission": mission.__dict__}


@app.post("/api/missions/{mission_id}/state")
def update_mission_state(mission_id: str, payload: MissionStateUpdate) -> dict[str, Any]:
    mission = store.update_mission_state(mission_id, payload.model_dump(exclude_unset=True))
    if mission is None:
        raise HTTPException(status_code=404, detail="mission not found")
    return mission.__dict__
