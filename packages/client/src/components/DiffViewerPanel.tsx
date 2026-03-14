import { useState, useEffect, useCallback } from 'react';

interface Project {
  id: string;
  name: string;
  description: string;
  default_branch: string;
  team_count: number;
  pr_count: number;
}

interface Worktree {
  id: string;
  project_id: string;
  branch_name: string;
  team_name: string | null;
  project_name: string;
}

interface PR {
  id: string;
  title: string;
  description: string;
  source_branch: string;
  target_branch: string;
  status: string;
  author_name: string | null;
  reviewer_name: string | null;
  created_at: string;
  merged_at: string | null;
}

interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

type View = 'projects' | 'worktree' | 'pr';

const S = {
  panel: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    width: '520px',
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
  breadcrumb: {
    padding: '6px 14px',
    borderBottom: '1px solid #333355',
    fontSize: '11px',
    color: '#a0aec0',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },
  breadcrumbLink: {
    color: '#818cf8',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: 0,
  },
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '8px 14px',
  },
  card: {
    background: '#2a2a45',
    borderRadius: '6px',
    marginBottom: '6px',
    padding: '10px 12px',
    cursor: 'pointer',
  },
  cardTitle: { fontSize: '12px', fontWeight: 'bold' as const, marginBottom: '3px' },
  cardSub: { color: '#a0aec0', fontSize: '10px' },
  section: { marginBottom: '16px' },
  sectionTitle: {
    fontSize: '11px',
    color: '#a0aec0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '6px',
    borderBottom: '1px solid #333355',
    paddingBottom: '4px',
  },
  statusBadge: (status: string) => ({
    fontSize: '9px',
    padding: '1px 6px',
    borderRadius: '3px',
    background:
      status === 'merged'
        ? '#22543d'
        : status === 'approved'
          ? '#2d6a4f'
          : status === 'rejected'
            ? '#742a2a'
            : '#2d3748',
    color: '#fff',
    textTransform: 'uppercase' as const,
  }),
  commitRow: {
    display: 'flex',
    gap: '8px',
    padding: '4px 0',
    borderBottom: '1px solid #2a2a45',
    fontSize: '11px',
  },
  commitHash: { color: '#818cf8', fontWeight: 'bold' as const, flexShrink: 0 },
  commitMsg: {
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  commitAuthor: { color: '#a0aec0', fontSize: '10px', flexShrink: 0 },
  diffContainer: {
    background: '#1a1a2e',
    borderRadius: '4px',
    padding: '8px',
    overflow: 'auto' as const,
    fontSize: '11px',
    lineHeight: '1.5',
    whiteSpace: 'pre' as const,
    maxHeight: '400px',
  },
  diffAdd: { color: '#68d391', background: 'rgba(104, 211, 145, 0.1)' },
  diffDel: { color: '#fc8181', background: 'rgba(252, 129, 129, 0.1)' },
  diffHunk: { color: '#818cf8' },
  diffFile: { color: '#f6ad55', fontWeight: 'bold' as const },
  empty: { color: '#666', textAlign: 'center' as const, padding: '20px' },
};

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div style={S.empty}>No changes</div>;

  const lines = diff.split('\n');
  return (
    <div style={S.diffContainer}>
      {lines.map((line, i) => {
        let style: React.CSSProperties = {};
        if (line.startsWith('+++') || line.startsWith('---')) {
          style = S.diffFile;
        } else if (line.startsWith('@@')) {
          style = S.diffHunk;
        } else if (line.startsWith('+')) {
          style = S.diffAdd;
        } else if (line.startsWith('-')) {
          style = S.diffDel;
        }
        return (
          <div key={i} style={style}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

interface DiffViewerPanelProps {
  onClose: () => void;
}

export function DiffViewerPanel({ onClose }: DiffViewerPanelProps) {
  const [view, setView] = useState<View>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [prs, setPrs] = useState<PR[]>([]);

  // Worktree detail state
  const [selectedWorktree, setSelectedWorktree] = useState<Worktree | null>(null);
  const [worktreeDiff, setWorktreeDiff] = useState<string>('');
  const [worktreeCommits, setWorktreeCommits] = useState<Commit[]>([]);

  // PR detail state
  const [selectedPR, setSelectedPR] = useState<PR | null>(null);
  const [prDiff, setPrDiff] = useState<string>('');

  // Fetch projects on mount
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const selectProject = useCallback((project: Project) => {
    setSelectedProject(project);
    setView('projects');
    // Fetch worktrees and PRs
    fetch(`/api/projects/${project.id}/worktrees`)
      .then((r) => r.json())
      .then((data) => setWorktrees(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch(`/api/projects/${project.id}/prs`)
      .then((r) => r.json())
      .then((data) => setPrs(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const selectWorktree = useCallback((wt: Worktree) => {
    setSelectedWorktree(wt);
    setView('worktree');
    setWorktreeDiff('');
    setWorktreeCommits([]);
    fetch(`/api/worktrees/${wt.id}/diff`)
      .then((r) => r.json())
      .then((data) => setWorktreeDiff(data.diff ?? ''))
      .catch(() => {});
    fetch(`/api/worktrees/${wt.id}/commits`)
      .then((r) => r.json())
      .then((data) => setWorktreeCommits(data.commits ?? []))
      .catch(() => {});
  }, []);

  const selectPR = useCallback((pr: PR) => {
    setSelectedPR(pr);
    setView('pr');
    setPrDiff('');
    fetch(`/api/prs/${pr.id}`)
      .then((r) => r.json())
      .then((data) => setPrDiff(data.diff ?? ''))
      .catch(() => {});
  }, []);

  const goToProjects = useCallback(() => {
    setSelectedProject(null);
    setSelectedWorktree(null);
    setSelectedPR(null);
    setView('projects');
  }, []);

  const goToProject = useCallback(() => {
    setSelectedWorktree(null);
    setSelectedPR(null);
    setView('projects');
  }, []);

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.title}>Projects</span>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
      </div>

      {/* Breadcrumb */}
      <div style={S.breadcrumb}>
        <button style={S.breadcrumbLink} onClick={goToProjects}>
          Projects
        </button>
        {selectedProject && (
          <>
            <span>/</span>
            <button style={S.breadcrumbLink} onClick={goToProject}>
              {selectedProject.name}
            </button>
          </>
        )}
        {view === 'worktree' && selectedWorktree && (
          <>
            <span>/</span>
            <span>{selectedWorktree.branch_name}</span>
          </>
        )}
        {view === 'pr' && selectedPR && (
          <>
            <span>/</span>
            <span>PR: {selectedPR.title.slice(0, 30)}</span>
          </>
        )}
      </div>

      <div style={S.body}>
        {/* Project list */}
        {!selectedProject && (
          <>
            {projects.map((p) => (
              <div key={p.id} style={S.card} onClick={() => selectProject(p)}>
                <div style={S.cardTitle}>{p.name}</div>
                <div style={S.cardSub}>
                  {p.description.slice(0, 80)}
                  {p.description.length > 80 ? '...' : ''}
                </div>
                <div style={S.cardSub}>
                  {p.team_count} team{p.team_count !== 1 ? 's' : ''} | {p.pr_count} PR
                  {p.pr_count !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
            {projects.length === 0 && <div style={S.empty}>No projects yet</div>}
          </>
        )}

        {/* Project detail: worktrees + PRs */}
        {selectedProject && view === 'projects' && (
          <>
            <div style={S.section}>
              <div style={S.sectionTitle}>Worktrees</div>
              {worktrees.map((wt) => (
                <div key={wt.id} style={S.card} onClick={() => selectWorktree(wt)}>
                  <div style={S.cardTitle}>{wt.branch_name}</div>
                  <div style={S.cardSub}>{wt.team_name ?? 'No team'}</div>
                </div>
              ))}
              {worktrees.length === 0 && (
                <div style={{ ...S.cardSub, padding: '8px 0' }}>No worktrees</div>
              )}
            </div>

            <div style={S.section}>
              <div style={S.sectionTitle}>Pull Requests</div>
              {prs.map((pr) => (
                <div key={pr.id} style={S.card} onClick={() => selectPR(pr)}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '3px',
                    }}
                  >
                    <div style={S.cardTitle}>{pr.title}</div>
                    <span style={S.statusBadge(pr.status)}>{pr.status}</span>
                  </div>
                  <div style={S.cardSub}>
                    {pr.source_branch} → {pr.target_branch}
                    {pr.author_name && <> | by {pr.author_name}</>}
                  </div>
                </div>
              ))}
              {prs.length === 0 && (
                <div style={{ ...S.cardSub, padding: '8px 0' }}>No pull requests</div>
              )}
            </div>
          </>
        )}

        {/* Worktree detail: diff + commits */}
        {view === 'worktree' && selectedWorktree && (
          <>
            <div style={S.section}>
              <div style={S.sectionTitle}>Diff ({selectedWorktree.branch_name})</div>
              <DiffView diff={worktreeDiff} />
            </div>

            <div style={S.section}>
              <div style={S.sectionTitle}>Commits</div>
              {worktreeCommits.map((c) => (
                <div key={c.hash} style={S.commitRow}>
                  <span style={S.commitHash}>{c.hash}</span>
                  <span style={S.commitMsg}>{c.message}</span>
                  <span style={S.commitAuthor}>{c.author}</span>
                </div>
              ))}
              {worktreeCommits.length === 0 && (
                <div style={{ ...S.cardSub, padding: '8px 0' }}>No commits</div>
              )}
            </div>
          </>
        )}

        {/* PR detail: diff */}
        {view === 'pr' && selectedPR && (
          <>
            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                }}
              >
                <div style={S.cardTitle}>{selectedPR.title}</div>
                <span style={S.statusBadge(selectedPR.status)}>{selectedPR.status}</span>
              </div>
              <div style={S.cardSub}>
                {selectedPR.source_branch} → {selectedPR.target_branch}
              </div>
              <div style={S.cardSub}>
                Author: {selectedPR.author_name ?? 'Unknown'}
                {selectedPR.reviewer_name && <> | Reviewer: {selectedPR.reviewer_name}</>}
              </div>
              {selectedPR.description && (
                <div style={{ fontSize: '11px', marginTop: '6px', color: '#c4b5fd' }}>
                  {selectedPR.description}
                </div>
              )}
            </div>

            <div style={S.section}>
              <div style={S.sectionTitle}>Diff</div>
              <DiffView diff={prDiff} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
