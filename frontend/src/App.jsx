import { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import MetricsPanel from './components/MetricsPanel'
import Settings from './components/Settings'
import { api } from './api'

export default function App() {
  const [captures, setCaptures] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState(null)

  const refreshCaptures = useCallback(async () => {
    try {
      const list = await api.listCaptures()
      setCaptures(list)
    } catch (e) {
      console.error('Failed to load captures', e)
    }
  }, [])

  useEffect(() => {
    refreshCaptures()
    api.getSettings().then(setSettings).catch(console.error)
    const t = setInterval(refreshCaptures, 3000)
    return () => clearInterval(t)
  }, [refreshCaptures])

  const selectedCapture = captures.find(c => c.id === selectedId) || null

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-vsc-bg text-vsc-text">
      <Sidebar
        captures={captures}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onRefresh={refreshCaptures}
        onOpenSettings={() => setShowSettings(true)}
        settings={settings}
      />

      <main className="flex flex-1 overflow-hidden">
        {selectedCapture ? (
          <>
            <MetricsPanel capture={selectedCapture} />
            <ChatPanel capture={selectedCapture} />
          </>
        ) : (
          <EmptyState />
        )}
      </main>

      {showSettings && (
        <Settings
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => { setSettings(s); setShowSettings(false) }}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-vsc-muted">
      <span className="text-5xl select-none">🦈</span>
      <p className="text-base font-semibold text-vsc-text">SharkAttk</p>
      <p className="text-xs">Upload a .pcap file or start a live capture to begin</p>
    </div>
  )
}
