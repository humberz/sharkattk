import { useState, useEffect, useRef } from 'react'
import { Activity, Wifi, BarChart2, GitFork, Zap } from 'lucide-react'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../api'

export default function MetricsPanel({ capture }) {
  const [livePackets, setLivePackets] = useState([])
  const [connections, setConnections] = useState([])
  const [throughput, setThroughput] = useState([])
  const [peakMbps, setPeakMbps] = useState(0)
  const wsRef = useRef(null)

  useEffect(() => {
    if (capture.type !== 'live' || capture.status !== 'active') return
    const ws = new WebSocket(`ws://${location.host}/ws/captures/${capture.id}/live`)
    wsRef.current = ws
    const ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 10000)
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'packet') setLivePackets(prev => [...prev.slice(-500), msg.data])
    }
    return () => { clearInterval(ping); ws.close() }
  }, [capture.id, capture.status, capture.type])

  useEffect(() => { setLivePackets([]) }, [capture.id])

  useEffect(() => {
    if (capture.status === 'loading') return
    api.getConnections(capture.id, 30)
      .then(d => setConnections(d.connections || []))
      .catch(() => {})
    api.getThroughput(capture.id, 1000)
      .then(d => {
        setThroughput(d.buckets || [])
        setPeakMbps(d.peak_mbps || 0)
      })
      .catch(() => {})
  }, [capture.id, capture.status, capture.packet_count])

  const protoData = capture.metadata?.protocol_breakdown?.protocols?.slice(0, 8) || []

  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-vsc-border bg-vsc-sidebar overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-vsc-border px-3 py-2 bg-vsc-bg">
        <Activity size={12} className="text-vsc-blue" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-vsc-muted">Metrics</span>
        {capture.status === 'active' && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-vsc-green">
            <span className="pulse-dot">●</span> live
          </span>
        )}
        {capture.status === 'loading' && (
          <span className="ml-auto text-[10px] text-vsc-yellow">loading…</span>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-px border-b border-vsc-border bg-vsc-border">
        <StatCard label="Packets" value={capture.packet_count.toLocaleString()} />
        <StatCard label="Duration" value={capture.duration_seconds ? `${capture.duration_seconds.toFixed(1)}s` : '—'} />
        <StatCard label="TCP Streams" value={capture.metadata?.tcp_stream_count ?? '—'} />
        <StatCard label="Source" value={capture.type === 'live' ? 'Live' : 'File'} />
      </div>

      {/* Live sparkline */}
      {capture.type === 'live' && livePackets.length > 1 && (
        <Section title="Packet Rate" icon={<Wifi size={11} />}>
          <LiveSparkline packets={livePackets} />
        </Section>
      )}

      {/* Protocol breakdown */}
      {protoData.length > 0 && (
        <Section title="Protocols" icon={<BarChart2 size={11} />}>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={protoData} layout="vertical" margin={{ left: 4, right: 8, top: 2, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#858585' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="protocol" tick={{ fontSize: 9, fill: '#d4d4d4' }} width={50} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#252526', border: '1px solid #3c3c3c', borderRadius: 0, fontSize: 11 }}
                formatter={(v, n, p) => [`${p.payload.packet_count.toLocaleString()} pkts (${v}%)`, '']}
                labelStyle={{ color: '#4fc1ff' }}
              />
              <Bar dataKey="percentage" fill="#007acc" radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Connection tree */}
      {connections.length > 0 && (
        <Section title="Connections" icon={<GitFork size={11} />}>
          <ConnectionTree connections={connections} />
        </Section>
      )}

      {/* Bandwidth utilization */}
      {throughput.length > 1 && (
        <Section title={`Bandwidth  (peak ${peakMbps} Mbps)`} icon={<Zap size={11} />}>
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={throughput} margin={{ top: 2, bottom: 2, left: 0, right: 4 }}>
              <defs>
                <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#007acc" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#007acc" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" vertical={false} />
              <XAxis
                dataKey="time_offset_ms"
                tickFormatter={v => `${(v / 1000).toFixed(0)}s`}
                tick={{ fontSize: 9, fill: '#858585' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#858585' }}
                width={32}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v}`}
                unit=" M"
              />
              <Tooltip
                contentStyle={{ background: '#252526', border: '1px solid #3c3c3c', borderRadius: 0, fontSize: 11 }}
                formatter={(v) => [`${v} Mbps`, 'Throughput']}
                labelFormatter={v => `t=${(v / 1000).toFixed(1)}s`}
              />
              <Area type="monotone" dataKey="mbps" stroke="#007acc" strokeWidth={1.5} fill="url(#bwGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Section>
      )}

      <div className="mt-auto border-t border-vsc-border p-3">
        <p className="text-[10px] text-vsc-muted leading-relaxed">
          Ask WireClaude to analyse throughput, retransmissions, MTU, RTT, and more.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-vsc-bg px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-widest text-vsc-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-vsc-text">{value}</p>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div className="border-b border-vsc-border px-3 py-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-vsc-muted">
        {icon} {title}
      </p>
      {children}
    </div>
  )
}

function LiveSparkline({ packets }) {
  const t0 = packets[0].timestamp
  const buckets = {}
  for (const p of packets) {
    const k = Math.floor(p.timestamp - t0)
    buckets[k] = (buckets[k] || 0) + 1
  }
  const maxK = Math.max(...Object.keys(buckets).map(Number))
  const data = Array.from({ length: maxK + 1 }, (_, i) => ({ t: i, pps: buckets[i] || 0 }))

  return (
    <ResponsiveContainer width="100%" height={70}>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 4 }}>
        <Line type="monotone" dataKey="pps" stroke="#4ec9b0" dot={false} strokeWidth={1.5} />
        <XAxis hide />
        <YAxis tick={{ fontSize: 9, fill: '#858585' }} width={24} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#252526', border: '1px solid #3c3c3c', borderRadius: 0, fontSize: 11 }}
          formatter={(v) => [`${v} pkt/s`, '']}
          labelFormatter={() => ''}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function ConnectionTree({ connections }) {
  const WIDTH = 256
  const NODE_H = 22
  const PADDING = 8
  const COL_LEFT = 4
  const COL_RIGHT = WIDTH - 4

  // Collect unique sources and destinations
  const srcs = [...new Set(connections.map(c => c.src))]
  const dsts = [...new Set(connections.map(c => c.dst))]

  const maxBytes = Math.max(...connections.map(c => c.bytes), 1)

  const srcY = (i) => PADDING + i * (NODE_H + 4) + NODE_H / 2
  const dstY = (i) => PADDING + i * (NODE_H + 4) + NODE_H / 2

  const HEIGHT = Math.max(
    srcs.length * (NODE_H + 4) + PADDING * 2,
    dsts.length * (NODE_H + 4) + PADDING * 2,
    60
  )

  const truncate = (ip, max = 13) => ip.length > max ? ip.slice(0, max - 1) + '…' : ip

  return (
    <div className="overflow-x-auto">
      <svg width={WIDTH} height={HEIGHT} className="block">
        {/* Edges */}
        {connections.map((conn, i) => {
          const si = srcs.indexOf(conn.src)
          const di = dsts.indexOf(conn.dst)
          const x1 = COL_LEFT + 72
          const y1 = srcY(si)
          const x2 = COL_RIGHT - 72
          const y2 = dstY(di)
          const mx = (x1 + x2) / 2
          const opacity = 0.2 + 0.6 * (conn.bytes / maxBytes)
          const strokeW = 0.5 + 1.5 * (conn.bytes / maxBytes)
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="#007acc"
              strokeWidth={strokeW}
              strokeOpacity={opacity}
            >
              <title>{conn.src} → {conn.dst}: {conn.packets.toLocaleString()} pkts, {fmtBytes(conn.bytes)}</title>
            </path>
          )
        })}

        {/* Source nodes */}
        {srcs.map((ip, i) => (
          <g key={ip} transform={`translate(0, ${srcY(i) - NODE_H / 2})`}>
            <rect x={COL_LEFT} y={0} width={70} height={NODE_H} fill="#2d2d2d" stroke="#3c3c3c" strokeWidth={0.5} />
            <text x={COL_LEFT + 4} y={NODE_H / 2 + 3.5} fontSize={10} fill="#4fc1ff" fontFamily="monospace">
              {truncate(ip)}
            </text>
          </g>
        ))}

        {/* Destination nodes */}
        {dsts.map((ip, i) => (
          <g key={ip} transform={`translate(${COL_RIGHT - 70}, ${dstY(i) - NODE_H / 2})`}>
            <rect x={0} y={0} width={70} height={NODE_H} fill="#2d2d2d" stroke="#3c3c3c" strokeWidth={0.5} />
            <text x={4} y={NODE_H / 2 + 3.5} fontSize={10} fill="#4ec9b0" fontFamily="monospace">
              {truncate(ip)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function fmtBytes(b) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}
