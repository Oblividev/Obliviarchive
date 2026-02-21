/**
 * VOD Archive - Local server with remote vods.json fetch
 * Serves the page and proxies vods.json from GitHub Pages (always up-to-date)
 */
const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = 3000;
const REMOTE_VODS = 'https://obliviarchive.officiallysp.net/data/vods.json';
const LOCAL_VODS = path.join(__dirname, 'data', 'vods.json');

// Proxy /data/vods.json from remote, fallback to local
app.get('/data/vods.json', async (req, res) => {
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(REMOTE_VODS, (resp) => {
        let body = '';
        resp.on('data', (chunk) => (body += chunk));
        resp.on('end', () => resolve(body));
      }).on('error', reject);
    });
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    console.warn('Remote fetch failed, using local:', err.message);
    try {
      const local = fs.readFileSync(LOCAL_VODS, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(local);
    } catch (e) {
      res.status(500).json({ error: 'Could not load VOD data' });
    }
  }
});

// Serve static files
app.use(express.static(__dirname));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  VOD Archive is running!');
  console.log('');
  console.log('  Open in your browser: ' + url);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');
  require('child_process').exec(`start ${url}`);
});
