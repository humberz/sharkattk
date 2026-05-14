import asyncio
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import storage
from analysis.claude_client import stream_chat
from analysis.metrics import CaptureAnalyzer
from capture.live import LiveCaptureManager
from capture.pcap import load_pcap
from models import (
    AppSettings,
    CaptureSession,
    CaptureStatus,
    CaptureType,
    ChatRequest,
    StartLiveCaptureRequest,
    UpdateSettingsRequest,
)
from settings_manager import get_api_key, load_settings, save_settings

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
CAPTURE_DIR = Path(__file__).parent.parent / "captures"
UPLOAD_DIR.mkdir(exist_ok=True)
CAPTURE_DIR.mkdir(exist_ok=True)

app = FastAPI(title="SharkAttk", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections for live capture broadcast: capture_id -> set of websockets
_live_ws_clients: dict[str, set[WebSocket]] = {}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@app.get("/api/settings")
def get_settings():
    s = load_settings()
    # Mask API key
    masked = s.model_dump()
    if masked["anthropic_api_key"]:
        masked["anthropic_api_key"] = "***" + masked["anthropic_api_key"][-4:]
    return masked


@app.put("/api/settings")
def update_settings(req: UpdateSettingsRequest):
    s = load_settings()
    if req.live_capture_mode is not None:
        if req.live_capture_mode not in ("manual", "always_on"):
            raise HTTPException(400, "live_capture_mode must be 'manual' or 'always_on'")
        s.live_capture_mode = req.live_capture_mode
    if req.default_interface is not None:
        s.default_interface = req.default_interface
    if req.anthropic_api_key is not None:
        s.anthropic_api_key = req.anthropic_api_key
    if req.max_packets_in_memory is not None:
        s.max_packets_in_memory = req.max_packets_in_memory
    if req.claude_model is not None:
        s.claude_model = req.claude_model
    save_settings(s)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Captures — list / delete
# ---------------------------------------------------------------------------


@app.get("/api/captures")
def list_captures():
    sessions = storage.list_sessions()
    return [_session_response(s) for s in sessions]


@app.get("/api/captures/{capture_id}")
def get_capture(capture_id: str):
    session = storage.get_session(capture_id)
    if not session:
        raise HTTPException(404, "Capture not found")
    return _session_response(session)


@app.delete("/api/captures/{capture_id}")
async def delete_capture(capture_id: str):
    session = storage.get_session(capture_id)
    if not session:
        raise HTTPException(404, "Capture not found")

    # Stop live capture if running
    mgr = storage.live_managers.get(capture_id)
    if mgr:
        await mgr.stop()

    storage.delete_session(capture_id)
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# File upload
# ---------------------------------------------------------------------------


@app.post("/api/captures/upload")
async def upload_pcap(file: UploadFile = File(...), name: Optional[str] = Form(None)):
    if not file.filename.endswith((".pcap", ".pcapng", ".cap")):
        raise HTTPException(400, "File must be a .pcap, .pcapng, or .cap file")

    settings = load_settings()
    capture_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / f"{capture_id}_{file.filename}"

    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            await f.write(chunk)

    session = CaptureSession(
        id=capture_id,
        name=name or file.filename,
        type=CaptureType.FILE,
        status=CaptureStatus.LOADING,
        file_path=str(dest),
    )
    storage.sessions[capture_id] = session

    analyzer = CaptureAnalyzer(capture_id=capture_id, file_path=str(dest))
    storage.analyzers[capture_id] = analyzer

    # Process pcap in background
    asyncio.create_task(
        _process_pcap(capture_id, str(dest), analyzer, settings.max_packets_in_memory)
    )

    return {"capture_id": capture_id, "status": "loading"}


async def _process_pcap(
    capture_id: str, file_path: str, analyzer: CaptureAnalyzer, max_packets: int
):
    session = storage.get_session(capture_id)
    try:
        async def on_packet(pkt):
            analyzer.ingest(pkt)

        async def on_progress(count: int):
            if session:
                session.packet_count = count

        count = await load_pcap(file_path, on_packet, on_progress, max_packets)

        if session:
            session.packet_count = count
            session.status = CaptureStatus.COMPLETE
            if analyzer.start_time and analyzer.end_time:
                session.duration_seconds = round(analyzer.end_time - analyzer.start_time, 3)
            session.metadata = {
                "protocol_breakdown": analyzer.get_protocol_breakdown(),
                "tcp_stream_count": len(analyzer.tcp_streams),
            }
    except Exception as e:
        if session:
            session.status = CaptureStatus.ERROR
            session.metadata["error"] = str(e)


# ---------------------------------------------------------------------------
# Live capture
# ---------------------------------------------------------------------------


@app.post("/api/captures/live/start")
async def start_live_capture(req: StartLiveCaptureRequest):
    settings = load_settings()

    if settings.live_capture_mode == "manual":
        pass  # always allowed when manually triggered
    # (always_on mode would have auto-started already)

    capture_id = str(uuid.uuid4())
    interface = req.interface or settings.default_interface
    name = req.name or f"Live: {interface} {datetime.utcnow().strftime('%H:%M:%S')}"
    pcap_path = str(CAPTURE_DIR / f"{capture_id}.pcapng")

    session = CaptureSession(
        id=capture_id,
        name=name,
        type=CaptureType.LIVE,
        status=CaptureStatus.ACTIVE,
        interface=interface,
        file_path=pcap_path,
    )
    storage.sessions[capture_id] = session

    analyzer = CaptureAnalyzer(capture_id=capture_id, file_path=pcap_path)
    storage.analyzers[capture_id] = analyzer

    mgr = LiveCaptureManager(
        interface=interface,
        output_file=pcap_path,
        capture_filter=req.capture_filter,
    )
    storage.live_managers[capture_id] = mgr

    async def on_live_packet(pkt):
        p = analyzer.ingest(pkt)
        session.packet_count = len(analyzer.packets)
        # Broadcast to any connected WebSocket clients
        ws_set = _live_ws_clients.get(capture_id, set())
        dead = set()
        for ws in ws_set:
            try:
                await ws.send_json({"type": "packet", "data": p})
            except Exception:
                dead.add(ws)
        ws_set -= dead

    await mgr.start(on_live_packet)

    return {"capture_id": capture_id, "status": "active", "interface": interface}


@app.post("/api/captures/{capture_id}/stop")
async def stop_live_capture(capture_id: str):
    session = storage.get_session(capture_id)
    if not session:
        raise HTTPException(404, "Capture not found")

    mgr = storage.live_managers.get(capture_id)
    if mgr:
        await mgr.stop()
        del storage.live_managers[capture_id]

    session.status = CaptureStatus.STOPPED
    if storage.analyzers.get(capture_id):
        a = storage.analyzers[capture_id]
        if a.start_time and a.end_time:
            session.duration_seconds = round(a.end_time - a.start_time, 3)

    return {"status": "stopped"}


# ---------------------------------------------------------------------------
# Live capture WebSocket (real-time packet feed)
# ---------------------------------------------------------------------------


@app.websocket("/ws/captures/{capture_id}/live")
async def live_ws(websocket: WebSocket, capture_id: str):
    session = storage.get_session(capture_id)
    if not session:
        await websocket.close(code=4004)
        return

    await websocket.accept()
    _live_ws_clients.setdefault(capture_id, set()).add(websocket)

    try:
        while True:
            # Keep connection alive; client sends pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        _live_ws_clients.get(capture_id, set()).discard(websocket)


# ---------------------------------------------------------------------------
# Chat — SSE streaming
# ---------------------------------------------------------------------------


@app.post("/api/captures/{capture_id}/chat")
async def chat(capture_id: str, req: ChatRequest):
    session = storage.get_session(capture_id)
    if not session:
        raise HTTPException(404, "Capture not found")

    analyzer = storage.analyzers.get(capture_id)
    if not analyzer:
        raise HTTPException(409, "Capture is still loading, try again shortly")

    settings = load_settings()
    api_key = get_api_key(settings)
    if not api_key:
        raise HTTPException(400, "Anthropic API key not configured — go to Settings")

    # Append user message to history
    session.chat_history.append({"role": "user", "content": req.message})

    # Build conversation history for Claude (exclude tool call internals stored separately)
    clean_history = [
        {"role": m["role"], "content": m["content"]}
        for m in session.chat_history[:-1]  # exclude the just-appended message
        if m["role"] in ("user", "assistant") and isinstance(m.get("content"), str)
    ]

    async def event_stream():
        full_text = ""
        tool_calls = []
        async for chunk in stream_chat(
            api_key=api_key,
            model=settings.claude_model,
            analyzer=analyzer,
            conversation=clean_history,
            user_message=req.message,
        ):
            yield chunk
            # Parse done event to capture final text for history
            if chunk.startswith("event: done"):
                import json as _json
                try:
                    data_line = [l for l in chunk.split("\n") if l.startswith("data:")]
                    if data_line:
                        payload = _json.loads(data_line[0][5:])
                        full_text = payload.get("text", "")
                        tool_calls = payload.get("tool_calls", [])
                except Exception:
                    pass

        # Store assistant reply in history
        session.chat_history.append({
            "role": "assistant",
            "content": full_text,
            "tool_calls": tool_calls,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/captures/{capture_id}/chat/history")
def get_chat_history(capture_id: str):
    session = storage.get_session(capture_id)
    if not session:
        raise HTTPException(404, "Capture not found")
    return session.chat_history


@app.delete("/api/captures/{capture_id}/chat/history")
def clear_chat_history(capture_id: str):
    session = storage.get_session(capture_id)
    if not session:
        raise HTTPException(404, "Capture not found")
    session.chat_history = []
    return {"status": "cleared"}


# ---------------------------------------------------------------------------
# Network interfaces
# ---------------------------------------------------------------------------


@app.get("/api/interfaces")
def list_interfaces():
    """Return available network interfaces via tshark."""
    import subprocess
    try:
        result = subprocess.run(
            ["tshark", "-D"], capture_output=True, text=True, timeout=5
        )
        interfaces = []
        for line in result.stdout.strip().splitlines():
            parts = line.strip().split(". ", 1)
            if len(parts) == 2:
                interfaces.append(parts[1].split(" ")[0])
        return {"interfaces": interfaces}
    except Exception as e:
        return {"interfaces": [], "error": str(e)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _session_response(session: CaptureSession) -> dict:
    analyzer = storage.analyzers.get(session.id)
    metadata = {**session.metadata}
    if analyzer:
        metadata["tcp_stream_count"] = len(analyzer.tcp_streams)
        metadata["protocol_breakdown"] = analyzer.get_protocol_breakdown()
    return {
        "id": session.id,
        "name": session.name,
        "type": session.type,
        "status": session.status,
        "created_at": session.created_at.isoformat(),
        "interface": session.interface,
        "packet_count": session.packet_count,
        "duration_seconds": session.duration_seconds,
        "metadata": metadata,
        "has_chat": len(session.chat_history) > 0,
    }
