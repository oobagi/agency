import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from '../db.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { simpleGit } from 'simple-git';

// ── create_project (manager-only) ───────────────────────────────────

export async function handleCreateProject(
  args: Record<string, unknown>,
  _callerAgentId: string,
  _simNow: () => Date,
): Promise<CallToolResult> {
  const name = args.name as string;
  const description = args.description as string;
  const repoPath = args.repo_path as string;

  if (!name) return error('name is required');
  if (!description) return error('description is required');
  if (!repoPath) return error('repo_path is required');

  // Validate absolute path
  if (!path.isAbsolute(repoPath)) {
    return error('repo_path must be an absolute path');
  }

  // Check if path already exists
  if (fs.existsSync(repoPath)) {
    return error(`Path "${repoPath}" already exists`);
  }

  const db = getDb();

  // Check for duplicate project name
  const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name);
  if (existing) {
    return error(`Project "${name}" already exists`);
  }

  // Create directory and init git repo
  fs.mkdirSync(repoPath, { recursive: true });
  const git = simpleGit(repoPath);
  await git.init();
  await git.checkoutLocalBranch('main');

  // Create an initial empty commit so the branch exists
  await git.raw(['commit', '--allow-empty', '-m', 'Initial commit']);

  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, description, repo_path, default_branch, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'main', ?, ?)`,
  ).run(projectId, name, description, repoPath, now, now);

  console.log(`[create_project] "${name}" (${projectId}) at ${repoPath}`);

  return ok({
    project_id: projectId,
    name,
    repo_path: repoPath,
    default_branch: 'main',
    message: `Project "${name}" created with Git repo at ${repoPath}.`,
  });
}

// ── delete_project (manager-only) ───────────────────────────────────

export async function handleDeleteProject(
  args: Record<string, unknown>,
  _callerAgentId: string,
  _simNow: () => Date,
): Promise<CallToolResult> {
  const projectId = args.project_id as string;
  if (!projectId) return error('project_id is required');

  const db = getDb();

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | { id: string; name: string; repo_path: string }
    | undefined;

  if (!project) return error(`Project "${projectId}" not found`);

  // Remove DB records (blockers, tasks, PRs, worktrees, team refs, then project)
  const deleteTx = db.transaction(() => {
    // Delete blockers referencing tasks in this project
    db.prepare(
      'DELETE FROM blockers WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)',
    ).run(projectId);
    db.prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM pull_requests WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM worktrees WHERE project_id = ?').run(projectId);
    db.prepare('UPDATE teams SET project_id = NULL WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  });

  deleteTx();

  console.log(`[delete_project] Deleted "${project.name}" (${projectId})`);

  return ok({
    project_id: projectId,
    name: project.name,
    message: `Project "${project.name}" deleted. Git repo at ${project.repo_path} was NOT removed from disk.`,
  });
}

// ── assign_team_to_project (manager-only) ───────────────────────────

export async function handleAssignTeamToProject(
  args: Record<string, unknown>,
  _callerAgentId: string,
  _simNow: () => Date,
): Promise<CallToolResult> {
  const teamId = args.team_id as string;
  const projectId = args.project_id as string;

  if (!teamId) return error('team_id is required');
  if (!projectId) return error('project_id is required');

  const db = getDb();

  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId) as
    | { id: string; name: string }
    | undefined;
  if (!team) return error(`Team "${teamId}" not found`);

  const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as
    | { id: string; name: string }
    | undefined;
  if (!project) return error(`Project "${projectId}" not found`);

  db.prepare('UPDATE teams SET project_id = ? WHERE id = ?').run(projectId, teamId);

  console.log(`[assign_team_to_project] Team "${team.name}" assigned to project "${project.name}"`);

  return ok({
    team_id: teamId,
    project_id: projectId,
    message: `Team "${team.name}" assigned to project "${project.name}".`,
  });
}

// ── create_worktree (manager-only) ──────────────────────────────────

export async function handleCreateWorktree(
  args: Record<string, unknown>,
  _callerAgentId: string,
  _simNow: () => Date,
): Promise<CallToolResult> {
  const projectId = args.project_id as string;
  const teamId = args.team_id as string;
  const branchName = args.branch_name as string;

  if (!projectId) return error('project_id is required');
  if (!teamId) return error('team_id is required');
  if (!branchName) return error('branch_name is required');

  const db = getDb();

  const project = db
    .prepare('SELECT id, name, repo_path FROM projects WHERE id = ?')
    .get(projectId) as { id: string; name: string; repo_path: string } | undefined;

  if (!project) return error(`Project "${projectId}" not found`);

  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId) as
    | { id: string; name: string }
    | undefined;
  if (!team) return error(`Team "${teamId}" not found`);

  // Worktree path: inside the project repo parent dir, named project-branch
  const safeBranch = branchName.replace(/\//g, '-');
  const worktreeDir = `${path.basename(project.repo_path)}-wt-${safeBranch}`;
  const worktreePath = path.join(path.dirname(project.repo_path), worktreeDir);

  if (fs.existsSync(worktreePath)) {
    return error(`Worktree path "${worktreePath}" already exists`);
  }

  // Create worktree with new branch
  const git = simpleGit(project.repo_path);
  await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);

  const worktreeId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO worktrees (id, project_id, team_id, branch_name, worktree_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(worktreeId, projectId, teamId, branchName, worktreePath, now);

  console.log(`[create_worktree] "${branchName}" for team "${team.name}" at ${worktreePath}`);

  return ok({
    worktree_id: worktreeId,
    branch_name: branchName,
    worktree_path: worktreePath,
    project: project.name,
    team: team.name,
    message: `Worktree created on branch "${branchName}" at ${worktreePath}.`,
  });
}

// ── commit_work (non-manager) ───────────────────────────────────────

export async function handleCommitWork(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const message = args.message as string;
  const worktreeId = args.worktree_id as string;

  if (!message) return error('message is required');
  if (!worktreeId) return error('worktree_id is required');

  const db = getDb();

  const worktree = db
    .prepare(
      `SELECT w.*, p.name as project_name FROM worktrees w
       JOIN projects p ON w.project_id = p.id
       WHERE w.id = ?`,
    )
    .get(worktreeId) as
    | {
        id: string;
        project_id: string;
        branch_name: string;
        worktree_path: string;
        project_name: string;
      }
    | undefined;

  if (!worktree) return error(`Worktree "${worktreeId}" not found`);

  const simTime = simNow().toISOString();

  // Record the commit in chat_logs as a system event for visibility
  db.prepare(
    `INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at)
     VALUES (?, ?, ?, 'system', ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    callerAgentId,
    callerAgentId,
    `Committed to ${worktree.branch_name}: ${message}`,
    simTime,
    new Date().toISOString(),
  );

  console.log(
    `[commit_work] ${callerAgentId} committed to ${worktree.branch_name}: "${message.slice(0, 60)}"`,
  );

  return ok({
    worktree_id: worktreeId,
    branch_name: worktree.branch_name,
    project: worktree.project_name,
    commit_message: message,
    sim_time: simTime,
    message: `Commit recorded on branch "${worktree.branch_name}".`,
  });
}

