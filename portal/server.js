import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const PORT = process.env.PORT || 3000;
const MB_PORT = process.env.MEETING_BOARD_PORT || '8081';
const PB_PORT = process.env.PROJECT_BOARD_PORT || '8088';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const html = template.replace('__MB_PORT__', MB_PORT).replace('__PB_PORT__', PB_PORT);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(PORT, () => {
  console.log(`Portal on port ${PORT} → messages :${MB_PORT}, board :${PB_PORT}`);
});
