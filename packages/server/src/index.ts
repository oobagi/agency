import http from 'node:http';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});

server.listen(PORT, () => {
  console.log(`Agency server listening on http://localhost:${PORT}`);
});
