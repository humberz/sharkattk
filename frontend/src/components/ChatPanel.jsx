import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Trash2, Wrench, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { api } from '../api'

// Pricing per million tokens (claude-sonnet-4-6)
const PRICE = { input: 3.0, output: 15.0 }

function calcCost(usage) {
  if (!usage) return null
  return (usage.input_tokens / 1e6) * PRICE.input + (usage.output_tokens / 1e6) * PRICE.output
}

function parseSSE(text) {
  const events = []
  const blocks = text.split('\n\n')
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    let event = 'message', data = ''
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
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, c) => `<pre><code>${escHtml(c.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
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
  const [streamMsg, setStreamMsg] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setMessages([])
    setStreamMsg(null)
    api.getChatHistory(capture.id)
      .then(h => setMessages(h.map(normalizeMsg)))
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
    setStreamMsg({ text: '', toolCalls: [], thinking: true })

    try {
      const res = await api.streamChat(capture.id, msg)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        const events = parseSSE(buf)
        const lastDouble = buf.lastIndexOf('\n\n')
        if (lastDouble !== -1) buf = buf.slice(lastDouble + 2)

        for (const { event, data } of events) {
          if (event === 'text') {
            setStreamMsg(prev => ({ ...prev, text: prev.text + data.chunk, thinking: false }))
          } else if (event === 'tool_use') {
            setStreamMsg(prev => ({
              ...prev,
              thinking: false,
              toolCalls: [...prev.toolCalls, { id: data.id, name: data.name, done: false }]
            }))
          } else if (event === 'tool_done') {
            setStreamMsg(prev => ({
              ...prev,
              toolCalls: prev.toolCalls.map(tc =>
                tc.id === data.id ? { ...tc, done: true, preview: data.result_preview } : tc
              )
            }))
          } else if (event === 'done') {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: data.text,
              toolCalls: data.tool_calls || [],
              usage: data.usage,
            }])
            setStreamMsg(null)
          } else if (event === 'error') {
            setMessages(prev => [...prev, { role: 'error', content: data.message }])
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
    if (!confirm('Clear chat history?')) return
    await api.clearChatHistory(capture.id)
    setMessages([])
  }

  return (
    <div className="flex flex-1 flex-col bg-vsc-bg min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-vsc-border px-4 py-2 bg-vsc-sidebar">
        <span className="text-xs font-medium text-vsc-text truncate">{capture.name}</span>
        <span className="text-[10px] text-vsc-muted">— WireClaude AI</span>
        <button onClick={clearHistory} className="ml-auto p-1 text-vsc-muted hover:text-vsc-red transition-colors" title="Clear history">
          <Trash2 size={12} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {capture.status === 'loading' && messages.length === 0 && (
          <SystemMsg>Parsing capture… analysis available once loading completes.</SystemMsg>
        )}
        {messages.length === 0 && capture.status !== 'loading' && (
          <SystemMsg>
            {capture.packet_count.toLocaleString()} packets loaded.
            Ask me to analyse throughput, retransmissions, MTU issues, or anything else.
          </SystemMsg>
        )}

        {messages.map((msg, i) => <Message key={i} msg={msg} />)}

        {/* Streaming */}
        {streamMsg && (
          <div className="flex flex-col gap-2">
            {streamMsg.thinking && <ThinkingIndicator />}
            {streamMsg.toolCalls.map(tc => <ToolCallBadge key={tc.id} tool={tc} />)}
            {streamMsg.text && <AssistantBubble text={streamMsg.text} streaming />}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-vsc-border p-3 bg-vsc-sidebar">
        <div className={`flex gap-2 border bg-vsc-bg p-2 transition-colors ${streaming ? 'border-vsc-border' : 'border-vsc-border focus-within:border-vsc-blue'}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about this capture… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={streaming}
            className="flex-1 resize-none bg-transparent text-xs text-vsc-text placeholder-vsc-muted outline-none"
          />
          <button
            onClick={send}
            disabled={!input.trim() || streaming}
            className="self-end p-1.5 bg-vsc-blue text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Send size={12} />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-vsc-muted">
          WireClaude has 9 analysis tools: retransmissions, MTU, RTT, throughput, window scaling, and more.
        </p>
      </div>
    </div>
  )
}

function Message({ msg }) {
  if (msg.role === 'user') return <UserBubble text={msg.content} />
  if (msg.role === 'error') return <ErrorBubble text={msg.content} />
  return (
    <div className="flex flex-col gap-1.5">
      {(msg.toolCalls || []).map((tc, i) => <ToolCallBadge key={i} tool={{ ...tc, done: true }} />)}
      <AssistantBubble text={msg.content} usage={msg.usage} />
    </div>
  )
}

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] border border-vsc-selection bg-vsc-selection px-3 py-2 text-xs text-vsc-text whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({ text, streaming, usage }) {
  const [copied, setCopied] = useState(false)
  const cost = calcCost(usage)

  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group flex flex-col gap-1">
      <div className="relative border border-vsc-border bg-vsc-panel">
        <div
          className="prose-vsc px-3 py-2.5 text-xs text-vsc-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
        />
        {streaming && <span className="cursor-blink ml-0.5 text-vsc-blue">▋</span>}
        {!streaming && (
          <button
            onClick={copy}
            className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-vsc-muted hover:text-vsc-text"
          >
            {copied ? <Check size={11} className="text-vsc-green" /> : <Copy size={11} />}
          </button>
        )}
      </div>
      {usage && (
        <div className="flex gap-3 text-[10px] text-vsc-muted px-0.5">
          <span>↑ {usage.input_tokens.toLocaleString()} in</span>
          <span>↓ {usage.output_tokens.toLocaleString()} out</span>
          {cost !== null && <span className="text-vsc-yellow">${cost.toFixed(4)}</span>}
        </div>
      )}
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 border border-vsc-border bg-vsc-panel px-3 py-2.5">
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map(i => (
          <span key={i} className={`thinking-dot inline-block w-1.5 h-1.5 rounded-full bg-vsc-blue`} />
        ))}
      </div>
      <span className="text-[11px] text-vsc-muted">Claude is thinking…</span>
    </div>
  )
}

function ErrorBubble({ text }) {
  return (
    <div className="border border-vsc-red bg-vsc-bg px-3 py-2 text-xs text-vsc-red">
      ⚠ {text}
    </div>
  )
}

function SystemMsg({ children }) {
  return (
    <div className="border-l-2 border-vsc-blue bg-vsc-panel px-3 py-2 text-[11px] text-vsc-muted italic">
      {children}
    </div>
  )
}

function ToolCallBadge({ tool }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-vsc-border bg-vsc-bg text-[11px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left hover:bg-vsc-panel transition-colors"
      >
        <Wrench size={10} className={tool.done ? 'text-vsc-green' : 'text-vsc-yellow pulse-dot'} />
        <span className="font-mono text-vsc-lightblue">{tool.name}</span>
        <span className="text-vsc-muted">()</span>
        {!tool.done && <span className="ml-1 text-vsc-yellow text-[10px]">running…</span>}
        {tool.done && <span className="ml-1 text-vsc-green text-[10px]">✓</span>}
        <span className="ml-auto text-vsc-muted">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {open && tool.preview && (
        <pre className="border-t border-vsc-border px-3 py-2 text-[10px] text-vsc-muted overflow-x-auto whitespace-pre-wrap max-h-48 bg-vsc-bg">
          {tool.preview}
        </pre>
      )}
    </div>
  )
}

function normalizeMsg(msg) {
  return {
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    toolCalls: msg.tool_calls || [],
    usage: msg.usage || null,
  }
}
