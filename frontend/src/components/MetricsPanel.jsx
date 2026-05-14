import { useState, useEffect, useRef } from 'react'
import { Activity, Wifi, AlertTriangle, BarChart2 } from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

const COLORS = ['#38bdf8', '#34d399', '#fb923c', '#f472b6', '#a78bfa', '#facc15']

export default function MetricsPanel({ capture }) {
  const [livePackets, setLivePackets] = useState([])
  const wsRef = useRef(null)

  // Connect WebSocket for live captures
  useEffect(() => {
    if (capture.type !== 'live' || capture.status !== 'active') return

    const ws = new WebSocket(`ws://${location.host}/ws/captures/${capture.id}/live`)
    wsRef.current = ws

    const ping = setInterval(() => ws.send('ping'), 10000)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'packet') {
        setLivePackets(prev => [...prev.slice(-500), msg.data])
      }
    }

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [capture.id, capture.status, capture.type])

  // Reset live packets when capture changes
  useEffect(() => {
    setLivePackets([])
  }, [capture.id])

  const protoData = capture.metadata?.protocol_breakdown?.protocols?.slice(0, 8) || []

  return (
    <div className="flex w-96 shrink-0 flex-col border-r border-shark-700 bg-shark-800 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-shark-700 px-3 py-2">
        <Activity size={14} className="text-sky-400" />
        <span className="text-xs font-semibold text-sky-400">Metrics</span>
        {capture.status === 'active' && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400">
            <span className="pulse-dot">●</span> live
          </span>
        )}
        {capture.status === 'loading' && (
          <span className="ml-auto text-[11px] text-amber-400">loading…</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 p-3">
        <StatCard label="Packets" value={capture.packet_count.toLocaleString()} />
        <StatCard
          label="Duration"
          value={capture.duration_seconds ? `${capture.duration_seconds.toFixed(1)}s` : '—'}
        />
        <StatCard
          label="TCP Streams"
          value={capture.metadata?.tcp_stream_count ?? '—'}
        />
        <StatCard label="Type" value={capture.type === 'live' ? 'Live' : 'File'} />
      </div>

      {/* Live sparkline */}
      {capture.type === 'live' && livePackets.length > 0 && (
        <Section title="Live Packet Rate" icon={<Wifi size={12} />}>
          <LiveSparkline packets={livePackets} />
        </Section>
      )}

      {/* Protocol breakdown */}
      {protoData.length > 0 && (
        <Section title="Protocol Breakdown" icon={<BarChart2 size={12} />}>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={protoData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="protocol"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={55}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 4, fontSize: 11 }}
                formatter={(v, n, p) => [`${p.payload.packet_count.toLocaleString()} (${v}%)`, 'packets']}
              />
              <Bar dataKey="percentage" fill="#38bdf8" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Hints */}
      <div className="mt-auto border-t border-shark-700 p-3">
        <p className="text-[11px] text-shark-500">
          Ask Claude in the chat for throughput graphs, retransmission analysis, MTU checks, and more.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="rounded border border-shark-700 bg-shark-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-shark-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-200">{value}</p>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div className="border-t border-shark-700 px-3 py-2">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-shark-400">
        {icon} {title}
      </p>
      {children}
    </div>
  )
}

function LiveSparkline({ packets }) {
  // Bucket packets into 1s intervals
  if (packets.length === 0) return null
  const t0 = packets[0].timestamp
  const buckets = {}
  for (const p of packets) {
    const k = Math.floor(p.timestamp - t0)
    buckets[k] = (buckets[k] || 0) + 1
  }
  const maxK = Math.max(...Object.keys(buckets).map(Number))
  const data = Array.from({ length: maxK + 1 }, (_, i) => ({
    t: i,
    pps: buckets[i] || 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 4 }}>
        <Line type="monotone" dataKey="pps" stroke="#34d399" dot={false} strokeWidth={1.5} />
        <XAxis hide />
        <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={28} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 4, fontSize: 11 }}
          formatter={(v) => [`${v} pkt/s`, 'rate']}
          labelFormatter={() => ''}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
