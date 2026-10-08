const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { default: pngToIco } = await import('png-to-ico');
  const assets = path.join(__dirname, '..', 'assets');
  const icon = await pngToIco(path.join(assets, 'icon.png'));
  fs.writeFileSync(path.join(assets, 'icon.ico'), icon);
  console.log('Created multi-resolution Windows icon.');
})().catch(error => { console.error(error); process.exitCode = 1; });
