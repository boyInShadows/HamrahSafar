'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
let backend;
if (process.env.BACKEND_URL) {
  try {
    backend = new URL(process.env.BACKEND_URL);
    assert(backend.protocol === 'https:' && !backend.username && !backend.password && backend.pathname === '/' && !backend.search && !backend.hash);
  } catch {
    throw new Error('BACKEND_URL must be an HTTPS origin without credentials, a path, query, or fragment.');
  }
} else if (process.env.NETLIFY === 'true') {
  throw new Error('Set BACKEND_URL in Netlify to the HTTPS origin of your running Express backend.');
}

assert.equal(path.dirname(out), root);
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
if (backend) {
  // https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/
  fs.writeFileSync(path.join(out, '_redirects'), `/api/* ${backend.origin}/api/:splat 200\n/uploads/* ${backend.origin}/uploads/:splat 200\n`);
} else {
  console.warn('Static preview only: set BACKEND_URL when building for Netlify to enable the API and uploads.');
}
console.log('Frontend built in dist/.');
