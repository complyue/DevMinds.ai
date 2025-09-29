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
  state,
}: {
  onRefresh: () => void;
  onRun: () => void;
  state: 'idle' | 'follow' | 'run';
}) {
  const running = state === 'run';
  return (
    <div className="toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
      <button disabled>停止</button>
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
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/events?date=${date}&limit=200`)
      .then((r) => r.json())
      .then((res) => {
        setEvents(res.items ?? []);
        setWarnings(res.warnings ?? []);
      })
      .catch(() => {
        setEvents([]);
        setWarnings([{ reason: 'fetch failed' }]);
      });
  }, [taskId, date]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${encodeURIComponent(taskId)}`;
    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      setWs(websocket);
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'message.appended' && message.payload?.taskId === taskId) {
          // Append new event to the stream
          setEvents((prev) => [...prev, message.payload]);
        }
      } catch (err) {
        console.warn('Failed to parse WebSocket message:', err);
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
      setWs(null);
    };

    return () => {
      websocket.close();
    };
  }, [taskId]);

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
          fetch(`/api/tasks/${encodeURIComponent(taskId)}/events?date=${date}&limit=200`)
            .then((r) => r.json())
            .then((res) => {
              setEvents(res.items ?? []);
              setWarnings(res.warnings ?? []);
            });
        }}
        onRun={() => {
          fetch(`/api/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' }).catch(() => {});
        }}
        state={state}
      />
      <div className="content" style={{ padding: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 12, color: '#6a737d' }}>{events.length} 个事件</div>
          {ws && <div style={{ fontSize: 12, color: '#28a745' }}>● 实时连接</div>}
          {!ws && <div style={{ fontSize: 12, color: '#dc3545' }}>● 连接断开</div>}
        </div>
        {warnings.length > 0 && (
          <div style={{ color: '#d73a49', marginBottom: 12, fontSize: 12 }}>
            ⚠ {warnings.length} 个警告
          </div>
        )}
        {eventGroups.map((group, i) => (
          <EventGroupComponent key={group.spanId} group={group} />
        ))}
        {events.length === 0 && <div style={{ color: '#6a737d' }}>暂无事件</div>}
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
