import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List

from models import CaptureSession, CaptureStatus, CaptureType

DB_PATH = Path(__file__).parent.parent / "wireclaude.db"


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def init_db() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS captures (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                type            TEXT NOT NULL,
                status          TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                interface       TEXT,
                file_path       TEXT,
                packet_count    INTEGER DEFAULT 0,
                duration_seconds REAL,
                metadata        TEXT DEFAULT '{}'
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                capture_id  TEXT NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                tool_calls  TEXT DEFAULT '[]',
                usage       TEXT,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
            )
        """)
        c.commit()


def save_session(session: CaptureSession) -> None:
    with _conn() as c:
        c.execute("""
            INSERT OR REPLACE INTO captures
              (id, name, type, status, created_at, interface, file_path,
               packet_count, duration_seconds, metadata)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            session.id, session.name, session.type.value, session.status.value,
            session.created_at.isoformat(), session.interface, session.file_path,
            session.packet_count, session.duration_seconds,
            json.dumps(session.metadata),
        ))
        c.commit()


def update_session(session: CaptureSession) -> None:
    with _conn() as c:
        c.execute("""
            UPDATE captures
            SET status=?, packet_count=?, duration_seconds=?, metadata=?
            WHERE id=?
        """, (
            session.status.value, session.packet_count,
            session.duration_seconds, json.dumps(session.metadata),
            session.id,
        ))
        c.commit()


def delete_session(capture_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM captures WHERE id=?", (capture_id,))
        c.commit()


def load_all_sessions() -> List[CaptureSession]:
    sessions = []
    with _conn() as c:
        for row in c.execute("SELECT * FROM captures ORDER BY created_at").fetchall():
            msgs = c.execute(
                "SELECT * FROM chat_messages WHERE capture_id=? ORDER BY id",
                (row["id"],),
            ).fetchall()
            chat_history = [
                {
                    "role": m["role"],
                    "content": m["content"],
                    "tool_calls": json.loads(m["tool_calls"] or "[]"),
                    "usage": json.loads(m["usage"]) if m["usage"] else None,
                }
                for m in msgs
            ]
            sessions.append(CaptureSession(
                id=row["id"],
                name=row["name"],
                type=CaptureType(row["type"]),
                status=CaptureStatus(row["status"]),
                created_at=datetime.fromisoformat(row["created_at"]),
                interface=row["interface"],
                file_path=row["file_path"],
                packet_count=row["packet_count"] or 0,
                duration_seconds=row["duration_seconds"],
                metadata=json.loads(row["metadata"] or "{}"),
                chat_history=chat_history,
            ))
    return sessions


def append_chat_message(capture_id: str, msg: dict) -> None:
    with _conn() as c:
        c.execute("""
            INSERT INTO chat_messages
              (capture_id, role, content, tool_calls, usage, created_at)
            VALUES (?,?,?,?,?,?)
        """, (
            capture_id,
            msg["role"],
            msg.get("content", ""),
            json.dumps(msg.get("tool_calls", [])),
            json.dumps(msg["usage"]) if msg.get("usage") else None,
            datetime.utcnow().isoformat(),
        ))
        c.commit()


def clear_chat_messages(capture_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM chat_messages WHERE capture_id=?", (capture_id,))
        c.commit()
