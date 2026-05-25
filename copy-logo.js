// Run once from project root: node copy-logo.js
const fs   = require('fs');
const path = require('path');

const src = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.cursor/projects/e-Mom-s-Belief-Unity-Dashboard/assets',
  'c__Users_Prithivi_AppData_Roaming_Cursor_User_workspaceStorage_' +
  'c41b819f75c179065783bac47f4fb145_images_' +
  'unity_logo-5920753d-3066-4bbe-a1a9-79bf89625a47.png'
);

const dst = path.join(__dirname, 'frontend', 'public', 'logo.png');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log('✓ Logo copied →', dst);
