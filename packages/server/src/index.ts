import http from 'node:http';
import { initDb, closeDb } from './db.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const db = initDb();
console.log('Database initialized');

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});

server.listen(PORT, () => {
  console.log(`Agency server listening on http://localhost:${PORT}`);
});

function shutdown() {
  console.log('Shutting down...');
  server.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
