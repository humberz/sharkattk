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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[460px] rounded-lg border border-shark-600 bg-shark-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-shark-700 px-5 py-3">
          <h2 className="text-sm font-semibold text-sky-400">Settings</h2>
          <button onClick={onClose} className="text-shark-400 hover:text-slate-200 transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* API Key */}
          <Field label="Anthropic API Key" hint={`Current: ${settings?.anthropic_api_key || 'not set'}`}>
            <input
              type="password"
              value={form.anthropic_api_key}
              onChange={e => set('anthropic_api_key', e.target.value)}
              placeholder="sk-ant-… (leave blank to keep current)"
              className={input}
            />
          </Field>

          {/* Model */}
          <Field label="Claude Model">
            <select value={form.claude_model} onChange={e => set('claude_model', e.target.value)} className={input}>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
              <option value="claude-opus-4-7">claude-opus-4-7 (most capable)</option>
              <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (fastest)</option>
            </select>
          </Field>

          {/* Live capture mode */}
          <Field
            label="Live Capture Mode"
            hint="'Manual' requires you to click Start each time. 'Always-on' auto-starts on server boot."
          >
            <div className="flex gap-3">
              <RadioOpt
                label="Manual (default)"
                desc="Start/stop from the UI"
                checked={form.live_capture_mode === 'manual'}
                onChange={() => set('live_capture_mode', 'manual')}
              />
              <RadioOpt
                label="Always-on"
                desc="Capture continuously in background"
                checked={form.live_capture_mode === 'always_on'}
                onChange={() => set('live_capture_mode', 'always_on')}
              />
            </div>
          </Field>

          {/* Default interface */}
          <Field label="Default Capture Interface">
            <input
              value={form.default_interface}
              onChange={e => set('default_interface', e.target.value)}
              placeholder="eth0"
              className={input}
            />
          </Field>

          {/* Max packets */}
          <Field label="Max Packets In Memory" hint="Higher values use more RAM. Restart any in-progress captures to apply.">
            <input
              type="number"
              value={form.max_packets_in_memory}
              onChange={e => set('max_packets_in_memory', parseInt(e.target.value) || 50000)}
              min={1000}
              max={500000}
              step={1000}
              className={input}
            />
          </Field>

          {error && (
            <p className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-shark-700 px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs text-shark-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-sky-600 text-xs text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          >
            <Save size={12} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const input = 'w-full rounded border border-shark-600 bg-shark-900 px-2 py-1.5 text-xs text-slate-200 placeholder-shark-500 focus:border-sky-500 outline-none'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-shark-300">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-shark-500">{hint}</p>}
    </div>
  )
}

function RadioOpt({ label, desc, checked, onChange }) {
  return (
    <label className={`flex flex-1 cursor-pointer flex-col rounded border p-2.5 transition-colors ${checked ? 'border-sky-600 bg-sky-900/20' : 'border-shark-600 bg-shark-900 hover:border-shark-500'}`}>
      <div className="flex items-center gap-2">
        <input type="radio" checked={checked} onChange={onChange} className="accent-sky-500" />
        <span className="text-xs font-medium text-slate-200">{label}</span>
      </div>
      <span className="ml-5 mt-0.5 text-[11px] text-shark-400">{desc}</span>
    </label>
  )
}
