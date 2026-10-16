// The full runtime ZIP can exceed upload limits. This smaller standard ZIP
// contains the single portable launcher, which already bundles that runtime.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { path7za } = require('7zip-bin');
const { version } = require('../package.json');
const architecture = process.argv[2] || 'x64';
if (!['x64', 'arm64'].includes(architecture)) throw new Error('Unsupported architecture.');
const output = path.join(__dirname, '..', 'dist');
const name = `Synced-Metronome-${version}-Windows-${architecture}`;
for (const [suffix, executable] of [['portable', `${name}.exe`], ['Setup', `${name}-Setup.exe`]]) {
  const zip = path.join(output, `${name}-${suffix}.zip`);
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execFileSync(path7za, ['a', '-tzip', '-mx=0', zip, executable], { cwd: output, stdio: 'inherit' });
}
