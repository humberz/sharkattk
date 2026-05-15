const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export const api = {
  // Settings
  getSettings: () => req('GET', '/settings'),
  updateSettings: (data) => req('PUT', '/settings', data),

  // Captures
  listCaptures: () => req('GET', '/captures'),
  getCapture: (id) => req('GET', `/captures/${id}`),
  deleteCapture: (id) => req('DELETE', `/captures/${id}`),

  // Upload
  uploadPcap: async (file, name) => {
    const fd = new FormData()
    fd.append('file', file)
    if (name) fd.append('name', name)
    const res = await fetch(`${BASE}/captures/upload`, { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },

  // Live capture
  startLive: (data) => req('POST', '/captures/live/start', data),
  stopLive: (id) => req('POST', `/captures/${id}/stop`),

  // Chat
  getChatHistory: (id) => req('GET', `/captures/${id}/chat/history`),
  clearChatHistory: (id) => req('DELETE', `/captures/${id}/chat/history`),

  // Packets + Connections + Throughput
  getPackets: (id, offset = 0, limit = 500) => req('GET', `/captures/${id}/packets?offset=${offset}&limit=${limit}`),
  getConnections: (id, limit = 40) => req('GET', `/captures/${id}/connections?limit=${limit}`),
  getThroughput: (id, interval_ms = 1000) => req('GET', `/captures/${id}/throughput?interval_ms=${interval_ms}`),

  // Interfaces
  getInterfaces: () => req('GET', '/interfaces'),

  // Streaming chat — returns a ReadableStream
  streamChat: (captureId, message) => {
    return fetch(`${BASE}/captures/${captureId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
  },
}
