import { useState, useEffect, useRef } from 'react';
import type { WSMessage } from '../hooks/useWebSocket';

interface ScheduledJob {
  id: string;
  agent_id: string;
  job_type: string;
  sim_time: string;
  recurrence: string | null;
  payload: string;
  agent_name?: string;
}

interface ActivityEntry {
  id: string;
  category: string;
  agentId: string;
  agentName: string;
  description: string;
  simTime: string;
}

type Tab = 'schedule' | 'activity';

const JOB_COLORS: Record<string, string> = {
  arrive: '#48bb78',
  lunch_break: '#f6ad55',
  return_from_lunch: '#4299e1',
  depart: '#a78bfa',
  morning_planning: '#ed64a6',
  midday_check: '#ed64a6',
  eod_review: '#ed64a6',
  meeting: '#6366f1',
};

const CATEGORY_COLORS: Record<string, string> = {
  state: '#4299e1',
  tool: '#a78bfa',
  session: '#48bb78',
  error: '#fc8181',
  blocker: '#f56565',
};

const S = {
  panel: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    width: '420px',
    background: '#1e1e32',
    borderRight: '1px solid #333355',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 20,
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e2e8f0',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 14px',
    borderBottom: '1px solid #333355',
    background: '#252540',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: '15px', fontWeight: 'bold' as const },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#a0aec0',
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: 'monospace',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #333355',
  },
  tab: (active: boolean) => ({
    flex: 1,
    padding: '8px 0',
    textAlign: 'center' as const,
    cursor: 'pointer',
    background: active ? '#2d2d4a' : 'transparent',
    color: active ? '#fff' : '#a0aec0',
    border: 'none',
    borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    fontFamily: 'monospace',
    fontSize: '11px',
  }),
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '8px 14px',
  },
  // Schedule
  timelineItem: (isPast: boolean) => ({
    display: 'flex',
    gap: '10px',
    padding: '6px 0',
    borderBottom: '1px solid #2a2a45',
    opacity: isPast ? 0.5 : 1,
  }),
  timelineDot: (color: string) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: color,
    marginTop: '4px',
    flexShrink: 0,
  }),
  timelineTime: {
    color: '#a0aec0',
    fontSize: '10px',
    width: '50px',
    flexShrink: 0,
  },
  timelineContent: { flex: 1 },
  timelineType: { fontSize: '11px', marginBottom: '1px' },
  timelineAgent: { color: '#a0aec0', fontSize: '10px' },
  // Activity log
  logEntry: {
    display: 'flex',
    gap: '8px',
    padding: '4px 0',
    borderBottom: '1px solid #2a2a45',
    fontSize: '11px',
  },
  logTime: { color: '#666', fontSize: '10px', width: '55px', flexShrink: 0 },
  logCategory: (color: string) => ({
    fontSize: '9px',
    padding: '0px 4px',
    borderRadius: '2px',
    background: color,
    color: '#fff',
    flexShrink: 0,
    height: '14px',
    lineHeight: '14px',
  }),
  logAgent: { color: '#c4b5fd', flexShrink: 0 },
  logDesc: { color: '#a0aec0', flex: 1 },
  empty: { color: '#666', textAlign: 'center' as const, padding: '20px' },
};

function formatJobType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTime(iso: string): string {
  try {
    return iso.split('T')[1]?.slice(0, 5) ?? iso;
  } catch {
    return iso;
  }
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

interface SchedulePanelProps {
  onClose: () => void;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  simTime: string;
}

const MAX_ACTIVITY_ENTRIES = 200;

export function SchedulePanel({ onClose, subscribe, simTime }: SchedulePanelProps) {
  const [tab, setTab] = useState<Tab>('schedule');
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  // Fetch scheduled jobs
  useEffect(() => {
    fetch('/api/scheduled-jobs')
      .then((r) => r.json())
      .then((data) => {
        // Also fetch agent names
        fetch('/api/agents')
          .then((r) => r.json())
          .then((agents: Array<{ id: string; name: string }>) => {
            const nameMap = new Map(agents.map((a) => [a.id, a.name]));
            const enriched = (Array.isArray(data) ? data : []).map((j: ScheduledJob) => ({
              ...j,
              agent_name: nameMap.get(j.agent_id) ?? 'Unknown',
            }));
            // Sort by sim_time
            enriched.sort((a: ScheduledJob, b: ScheduledJob) =>
              a.sim_time.localeCompare(b.sim_time),
            );
            setJobs(enriched);
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  // Subscribe to activity events via WebSocket
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'activity') {
        const entry: ActivityEntry = {
          id: `act-${++idCounter.current}`,
          category: msg.category,
          agentId: msg.agentId,
          agentName: msg.agentName,
          description: msg.description,
          simTime: msg.simTime,
        };
        setActivity((prev) => {
          const next = [...prev, entry];
          if (next.length > MAX_ACTIVITY_ENTRIES) {
            return next.slice(next.length - MAX_ACTIVITY_ENTRIES);
          }
          return next;
        });
      }
    });
  }, [subscribe]);

  // Auto-scroll activity log
  useEffect(() => {
    if (tab === 'activity') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activity.length, tab]);

  // Determine current sim day for filtering schedule
  const currentDay = simTime.split('T')[0] ?? '';

  // Filter jobs for current day
  const todayJobs = jobs.filter((j) => j.sim_time.startsWith(currentDay));

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.title}>Schedule & Activity</span>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
      </div>

      <div style={S.tabs}>
        <button style={S.tab(tab === 'schedule')} onClick={() => setTab('schedule')}>
          Schedule
        </button>
        <button style={S.tab(tab === 'activity')} onClick={() => setTab('activity')}>
          Activity Log
        </button>
      </div>

      <div style={S.body}>
        {tab === 'schedule' && (
          <>
            {todayJobs.length === 0 && <div style={S.empty}>No events scheduled for today</div>}
            {todayJobs.map((job) => {
              const isPast = job.sim_time < simTime;
              const color = JOB_COLORS[job.job_type] ?? '#666';
              const payload = parsePayload(job.payload);
              return (
                <div key={job.id} style={S.timelineItem(isPast)}>
                  <div style={S.timelineTime}>{formatTime(job.sim_time)}</div>
                  <div style={S.timelineDot(color)} />
                  <div style={S.timelineContent}>
                    <div style={S.timelineType}>
                      {formatJobType(job.job_type)}
                      {payload.agenda ? `: ${String(payload.agenda).slice(0, 60)}` : ''}
                    </div>
                    <div style={S.timelineAgent}>{job.agent_name}</div>
                  </div>
                </div>
              );
            })}
            {todayJobs.length > 0 && (
              <div style={{ ...S.empty, fontSize: '10px', padding: '12px' }}>
                {currentDay} — {todayJobs.length} event
                {todayJobs.length !== 1 ? 's' : ''}
              </div>
            )}
          </>
        )}

        {tab === 'activity' && (
          <>
            {activity.length === 0 && <div style={S.empty}>Waiting for simulation events...</div>}
            {activity.map((entry) => {
              const catColor = CATEGORY_COLORS[entry.category] ?? '#666';
              return (
                <div key={entry.id} style={S.logEntry}>
                  <span style={S.logTime}>{formatTime(entry.simTime)}</span>
                  <span style={S.logCategory(catColor)}>{entry.category}</span>
                  <span style={S.logAgent}>{entry.agentName}</span>
                  <span style={S.logDesc}>{entry.description}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </>
        )}
      </div>
    </div>
  );
}
