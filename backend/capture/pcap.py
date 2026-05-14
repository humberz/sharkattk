import asyncio
from pathlib import Path
from typing import Callable, Optional
import pyshark


async def load_pcap(
    file_path: str,
    packet_callback: Callable,
    progress_callback: Optional[Callable] = None,
    max_packets: int = 50000,
) -> int:
    """Parse a pcap file and call packet_callback for each packet. Returns total packet count."""
    cap = pyshark.FileCapture(
        file_path,
        keep_packets=False,
        use_json=True,
        include_raw=False,
    )
    count = 0
    try:
        for pkt in cap:
            await packet_callback(pkt)
            count += 1
            if count % 500 == 0 and progress_callback:
                await progress_callback(count)
            if count >= max_packets:
                break
            # Yield control periodically so we don't block the event loop
            if count % 100 == 0:
                await asyncio.sleep(0)
    finally:
        try:
            result = cap.close()
            if asyncio.iscoroutine(result):
                await result
        except Exception:
            pass
    return count
