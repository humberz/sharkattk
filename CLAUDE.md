# WireClaude — Claude Code Handover

## What this project is

WireClaude is a self-hosted network packet capture analysis tool. Users upload `.pcap` files or run live interface captures, then chat with Claude AI which queries the capture using 9 built-in analysis tools. The primary use case is diagnosing network performance issues (throughput, retransmissions, MTU/fragmentation, RTT, TCP window sizing).

Deployed on a Linux VM. GitHub: `humberz/sharkattk`.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python, FastAPI, uvicorn |
| Packet parsing | tshark subprocess (NOT pyshark — replaced due to asyncio conflicts) |
| AI | Anthropic SDK, Claude claude-sonnet-4-6, tool-use + SSE streaming |
| Frontend | React, Vite, Tailwind CSS (VS Code Dark+ palette), Recharts |
| Persistence | SQLite (`wireclaude.db`) via `sqlite3` |
| Live packets | WebSocket (`/ws/captures/{id}/live`) |
| Chat streaming | Server-Sent Events (SSE) |

---

## Project structure

```
sharkattk/
├── backend/
│   ├── main.py                  # FastAPI app, all endpoints
│   ├── models.py                # Pydantic models
│   ├── database.py              # SQLite: captures + chat_messages tables
│   ├── storage.py               # In-memory dicts: sessions, analyzers, live_managers
│   ├── settings_manager.py      # load/save settings.json, get_api_key()
│   ├── capture/
│   │   ├── pcap.py              # tshark subprocess file parser (asyncio.to_thread)
│   │   └── live.py              # tshark subprocess live capture (asyncio subprocess)
│   ├── analysis/
│   │   ├── metrics.py           # CaptureAnalyzer — all 9 tool methods
│   │   └── claude_client.py     # Claude tool-use loop, SSE yield, retry logic
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api.js               # All fetch calls to backend
│   │   ├── components/
│   │   │   ├── ChatPanel.jsx    # Split pane: packets table (top) + chat (bottom)
│   │   │   ├── MetricsPanel.jsx # Stat cards, protocol chart, connection tree, bandwidth chart
│   │   │   ├── Sidebar.jsx      # Capture list, upload, live capture controls
│   │   │   ├── SettingsModal.jsx
│   │   │   └── WireClaudeLogo.jsx  # Robot shark SVG
│   │   └── App.jsx
│   ├── vite.config.js           # host 0.0.0.0, proxy /api + /ws to backend, allowedHosts
│   └── tailwind.config.js       # VS Code Dark+ colour palette under `vsc.*`
├── start.sh                     # Creates venv, installs deps, starts both services
├── .env                         # ANTHROPIC_API_KEY (gitignored)
└── .gitignore                   # Excludes uploads/, captures/, wireclaude.db, settings.json
```

---

## Key backend endpoints

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `/api/settings` | API key masked in GET response |
| GET | `/api/captures` | List all sessions |
| GET/DELETE | `/api/captures/{id}` | Single session |
| POST | `/api/captures/upload` | Multipart .pcap/.pcapng/.cap upload |
| POST | `/api/captures/live/start` | Start live tshark capture |
| POST | `/api/captures/{id}/stop` | Stop live capture |
| POST | `/api/captures/{id}/chat` | SSE streaming chat |
| GET/DELETE | `/api/captures/{id}/chat/history` | |
| GET | `/api/captures/{id}/packets` | Paginated packet list (`offset`, `limit`) |
| GET | `/api/captures/{id}/connections` | Top src→dst pairs by bytes |
| GET | `/api/captures/{id}/throughput` | Mbps time-series (`interval_ms`) |
| GET | `/api/interfaces` | tshark -D output |
| WS | `/ws/captures/{id}/live` | Real-time packet feed |

---

## Claude AI tools (in `claude_client.py`)

1. `get_capture_summary` — packet count, duration, throughput, top talkers
2. `get_tcp_streams` — per-stream metrics with optional IP/port filter
3. `get_retransmissions` — retransmissions, dup ACKs, out-of-order
4. `analyze_throughput` — Mbps time-series, optionally per stream
5. `check_mtu_issues` — fragmentation, DF-bit packets, ICMP Type 3
6. `get_rtt_analysis` — min/max/avg/p95 RTT per stream
7. `get_window_scaling` — zero-window events, window size limits
8. `filter_packets` — Wireshark display filter via tshark (requires pcap file)
9. `get_protocol_breakdown` — count + % per protocol

The chat loop in `stream_chat()` runs until `stop_reason == "end_turn"`, supporting multi-turn tool use in a single user message. Retries on HTTP 529 (overloaded) with 2/5/10s backoff, emitting `status` SSE events during wait.

SSE event types: `text`, `tool_use`, `tool_done`, `status`, `done`, `error`.

---

## Persistence

On startup, all sessions are reloaded from SQLite. File captures are re-analysed in the background (`asyncio.create_task`). Live captures that were `ACTIVE` at shutdown are marked `STOPPED`. Chat history is fully restored.

---

## Frontend UI

- **VS Code Dark+ theme** — palette defined in `tailwind.config.js` under `vsc.*`
- **Sidebar** — upload button + live capture start/stop at top, capture list below
- **MetricsPanel (left)** — stat cards, protocol bar chart (horizontal), connection tree SVG (bipartite, edge weight = bytes), bandwidth area chart (Mbps/s)
- **ChatPanel (right)** — resizable split: packets table top (paginated, actual timestamps), chat bottom with SSE streaming, tool call badges, token usage + cost per response

---

## Known gotchas

- **tshark / dumpcap on Ubuntu**: Ubuntu symlinks `dumpcap`. `setcap` fails on symlinks. Always use the real path: `sudo setcap cap_net_raw,cap_net_admin+eip /usr/bin/dumpcap`. Verify with `readlink -f $(which dumpcap)`.
- **pyshark is NOT used** — it was replaced entirely due to asyncio event loop conflicts when running under FastAPI/uvicorn. All parsing goes through tshark subprocess with `-T fields` CSV output.
- **Custom domain access** — Vite blocks unknown hostnames. Add to `allowedHosts` in `frontend/vite.config.js`.
- **max_packets_in_memory** — configurable in Settings (default 500k). Controlled via `load_pcap()` `-c` flag to tshark.

---

## Deployment

```bash
# First time
git clone https://github.com/humberz/sharkattk.git
cd sharkattk
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
chmod +x start.sh

# Run
./start.sh

# Update
git pull && sudo systemctl restart wireclaude
```

Systemd service at `/etc/systemd/system/wireclaude.service` — see README for setup.
