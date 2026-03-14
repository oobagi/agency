import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Set DB path BEFORE any other imports (ESM hoists imports, so we use dynamic import)
const testId = crypto.randomUUID().slice(0, 8);
process.env.AGENCY_DB_PATH = path.join(os.tmpdir(), `agency-test-${testId}.db`);

await import('./integration.js');
