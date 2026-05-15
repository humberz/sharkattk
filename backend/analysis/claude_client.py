import asyncio
import json
from typing import Any, AsyncGenerator, Dict, List, Optional
import anthropic
from analysis.metrics import CaptureAnalyzer

MAX_RETRIES = 3
RETRY_DELAYS = [2, 5, 10]  # seconds between attempts

TOOLS = [
    {
        "name": "get_capture_summary",
        "description": (
            "Get a high-level summary of the capture: packet count, duration, total bytes, "
            "throughput, protocol breakdown, top talkers, TCP stream count, and retransmission rate."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_tcp_streams",
        "description": (
            "List all TCP streams with per-stream metrics: endpoints, bytes, throughput, duration, "
            "retransmissions, duplicate ACKs, RTT, and window sizes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filter": {
                    "type": "string",
                    "description": "Optional: filter streams by IP address or port substring",
                }
            },
        },
    },
    {
        "name": "get_retransmissions",
        "description": (
            "Find TCP retransmissions, duplicate ACKs, and out-of-order packets — key indicators "
            "of packet loss, congestion, or link quality issues."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "analyze_throughput",
        "description": (
            "Analyse throughput over time. Returns a time-series of Mbps values. Optionally scoped "
            "to a single TCP stream."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "stream_id": {
                    "type": "integer",
                    "description": "TCP stream index (omit to analyse all traffic)",
                },
                "interval_ms": {
                    "type": "integer",
                    "description": "Bucket width in milliseconds (default 1000)",
                },
            },
        },
    },
    {
        "name": "check_mtu_issues",
        "description": (
            "Detect MTU and fragmentation problems: fragmented IP packets, large frames with the "
            "DF bit set (PMTUD black hole candidates), ICMP Type 3 Code 4 messages, and frame "
            "size distribution."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_rtt_analysis",
        "description": (
            "Analyse TCP round-trip times per stream: min, max, average, and 95th-percentile RTT in ms."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "stream_id": {
                    "type": "integer",
                    "description": "TCP stream index (omit to analyse all streams)",
                }
            },
        },
    },
    {
        "name": "get_window_scaling",
        "description": (
            "Analyse TCP window sizes and scaling. Identifies zero-window events and whether "
            "receiver buffer limits may be throttling throughput."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "filter_packets",
        "description": (
            "Filter packets using a Wireshark display filter expression (requires tshark on PATH "
            "and a saved pcap file). Returns matching packets."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "display_filter": {
                    "type": "string",
                    "description": "Wireshark display filter, e.g. 'tcp.analysis.retransmission' or 'smb2'",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max packets to return (default 100)",
                },
            },
            "required": ["display_filter"],
        },
    },
    {
        "name": "get_protocol_breakdown",
        "description": "Get a count and percentage breakdown of all protocols in the capture.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]

SYSTEM_PROMPT = """You are WireClaude — an expert network performance analyst powered by live packet capture data.

Your role is to diagnose network issues using pcap data. Use tools proactively and in combination before drawing conclusions.

Guidelines:
- When the user first asks about a capture, call get_capture_summary before anything else.
- For slowness complaints, always check retransmissions, throughput, RTT, and window sizes.
- For MTU suspicions, call check_mtu_issues and filter_packets with 'icmp.type==3'.
- Be concise and direct. Lead with the finding, follow with the evidence. No preamble.
- Always quote specific numbers from tool results. Never give vague qualitative answers.
- Use bullet points and markdown headers to structure findings — avoid long prose paragraphs.
- State the most likely root cause first, then supporting evidence, then recommended action.
- If something is inconclusive, say so in one sentence and suggest what additional data would help.
- Do not explain what you are about to do — just do it and report the result."""


def _dispatch_tool(analyzer: CaptureAnalyzer, name: str, inputs: Dict[str, Any]) -> str:
    if name == "get_capture_summary":
        result = analyzer.get_summary()
    elif name == "get_tcp_streams":
        result = analyzer.get_tcp_streams(filter_str=inputs.get("filter"))
    elif name == "get_retransmissions":
        result = analyzer.get_retransmissions()
    elif name == "analyze_throughput":
        result = analyzer.analyze_throughput(
            stream_id=inputs.get("stream_id"),
            interval_ms=inputs.get("interval_ms", 1000),
        )
    elif name == "check_mtu_issues":
        result = analyzer.check_mtu_issues()
    elif name == "get_rtt_analysis":
        result = analyzer.get_rtt_analysis(stream_id=inputs.get("stream_id"))
    elif name == "get_window_scaling":
        result = analyzer.get_window_scaling()
    elif name == "filter_packets":
        result = analyzer.filter_packets_tshark(
            display_filter=inputs["display_filter"],
            limit=inputs.get("limit", 100),
        )
    elif name == "get_protocol_breakdown":
        result = analyzer.get_protocol_breakdown()
    else:
        result = {"error": f"Unknown tool: {name}"}

    return json.dumps(result, default=str)


async def stream_chat(
    api_key: str,
    model: str,
    analyzer: CaptureAnalyzer,
    conversation: List[Dict[str, Any]],
    user_message: str,
) -> AsyncGenerator[str, None]:
    """
    Yields Server-Sent Event strings. Event types:
      text      — streamed assistant text chunk
      tool_use  — Claude is calling a tool (name + inputs)
      tool_done — tool result summary
      done      — stream finished
      error     — error payload
    """
    client = anthropic.Anthropic(api_key=api_key)

    messages = conversation + [{"role": "user", "content": user_message}]
    accumulated_text = ""
    accumulated_tool_calls: List[Dict[str, Any]] = []
    total_input_tokens = 0
    total_output_tokens = 0

    def sse(event: str, data: Any) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    try:
        while True:
            # Retry on overloaded errors
            last_overload_err = None
            for attempt in range(MAX_RETRIES):
                try:
                    stream_ctx = client.messages.stream(
                        model=model,
                        max_tokens=4096,
                        system=SYSTEM_PROMPT,
                        tools=TOOLS,
                        messages=messages,
                    )
                    break
                except anthropic.APIStatusError as e:
                    if e.status_code == 529 and attempt < MAX_RETRIES - 1:
                        last_overload_err = e
                        delay = RETRY_DELAYS[attempt]
                        yield sse("status", {"message": f"API overloaded — retrying in {delay}s… (attempt {attempt + 2}/{MAX_RETRIES})"})
                        await asyncio.sleep(delay)
                    else:
                        raise
            else:
                raise last_overload_err

            with stream_ctx as stream:
                current_tool_use_id = None
                current_tool_name = None
                current_tool_input_buf = ""
                current_text = ""

                for event in stream:
                    if event.type == "content_block_start":
                        if event.content_block.type == "tool_use":
                            current_tool_use_id = event.content_block.id
                            current_tool_name = event.content_block.name
                            current_tool_input_buf = ""
                            yield sse("tool_use", {"name": current_tool_name, "id": current_tool_use_id})
                        elif event.content_block.type == "text":
                            current_text = ""

                    elif event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            chunk = event.delta.text
                            current_text += chunk
                            accumulated_text += chunk
                            yield sse("text", {"chunk": chunk})
                        elif event.delta.type == "input_json_delta":
                            current_tool_input_buf += event.delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool_use_id and current_tool_name:
                            try:
                                tool_inputs = json.loads(current_tool_input_buf or "{}")
                            except json.JSONDecodeError:
                                tool_inputs = {}

                            tool_result = _dispatch_tool(analyzer, current_tool_name, tool_inputs)

                            accumulated_tool_calls.append({
                                "id": current_tool_use_id,
                                "name": current_tool_name,
                                "inputs": tool_inputs,
                                "result_preview": tool_result[:500],
                            })

                            yield sse("tool_done", {
                                "id": current_tool_use_id,
                                "name": current_tool_name,
                                "result_preview": tool_result[:300],
                            })

                            # Inject tool result into messages for next turn
                            messages.append({
                                "role": "assistant",
                                "content": [
                                    {
                                        "type": "tool_use",
                                        "id": current_tool_use_id,
                                        "name": current_tool_name,
                                        "input": tool_inputs,
                                    }
                                ],
                            })
                            messages.append({
                                "role": "user",
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": current_tool_use_id,
                                        "content": tool_result,
                                    }
                                ],
                            })

                            current_tool_use_id = None
                            current_tool_name = None
                            current_tool_input_buf = ""

                final_msg = stream.get_final_message()
                stop_reason = final_msg.stop_reason
                if final_msg.usage:
                    total_input_tokens += final_msg.usage.input_tokens
                    total_output_tokens += final_msg.usage.output_tokens

            if stop_reason == "end_turn":
                break
            elif stop_reason != "tool_use":
                break

        yield sse("done", {
            "text": accumulated_text,
            "tool_calls": accumulated_tool_calls,
            "usage": {
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens,
            },
        })

    except anthropic.AuthenticationError:
        yield sse("error", {"message": "Invalid Anthropic API key — check Settings."})
    except anthropic.APIStatusError as e:
        if e.status_code == 529:
            yield sse("error", {"message": "Anthropic API is overloaded. Wait a moment and try again."})
        else:
            yield sse("error", {"message": f"Anthropic API error {e.status_code}: {e.message}"})
    except Exception as e:
        yield sse("error", {"message": str(e)})
