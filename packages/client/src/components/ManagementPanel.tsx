import { useState, useEffect, useCallback } from 'react';

interface Persona {
  id: string;
  name: string;
  bio: string;
  specialties: string;
}

interface Team {
  id: string;
  name: string;
  color: string;
  agent_count: number;
}

interface AgentBasic {
  id: string;
  name: string;
  role: string;
  team_id: string | null;
  team_name: string | null;
  state: string;
  desk_id: string | null;
}

interface ManagementPanelProps {
  onClose: () => void;
}

type Tab = 'hire' | 'teams';

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
  title: { fontSize: '14px', fontWeight: 'bold' as const },
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
    padding: '10px 14px',
  },
  search: {
    width: '100%',
    background: '#2a2a45',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#e2e8f0',
    padding: '6px 8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
    marginBottom: '10px',
    boxSizing: 'border-box' as const,
  },
  card: {
    background: '#2a2a45',
    borderRadius: '6px',
    padding: '10px',
    marginBottom: '8px',
  },
  cardName: { fontSize: '12px', fontWeight: 'bold' as const, marginBottom: '4px' },
  cardBio: { fontSize: '10px', color: '#a0aec0', marginBottom: '6px', lineHeight: '1.4' },
  specs: { display: 'flex', gap: '4px', flexWrap: 'wrap' as const, marginBottom: '8px' },
  spec: {
    fontSize: '9px',
    background: '#3b3b6b',
    padding: '1px 6px',
    borderRadius: '3px',
    color: '#c4b5fd',
  },
  btnRow: { display: 'flex', gap: '6px' },
  btn: {
    background: '#4a4a8a',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '10px',
  },
  btnDanger: {
    background: '#742a2a',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '10px',
  },
  teamDot: (color: string) => ({
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: color,
    marginRight: '6px',
    verticalAlign: 'middle',
  }),
  formRow: {
    display: 'flex',
    gap: '6px',
    marginBottom: '10px',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    background: '#2a2a45',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#e2e8f0',
    padding: '6px 8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
  },
  sectionLabel: {
    fontSize: '11px',
    color: '#a0aec0',
    marginBottom: '6px',
    marginTop: '12px',
    fontWeight: 'bold' as const,
  },
  select: {
    background: '#2a2a45',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#e2e8f0',
    padding: '4px 6px',
    fontFamily: 'monospace',
    fontSize: '10px',
    outline: 'none',
  },
};

function parseSpecs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string' && raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Comma-separated fallback
      return raw.split(',').map((s) => s.trim());
    }
  }
  return [];
}

const COLORS = [
  '#3B82F6',
  '#10B981',
  '#8B5CF6',
  '#F59E0B',
  '#06B6D4',
  '#EC4899',
  '#84CC16',
  '#F97316',
];

