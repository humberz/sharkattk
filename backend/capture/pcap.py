import asyncio
import csv
import io
import subprocess
from typing import Any, Callable, Dict, Optional

# Exact tshark field names to extract
_FIELDS = [
    'frame.number', 'frame.time_epoch', 'frame.len', 'frame.protocols',
    'ip.src', 'ip.dst', 'ip.flags.df', 'ip.frag_offset', 'ip.ttl',
    'ipv6.src', 'ipv6.dst',
    'tcp.stream', 'tcp.srcport', 'tcp.dstport', 'tcp.flags',
    'tcp.window_size_value', 'tcp.seq', 'tcp.ack',
    'tcp.analysis.retransmission', 'tcp.analysis.duplicate_ack',
    'tcp.analysis.out_of_order', 'tcp.analysis.ack_rtt',
    'tcp.options.wscale.shift',
    'udp.srcport', 'udp.dstport',
    'icmp.type', 'icmp.code',
]


def _run_tshark(file_path: str, max_packets: int):
    """Blocking tshark call — run inside asyncio.to_thread."""
    cmd = [
        'tshark', '-r', file_path,
        '-T', 'fields',
        '-E', 'header=y',
        '-E', 'separator=,',
        '-E', 'quote=d',
        '-E', 'occurrence=f',
        '-c', str(max_packets),
    ]
    for f in _FIELDS:
        cmd += ['-e', f]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return result.stdout, result.stderr


async def load_pcap(
    file_path: str,
    packet_callback: Callable,
    progress_callback: Optional[Callable] = None,
    max_packets: int = 50000,
) -> int:
    """Parse a pcap via tshark subprocess (no pyshark event loop conflicts)."""
    stdout, stderr = await asyncio.to_thread(_run_tshark, file_path, max_packets)

    if not stdout.strip():
        raise RuntimeError(f'tshark produced no output. stderr: {stderr[:500]}')

    reader = csv.DictReader(io.StringIO(stdout))
    count = 0
    for row in reader:
        pkt = _parse_row(row)
        await packet_callback(pkt)
        count += 1
        if count % 500 == 0 and progress_callback:
            await progress_callback(count)
        if count % 100 == 0:
            await asyncio.sleep(0)

    return count


def _int(val, default=None):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _float(val, default=None):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _parse_row(row: Dict[str, str]) -> Dict[str, Any]:
    protocols = row.get('frame.protocols') or ''
    return {
        'number':           _int(row.get('frame.number'), 0),
        'timestamp':        _float(row.get('frame.time_epoch'), 0.0),
        'length':           _int(row.get('frame.len'), 0),
        'protocol':         protocols.split(':')[-1].upper() if protocols else 'UNKNOWN',
        'src_ip':           row.get('ip.src') or row.get('ipv6.src') or None,
        'dst_ip':           row.get('ip.dst') or row.get('ipv6.dst') or None,
        'src_port':         row.get('tcp.srcport') or row.get('udp.srcport') or None,
        'dst_port':         row.get('tcp.dstport') or row.get('udp.dstport') or None,
        'tcp_stream':       _int(row.get('tcp.stream')),
        'tcp_flags':        row.get('tcp.flags') or None,
        'tcp_window':       _int(row.get('tcp.window_size_value')),
        'tcp_seq':          row.get('tcp.seq') or None,
        'tcp_ack':          row.get('tcp.ack') or None,
        'tcp_window_scale': _int(row.get('tcp.options.wscale.shift')),
        'rtt':              _float(row.get('tcp.analysis.ack_rtt')),
        'is_retransmission': bool(row.get('tcp.analysis.retransmission')),
        'is_dup_ack':        bool(row.get('tcp.analysis.duplicate_ack')),
        'is_out_of_order':   bool(row.get('tcp.analysis.out_of_order')),
        'ip_df':            row.get('ip.flags.df') == '1',
        'ip_frag_offset':   _int(row.get('ip.frag_offset'), 0),
        'ttl':              row.get('ip.ttl') or None,
        'icmp_type':        _int(row.get('icmp.type')),
        'icmp_code':        _int(row.get('icmp.code')),
    }
