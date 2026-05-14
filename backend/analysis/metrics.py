from collections import defaultdict
from typing import Any, Dict, List, Optional
import subprocess
import json
import tempfile
import os


def _safe(pkt, *attrs, default=None):
    """Safely traverse nested pyshark layer attributes."""
    try:
        obj = pkt
        for attr in attrs:
            obj = getattr(obj, attr)
        return str(obj)
    except Exception:
        return default


class CaptureAnalyzer:
    def __init__(self, capture_id: str, file_path: Optional[str] = None):
        self.capture_id = capture_id
        self.file_path = file_path  # path to underlying pcap (used for tshark filter queries)

        self.packets: List[Dict[str, Any]] = []
        self.tcp_streams: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
        self.protocol_counts: Dict[str, int] = defaultdict(int)
        self.retransmissions: List[Dict[str, Any]] = []
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None

    # ------------------------------------------------------------------
    # Packet ingestion
    # ------------------------------------------------------------------

    def ingest(self, pkt) -> Dict[str, Any]:
        """Process one packet — accepts a pre-parsed dict (file load) or pyshark object (live)."""
        p = pkt if isinstance(pkt, dict) else self._extract(pkt)
        self.packets.append(p)

        if self.start_time is None or p["timestamp"] < self.start_time:
            self.start_time = p["timestamp"]
        if self.end_time is None or p["timestamp"] > self.end_time:
            self.end_time = p["timestamp"]

        proto = p["protocol"]
        self.protocol_counts[proto] += 1

        if p.get("tcp_stream") is not None:
            self.tcp_streams[p["tcp_stream"]].append(p)

        if p.get("is_retransmission") or p.get("is_dup_ack"):
            self.retransmissions.append(p)

        return p

    def _extract(self, pkt) -> Dict[str, Any]:
        try:
            ts = float(pkt.sniff_timestamp)
        except Exception:
            ts = 0.0

        p: Dict[str, Any] = {
            "number": int(_safe(pkt, "number", default=0)),
            "timestamp": ts,
            "length": int(_safe(pkt, "length", default=0)),
            "protocol": pkt.highest_layer if hasattr(pkt, "highest_layer") else "UNKNOWN",
            "src_ip": None,
            "dst_ip": None,
            "src_port": None,
            "dst_port": None,
            "tcp_stream": None,
            "tcp_flags": None,
            "tcp_window": None,
            "tcp_seq": None,
            "tcp_ack": None,
            "tcp_window_scale": None,
            "rtt": None,
            "is_retransmission": False,
            "is_dup_ack": False,
            "is_out_of_order": False,
            "ip_df": False,
            "ip_frag_offset": 0,
            "ttl": None,
            "icmp_type": None,
            "icmp_code": None,
        }

        # IP layer
        if hasattr(pkt, "ip"):
            p["src_ip"] = _safe(pkt.ip, "src")
            p["dst_ip"] = _safe(pkt.ip, "dst")
            p["ttl"] = _safe(pkt.ip, "ttl")
            try:
                p["ip_df"] = bool(int(_safe(pkt.ip, "flags_df", default="0")))
            except Exception:
                pass
            try:
                p["ip_frag_offset"] = int(_safe(pkt.ip, "frag_offset", default="0"))
            except Exception:
                pass

        # IPv6
        if hasattr(pkt, "ipv6") and p["src_ip"] is None:
            p["src_ip"] = _safe(pkt.ipv6, "src")
            p["dst_ip"] = _safe(pkt.ipv6, "dst")

        # TCP layer
        if hasattr(pkt, "tcp"):
            try:
                p["tcp_stream"] = int(_safe(pkt.tcp, "stream", default="-1"))
                if p["tcp_stream"] < 0:
                    p["tcp_stream"] = None
            except Exception:
                pass
            p["src_port"] = _safe(pkt.tcp, "srcport")
            p["dst_port"] = _safe(pkt.tcp, "dstport")
            p["tcp_flags"] = _safe(pkt.tcp, "flags")
            try:
                p["tcp_window"] = int(_safe(pkt.tcp, "window_size_value", default="0"))
            except Exception:
                pass
            p["tcp_seq"] = _safe(pkt.tcp, "seq")
            p["tcp_ack"] = _safe(pkt.tcp, "ack")

            # Analysis fields from tshark expert info
            if hasattr(pkt.tcp, "analysis_retransmission"):
                p["is_retransmission"] = True
            if hasattr(pkt.tcp, "analysis_duplicate_ack"):
                p["is_dup_ack"] = True
            if hasattr(pkt.tcp, "analysis_out_of_order"):
                p["is_out_of_order"] = True
            try:
                rtt_str = _safe(pkt.tcp, "analysis_ack_rtt")
                if rtt_str:
                    p["rtt"] = float(rtt_str)
            except Exception:
                pass

            # Window scale option (from SYN/SYN-ACK)
            try:
                p["tcp_window_scale"] = int(_safe(pkt.tcp, "options_wscale_shift", default="-1"))
                if p["tcp_window_scale"] < 0:
                    p["tcp_window_scale"] = None
            except Exception:
                pass

        # UDP layer
        if hasattr(pkt, "udp"):
            p["src_port"] = _safe(pkt.udp, "srcport")
            p["dst_port"] = _safe(pkt.udp, "dstport")

        # ICMP
        if hasattr(pkt, "icmp"):
            try:
                p["icmp_type"] = int(_safe(pkt.icmp, "type", default="-1"))
                p["icmp_code"] = int(_safe(pkt.icmp, "code", default="-1"))
            except Exception:
                pass

        return p

    # ------------------------------------------------------------------
    # Tool-callable analysis methods
    # ------------------------------------------------------------------

    def get_summary(self) -> Dict[str, Any]:
        duration = (self.end_time - self.start_time) if self.start_time and self.end_time else 0
        total_bytes = sum(p["length"] for p in self.packets)
        throughput_bps = (total_bytes * 8 / duration) if duration > 0 else 0

        top_talkers: Dict[str, int] = defaultdict(int)
        for p in self.packets:
            if p["src_ip"]:
                top_talkers[p["src_ip"]] += p["length"]

        sorted_talkers = sorted(top_talkers.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "packet_count": len(self.packets),
            "duration_seconds": round(duration, 3),
            "total_bytes": total_bytes,
            "throughput_bps": round(throughput_bps, 0),
            "throughput_mbps": round(throughput_bps / 1_000_000, 3),
            "tcp_stream_count": len(self.tcp_streams),
            "retransmission_count": len(self.retransmissions),
            "retransmission_rate_pct": round(
                100 * len(self.retransmissions) / max(len(self.packets), 1), 2
            ),
            "protocol_breakdown": dict(self.protocol_counts),
            "top_talkers_by_bytes": [{"ip": ip, "bytes": b} for ip, b in sorted_talkers],
        }

    def get_tcp_streams(self, filter_str: Optional[str] = None) -> List[Dict[str, Any]]:
        results = []
        for stream_id, pkts in self.tcp_streams.items():
            if not pkts:
                continue

            # Extract endpoints from first packets
            src = next((p["src_ip"] for p in pkts if p["src_ip"]), "?")
            dst = next((p["dst_ip"] for p in pkts if p["dst_ip"]), "?")
            sport = next((p["src_port"] for p in pkts if p["src_port"]), "?")
            dport = next((p["dst_port"] for p in pkts if p["dst_port"]), "?")

            label = f"{src}:{sport} → {dst}:{dport}"
            if filter_str and filter_str.lower() not in label.lower():
                continue

            total_bytes = sum(p["length"] for p in pkts)
            ts_list = [p["timestamp"] for p in pkts if p["timestamp"]]
            duration = (max(ts_list) - min(ts_list)) if len(ts_list) > 1 else 0
            retrans = sum(1 for p in pkts if p["is_retransmission"])
            dup_acks = sum(1 for p in pkts if p["is_dup_ack"])

            rtts = [p["rtt"] for p in pkts if p["rtt"] is not None]
            avg_rtt = sum(rtts) / len(rtts) if rtts else None

            windows = [p["tcp_window"] for p in pkts if p["tcp_window"] is not None]
            min_window = min(windows) if windows else None
            max_window = max(windows) if windows else None

            results.append({
                "stream_id": stream_id,
                "endpoints": label,
                "packet_count": len(pkts),
                "bytes": total_bytes,
                "duration_seconds": round(duration, 3),
                "throughput_bps": round(total_bytes * 8 / duration, 0) if duration > 0 else 0,
                "throughput_mbps": round(total_bytes * 8 / duration / 1_000_000, 3) if duration > 0 else 0,
                "retransmissions": retrans,
                "duplicate_acks": dup_acks,
                "avg_rtt_seconds": round(avg_rtt, 6) if avg_rtt else None,
                "avg_rtt_ms": round(avg_rtt * 1000, 3) if avg_rtt else None,
                "min_window_bytes": min_window,
                "max_window_bytes": max_window,
            })

        results.sort(key=lambda x: x["bytes"], reverse=True)
        return results

    def get_retransmissions(self) -> Dict[str, Any]:
        by_stream: Dict[int, Dict[str, Any]] = defaultdict(
            lambda: {"retransmissions": 0, "dup_acks": 0, "out_of_order": 0, "packets": []}
        )

        for p in self.packets:
            sid = p.get("tcp_stream", -1) or -1
            if p["is_retransmission"]:
                by_stream[sid]["retransmissions"] += 1
                by_stream[sid]["packets"].append({
                    "number": p["number"],
                    "timestamp": p["timestamp"],
                    "type": "retransmission",
                    "src": p["src_ip"],
                    "dst": p["dst_ip"],
                    "length": p["length"],
                })
            if p["is_dup_ack"]:
                by_stream[sid]["dup_acks"] += 1
                by_stream[sid]["packets"].append({
                    "number": p["number"],
                    "timestamp": p["timestamp"],
                    "type": "dup_ack",
                    "src": p["src_ip"],
                    "dst": p["dst_ip"],
                    "length": p["length"],
                })
            if p["is_out_of_order"]:
                by_stream[sid]["out_of_order"] += 1

        return {
            "total_retransmissions": len(self.retransmissions),
            "retransmission_rate_pct": round(
                100 * len(self.retransmissions) / max(len(self.packets), 1), 2
            ),
            "by_stream": {str(k): v for k, v in by_stream.items() if
                          v["retransmissions"] > 0 or v["dup_acks"] > 0},
        }

    def analyze_throughput(
        self, stream_id: Optional[int] = None, interval_ms: int = 1000
    ) -> Dict[str, Any]:
        pkts = self.packets
        if stream_id is not None:
            pkts = self.tcp_streams.get(stream_id, [])

        if not pkts:
            return {"buckets": [], "peak_mbps": 0, "avg_mbps": 0}

        interval_s = interval_ms / 1000.0
        ts_start = min(p["timestamp"] for p in pkts)

        buckets: Dict[int, int] = defaultdict(int)
        for p in pkts:
            bucket = int((p["timestamp"] - ts_start) / interval_s)
            buckets[bucket] += p["length"]

        max_bucket = max(buckets.keys()) if buckets else 0
        series = []
        for i in range(max_bucket + 1):
            bytes_in_bucket = buckets.get(i, 0)
            mbps = (bytes_in_bucket * 8) / (interval_s * 1_000_000)
            series.append({
                "time_offset_ms": i * interval_ms,
                "bytes": bytes_in_bucket,
                "mbps": round(mbps, 3),
            })

        mbps_vals = [b["mbps"] for b in series]
        return {
            "stream_id": stream_id,
            "interval_ms": interval_ms,
            "buckets": series,
            "peak_mbps": round(max(mbps_vals), 3) if mbps_vals else 0,
            "avg_mbps": round(sum(mbps_vals) / len(mbps_vals), 3) if mbps_vals else 0,
        }

    def check_mtu_issues(self) -> Dict[str, Any]:
        fragmented: List[Dict] = []
        large_df: List[Dict] = []
        icmp_unreachable: List[Dict] = []

        for p in self.packets:
            if p["ip_frag_offset"] and p["ip_frag_offset"] > 0:
                fragmented.append({
                    "number": p["number"],
                    "timestamp": p["timestamp"],
                    "src": p["src_ip"],
                    "dst": p["dst_ip"],
                    "length": p["length"],
                    "frag_offset": p["ip_frag_offset"],
                })
            elif p["ip_df"] and p["length"] > 1400:
                large_df.append({
                    "number": p["number"],
                    "timestamp": p["timestamp"],
                    "src": p["src_ip"],
                    "dst": p["dst_ip"],
                    "length": p["length"],
                })
            if p["icmp_type"] == 3:  # Destination unreachable
                icmp_unreachable.append({
                    "number": p["number"],
                    "timestamp": p["timestamp"],
                    "src": p["src_ip"],
                    "dst": p["dst_ip"],
                    "code": p["icmp_code"],
                    "description": _icmp3_code(p["icmp_code"]),
                })

        # Find the largest unfragmented frame
        max_frame = max((p["length"] for p in self.packets), default=0)
        large_frames = sorted(
            [p["length"] for p in self.packets if p["length"] > 1400], reverse=True
        )
        frame_size_dist = {
            "<=576": sum(1 for p in self.packets if p["length"] <= 576),
            "577-1280": sum(1 for p in self.packets if 577 <= p["length"] <= 1280),
            "1281-1500": sum(1 for p in self.packets if 1281 <= p["length"] <= 1500),
            ">1500 (jumbo)": sum(1 for p in self.packets if p["length"] > 1500),
        }

        return {
            "fragmented_packets": fragmented[:50],
            "fragmented_count": len(fragmented),
            "large_df_packets": large_df[:50],
            "large_df_count": len(large_df),
            "icmp_unreachable": icmp_unreachable[:50],
            "icmp_unreachable_count": len(icmp_unreachable),
            "max_frame_size": max_frame,
            "frame_size_distribution": frame_size_dist,
            "notes": _mtu_notes(fragmented, large_df, icmp_unreachable),
        }

    def get_rtt_analysis(self, stream_id: Optional[int] = None) -> Dict[str, Any]:
        streams_to_check = (
            {stream_id: self.tcp_streams.get(stream_id, [])}
            if stream_id is not None
            else self.tcp_streams
        )

        result = []
        for sid, pkts in streams_to_check.items():
            rtts = [p["rtt"] for p in pkts if p["rtt"] is not None]
            if not rtts:
                continue
            rtts_ms = [r * 1000 for r in rtts]
            result.append({
                "stream_id": sid,
                "sample_count": len(rtts_ms),
                "min_ms": round(min(rtts_ms), 3),
                "max_ms": round(max(rtts_ms), 3),
                "avg_ms": round(sum(rtts_ms) / len(rtts_ms), 3),
                "p95_ms": round(sorted(rtts_ms)[int(len(rtts_ms) * 0.95)], 3),
            })

        return {"streams": result}

    def get_window_scaling(self) -> Dict[str, Any]:
        results = []
        for sid, pkts in self.tcp_streams.items():
            scales = [p["tcp_window_scale"] for p in pkts if p["tcp_window_scale"] is not None]
            windows = [p["tcp_window"] for p in pkts if p["tcp_window"] is not None]
            zero_windows = sum(1 for w in windows if w == 0)

            scale_factor = scales[0] if scales else None
            actual_max_window = None
            if windows and scale_factor is not None:
                actual_max_window = max(windows) * (2 ** scale_factor)

            if not windows:
                continue

            results.append({
                "stream_id": sid,
                "window_scale_shift": scale_factor,
                "scale_multiplier": 2 ** scale_factor if scale_factor else 1,
                "min_advertised_window": min(windows),
                "max_advertised_window": max(windows),
                "actual_max_window_bytes": actual_max_window,
                "zero_window_events": zero_windows,
                "avg_window": round(sum(windows) / len(windows)),
                "window_limited": zero_windows > 0 or (windows and min(windows) < 8192),
            })

        return {"streams": results}

    def get_protocol_breakdown(self) -> Dict[str, Any]:
        total = sum(self.protocol_counts.values()) or 1
        breakdown = [
            {
                "protocol": proto,
                "packet_count": count,
                "percentage": round(100 * count / total, 2),
            }
            for proto, count in sorted(
                self.protocol_counts.items(), key=lambda x: x[1], reverse=True
            )
        ]
        return {"total_packets": len(self.packets), "protocols": breakdown}

    def filter_packets_simple(self, search: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Simple in-memory filter — matches src/dst IP, port, or protocol (case-insensitive)."""
        search_lower = search.lower()
        matches = []
        for p in self.packets:
            haystack = " ".join(
                str(v) for v in [p["src_ip"], p["dst_ip"], p["src_port"],
                                  p["dst_port"], p["protocol"]] if v
            ).lower()
            if search_lower in haystack:
                matches.append(p)
                if len(matches) >= limit:
                    break
        return matches

    def filter_packets_tshark(self, display_filter: str, limit: int = 100) -> Dict[str, Any]:
        """Run tshark display filter against the saved pcap file."""
        if not self.file_path or not os.path.exists(self.file_path):
            return {"error": "No pcap file available for filter queries", "packets": []}

        try:
            result = subprocess.run(
                [
                    "tshark", "-r", self.file_path,
                    "-Y", display_filter,
                    "-T", "json",
                    "-c", str(limit),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                return {"error": result.stderr.strip(), "packets": []}

            raw = json.loads(result.stdout or "[]")
            packets = []
            for item in raw:
                layers = item.get("_source", {}).get("layers", {})
                packets.append({
                    "frame_number": layers.get("frame", {}).get("frame.number"),
                    "timestamp": layers.get("frame", {}).get("frame.time_relative"),
                    "src": layers.get("ip", {}).get("ip.src") or layers.get("ipv6", {}).get("ipv6.src"),
                    "dst": layers.get("ip", {}).get("ip.dst") or layers.get("ipv6", {}).get("ipv6.dst"),
                    "protocol": layers.get("frame", {}).get("frame.protocols", "").split(":")[-1].upper(),
                    "length": layers.get("frame", {}).get("frame.len"),
                })
            return {"filter": display_filter, "match_count": len(packets), "packets": packets}
        except Exception as e:
            return {"error": str(e), "packets": []}


def _icmp3_code(code: Optional[int]) -> str:
    codes = {
        0: "Net unreachable", 1: "Host unreachable", 2: "Protocol unreachable",
        3: "Port unreachable", 4: "Fragmentation needed (MTU issue)", 5: "Source route failed",
    }
    return codes.get(code, f"Code {code}")


def _mtu_notes(fragmented, large_df, icmp_unreachable) -> List[str]:
    notes = []
    if fragmented:
        notes.append(
            f"{len(fragmented)} fragmented IP packets detected — frames are being split, "
            "suggesting path MTU is smaller than sender's MSS."
        )
    if large_df:
        notes.append(
            f"{len(large_df)} packets >1400 bytes with DF (Don't Fragment) bit set — "
            "if these are being dropped silently it causes PMTUD black holes."
        )
    if any(p["code"] == 4 for p in icmp_unreachable):
        notes.append(
            "ICMP Type 3 Code 4 (Fragmentation Needed) detected — this is direct evidence "
            "of an MTU mismatch. The receiving router is signalling the sender to reduce packet size."
        )
    if not notes:
        notes.append("No obvious MTU/fragmentation issues detected in this capture.")
    return notes
