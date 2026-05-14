import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Trash2, Wrench, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { api } from '../api'

function parseSSE(text) {
  const events = []
  const blocks = text.split('\n\n')
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    let event = 'message'
    let data = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7)
      else if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (data) {
      try { events.push({ event, data: JSON.parse(data) }) } catch {}
    }
  }
  return events
}

function renderMarkdown(text) {
  // Minimal markdown: bold, italic, inline code, code blocks, headers
  return text
    .replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${escHtml(c.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n/g, '<br/>')
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function ChatPanel({ capture }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamMsg, setStreamMsg] = useState(null) // {text, toolCalls: [{name, id, done}]}
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Load history when capture changes
  useEffect(() => {
    setMessages([])
    setStreamMsg(null)
    api.getChatHistory(capture.id)
      .then(history => setMessages(history.map(normalizeHistoryMsg)))
      .catch(() => {})
  }, [capture.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamMsg])

  const send = useCallback(async () => {
    const msg = input.trim()
    if (!msg || streaming) return
    setInput('')
    setStreaming(true)

    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setStreamMsg({ text: '', toolCalls: [] })

    try {
      const res = await api.streamChat(capture.id, msg)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let finalText = ''
      let toolCalls = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        const events = parseSSE(buf)
        buf = buf.slice(buf.lastIndexOf('\n\n') + 2)

        for (const { event, data } of events) {
          if (event === 'text') {
            finalText += data.chunk
            setStreamMsg(prev => ({ ...prev, text: prev.text + data.chunk }))
          } else if (event === 'tool_use') {
            toolCalls = [...toolCalls, { id: data.id, name: data.name, done: false }]
            setStreamMsg(prev => ({ ...prev, toolCalls }))
          } else if (event === 'tool_done') {
            toolCalls = toolCalls.map(tc =>
              tc.id === data.id ? { ...tc, done: true, preview: data.result_preview } : tc
            )
            setStreamMsg(prev => ({ ...prev, toolCalls }))
          } else if (event === 'done') {
            finalText = data.text
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: finalText, toolCalls: data.tool_calls }
            ])
            setStreamMsg(null)
          } else if (event === 'error') {
            setMessages(prev => [
              ...prev,
              { role: 'error', content: data.message }
            ])
            setStreamMsg(null)
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', content: e.message }])
      setStreamMsg(null)
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }, [input, streaming, capture.id])

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const clearHistory = async () => {
    if (!confirm('Clear chat history for this capture?')) return
    await api.clearChatHistory(capture.id)
    setMessages([])
  }

  return (
    <div className="flex flex-1 flex-col bg-shark-900 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-shark-700 px-4 py-2">
        <span className="text-xs font-semibold text-sky-400 truncate">
          {capture.name}
        </span>
        <span className="text-[11px] text-shark-500 ml-1">— ask Claude anything</span>
        <button
          onClick={clearHistory}
          className="ml-auto rounded p-1 text-shark-500 hover:text-red-400 transition-colors"
          title="Clear chat history"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {capture.status === 'loading' && messages.length === 0 && (
          <SystemMsg>Parsing capture file… analysis will be available once loading completes.</SystemMsg>
        )}
        {messages.length === 0 && capture.status !== 'loading' && (
          <SystemMsg>
            Capture loaded — {capture.packet_count.toLocaleString()} packets.
            Ask me to analyse throughput, retransmissions, MTU issues, or anything else.
          </SystemMsg>
        )}

        {messages.map((msg, i) => <Message key={i} msg={msg} />)}

        {/* Streaming message */}
        {streamMsg && (
          <div className="flex flex-col gap-2">
            {streamMsg.toolCalls.map(tc => (
              <ToolCallBadge key={tc.id} tool={tc} />
            ))}
            {streamMsg.text && (
              <AssistantBubble text={streamMsg.text} streaming />
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-shark-700 p-3">
        <div className="flex gap-2 rounded-lg border border-shark-600 bg-shark-800 p-2 focus-within:border-sky-500 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about this capture… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 resize-none bg-transparent text-xs text-slate-200 placeholder-shark-500 outline-none"
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={!input.trim() || streaming}
            className="self-end rounded p-1.5 bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40 transition-colors"
          >
            <Send size={13} />
          </button>
        </div>
        <p className="mt-1 text-[10px] text-shark-600">
          Claude has tools to query packets, streams, retransmissions, MTU, RTT, and more.
        </p>
      </div>
    </div>
  )
}

function Message({ msg }) {
  if (msg.role === 'user') return <UserBubble text={msg.content} />
  if (msg.role === 'error') return <ErrorBubble text={msg.content} />
  return (
    <div className="flex flex-col gap-2">
      {(msg.toolCalls || []).map((tc, i) => (
        <ToolCallBadge key={i} tool={{ ...tc, done: true }} />
      ))}
      <AssistantBubble text={msg.content} />
    </div>
  )
}

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-lg rounded-br-sm bg-sky-700/60 px-3 py-2 text-xs text-slate-100 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({ text, streaming }) {
  const copy = () => navigator.clipboard.writeText(text)
  return (
    <div className="group relative">
      <div
        className="prose-shark rounded-lg rounded-tl-sm bg-shark-800 border border-shark-700 px-3 py-2 text-xs text-slate-200"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
      {streaming && (
        <span className="inline-block ml-1 animate-pulse text-sky-400">▋</span>
      )}
      {!streaming && (
        <button
          onClick={copy}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-shark-500 hover:text-slate-300"
        >
          <Copy size={11} />
        </button>
      )}
    </div>
  )
}

function ErrorBubble({ text }) {
  return (
    <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
      ⚠ {text}
    </div>
  )
}

function SystemMsg({ children }) {
  return (
    <div className="rounded border border-shark-700 bg-shark-800/50 px-3 py-2 text-[11px] text-shark-400 italic">
      {children}
    </div>
  )
}

function ToolCallBadge({ tool }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col rounded border border-shark-700 bg-shark-800/80 text-[11px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-shark-700/50 transition-colors"
      >
        <Wrench size={10} className={tool.done ? 'text-emerald-400' : 'text-amber-400 pulse-dot'} />
        <span className="font-mono text-shark-300">{tool.name}()</span>
        {!tool.done && <span className="ml-1 text-amber-400">running…</span>}
        {tool.done && <span className="ml-1 text-emerald-400">done</span>}
        <span className="ml-auto">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {open && tool.preview && (
        <pre className="border-t border-shark-700 px-2 py-1.5 text-[10px] text-shark-400 overflow-x-auto whitespace-pre-wrap max-h-40">
          {tool.preview}
        </pre>
      )}
    </div>
  )
}

function normalizeHistoryMsg(msg) {
  return {
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    toolCalls: msg.tool_calls || [],
  }
}
