import asyncio
import pyshark
from pathlib import Path
from typing import Callable, Optional


class LiveCaptureManager:
    def __init__(self, interface: str, output_file: str, capture_filter: Optional[str] = None):
        self.interface = interface
        self.output_file = output_file
        self.capture_filter = capture_filter
        self._capture: Optional[pyshark.LiveCapture] = None
        self._task: Optional[asyncio.Task] = None
        self.is_running = False
        self.packet_count = 0

    async def start(self, packet_callback: Callable) -> None:
        self.is_running = True
        self._capture = pyshark.LiveCapture(
            interface=self.interface,
            output_file=self.output_file,
            bpf_filter=self.capture_filter,
        )

        loop = asyncio.get_event_loop()
        self._task = loop.create_task(self._run(packet_callback))

    async def _run(self, packet_callback: Callable) -> None:
        try:
            for pkt in self._capture.sniff_continuously():
                if not self.is_running:
                    break
                self.packet_count += 1
                await packet_callback(pkt)
                await asyncio.sleep(0)
        except Exception:
            pass
        finally:
            self.is_running = False

    async def stop(self) -> None:
        self.is_running = False
        if self._capture:
            try:
                self._capture.close()
            except Exception:
                pass
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
