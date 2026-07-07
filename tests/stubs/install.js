const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(__dirname, 'ubc-genai-toolkit-course-list-sync');
const target = path.join(
  root,
  'node_modules',
  '@ubc',
  'ubc-genai-toolkit-course-list-sync'
);
const targetPackageJson = path.join(target, 'package.json');

if (fs.existsSync(targetPackageJson)) {
  const existing = JSON.parse(fs.readFileSync(targetPackageJson, 'utf8'));
  if (existing.version !== '0.0.0-test') {
    process.exit(0);
  }
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

for (const file of ['package.json', 'index.js']) {
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}