// ── open_pull_request (non-manager) ─────────────────────────────────

export async function handleOpenPullRequest(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const title = args.title as string;
  const description = args.description as string;
  const sourceBranch = args.source_branch as string;
  const targetBranch = args.target_branch as string;
  const worktreeId = args.worktree_id as string;

  if (!title) return error('title is required');
  if (!description) return error('description is required');
  if (!sourceBranch) return error('source_branch is required');
  if (!targetBranch) return error('target_branch is required');
  if (!worktreeId) return error('worktree_id is required');

  const db = getDb();

  const worktree = db
    .prepare('SELECT id, project_id FROM worktrees WHERE id = ?')
    .get(worktreeId) as { id: string; project_id: string } | undefined;

  if (!worktree) return error(`Worktree "${worktreeId}" not found`);

  const prId = crypto.randomUUID();
  const now = new Date().toISOString();
  const simTime = simNow().toISOString();

  db.prepare(
    `INSERT INTO pull_requests (id, project_id, worktree_id, agent_id, title, description, source_branch, target_branch, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(
    prId,
    worktree.project_id,
    worktreeId,
    callerAgentId,
    title,
    description,
    sourceBranch,
    targetBranch,
    now,
  );

  console.log(`[open_pull_request] ${callerAgentId} opened PR "${title}" (${prId})`);

  return ok({
    pull_request_id: prId,
    title,
    source_branch: sourceBranch,
    target_branch: targetBranch,
    status: 'open',
    sim_time: simTime,
    message: `Pull request "${title}" opened. Awaiting review from your Team Manager.`,
  });
}

// ── review_pull_request (manager-only) ──────────────────────────────

export async function handleReviewPullRequest(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const prId = args.pull_request_id as string;
  const decision = args.decision as string;
  const comments = (args.comments as string) || null;

  if (!prId) return error('pull_request_id is required');
  if (!decision || (decision !== 'approved' && decision !== 'rejected')) {
    return error('decision must be "approved" or "rejected"');
  }

  const db = getDb();

  const pr = db.prepare('SELECT * FROM pull_requests WHERE id = ?').get(prId) as
    | { id: string; title: string; status: string; agent_id: string }
    | undefined;

  if (!pr) return error(`Pull request "${prId}" not found`);

  if (pr.status !== 'open') {
    return error(`PR "${pr.title}" is ${pr.status}, not open. Cannot review.`);
  }

  // Hard constraint 7: author cannot review their own PR
  if (pr.agent_id === callerAgentId) {
    return error('You cannot review your own pull request.');
  }

  const simTime = simNow().toISOString();

  db.prepare(
    `UPDATE pull_requests SET status = ?, reviewer_id = ?, reviewed_at = ?
     WHERE id = ?`,
  ).run(decision, callerAgentId, simTime, prId);

  console.log(`[review_pull_request] PR "${pr.title}" ${decision} by ${callerAgentId}`);

  return ok({
    pull_request_id: prId,
    title: pr.title,
    decision,
    comments,
    sim_time: simTime,
    message: `Pull request "${pr.title}" has been ${decision}.`,
  });
}

// ── merge_pull_request (manager-only) ───────────────────────────────

export async function handleMergePullRequest(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const prId = args.pull_request_id as string;
  if (!prId) return error('pull_request_id is required');

  const db = getDb();

  const pr = db
    .prepare(
      `SELECT pr.*, p.repo_path FROM pull_requests pr
       JOIN projects p ON pr.project_id = p.id
       WHERE pr.id = ?`,
    )
    .get(prId) as
    | {
        id: string;
        title: string;
        status: string;
        agent_id: string;
        source_branch: string;
        target_branch: string;
        repo_path: string;
      }
    | undefined;

  if (!pr) return error(`Pull request "${prId}" not found`);

  if (pr.status !== 'approved') {
    return error(`PR "${pr.title}" is ${pr.status}. Only approved PRs can be merged.`);
  }

  // Hard constraint 7: author cannot merge their own PR
  if (pr.agent_id === callerAgentId) {
    return error('You cannot merge your own pull request.');
  }

  // Perform the git merge
  const git = simpleGit(pr.repo_path);
  try {
    await git.checkout(pr.target_branch);
    await git.merge([pr.source_branch]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Git merge failed';
    return error(`Merge failed: ${msg}`);
  }

  const simTime = simNow().toISOString();

  db.prepare(`UPDATE pull_requests SET status = 'merged', merged_at = ? WHERE id = ?`).run(
    simTime,
    prId,
  );

  console.log(
    `[merge_pull_request] PR "${pr.title}" merged ${pr.source_branch} → ${pr.target_branch}`,
  );

  return ok({
    pull_request_id: prId,
    title: pr.title,
    source_branch: pr.source_branch,
    target_branch: pr.target_branch,
    status: 'merged',
    sim_time: simTime,
    message: `Pull request "${pr.title}" merged into ${pr.target_branch}.`,
  });
}

// ── REST helpers ────────────────────────────────────────────────────

export function getProjects(): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM teams t WHERE t.project_id = p.id) as team_count,
              (SELECT COUNT(*) FROM pull_requests pr WHERE pr.project_id = p.id) as pr_count
       FROM projects p
       ORDER BY p.created_at DESC`,
    )
    .all();
}

