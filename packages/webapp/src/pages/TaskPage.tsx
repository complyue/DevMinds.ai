import React, { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

type Event = {
  ts: string
  taskId: string
  agentId?: string
  type: string
  payload: any
  spanId?: string
  parentSpanId?: string
}

function Toolbar({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="toolbar">
      <button onClick={onRefresh}>刷新</button>
      <button disabled>新建子任务</button>
      <button disabled>停止</button>
    </div>
  )
}

function TaskTreePanel({ taskId }: { taskId: string }) {
  const [tree, setTree] = useState<any | null>(null)
  useEffect(() => {
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/tree`).then(r => r.json()).then(setTree).catch(() => setTree(null))
  }, [taskId])
  return (
    <div className="panel left">
      <div className="toolbar"><strong>任务树</strong></div>
      <div className="content">
        <pre>{JSON.stringify(tree, null, 2)}</pre>
      </div>
    </div>
  )
}

function ConversationStream({ taskId, date }: { taskId: string; date: string }) {
  const [events, setEvents] = useState<Event[]>([])
  const [warnings, setWarnings] = useState<any[]>([])
  useEffect(() => {
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/events?date=${date}&limit=200`)
      .then(r => r.json())
      .then((res) => {
        setEvents(res.items ?? [])
        setWarnings(res.warnings ?? [])
      }).catch(() => {
        setEvents([]); setWarnings([{ reason: "fetch failed" }])
      })
  }, [taskId, date])

  return (
    <div className="panel">
      <Toolbar onRefresh={() => {
        // simply refetch by toggling date key
        setEvents([...events])
      }} />
      <div className="content" style={{ padding: 12 }}>
        {warnings.length > 0 && <div style={{ color: "#b36" }}>Warnings: {warnings.length}</div>}
        {events.map((e, i) => (
          <div key={i} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
            <div style={{ fontSize: 12, color: "#666" }}>{e.ts} · {e.type} · span:{e.spanId ?? "-"} parent:{e.parentSpanId ?? "-"}</div>
            <pre>{typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload, null, 2)}</pre>
          </div>
        ))}
        {events.length === 0 && <div>暂无事件</div>}
      </div>
    </div>
  )
}

function WipSummaryPanel({ taskId }: { taskId: string }) {
  const [wip, setWip] = useState<string>("")
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/wip`).then(async (r) => {
      if (!r.ok) { setMissing(true); setWip(""); return }
      const res = await r.json()
      if (res.ok) setWip(res.wip ?? ""); else setMissing(true)
    }).catch(() => { setMissing(true) })
  }, [taskId])
  return (
    <div className="panel right">
      <div className="toolbar"><strong>WIP 摘要</strong></div>
      <div className="content" style={{ padding: 12 }}>
        {missing ? <div>摘要缺失，去查看原始事件</div> : <pre>{wip || "…"}</pre>}
      </div>
    </div>
  )
}

export default function TaskPage() {
  const { taskId = "" } = useParams()
  const date = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`
  }, [])
  if (!taskId) return <div style={{ padding: 16 }}>未指定 taskId</div>
  return (
    <div className="layout">
      <TaskTreePanel taskId={taskId} />
      <ConversationStream taskId={taskId} date={date} />
      <WipSummaryPanel taskId={taskId} />
    </div>
  )
}
