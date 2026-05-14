import asyncio
import csv
from typing import Callable, Optional

from capture.pcap import _FIELDS, _parse_row


class LiveCaptureManager:
    def __init__(self, interface: str, output_file: str, capture_filter: Optional[str] = None):
        self.interface = interface
        self.capture_filter = capture_filter
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._task: Optional[asyncio.Task] = None
        self.is_running = False
        self.packet_count = 0

    async def start(self, packet_callback: Callable) -> None:
        self.is_running = True

        cmd = [
            'tshark',
            '-i', self.interface,
            '-l',           # flush stdout after every packet
            '-T', 'fields',
            '-E', 'header=n',
            '-E', 'separator=,',
            '-E', 'quote=d',
            '-E', 'occurrence=f',
        ]
        for f in _FIELDS:
            cmd += ['-e', f]
        if self.capture_filter:
            cmd += ['-f', self.capture_filter]

        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        self._task = asyncio.get_event_loop().create_task(self._run(packet_callback))

    async def _run(self, packet_callback: Callable) -> None:
        try:
            while self.is_running and self._proc and self._proc.stdout:
                line = await self._proc.stdout.readline()
                if not line:
                    break
                line = line.decode('utf-8', errors='replace').strip()
                if not line:
                    continue
                try:
                    reader = csv.reader([line], quotechar='"')
                    values = next(reader)
                    if len(values) == len(_FIELDS):
                        row = dict(zip(_FIELDS, values))
                        pkt = _parse_row(row)
                        self.packet_count += 1
                        await packet_callback(pkt)
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            self.is_running = False

    async def stop(self) -> None:
        self.is_running = False
        if self._proc:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=3.0)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
