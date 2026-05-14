import { useState, useRef } from 'react'
import {
  Upload, Radio, Settings, Trash2, Square, RefreshCw,
  FileText, Wifi, AlertCircle, CheckCircle, Clock, ChevronRight
} from 'lucide-react'
import { api } from '../api'

export default function Sidebar({
  captures, selectedId, onSelect, onRefresh, onOpenSettings, settings
}) {
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
    <aside className="flex w-64 flex-col border-r border-shark-700 bg-shark-800">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-shark-700 px-3 py-3">
        <span className="text-xl">🦈</span>
        <span className="font-bold text-sky-400 tracking-wide text-sm">SharkAttk</span>
      </div>

      {/* Actions */}
      <div className="flex gap-1 border-b border-shark-700 p-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-sky-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          title="Upload .pcap file"
        >
          <Upload size={13} />
          {uploading ? 'Uploading…' : 'Upload .pcap'}
        </button>
        <input ref={fileRef} type="file" accept=".pcap,.pcapng,.cap" className="hidden" onChange={handleUpload} />

        <button
          onClick={() => setShowLiveDialog(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-emerald-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition-colors"
          title="Start live capture"
        >
          <Radio size={13} />
          Live Capture
        </button>
      </div>

      {/* Captures list */}
      <div className="flex-1 overflow-y-auto">
        {captures.length === 0 ? (
          <p className="p-4 text-xs text-shark-500 text-center">No captures yet</p>
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

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-shark-700 px-3 py-2">
        <button
          onClick={onRefresh}
          className="rounded p-1 text-shark-400 hover:text-sky-400 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
        <div className="text-xs text-shark-500">
          {settings?.live_capture_mode === 'always_on' ? (
            <span className="text-emerald-400">● always-on</span>
          ) : (
            <span>manual capture</span>
          )}
        </div>
        <button
          onClick={onOpenSettings}
          className="rounded p-1 text-shark-400 hover:text-sky-400 transition-colors"
          title="Settings"
        >
          <Settings size={13} />
        </button>
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
      className={`group flex cursor-pointer items-start gap-2 border-b border-shark-700/50 px-3 py-2 hover:bg-shark-700/50 transition-colors ${selected ? 'bg-shark-700' : ''}`}
    >
      <span className="mt-0.5 shrink-0">
        {isLive ? <Wifi size={13} className={isActive ? 'text-emerald-400 pulse-dot' : 'text-shark-500'} />
                 : <FileText size={13} className="text-sky-400" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-200">{capture.name}</p>
        <p className="text-[11px] text-shark-400 mt-0.5">
          {capture.packet_count.toLocaleString()} pkts
          {capture.duration_seconds ? ` · ${capture.duration_seconds.toFixed(1)}s` : ''}
          {' · '}
          <StatusBadge status={capture.status} />
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {isActive && (
          <button onClick={onStop} className="rounded p-0.5 text-amber-400 hover:text-amber-300" title="Stop">
            <Square size={11} />
          </button>
        )}
        <button onClick={onDelete} className="rounded p-0.5 text-shark-400 hover:text-red-400" title="Delete">
          <Trash2 size={11} />
        </button>
      </div>
    </li>
  )
}

function StatusBadge({ status }) {
  if (status === 'active') return <span className="text-emerald-400">live</span>
  if (status === 'loading') return <span className="text-amber-400">loading…</span>
  if (status === 'error') return <span className="text-red-400">error</span>
  return <span className="text-shark-500">{status}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-96 rounded-lg border border-shark-600 bg-shark-800 p-5 shadow-2xl">
        <h2 className="mb-4 font-semibold text-sky-400">Start Live Capture</h2>

        <label className="mb-1 block text-xs text-shark-400">Interface</label>
        <select
          value={iface}
          onChange={e => setIface(e.target.value)}
          className="mb-3 w-full rounded border border-shark-600 bg-shark-900 px-2 py-1.5 text-xs text-slate-200 focus:border-sky-500 outline-none"
        >
          <option value="">Use server default</option>
          {interfaces.map(i => <option key={i} value={i}>{i}</option>)}
        </select>

        <label className="mb-1 block text-xs text-shark-400">Name (optional)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. SMB transfer test"
          className="mb-3 w-full rounded border border-shark-600 bg-shark-900 px-2 py-1.5 text-xs text-slate-200 placeholder-shark-500 focus:border-sky-500 outline-none"
        />

        <label className="mb-1 block text-xs text-shark-400">BPF capture filter (optional)</label>
        <input
          value={bpf}
          onChange={e => setBpf(e.target.value)}
          placeholder="e.g. host 192.168.1.1 and port 445"
          className="mb-4 w-full rounded border border-shark-600 bg-shark-900 px-2 py-1.5 text-xs text-slate-200 placeholder-shark-500 focus:border-sky-500 outline-none"
        />

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-shark-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={start}
            disabled={loading}
            className="px-4 py-1.5 rounded bg-emerald-600 text-xs text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Starting…' : '▶ Start'}
          </button>
        </div>
      </div>
    </div>
  )
}
