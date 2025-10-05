import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';

type Event = {
  ts: string;
  taskId: string;
  agentId?: string;
  type: string;
  payload: any;
  spanId?: string;
  parentSpanId?: string;
};

function Toolbar({
  onRefresh,
  onRun,
  onCancel,
  onToolRun,
  toolArg,
  setToolArg,
  state,
}: {
  onRefresh: () => void;
  onRun: () => void;
  onCancel: () => void;
  onToolRun: () => void;
  toolArg: string;
  setToolArg: (v: string) => void;
  state: 'idle' | 'follow' | 'run';
}) {
  const running = state === 'run';
  return (
    <div
      className="toolbar"
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <button onClick={onRefresh}>刷新</button>
      <button onClick={onRun} disabled={running}>
        推进
      </button>
      <span
        style={{
          fontSize: 12,
          color: running ? '#d73a49' : state === 'follow' ? '#28a745' : '#6a737d',
        }}
      >
        状态: {state}
      </span>
      <button disabled>新建子任务</button>
      <button onClick={onCancel} disabled={!running}>
        停止
      </button>
      {/* 工具触发：简单参数输入 + 触发按钮（运行中禁用） */}
      <input
        value={toolArg}
        onChange={(e) => setToolArg(e.target.value)}
        placeholder="工具参数..."
        style={{
          fontSize: 12,
          padding: '4px 6px',
          border: '1px solid #ddd',
          borderRadius: 4,
          minWidth: 180,
        }}
        disabled={running}
      />
      <button onClick={onToolRun} disabled={running || !toolArg.trim()}>
        触发工具
      </button>
    </div>
  );
}

type TreeNode = {
  id: string;
  children: TreeNode[];
  meta: any;
};

