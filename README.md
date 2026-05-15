# WireClaude

Network packet capture analysis tool with Claude AI. Upload `.pcap` files or run live captures, then chat with an AI analyst that queries the capture data directly using 9 built-in analysis tools.

## Requirements

- Python 3.10+
- Node.js 18+
- [tshark](https://www.wireshark.org/docs/man-pages/tshark.html) (Wireshark CLI)
- Anthropic API key

## Installation

```bash
git clone https://github.com/humberz/sharkattk.git
cd sharkattk
```

### Install tshark

```bash
sudo apt install tshark
```

### Live capture permissions

Ubuntu symlinks `dumpcap` — `setcap` will fail on the symlink, use the resolved path:

```bash
sudo setcap cap_net_raw,cap_net_admin+eip /usr/bin/dumpcap
```

If that path doesn't work, find the real binary first:

```bash
readlink -f $(which dumpcap)
```

### Configure API key

Create a `.env` file in the project root:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

Alternatively set it via the Settings panel in the UI after starting.

## Running

```bash
chmod +x start.sh
./start.sh
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000

The script creates the Python venv, installs all dependencies, and starts both services. Press `Ctrl+C` to stop both.

## Auto-start on Boot (systemd)

Create a systemd service (replace `base` with your Linux username):

```bash
sudo tee /etc/systemd/system/wireclaude.service > /dev/null <<EOF
[Unit]
Description=WireClaude
After=network.target

[Service]
Type=simple
User=base
WorkingDirectory=/home/base/sharkattk
ExecStart=/bin/bash /home/base/sharkattk/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable wireclaude
sudo systemctl start wireclaude
```

Useful commands:

```bash
sudo systemctl status wireclaude       # check status
sudo systemctl restart wireclaude      # restart (e.g. after git pull)
journalctl -u wireclaude -f            # tail logs
```

## Updating

```bash
git pull && ./start.sh
```

Or if running as a service:

```bash
git pull && sudo systemctl restart wireclaude
```
