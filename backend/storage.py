from typing import Dict, Optional
from models import CaptureSession

# In-memory store — keyed by capture ID
sessions: Dict[str, CaptureSession] = {}

# CaptureAnalyzer instances — keyed by capture ID
analyzers: Dict[str, "CaptureAnalyzer"] = {}  # noqa: F821

# Active live capture managers — keyed by capture ID
live_managers: Dict[str, "LiveCaptureManager"] = {}  # noqa: F821


def get_session(capture_id: str) -> Optional[CaptureSession]:
    return sessions.get(capture_id)


def put_session(session: CaptureSession) -> None:
    sessions[session.id] = session


def delete_session(capture_id: str) -> bool:
    if capture_id in sessions:
        del sessions[capture_id]
        analyzers.pop(capture_id, None)
        live_managers.pop(capture_id, None)
        return True
    return False


def list_sessions() -> list[CaptureSession]:
    return list(sessions.values())