function TreeNodeComponent({
  node,
  level = 0,
  onSelect,
}: {
  node: TreeNode;
  level?: number;
  onSelect: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(level === 0);
  const hasChildren = node.children && node.children.length > 0;
  const indent = level * 16;

  return (
    <div>
      <div
        style={{
          paddingLeft: indent + 8,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          cursor: 'pointer',
          borderRadius: 4,
          margin: '2px 4px',
        }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {hasChildren && (
            <span
              style={{
                cursor: 'pointer',
                userSelect: 'none',
                width: 16,
                textAlign: 'center',
              }}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
            >
              {expanded ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span style={{ width: 16 }}></span>}
          <span
            style={{
              fontSize: 14,
              fontWeight: level === 0 ? 'bold' : 'normal',
            }}
          >
            {node.id}
          </span>
          {node.meta?.parseError && <span style={{ color: '#d73a49', fontSize: 12 }}>⚠</span>}
          {node.meta?.missing && <span style={{ color: '#6a737d', fontSize: 12 }}>?</span>}
        </div>
        {node.meta?.title && (
          <div
            style={{
              fontSize: 12,
              color: '#6a737d',
              marginLeft: hasChildren ? 20 : 16,
              marginTop: 2,
            }}
          >
            {node.meta.title}
          </div>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <TreeNodeComponent
              key={child.id || i}
              node={child}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskTreePanel({
  taskId,
  onTaskSelect,
}: {
  taskId: string;
  onTaskSelect: (taskId: string) => void;
}) {
  const [tree, setTree] = useState<{ root: TreeNode } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/tree`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setTree(res);
        } else {
          setError(res.message || '加载失败');
        }
      })
      .catch(() => setError('网络错误'))
      .finally(() => setLoading(false));
  }, [taskId]);

  return (
    <div className="panel left">
      <div className="toolbar">
        <strong>任务树</strong>
      </div>
      <div className="content" style={{ padding: 8 }}>
        {loading && <div style={{ padding: 8, color: '#6a737d' }}>加载中...</div>}
        {error && <div style={{ padding: 8, color: '#d73a49' }}>错误: {error}</div>}
        {tree && !loading && <TreeNodeComponent node={tree.root} onSelect={onTaskSelect} />}
      </div>
    </div>
  );
}

type EventGroup = {
  spanId: string;
  parentSpanId?: string;
  events: Event[];
  children: EventGroup[];
  collapsed: boolean;
};

function EventGroupComponent({ group, level = 0 }: { group: EventGroup; level?: number }) {
  const [collapsed, setCollapsed] = useState(group.collapsed);
  const indent = level * 16;
  const hasChildren = group.children.length > 0;
  const mainEvent = group.events[0];

  return (
    <div style={{ marginLeft: indent }}>
      <div
        style={{
          borderBottom: '1px solid #eee',
          padding: '8px 0',
          backgroundColor: level > 0 ? '#f8f9fa' : 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(hasChildren || group.events.length > 1) && (
            <span
              style={{
                cursor: 'pointer',
                userSelect: 'none',
                width: 16,
                textAlign: 'center',
              }}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '▶' : '▼'}
            </span>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#666' }}>
              {mainEvent.ts} · {mainEvent.type} · span:{group.spanId}
              {group.parentSpanId && ` parent:${group.parentSpanId}`}
              {group.events.length > 1 && ` (${group.events.length} events)`}
            </div>
            {!collapsed && (
              <div style={{ marginTop: 4 }}>
                {group.events.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: i < group.events.length - 1 ? 8 : 0,
                    }}
                  >
                    {i > 0 && (
                      <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>
                        {e.ts} · {e.type}
                      </div>
                    )}
                    <div style={{ fontSize: 13 }}>
                      {typeof e.payload === 'string' ? (
                        e.payload.length > 200 ? (
                          <details>
                            <summary style={{ cursor: 'pointer', color: '#0366d6' }}>
                              {e.payload.slice(0, 200)}...
                            </summary>
                            <pre style={{ marginTop: 8, fontSize: 12 }}>{e.payload}</pre>
                          </details>
                        ) : (
                          <pre style={{ margin: 0, fontSize: 12 }}>{e.payload}</pre>
                        )
                      ) : (
                        <pre style={{ margin: 0, fontSize: 12 }}>
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {!collapsed && hasChildren && (
        <div>
          {group.children.map((child, i) => (
            <EventGroupComponent key={child.spanId || i} group={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationStream({ taskId, date }: { taskId: string; date: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [state, setState] = useState<'idle' | 'follow' | 'run'>('idle');
  // 运行进度与状态提示
  const [deltaCount, setDeltaCount] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [outputReady, setOutputReady] = useState(false);
  // 工具参数与提示
  const [toolArg, setToolArg] = useState('');
  // 统一 toast 提示队列（2s 自动消退）
  const [toasts, setToasts] = useState<{ id: number; text: string; color?: string }[]>([]);
  const pushToast = (text: string, color?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, text, color }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2000);
  };
  // WS 重连与退避
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const connectRef = React.useRef<(() => void) | null>(null);
  // 批量刷新队列，缓解长文本与高频增量的重排压力
  const queueRef = React.useRef<Event[]>([]);
  const flushTimerRef = React.useRef<number | null>(null);
  // 事件分页与日期范围过滤
  const [limit, setLimit] = useState<number>(200);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);

  const fetchEvents = (off: number) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(off));
    params.set('date', date);
    if (dateFrom.trim()) params.set('dateFrom', dateFrom.trim());
    if (dateTo.trim()) params.set('dateTo', dateTo.trim());
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/events?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        const items: Event[] = res.items ?? [];
        setEvents(items);
        setWarnings(res.warnings ?? []);
        // 初始化进度/取消/完成状态
        setDeltaCount(items.filter((e) => e.type === 'agent.run.delta').length);
        setCancelled(items.some((e) => e.type === 'agent.run.cancelled'));
        setOutputReady(items.some((e) => e.type === 'agent.run.output'));
        setOffset(off);
      })
      .catch(() => {
        setEvents([]);
        setWarnings([{ reason: 'fetch failed' }]);
      });
  };

  const applyFilters = () => {
    setOffset(0);
    fetchEvents(0);
  };

  // Group events by spanId hierarchy
  const eventGroups = useMemo(() => {
    const groups = new Map<string, EventGroup>();
    const rootGroups: EventGroup[] = [];

    // First pass: create groups
    events.forEach((event) => {
      const spanId = event.spanId || `no-span-${event.ts}`;
      if (!groups.has(spanId)) {
        groups.set(spanId, {
          spanId,
          parentSpanId: event.parentSpanId,
          events: [],
          children: [],
          collapsed: false,
        });
      }
      groups.get(spanId)!.events.push(event);
    });

    // Second pass: build hierarchy
    groups.forEach((group) => {
      if (group.parentSpanId && groups.has(group.parentSpanId)) {
        groups.get(group.parentSpanId)!.children.push(group);
      } else {
        rootGroups.push(group);
      }
    });

    return rootGroups;
  }, [events]);

  useEffect(() => {
    // 初次加载按当前过滤参数拉取
    fetchEvents(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, date]);

  // WebSocket with exponential backoff, continuity recovery, and batched flush
  useEffect(() => {
    let stopped = false;

    const flush = () => {
      if (flushTimerRef.current != null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        if (queueRef.current.length) {
          // 批量追加，减少 setState 次数与重排
          setEvents((prev) => [...prev, ...queueRef.current]);
          const newDeltas = queueRef.current.filter((e) => e.type === 'agent.run.delta').length;
          if (newDeltas && !outputReady && !cancelled) {
            setDeltaCount((c) => c + newDeltas);
          }
          if (queueRef.current.some((e) => e.type === 'agent.run.cancelled')) {
            setCancelled(true);
          }
          if (queueRef.current.some((e) => e.type === 'agent.run.output')) {
            setOutputReady(true);
          }
          queueRef.current = [];
        }
      }, 50);
    };

    const connect = () => {
      if (stopped) return;
      setReconnecting(false);
      setReconnectFailed(false);

      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${encodeURIComponent(taskId)}`;
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setWs(websocket);
        setReconnecting(false);
        setReconnectAttempts(0);
        // 重连成功后按当前过滤用 offset 补齐遗漏事件
        const curOffset = offset + events.length;
        const params = new URLSearchParams();
        params.set('limit', '500');
        params.set('offset', String(curOffset));
        params.set('date', date);
        if (dateFrom.trim()) params.set('dateFrom', dateFrom.trim());
        if (dateTo.trim()) params.set('dateTo', dateTo.trim());
        fetch(`/api/tasks/${encodeURIComponent(taskId)}/events?${params.toString()}`)
          .then((r) => r.json())
          .then((res) => {
            const items: Event[] = res.items ?? [];
            if (items.length) {
              queueRef.current.push(...items);
              flush();
            }
          })
          .catch(() => {});
      };

      websocket.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'message.appended' && msg.payload?.taskId === taskId) {
            const ev: Event = msg.payload;
            queueRef.current.push(ev);
            flush();
          }
        } catch (err) {
          console.warn('Failed to parse WebSocket message:', err);
        }
      };

      websocket.onclose = () => {
        setWs(null);
        // 指数退避重连：1s → 2s → 4s → 8s（上限 10s），最多 6 次
        setReconnecting(true);
        setReconnectAttempts((prev) => {
          const next = prev + 1;
          const backoff = Math.min(1000 * Math.pow(2, prev), 10000);
          if (next <= 6 && !stopped) {
            window.setTimeout(() => {
              connect();
            }, backoff);
          } else {
            setReconnecting(false);
            setReconnectFailed(true);
          }
          return next;
        });
      };

      websocket.onerror = () => {
        // 可选：记录错误日志
      };

      connectRef.current = connect;
    };

    connect();

    return () => {
      stopped = true;
      try {
        ws?.close();
      } catch {}
      queueRef.current = [];
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, date]);

  // Poll backend status to reflect idle/follow/run
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/status`);
        const res = await r.json();
        if (!stop && res?.ok && res.status?.state) {
          setState(res.status.state);
        }
      } catch {}
      if (!stop) setTimeout(tick, 500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [taskId]);

  return (
    <div className="panel">
      <Toolbar
        onRefresh={() => {
          try {
            applyFilters();
          } catch {
            pushToast('刷新失败', '#d73a49');
          }
        }}
        onRun={() => {
          fetch(`/api/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' })
            .then((r) => {
              if (!r.ok) throw new Error('run failed');
              pushToast('已触发运行', '#28a745');
            })
            .catch(() => pushToast('运行触发失败', '#d73a49'));
        }}
        onCancel={() => {
          fetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
            .then((r) => {
              if (!r.ok) throw new Error('cancel failed');
              pushToast('已取消', '#d73a49');
            })
            .catch(() => pushToast('取消失败', '#d73a49'));
        }}
        onToolRun={() => {
          const body = JSON.stringify({ prompt: `工具触发: ${toolArg}` });
          fetch(`/api/tasks/${encodeURIComponent(taskId)}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
            .then((r) => {
              if (!r.ok) throw new Error('tool failed');
              pushToast('工具已触发', '#6f42c1');
              setToolArg('');
            })
            .catch(() => pushToast('工具触发失败', '#d73a49'));
        }}
        toolArg={toolArg}
        setToolArg={setToolArg}
        state={state}
      />
      <div className="content" style={{ padding: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* 过滤与分页控件 */}
          <label style={{ fontSize: 12, color: '#6a737d' }}>
            limit
            <input
              type="number"
              min={10}
              max={1000}
              step={10}
              value={limit}
              onChange={(e) => setLimit(Math.max(10, Math.min(1000, Number(e.target.value) || 10)))}
              style={{ marginLeft: 6, width: 80 }}
            />
          </label>
          <label style={{ fontSize: 12, color: '#6a737d' }}>
            dateFrom
            <input
              type="text"
              placeholder="YYYYMMDD"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ marginLeft: 6, width: 110 }}
            />
          </label>
          <label style={{ fontSize: 12, color: '#6a737d' }}>
            dateTo
            <input
              type="text"
              placeholder="YYYYMMDD"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ marginLeft: 6, width: 110 }}
            />
          </label>
          <button
            onClick={applyFilters}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              border: '1px solid #d1d5da',
              borderRadius: 4,
              background: '#f6f8fa',
            }}
          >
            应用过滤
          </button>
          <div style={{ fontSize: 12, color: '#6a737d' }}>{events.length} 个事件</div>
          {ws && <div style={{ fontSize: 12, color: '#28a745' }}>● 实时连接</div>}
          {!ws && reconnecting && (
            <div style={{ fontSize: 12, color: '#ff9800' }}>
              ● 重连中（第 {reconnectAttempts} 次，退避中）
            </div>
          )}
          {!ws && !reconnecting && reconnectFailed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#dc3545' }}>● 重连失败</div>
              <button
                onClick={() => {
                  setReconnectAttempts(0);
                  setReconnectFailed(false);
                  setReconnecting(true);
                  connectRef.current?.();
                }}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  border: '1px solid #d1d5da',
                  borderRadius: 4,
                  background: '#f6f8fa',
                  cursor: 'pointer',
                }}
              >
                手动重试
              </button>
            </div>
          )}

          {/* 运行进度：基于已收 delta 片段数的粗略提示（不依赖 state=run，提高鲁棒性） */}
          {!cancelled && !outputReady && deltaCount > 0 && (
            <div style={{ fontSize: 12, color: '#6f42c1' }}>
              进度：已收 {deltaCount} 片段（流式）
            </div>
          )}
          {/* 取消态显式化 */}
          {cancelled && (
            <div style={{ fontSize: 12, color: '#d73a49' }}>
              已取消（保留已有片段，不再继续合并）
            </div>
          )}
          {/* 合并完成提示 */}
          {outputReady && (
            <div style={{ fontSize: 12, color: '#28a745' }}>已完成合并并输出最终内容</div>
          )}
        </div>
        {warnings.length > 0 && (
          <div style={{ color: '#d73a49', marginBottom: 12, fontSize: 12 }}>
            ⚠ {warnings.length} 个警告
          </div>
        )}
        {/* 统一 toast 提示 */}
        {toasts.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {toasts.map((t) => (
              <span key={t.id} style={{ fontSize: 12, color: t.color || '#6a737d' }}>
                {t.text}
              </span>
            ))}
          </div>
        )}
        {/* 翻页控件 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button
            onClick={() => {
              const nextOff = Math.max(0, offset - limit);
              fetchEvents(nextOff);
            }}
            disabled={offset <= 0}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              border: '1px solid #d1d5da',
              borderRadius: 4,
              background: '#f6f8fa',
            }}
          >
            上一页
          </button>
          <button
            onClick={() => {
              const nextOff = offset + limit;
              fetchEvents(nextOff);
            }}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              border: '1px solid #d1d5da',
              borderRadius: 4,
              background: '#f6f8fa',
            }}
          >
            下一页
          </button>
          <span style={{ fontSize: 12, color: '#6a737d' }}>offset: {offset}</span>
        </div>
        {eventGroups.map((group, i) => (
          <EventGroupComponent key={group.spanId} group={group} />
        ))}
        {events.length === 0 && <div style={{ color: '#6a737d' }}>暂无事件</div>}
      </div>
    </div>
  );
}

function AskPanel({ taskId }: { taskId: string }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async (path: string, body: any) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('request failed');
    } catch (err) {
      console.warn('ask request failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: '#6a737d', marginBottom: 6 }}>Ask 面板（最小实现）</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入问题（ask）"
          style={{
            fontSize: 12,
            padding: '4px 6px',
            border: '1px solid #ddd',
            borderRadius: 4,
            minWidth: 240,
          }}
          disabled={busy}
        />
        <button
          onClick={() => q.trim() && post('ask', { question: q.trim() }).then(() => setQ(''))}
          disabled={busy || !q.trim()}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            border: '1px solid #d1d5da',
            borderRadius: 4,
            background: '#f6f8fa',
          }}
        >
          提交问题
        </button>
      </div>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}
      >
        <input
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder="输入回答（answer）"
          style={{
            fontSize: 12,
            padding: '4px 6px',
            border: '1px solid #ddd',
            borderRadius: 4,
            minWidth: 240,
          }}
          disabled={busy}
        />
        <button
          onClick={() => a.trim() && post('answer', { answer: a.trim() }).then(() => setA(''))}
          disabled={busy || !a.trim()}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            border: '1px solid #d1d5da',
            borderRadius: 4,
            background: '#f6f8fa',
          }}
        >
          提交回答
        </button>
      </div>
    </div>
  );
}

function WipSummaryPanel({ taskId }: { taskId: string }) {
  const [wip, setWip] = useState<string>('');
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastModified, setLastModified] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/wip`)
      .then(async (r) => {
        if (!r.ok) {
          setMissing(true);
          setWip('');
          return;
        }
        const res = await r.json();
        if (res.ok) {
          setWip(res.wip ?? '');
          setLastModified(res.meta?.mtime || null);
          setMissing(false);
        } else {
          setMissing(true);
        }
      })
      .catch(() => {
        setMissing(true);
      })
      .finally(() => setLoading(false));
  }, [taskId]);

  return (
    <div className="panel right">
      <div className="toolbar">
        <strong>WIP 摘要</strong>
        {lastModified && (
          <span style={{ fontSize: 11, color: '#6a737d', marginLeft: 8 }}>
            {new Date(lastModified).toLocaleString()}
          </span>
        )}
      </div>
      <div className="content" style={{ padding: 12, overflow: 'auto' }}>
        {loading && <div style={{ color: '#6a737d' }}>加载中...</div>}
        {missing && !loading && <div style={{ color: '#d73a49' }}>摘要缺失，请查看原始事件流</div>}
        {!missing && !loading && wip && (
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}
          >
            <ReactMarkdown>{wip}</ReactMarkdown>
          </div>
        )}
        {!missing && !loading && !wip && <div style={{ color: '#6a737d' }}>摘要为空</div>}

        {/* Ask 面板（最小实现）：调用后端 ask/answer API */}
        <AskPanel taskId={taskId} />
      </div>
    </div>
  );
}

export default function TaskPage() {
  const { taskId = '' } = useParams();
  const [currentTaskId, setCurrentTaskId] = useState(taskId);
  const date = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Update current task when URL changes
  useEffect(() => {
    setCurrentTaskId(taskId);
  }, [taskId]);

  if (!taskId) return <div style={{ padding: 16 }}>未指定 taskId</div>;

  return (
    <div className="layout">
      <TaskTreePanel taskId={currentTaskId} onTaskSelect={setCurrentTaskId} />
      <ConversationStream taskId={currentTaskId} date={date} />
      <WipSummaryPanel taskId={currentTaskId} />
    </div>
  );
}
