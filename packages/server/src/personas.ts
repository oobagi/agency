import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { getDb } from './db.js';

const execFileAsync = promisify(execFile);

const REPO_URL =
  process.env.AGENCY_AGENTS_REPO ?? 'https://github.com/msitarzewski/agency-agents.git';

const CACHE_DIR = path.join(os.tmpdir(), 'agency-agents-cache');

// Directories in the repo that map to software-dev specialties
const RELEVANT_DIRS = ['engineering', 'testing', 'design', 'product', 'project-management'];

// Keyword → specialty mapping for classifying personas
const SPECIALTY_KEYWORDS: Record<string, string[]> = {
  frontend: ['frontend', 'ui', 'ux', 'css', 'react', 'vue', 'angular', 'web app', 'responsive'],
  backend: ['backend', 'api', 'server', 'database', 'data engineer', 'data-engineer'],
  devops: ['devops', 'sre', 'infrastructure', 'deploy', 'ci/cd', 'security', 'incident'],
  testing: ['test', 'qa', 'quality', 'accessibility-auditor', 'performance-benchmarker'],
  design: ['design', 'brand', 'visual', 'ux-architect', 'ux-researcher', 'image-prompt'],
  architecture: ['architect', 'software-architect', 'system'],
};

// ---------- Frontmatter parser ----------

interface FrontmatterResult {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      meta[key] = value;
    }
  }

  return { meta, body: match[2] };
}

// ---------- Specialty detection ----------

function detectSpecialties(filename: string, description: string, dir: string): string[] {
  const text = `${dir} ${filename} ${description}`.toLowerCase();
  const specialties = new Set<string>();

  for (const [specialty, keywords] of Object.entries(SPECIALTY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        specialties.add(specialty);
        break;
      }
    }
  }

  // Fallback: if nothing matched, infer from directory
  if (specialties.size === 0) {
    if (dir === 'engineering') specialties.add('backend');
    else if (dir === 'testing') specialties.add('testing');
    else if (dir === 'design') specialties.add('design');
    else if (dir === 'product') specialties.add('architecture');
    else if (dir === 'project-management') specialties.add('architecture');
  }

  return [...specialties];
}

// ---------- Git operations ----------

async function cloneOrPullRepo(): Promise<void> {
  if (fs.existsSync(path.join(CACHE_DIR, '.git'))) {
    await execFileAsync('git', ['-C', CACHE_DIR, 'pull', '--ff-only'], {
      timeout: 30_000,
    });
  } else {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    await execFileAsync('git', ['clone', '--depth', '1', REPO_URL, CACHE_DIR], {
      timeout: 60_000,
    });
  }
}

// ---------- Parse persona files ----------

interface ParsedPersona {
  id: string;
  name: string;
  github_username: string;
  bio: string;
  system_prompt: string;
  specialties: string[];
  source_url: string;
}

function parsePersonaFiles(): ParsedPersona[] {
  const personas: ParsedPersona[] = [];

  for (const dir of RELEVANT_DIRS) {
    const dirPath = path.join(CACHE_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
      const { meta, body } = parseFrontmatter(content);

      const name = meta.name || file.replace('.md', '').replace(/-/g, ' ');
      const slug = file.replace('.md', '');
      const description = meta.description || meta.vibe || '';
      const specialties = detectSpecialties(slug, description, dir);

      personas.push({
        id: crypto.createHash('sha256').update(`${dir}/${file}`).digest('hex').slice(0, 16),
        name,
        github_username: slug,
        bio: description,
        system_prompt: body.trim(),
        specialties,
        source_url: `${REPO_URL.replace('.git', '')}/blob/main/${dir}/${file}`,
      });
    }
  }

  return personas;
}

// ---------- Store in database ----------

function storePersonas(personas: ParsedPersona[]): number {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO personas (id, name, github_username, bio, system_prompt, specialties, fetched_at, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      bio = excluded.bio,
      system_prompt = excluded.system_prompt,
      specialties = excluded.specialties,
      fetched_at = excluded.fetched_at,
      source_url = excluded.source_url
  `);

  const now = new Date().toISOString();
  const runAll = db.transaction(() => {
    for (const p of personas) {
      upsert.run(
        p.id,
        p.name,
        p.github_username,
        p.bio,
        p.system_prompt,
        JSON.stringify(p.specialties),
        now,
        p.source_url,
      );
    }
  });

  runAll();
  return personas.length;
}

// ---------- Public API ----------

export async function fetchAndStorePersonas(): Promise<void> {
  try {
    await cloneOrPullRepo();
    const personas = parsePersonaFiles();
    const count = storePersonas(personas);

    const specialtyCounts = new Map<string, number>();
    for (const p of personas) {
      for (const s of p.specialties) {
        specialtyCounts.set(s, (specialtyCounts.get(s) ?? 0) + 1);
      }
    }
    console.log(
      `[personas] Stored ${count} personas. Specialties: ` +
        [...specialtyCounts.entries()].map(([k, v]) => `${k}(${v})`).join(', '),
    );
  } catch (err) {
    // Fall back to previously cached personas in the database
    const db = getDb();
    const { count } = db.prepare('SELECT COUNT(*) as count FROM personas').get() as {
      count: number;
    };
    if (count > 0) {
      console.warn(`[personas] Repo unavailable, using ${count} cached personas from database`);
    } else {
      console.error(
        `[personas] Repo unavailable and no cached personas: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

export function getPersonas(): Record<string, unknown>[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM personas ORDER BY name').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => ({
    ...row,
    specialties: JSON.parse(row.specialties as string),
  }));
}

export async function refreshPersonas(): Promise<{ count: number }> {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
  await cloneOrPullRepo();
  const personas = parsePersonaFiles();
  const count = storePersonas(personas);
  return { count };
}
