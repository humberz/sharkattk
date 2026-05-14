import { useState, useEffect, useRef } from 'react'
import { Activity, Wifi, BarChart2 } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function MetricsPanel({ capture }) {
  const [livePackets, setLivePackets] = useState([])
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

      <div className="mt-auto border-t border-vsc-border p-3">
        <p className="text-[10px] text-vsc-muted leading-relaxed">
          Use the chat to analyse throughput, retransmissions, MTU, RTT, and more.
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
