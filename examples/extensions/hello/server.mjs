// A fake endpoint for the Hello sample extension. Node 18+, no packages.
// Run: node examples/extensions/hello/server.mjs  (port 8787, or PORT=...)
// Then add http://localhost:8787 in Zoggyfin: Settings, Extensions.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const port = Number(process.env.PORT || 8787);
const base = process.env.BASE_URL || `http://localhost:${port}`;
const manifest = JSON.parse(readFileSync(new URL('./zoggyfin-extension.json', import.meta.url), 'utf8'));
manifest.baseUrl = base;
const panel = readFileSync(new URL('./panel.html', import.meta.url), 'utf8');
// A second sample, schema version 2: add http://localhost:8787/pages/zoggyfin-extension.json.
const pagesManifest = JSON.parse(readFileSync(new URL('./pages-extension.json', import.meta.url), 'utf8'));
pagesManifest.baseUrl = base;
// The panel of the "My list" tab: a fake sign-in that the server keeps in memory.
const accountPanel = readFileSync(new URL('./account-panel.html', import.meta.url), 'utf8');
let signedIn = false;

// Library tile art for the pages: a small PNG drawn here (a diagonal colour
// ramp per page), so the repository holds no binary picture.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function rampPng(width, height, from, to) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      for (let i = 0; i < 3; i++) row[1 + x * 3 + i] = Math.round(from[i] + (to[i] - from[i]) * t);
    }
    rows.push(row);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; // bit depth
  head[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const ART = {
  main: rampPng(320, 180, [40, 70, 160], [120, 200, 220]),
  tabs: rampPng(320, 180, [150, 50, 90], [240, 170, 90]),
};
// A 6 s test pattern with a tone (320x180 H.264 and AAC, made with ffmpeg's
// testsrc and sine sources). Every sample entry plays this one file.
const video = readFileSync(new URL('./media/sample.mp4', import.meta.url));
const VIDEO_SECONDS = 6;
// The Save button of the entry pages: the ids the user saved, in memory only.
const saved = new Set();
// The subtitles of the test video (WebVTT), served at /pages/media/sample.en.vtt.
const SUBTITLES = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA test pattern.\n\n00:00:02.000 --> 00:00:04.500\nThe tone keeps playing.\n\n00:00:04.500 --> 00:00:06.000\nThe end.\n';
// The two qualities: the same file under two URLs (a real extension names two encodes).
const QUALITIES = [
  { id: 'high', label: 'High' },
  { id: 'low', label: 'Low' },
];
const fileUrl = (q) => `/pages/media/sample.mp4?q=${q}`;

// Fake catalogue for the page sample: neutral titles, no pictures (the app draws generated art).
const TOPICS = ['Nature', 'Cooking', 'Travel', 'Science', 'Music', 'Craft'];
const samples = Array.from({ length: 95 }, (_, i) => {
  const n = i + 1;
  const minutes = 3 + (n % 40);
  const entry = { id: `s${n}`, title: `Sample clip ${n}`, subtitle: `${minutes} min · ${TOPICS[n % TOPICS.length]}` };
  if (n % 7 === 0) entry.badge = 'New';
  if (n % 5 === 0) entry.progress = (n % 10) / 10 || 0.5;
  // Every entry has media (the one test video). Every third entry also has a
  // detail page: a tap opens it; a tap on any other entry plays at once.
  entry.media = { id: `s${n}`, kind: 'video', duration: VIDEO_SECONDS, playback: `/pages/entries/s${n}/play`, download: `/pages/entries/s${n}/download` };
  if (n % 3 === 0) entry.detail = `/pages/entries/s${n}`;
  return entry;
});

// One page of a list. The cursor is the index of the first entry, as text.
function pageOf(list, url, size) {
  const start = Math.max(0, Number(url.searchParams.get('cursor') || 0) || 0);
  const items = list.slice(start, start + size);
  const next = start + size < list.length ? String(start + size) : null;
  return { items, next };
}

const tasks = new Map(); // id -> { started, title }
let seq = 0;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    // A sample: any origin. A real extension lists the app's web origins.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization, X-Emby-Token, X-Jellyfin-Server-Url, X-Jellyfin-Server-Id, X-Jellyfin-User-Id',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// The detail description of a sample entry.
function detailOf(e) {
  const d = {
    title: e.title,
    eyebrow: 'Hello Pages',
    // A 16:9 picture: the app shows it whole (a video entry is a `thumb` unless the detail says otherwise).
    image: '/pages/art/main.png',
    lines: [e.subtitle],
    description: 'A sample entry from the Hello Pages extension. Play shows a short test pattern. Save is an on/off button that the sample server remembers until it stops.',
    media: e.media,
    actions: [
      {
        id: 'save',
        title: 'Save',
        icon: 'heart',
        state: { on: saved.has(e.id), onTitle: 'Saved', onIcon: 'heart.fill' },
        request: { method: 'POST', path: `/pages/entries/${e.id}/save`, body: { on: '{{action.next}}' } },
      },
    ],
    sections: [{ id: 'related', title: 'Related', layout: 'row', shape: 'thumb', feed: `/pages/entries/${e.id}/related` }],
  };
  if (e.progress !== undefined) d.progress = e.progress;
  return d;
}

// The stream description of a sample entry: every schema version 2 field.
function streamOf(e) {
  const i = samples.indexOf(e);
  const next = samples[(i + 1) % samples.length];
  return {
    stream: { url: fileUrl('high'), type: 'file' },
    qualities: QUALITIES.map((q) => ({ ...q, url: fileUrl(q.id) })),
    title: e.title,
    subtitle: 'Hello Pages',
    duration: VIDEO_SECONDS,
    subtitles: [{ id: 'en', label: 'English', language: 'en', url: '/pages/media/sample.en.vtt' }],
    // Labels from `skipLabels` in the manifest: the user picks auto, ask or off per label.
    segments: [
      { label: 'intro', start: 0, end: 1.5 },
      { label: 'credits', start: 4.5, end: VIDEO_SECONDS },
    ],
    chapters: [
      { title: 'Opening', start: 0 },
      { title: 'Middle', start: 3 },
    ],
    next: { id: next.id, title: next.title, subtitle: next.subtitle, media: next.media },
    report: { path: `/pages/entries/${e.id}/report`, intervalSeconds: 10 },
  };
}

// The download description: first two choices, then the file of the chosen one.
function downloadOf(e, option) {
  const q = QUALITIES.find((x) => x.id === option);
  if (!q) return { options: QUALITIES.map((x) => ({ id: x.id, label: `${x.label} (test pattern)`, download: `/pages/entries/${e.id}/download?option=${x.id}` })) };
  return {
    url: fileUrl(q.id),
    bytes: video.length,
    container: 'mp4',
    label: q.label,
    subtitles: [{ label: 'English', language: 'en', url: '/pages/media/sample.en.vtt' }],
  };
}

// The test video, with byte ranges (AVPlayer and browsers ask for ranges).
function sendVideo(req, res) {
  const head = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!m) {
    res.writeHead(200, { ...head, 'Content-Length': video.length });
    return res.end(req.method === 'HEAD' ? undefined : video);
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, video.length - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), video.length - 1) : video.length - 1;
  if (start > end || start >= video.length) {
    res.writeHead(416, { ...head, 'Content-Range': `bytes */${video.length}` });
    return res.end();
  }
  res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${video.length}` });
  res.end(req.method === 'HEAD' ? undefined : video.subarray(start, end + 1));
}

createServer(async (req, res) => {
  const url = new URL(req.url, base);
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  if (url.pathname === '/zoggyfin-extension.json') return send(res, 200, manifest);
  if (url.pathname === '/moods') return send(res, 200, { options: [{ value: 'happy', label: 'Happy' }, { value: 'calm', label: 'Calm' }] });
  if (url.pathname === '/greet' && req.method === 'POST') {
    const b = await readBody(req);
    const id = String(++seq);
    tasks.set(id, { started: Date.now(), title: `${b.greeting || 'Hello'} ${b.name || 'item'}` });
    return send(res, 200, { toast: `${b.greeting || 'Hello'}, ${b.user || 'friend'}! (${b.mood})`, task: { id, title: `Counting for ${b.name}`, statusUrl: `/tasks/${id}`, intervalSeconds: 1 } });
  }
  const t = /^\/tasks\/(\d+)$/.exec(url.pathname);
  if (t) {
    const task = tasks.get(t[1]);
    if (!task) return send(res, 404, { error: 'No such task' });
    const p = Math.min(1, (Date.now() - task.started) / 10000);
    return send(res, 200, p < 1 ? { state: 'running', progress: p } : { state: 'done', toast: `${task.title}: done`, refresh: 'none' });
  }
  if (url.pathname === '/share' && req.method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, { toast: `Hello got ${b.url}` });
  }
  if (url.pathname === '/feed') {
    return send(res, 200, {
      items: [
        { id: 'a', title: 'First card', subtitle: 'A plain card', progress: 0.3 },
        { id: 'b', title: 'Open the page', subtitle: 'Opens the panel', panel: 'main' },
        { id: 'c', title: 'A link', subtitle: 'Opens the browser', link: 'https://jellyfin.org' },
      ],
    });
  }
  if (url.pathname === '/panel') return send(res, 200, panel, 'text/html; charset=utf-8');
  // Schema version 2 page sample.
  if (url.pathname === '/pages/zoggyfin-extension.json') return send(res, 200, pagesManifest);
  if (url.pathname === '/pages/latest') return send(res, 200, { items: samples.slice(0, 12), next: null });
  if (url.pathname === '/pages/queue') return send(res, 200, pageOf(samples.filter((e) => e.progress !== undefined), url, 5));
  if (url.pathname === '/pages/all') return send(res, 200, pageOf(samples, url, 20));
  // The "My list" tab: empty with a message and a Sign in button until the panel signs in.
  if (url.pathname === '/pages/account') return send(res, 200, accountPanel, 'text/html; charset=utf-8');
  if (url.pathname === '/pages/account/state') {
    if (req.method === 'POST') signedIn = (await readBody(req)).signedIn === true;
    return send(res, 200, { signedIn });
  }
  const mine = () => samples.filter((e) => saved.has(e.id) || Number(e.id.slice(1)) % 10 === 0);
  if (url.pathname === '/pages/mine') {
    if (!signedIn) return send(res, 200, { items: [], message: 'Sign in to see your list.', action: { title: 'Sign in', panel: 'account' } });
    return send(res, 200, pageOf(mine(), url, 20));
  }
  if (url.pathname === '/pages/mine/search') {
    const q = (url.searchParams.get('query') || '').trim().toLowerCase();
    return send(res, 200, pageOf(signedIn && q ? mine().filter((e) => e.title.toLowerCase().includes(q)) : [], url, 20));
  }
  if (url.pathname === '/pages/search') {
    const q = (url.searchParams.get('query') || '').trim().toLowerCase();
    const found = q ? samples.filter((e) => `${e.title} ${e.subtitle}`.toLowerCase().includes(q)) : [];
    return send(res, 200, pageOf(found, url, 20));
  }
  // Entry pages, their buttons and related rows, stream and download descriptions.
  const route = /^\/pages\/entries\/(s\d+)(?:\/(play|download|save|related|report))?$/.exec(url.pathname);
  if (route) {
    const [, id, part] = route;
    const e = samples.find((x) => x.id === id);
    if (!e) return send(res, 404, { error: 'No such entry' });
    if (!part) return send(res, 200, detailOf(e));
    if (part === 'play') return send(res, 200, streamOf(e));
    if (part === 'download') return send(res, 200, downloadOf(e, url.searchParams.get('option')));
    if (part === 'report' && req.method === 'POST') {
      // Progress reports: start, progress, pause, resume, seek, stop, finished.
      const b = await readBody(req);
      console.log(`report ${id}: ${b.event} at ${b.position} s${b.quality ? ` (${b.quality})` : ''}${b.offline ? ' (offline)' : ''}`);
      return send(res, 204, '', 'text/plain');
    }
    if (part === 'related') {
      const i = samples.indexOf(e);
      return send(res, 200, { items: [...samples.slice(i + 1), ...samples.slice(0, i)].slice(0, 8), next: null });
    }
    if (part === 'save' && req.method === 'POST') {
      const b = await readBody(req);
      // {{action.next}} arrives as a JSON boolean.
      if (typeof b.on !== 'boolean') return send(res, 400, { error: 'on must be true or false' });
      if (b.on) saved.add(id);
      else saved.delete(id);
      return send(res, 200, { toast: b.on ? `${e.title} is saved` : `${e.title} is no longer saved`, state: { on: b.on } });
    }
  }
  const art = /^\/pages\/art\/(\w+)\.png$/.exec(url.pathname);
  if (art && ART[art[1]]) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600' });
    return res.end(ART[art[1]]);
  }
  if (url.pathname === '/pages/media/sample.mp4') return sendVideo(req, res);
  if (url.pathname === '/pages/media/sample.en.vtt') return send(res, 200, SUBTITLES, 'text/vtt; charset=utf-8');
  send(res, 404, { error: 'Not found' });
}).listen(port, () => console.log(`Hello extension on ${base}`));