export function getProject(projectId: string): unknown | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM teams t WHERE t.project_id = p.id) as team_count
       FROM projects p
       WHERE p.id = ?`,
    )
    .get(projectId);
}

export function getProjectPRs(projectId: string): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT pr.*, a.name as author_name, r.name as reviewer_name
       FROM pull_requests pr
       LEFT JOIN agents a ON pr.agent_id = a.id
       LEFT JOIN agents r ON pr.reviewer_id = r.id
       WHERE pr.project_id = ?
       ORDER BY pr.created_at DESC`,
    )
    .all(projectId);
}

export async function getPRDetails(
  prId: string,
): Promise<{ pr: unknown; diff: string | null } | undefined> {
  const db = getDb();

  const pr = db
    .prepare(
      `SELECT pr.*, a.name as author_name, r.name as reviewer_name,
              p.repo_path, p.name as project_name
       FROM pull_requests pr
       LEFT JOIN agents a ON pr.agent_id = a.id
       LEFT JOIN agents r ON pr.reviewer_id = r.id
       JOIN projects p ON pr.project_id = p.id
       WHERE pr.id = ?`,
    )
    .get(prId) as
    | {
        repo_path: string;
        source_branch: string;
        target_branch: string;
        [key: string]: unknown;
      }
    | undefined;

  if (!pr) return undefined;

  // Generate diff between target and source branches
  let diff: string | null = null;
  try {
    const git = simpleGit(pr.repo_path as string);
    diff = await git.diff([`${pr.target_branch}...${pr.source_branch}`]);
  } catch {
    // Diff may fail if branches don't exist yet or repo is empty
    diff = null;
  }

  return { pr, diff };
}

