'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
let count = 0;
for (const dir of ['server', 'public/js', 'scripts', 'test']) {
  for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, dir, file)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
console.log(`JavaScript syntax checked: ${count} files. This is not TypeScript type checking.`);
