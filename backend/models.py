from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime


class CaptureType(str, Enum):
    FILE = "file"
    LIVE = "live"


class CaptureStatus(str, Enum):
    LOADING = "loading"
    ACTIVE = "active"
    STOPPED = "stopped"
    COMPLETE = "complete"
    ERROR = "error"


class ChatRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(BaseModel):
    role: ChatRole
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    tool_calls: Optional[List[Dict[str, Any]]] = None


class CaptureSession(BaseModel):
    id: str
    name: str
    type: CaptureType
    status: CaptureStatus
    created_at: datetime = Field(default_factory=datetime.utcnow)
    interface: Optional[str] = None
    file_path: Optional[str] = None
    packet_count: int = 0
    duration_seconds: Optional[float] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    chat_history: List[Dict[str, Any]] = Field(default_factory=list)


class AppSettings(BaseModel):
    live_capture_mode: str = "manual"  # "manual" | "always_on"
    default_interface: str = "eth0"
    anthropic_api_key: str = ""
    max_packets_in_memory: int = 50000
    claude_model: str = "claude-sonnet-4-6"


class StartLiveCaptureRequest(BaseModel):
    interface: Optional[str] = None
    name: Optional[str] = None
    capture_filter: Optional[str] = None


class ChatRequest(BaseModel):
    message: str


class UpdateSettingsRequest(BaseModel):
    live_capture_mode: Optional[str] = None
    default_interface: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    max_packets_in_memory: Optional[int] = None
    claude_model: Optional[str] = None
