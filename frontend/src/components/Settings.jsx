import { useState } from 'react'
import { X, Save } from 'lucide-react'
import { api } from '../api'

export default function Settings({ settings, onClose, onSaved }) {
  const [form, setForm] = useState({
    live_capture_mode: settings?.live_capture_mode || 'manual',
    default_interface: settings?.default_interface || 'eth0',
    anthropic_api_key: '',
    max_packets_in_memory: settings?.max_packets_in_memory || 50000,
    claude_model: settings?.claude_model || 'claude-sonnet-4-6',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = { ...form }
      if (!payload.anthropic_api_key) delete payload.anthropic_api_key
      await api.updateSettings(payload)
      const updated = await api.getSettings()
      onSaved(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[460px] border border-vsc-border bg-vsc-sidebar shadow-2xl">
        {/* Title */}
        <div className="flex items-center justify-between border-b border-vsc-border px-4 py-2.5 bg-vsc-bg">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-vsc-muted">Settings</h2>
          <button onClick={onClose} className="text-vsc-muted hover:text-vsc-text transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Field label="Anthropic API Key" hint={`Current: ${settings?.anthropic_api_key || 'not set'}`}>
            <input type="password" value={form.anthropic_api_key} onChange={e => set('anthropic_api_key', e.target.value)}
              placeholder="sk-ant-… (leave blank to keep current)" className={inp} />
          </Field>

          <Field label="Claude Model">
            <select value={form.claude_model} onChange={e => set('claude_model', e.target.value)} className={inp}>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
              <option value="claude-opus-4-7">claude-opus-4-7 (most capable)</option>
              <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (fastest)</option>
            </select>
          </Field>

          <Field label="Live Capture Mode" hint="Manual requires you to click Start. Always-on captures continuously in the background.">
            <div className="flex gap-2 mt-1">
              <RadioOpt label="Manual (default)" desc="Start/stop from UI" checked={form.live_capture_mode === 'manual'} onChange={() => set('live_capture_mode', 'manual')} />
              <RadioOpt label="Always-on" desc="Background capture" checked={form.live_capture_mode === 'always_on'} onChange={() => set('live_capture_mode', 'always_on')} />
            </div>
          </Field>

          <Field label="Default Capture Interface">
            <input value={form.default_interface} onChange={e => set('default_interface', e.target.value)} placeholder="eth0" className={inp} />
          </Field>

          <Field label="Max Packets In Memory" hint="Larger values use more RAM. Default: 50,000.">
            <input type="number" value={form.max_packets_in_memory} onChange={e => set('max_packets_in_memory', parseInt(e.target.value) || 50000)}
              min={1000} max={500000} step={1000} className={inp} />
          </Field>

          {error && (
            <div className="border border-vsc-red px-3 py-2 text-xs text-vsc-red">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-vsc-border px-5 py-2.5 bg-vsc-bg">
          <button onClick={onClose} className="px-3 py-1 text-xs text-vsc-muted hover:text-vsc-text transition-colors">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-1 text-xs bg-vsc-blue text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
            <Save size={11} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-vsc-muted font-semibold">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-vsc-muted">{hint}</p>}
    </div>
  )
}

function RadioOpt({ label, desc, checked, onChange }) {
  return (
    <label className={`flex flex-1 cursor-pointer flex-col border p-2.5 transition-colors ${checked ? 'border-vsc-blue bg-vsc-selection' : 'border-vsc-border bg-vsc-bg hover:border-vsc-muted'}`}>
      <div className="flex items-center gap-2">
        <input type="radio" checked={checked} onChange={onChange} className="accent-vsc-blue" />
        <span className="text-xs text-vsc-text">{label}</span>
      </div>
      <span className="ml-5 mt-0.5 text-[10px] text-vsc-muted">{desc}</span>
    </label>
  )
}

const inp = 'w-full bg-vsc-bg border border-vsc-border px-2 py-1.5 text-xs text-vsc-text placeholder-vsc-muted focus:border-vsc-blue outline-none'
