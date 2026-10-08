// Resource validation for cross builds; this does not execute Windows code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');

(async () => {
  const PE = await import('pe-library');
  const ResEdit = await import('resedit');
  const root = path.join(__dirname, '..');
  const icoBytes = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
  const icon = ResEdit.Data.IconFile.from(icoBytes);
  const digest = item => createHash('sha256').update(Buffer.from(item.generate())).digest('hex');
  const expected = icon.icons.map(item => digest(item.data)).sort();
  const runtime = path.join(root, 'dist', 'win-unpacked', 'Synced Metronome.exe');
  const launcher = path.join(root, 'dist', `Synced-Metronome-${version}-Windows-x64.exe`);
  for (const file of [runtime, launcher]) {
    console.log(`Checking ${path.basename(file)} icon resources...`);
    const exe = PE.NtExecutable.from(fs.readFileSync(file));
    const resources = PE.NtExecutableResource.from(exe);
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
    assert.ok(groups.length > 0, `No icon groups in ${file}`);
    const items = groups[0].getIconItemsFromEntries(resources.entries);
    assert.equal(items.length, icon.icons.length);
    // NSIS stores sizes in a different order; the image bytes must match.
    assert.deepEqual(items.map(digest).sort(), expected, `Icon mismatch in ${path.basename(file)}`);
  }
  const { extractFile } = await import('@electron/asar');
  assert.deepEqual(extractFile(path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar'),
    'assets/icon.ico'), icoBytes);
  const zip = path.join(root, 'dist', `Synced-Metronome-${version}-Windows-x64-portable.zip`);
  assert.ok(fs.statSync(launcher).size < 104857600, 'EXE exceeds Drive connector upload limit.');
  assert.ok(fs.statSync(zip).size < 104857600, 'Portable ZIP exceeds Drive connector upload limit.');
  console.log('Verified custom icons in app and portable launcher, packaged ICO, and Drive upload sizes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
