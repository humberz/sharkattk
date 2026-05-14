import { useState, useRef } from 'react'
import { Upload, Radio, Settings, Trash2, Square, RefreshCw, FileText, Wifi } from 'lucide-react'
import { api } from '../api'

export default function Sidebar({ captures, selectedId, onSelect, onRefresh, onOpenSettings, settings }) {
  const [showLiveDialog, setShowLiveDialog] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadPcap(file, file.name)
      await onRefresh()
    } catch (err) {
      alert(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Delete this capture?')) return
    await api.deleteCapture(id)
    await onRefresh()
  }

  const handleStop = async (e, id) => {
    e.stopPropagation()
    await api.stopLive(id)
    await onRefresh()
  }

  return (
    <aside className="flex w-60 flex-col border-r border-vsc-border bg-vsc-sidebar">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-vsc-border px-3 py-2.5 bg-vsc-bg">
        <span className="text-lg select-none">🦈</span>
        <span className="text-xs font-semibold uppercase tracking-widest text-vsc-muted">SharkAttk</span>
      </div>

      {/* Section label */}
      <div className="px-3 pt-3 pb-1">
        <p className="text-[10px] uppercase tracking-widest text-vsc-muted font-semibold">Captures</p>
      </div>

      {/* Captures list */}
      <div className="flex-1 overflow-y-auto">
        {captures.length === 0 ? (
          <p className="px-4 py-3 text-xs text-vsc-muted italic">No captures yet</p>
        ) : (
          <ul>
            {captures.map(c => (
              <CaptureItem
                key={c.id}
                capture={c}
                selected={c.id === selectedId}
                onSelect={() => onSelect(c.id)}
                onDelete={(e) => handleDelete(e, c.id)}
                onStop={(e) => handleStop(e, c.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-vsc-border p-2 flex flex-col gap-1">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-vsc-text hover:bg-vsc-selection disabled:opacity-50 transition-colors w-full text-left"
        >
          <Upload size={13} className="text-vsc-blue shrink-0" />
          {uploading ? 'Uploading…' : 'Upload .pcap'}
        </button>
        <input ref={fileRef} type="file" accept=".pcap,.pcapng,.cap" className="hidden" onChange={handleUpload} />

        <button
          onClick={() => setShowLiveDialog(true)}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-vsc-text hover:bg-vsc-selection transition-colors w-full text-left"
        >
          <Radio size={13} className="text-vsc-green shrink-0" />
          Start Live Capture
        </button>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-vsc-border px-3 py-1.5 bg-vsc-bg">
        <div className="text-[10px] text-vsc-muted">
          {settings?.live_capture_mode === 'always_on'
            ? <span className="text-vsc-green">● always-on</span>
            : <span>manual capture</span>}
        </div>
        <div className="flex gap-1">
          <button onClick={onRefresh} className="rounded p-1 text-vsc-muted hover:text-vsc-text transition-colors" title="Refresh">
            <RefreshCw size={12} />
          </button>
          <button onClick={onOpenSettings} className="rounded p-1 text-vsc-muted hover:text-vsc-text transition-colors" title="Settings">
            <Settings size={12} />
          </button>
        </div>
      </div>

      {showLiveDialog && (
        <LiveCaptureDialog
          onClose={() => setShowLiveDialog(false)}
          onStarted={async () => { setShowLiveDialog(false); await onRefresh() }}
        />
      )}
    </aside>
  )
}

function CaptureItem({ capture, selected, onSelect, onDelete, onStop }) {
  const isLive = capture.type === 'live'
  const isActive = capture.status === 'active'

  return (
    <li
      onClick={onSelect}
      className={`group flex cursor-pointer items-start gap-2 px-3 py-1.5 hover:bg-vsc-panel transition-colors ${selected ? 'bg-vsc-selection' : ''}`}
    >
      <span className="mt-0.5 shrink-0">
        {isLive
          ? <Wifi size={12} className={isActive ? 'text-vsc-green pulse-dot' : 'text-vsc-muted'} />
          : <FileText size={12} className="text-vsc-blue" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-vsc-text">{capture.name}</p>
        <p className="text-[10px] text-vsc-muted mt-0.5">
          {capture.packet_count.toLocaleString()} pkts
          {capture.duration_seconds ? ` · ${capture.duration_seconds.toFixed(1)}s` : ''}
          {' · '}
          <StatusBadge status={capture.status} />
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {isActive && (
          <button onClick={onStop} className="p-0.5 text-vsc-yellow hover:text-vsc-text" title="Stop">
            <Square size={10} />
          </button>
        )}
        <button onClick={onDelete} className="p-0.5 text-vsc-muted hover:text-vsc-red" title="Delete">
          <Trash2 size={10} />
        </button>
      </div>
    </li>
  )
}

function StatusBadge({ status }) {
  if (status === 'active') return <span className="text-vsc-green">live</span>
  if (status === 'loading') return <span className="text-vsc-yellow">loading…</span>
  if (status === 'error') return <span className="text-vsc-red">error</span>
  return <span className="text-vsc-muted">{status}</span>
}

function LiveCaptureDialog({ onClose, onStarted }) {
  const [iface, setIface] = useState('')
  const [name, setName] = useState('')
  const [bpf, setBpf] = useState('')
  const [interfaces, setInterfaces] = useState([])
  const [loading, setLoading] = useState(false)

  useState(() => {
    api.getInterfaces().then(r => setInterfaces(r.interfaces || [])).catch(() => {})
  })

  const start = async () => {
    setLoading(true)
    try {
      await api.startLive({ interface: iface || undefined, name: name || undefined, capture_filter: bpf || undefined })
      await onStarted()
    } catch (err) {
      alert(`Failed to start capture: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-96 border border-vsc-border bg-vsc-sidebar shadow-2xl">
        <div className="border-b border-vsc-border px-4 py-2.5 bg-vsc-bg">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-vsc-muted">Start Live Capture</h2>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Interface">
            <select value={iface} onChange={e => setIface(e.target.value)} className={sel}>
              <option value="">Use server default</option>
              {interfaces.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Name (optional)">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. SMB transfer test" className={inp} />
          </Field>
          <Field label="BPF capture filter (optional)">
            <input value={bpf} onChange={e => setBpf(e.target.value)} placeholder="e.g. host 192.168.1.1 and port 445" className={inp} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-vsc-border px-4 py-2.5">
          <button onClick={onClose} className="px-3 py-1 text-xs text-vsc-muted hover:text-vsc-text transition-colors">Cancel</button>
          <button onClick={start} disabled={loading} className="px-4 py-1 text-xs bg-vsc-blue text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
            {loading ? 'Starting…' : '▶ Start'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-vsc-muted">{label}</label>
      {children}
    </div>
  )
}

const inp = 'w-full bg-vsc-bg border border-vsc-border px-2 py-1.5 text-xs text-vsc-text placeholder-vsc-muted focus:border-vsc-blue outline-none'
const sel = 'w-full bg-vsc-bg border border-vsc-border px-2 py-1.5 text-xs text-vsc-text focus:border-vsc-blue outline-none'
