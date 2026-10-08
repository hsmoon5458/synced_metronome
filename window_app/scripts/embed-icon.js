// Edit only the intermediate Windows app binary before packaging. This is
// pure JavaScript, so a Windows icon can be embedded on macOS without Wine.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function embedIcon(context) {
  if (context.electronPlatformName !== 'win32') return;
  const PE = await import('pe-library');
  const ResEdit = await import('resedit');
  const executablePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const exe = PE.NtExecutable.from(fs.readFileSync(executablePath));
  const resources = PE.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw new Error('Windows runtime has no icon group to replace.');
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,
      group.id, group.lang, icon.icons.map(item => item.data));
  }
  const version = context.packager.appInfo.version.split('.').map(Number);
  for (const info of ResEdit.Resource.VersionInfo.fromEntries(resources.entries)) {
    info.setFileVersion(...version, 0, 1033);
    info.setProductVersion(...version, 0, 1033);
    info.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: context.packager.appInfo.productName,
      FileDescription: 'Offline standalone metronome',
      CompanyName: 'Hye Sung Moon',
      OriginalFilename: path.basename(executablePath)
    });
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  fs.writeFileSync(executablePath, Buffer.from(exe.generate()));
  console.log('Embedded metronome icon and app metadata into Windows runtime.');
};
