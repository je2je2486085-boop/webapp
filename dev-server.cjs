#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

// 현재 스크립트 디렉토리 기준 (webapp/)
const appDir = __dirname;
const PORT = 8080;

// 간단한 정적 파일 + API 서버
const server = http.createServer((req, res) => {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API 요청 (모두 404로 응답 - 실제 DB 없이 테스트용)
  if (req.url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API 데이터베이스 미연결 - Cloudflare D1 필요' }));
    return;
  }

  // 정적 파일 제공
  let filePath = req.url === '/' ? path.join(appDir, 'public/index.html') : path.join(appDir, 'public' + req.url);
  if (filePath === path.join(appDir, 'public/admin')) filePath = path.join(appDir, 'public/admin.html');

  const ext = path.extname(filePath);
  let contentType = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png'
  }[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // .js, .css 등은 404 반환 (SPA 모드 미적용)
        if (['.js', '.css', '.png', '.jpg', '.json'].includes(ext)) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        // HTML 라우팅은 index.html로 (SPA)
        fs.readFile(path.join(appDir, 'public/index.html'), (err2, content2) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content2);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
✅ 로컬 테스트 서버 시작
🌐 http://localhost:${PORT}

📝 참고:
- 관리자: http://localhost:${PORT}/admin (비밀번호: admin1234)
- 실제 데이터는 저장되지 않습니다 (DB 미연결)
- 배포 전에 Cloudflare D1과 연결해야 합니다
`);
});