export function getWorktrees(projectId?: string): unknown[] {
  const db = getDb();
  if (projectId) {
    return db
      .prepare(
        `SELECT w.*, t.name as team_name, p.name as project_name
         FROM worktrees w
         LEFT JOIN teams t ON w.team_id = t.id
         LEFT JOIN projects p ON w.project_id = p.id
         WHERE w.project_id = ?`,
      )
      .all(projectId);
  }
  return db
    .prepare(
      `SELECT w.*, t.name as team_name, p.name as project_name
       FROM worktrees w
       LEFT JOIN teams t ON w.team_id = t.id
       LEFT JOIN projects p ON w.project_id = p.id`,
    )
    .all();
}

export async function getWorktreeDiff(
  worktreeId: string,
): Promise<{ diff: string; branch: string } | undefined> {
  const db = getDb();
  const worktree = db
    .prepare(
      `SELECT w.*, p.repo_path, p.default_branch
       FROM worktrees w JOIN projects p ON w.project_id = p.id
       WHERE w.id = ?`,
    )
    .get(worktreeId) as
    | { worktree_path: string; branch_name: string; repo_path: string; default_branch: string }
    | undefined;

  if (!worktree) return undefined;

  try {
    const git = simpleGit(worktree.worktree_path);
    const diff = await git.diff([`${worktree.default_branch}...${worktree.branch_name}`]);
    return { diff, branch: worktree.branch_name };
  } catch {
    return { diff: '', branch: worktree.branch_name };
  }
}

export async function getWorktreeCommits(
  worktreeId: string,
  limit = 30,
): Promise<
  | {
      commits: Array<{ hash: string; message: string; author: string; date: string }>;
      branch: string;
    }
  | undefined
> {
  const db = getDb();
  const worktree = db
    .prepare(
      `SELECT w.*, p.repo_path, p.default_branch
       FROM worktrees w JOIN projects p ON w.project_id = p.id
       WHERE w.id = ?`,
    )
    .get(worktreeId) as
    | { worktree_path: string; branch_name: string; repo_path: string; default_branch: string }
    | undefined;

  if (!worktree) return undefined;

  try {
    const git = simpleGit(worktree.worktree_path);
    const log = await git.log({ maxCount: limit });
    const commits = log.all.map((c) => ({
      hash: c.hash.slice(0, 8),
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
    return { commits, branch: worktree.branch_name };
  } catch {
    return { commits: [], branch: worktree.branch_name };
  }
}

// ── Internal helpers ───────────────────────────────────────────────

function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

function error(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
  };
}
