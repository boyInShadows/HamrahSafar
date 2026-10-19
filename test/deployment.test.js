'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const build = backend => spawnSync(process.execPath, ['scripts/build.js'], {
  cwd: root,
  env: { ...process.env, NETLIFY: 'true', BACKEND_URL: backend },
  encoding: 'utf8'
});

test('Netlify build requires a safe backend origin and publishes only frontend files', () => {
  for (const invalid of ['', 'http://backend.example', 'https://user:secret@backend.example', 'https://backend.example/api', 'https://backend.example/?token=secret', 'https://backend.example/#fragment']) {
    assert.notEqual(build(invalid).status, 0);
  }
  const result = build('https://backend.example/');
  assert.equal(result.status, 0, result.stderr);
  const out = path.join(root, 'dist');
  assert(fs.existsSync(path.join(out, 'index.html')));
  assert(fs.existsSync(path.join(out, 'admin.html')));
  assert(fs.existsSync(path.join(out, 'office.html')));
  assert(fs.existsSync(path.join(out, 'js', 'app.js')));
  assert.equal(fs.readFileSync(path.join(out, '_redirects'), 'utf8'), '/api/* https://backend.example/api/:splat 200\n/uploads/* https://backend.example/uploads/:splat 200\n');
  for (const privatePath of ['.env', '.env.example', 'server', 'data', 'node_modules', 'AGENTS.md']) {
    assert(!fs.existsSync(path.join(out, privatePath)), privatePath);
  }
});