export function ManagementPanel({ onClose }: ManagementPanelProps) {
  const [tab, setTab] = useState<Tab>('hire');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<AgentBasic[]>([]);
  const [search, setSearch] = useState('');
  const [hiring, setHiring] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamColor, setNewTeamColor] = useState(COLORS[0]);

  const fetchTeams = useCallback(() => {
    fetch('/api/teams')
      .then((r) => r.json())
      .then((d) => setTeams(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const fetchAgents = useCallback(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((d) => setAgents(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((d) => setPersonas(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'teams') {
      fetchTeams();
      fetchAgents();
    }
  }, [tab, fetchTeams, fetchAgents]);

  const hireAgent = useCallback(async (personaId: string, role: string) => {
    setHiring(personaId);
    try {
      const res = await fetch('/api/agents/hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: personaId, role }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Hire failed:', data.error);
      }
    } finally {
      setHiring(null);
    }
  }, []);

  const createTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTeamName.trim(), color: newTeamColor }),
    });
    if (res.ok) {
      setNewTeamName('');
      fetchTeams();
    }
  }, [newTeamName, newTeamColor, fetchTeams]);

  const assignToTeam = useCallback(
    async (agentId: string, teamId: string) => {
      await fetch(`/api/agents/${agentId}/assign-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId }),
      });
      fetchAgents();
      fetchTeams();
    },
    [fetchAgents, fetchTeams],
  );

  const filteredPersonas = personas.filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const specs = parseSpecs(p.specialties);
    return p.name.toLowerCase().includes(s) || specs.some((sp) => sp.toLowerCase().includes(s));
  });

  const unassignedAgents = agents.filter(
    (a) => !a.team_id && a.role !== 'office_manager' && !('fired_at' in a && a.fired_at),
  );

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <div style={S.title}>Manage Office</div>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
      </div>

      <div style={S.tabs}>
        <button style={S.tab(tab === 'hire')} onClick={() => setTab('hire')}>
          Hire
        </button>
        <button style={S.tab(tab === 'teams')} onClick={() => setTab('teams')}>
          Teams
        </button>
      </div>

      <div style={S.body}>
        {tab === 'hire' && (
          <>
            <input
              style={S.search}
              placeholder="Search personas by name or specialty..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filteredPersonas.map((p) => {
              const specs = parseSpecs(p.specialties);
              return (
                <div key={p.id} style={S.card}>
                  <div style={S.cardName}>{p.name}</div>
                  <div style={S.cardBio}>
                    {p.bio?.slice(0, 150)}
                    {p.bio?.length > 150 ? '...' : ''}
                  </div>
                  {specs.length > 0 && (
                    <div style={S.specs}>
                      {specs.map((s) => (
                        <span key={s} style={S.spec}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={S.btnRow}>
                    <button
                      style={S.btn}
                      disabled={hiring === p.id}
                      onClick={() => hireAgent(p.id, 'agent')}
                    >
                      {hiring === p.id ? '...' : 'Hire as Agent'}
                    </button>
                    <button
                      style={S.btn}
                      disabled={hiring === p.id}
                      onClick={() => hireAgent(p.id, 'team_manager')}
                    >
                      {hiring === p.id ? '...' : 'Hire as TM'}
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredPersonas.length === 0 && (
              <div style={{ color: '#666', textAlign: 'center', marginTop: '20px' }}>
                {personas.length === 0 ? 'Loading personas...' : 'No matching personas'}
              </div>
            )}
          </>
        )}

        {tab === 'teams' && (
          <>
            {/* Create team form */}
            <div style={S.sectionLabel}>Create Team</div>
            <div style={S.formRow}>
              <input
                style={S.input}
                placeholder="Team name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createTeam()}
              />
              <div style={{ display: 'flex', gap: '3px' }}>
                {COLORS.map((c) => (
                  <div
                    key={c}
                    onClick={() => setNewTeamColor(c)}
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '3px',
                      background: c,
                      cursor: 'pointer',
                      border: newTeamColor === c ? '2px solid #fff' : '2px solid transparent',
                    }}
                  />
                ))}
              </div>
              <button style={S.btn} onClick={createTeam}>
                Create
              </button>
            </div>

            {/* Unassigned agents */}
            {unassignedAgents.length > 0 && (
              <>
                <div style={S.sectionLabel}>Unassigned ({unassignedAgents.length})</div>
                {unassignedAgents.map((a) => (
                  <div
                    key={a.id}
                    style={{ ...S.card, display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={S.cardName}>{a.name}</div>
                      <div style={{ fontSize: '10px', color: '#a0aec0' }}>
                        {a.role === 'team_manager' ? 'Team Manager' : 'Agent'} | {a.state}
                      </div>
                    </div>
                    {teams.length > 0 && (
                      <select
                        style={S.select}
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) assignToTeam(a.id, e.target.value);
                        }}
                      >
                        <option value="" disabled>
                          Assign...
                        </option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Teams list */}
            <div style={S.sectionLabel}>Teams ({teams.length})</div>
            {teams.map((t) => {
              const members = agents.filter((a) => a.team_id === t.id);
              return (
                <div key={t.id} style={S.card}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={S.teamDot(t.color)} />
                    <span style={S.cardName}>{t.name}</span>
                    <span style={{ fontSize: '10px', color: '#a0aec0', marginLeft: '8px' }}>
                      {t.agent_count} agent{t.agent_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {members.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        fontSize: '10px',
                        padding: '2px 0',
                        color: '#c4b5fd',
                      }}
                    >
                      {m.name}{' '}
                      <span style={{ color: '#666' }}>
                        ({m.role === 'team_manager' ? 'TM' : 'Agent'}, {m.state})
                      </span>
                    </div>
                  ))}
                  {members.length === 0 && (
                    <div style={{ fontSize: '10px', color: '#666' }}>No members</div>
                  )}
                  {members.length === 0 && (
                    <button
                      style={{ ...S.btnDanger, marginTop: '6px', fontSize: '9px' }}
                      onClick={async () => {
                        if (!confirm(`Delete team "${t.name}"?`)) return;
                        const res = await fetch(`/api/teams/${t.id}`, { method: 'DELETE' });
                        if (res.ok) {
                          fetchTeams();
                        } else {
                          const data = await res.json();
                          alert(data.error);
                        }
                      }}
                    >
                      Delete Team
                    </button>
                  )}
                </div>
              );
            })}
            {teams.length === 0 && (
              <div style={{ color: '#666', textAlign: 'center', marginTop: '10px' }}>
                No teams yet
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
