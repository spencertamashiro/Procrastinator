// Writes licenses/THIRD_PARTY_NOTICES.txt: the licence text of every package that ends up in the
// built app, found by walking the runtime dependencies of the packages the source imports.
// Electron and Chromium ship their own LICENSE.electron.txt and LICENSES.chromium.html.
//
// Run: node scripts/third-party-notices.cjs   (dist:win and dist:mac run it first)

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ROOTS = ['react', 'react-dom', 'lucide-react', 'ical.js', 'tsdav', '@fontsource-variable/dm-sans', '@fontsource-variable/newsreader'];
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === path.dirname(dir)) throw new Error(`Cannot find ${name} from ${fromDir}`);
  }
}

const seen = new Map();
function visit(name, fromDir) {
  const pkgFile = findPackage(name, fromDir);
  const dir = path.dirname(pkgFile);
  if (seen.has(dir)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  seen.set(dir, { name: pkg.name, version: pkg.version, license: pkg.license ?? '(not stated)', homepage: pkg.homepage ?? pkg.repository?.url ?? '', dir, files });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
  for (const [dep, meta] of Object.entries(pkg.peerDependenciesMeta ?? {})) if (!meta?.optional && pkg.peerDependencies?.[dep]) visit(dep, dir);
}
for (const name of ROOTS) visit(name, root);

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const missing = entries.filter((e) => e.files.length === 0);
if (missing.length) {
  console.error(`No licence file in: ${missing.map((e) => `${e.name}@${e.version}`).join(', ')}`);
  process.exit(1);
}

const sep = '='.repeat(78);
let out = `Procrastinator includes the following third-party software.\n` +
  `Electron and Chromium notices are in LICENSE.electron.txt and LICENSES.chromium.html.\n` +
  `ical.js is used unmodified under MPL-2.0; its source is available at https://github.com/kewisch/ical.js\n\n`;
out += entries.map((e) => `  ${e.name} ${e.version} (${e.license})`).join('\n') + '\n';
for (const e of entries) {
  out += `\n${sep}\n${e.name} ${e.version}\nLicense: ${e.license}\n${e.homepage ? `Source: ${e.homepage}\n` : ''}${sep}\n`;
  for (const f of e.files) out += `\n${fs.readFileSync(path.join(e.dir, f), 'utf8').trim()}\n`;
}

fs.mkdirSync(path.join(root, 'licenses'), { recursive: true });
fs.writeFileSync(path.join(root, 'licenses', 'THIRD_PARTY_NOTICES.txt'), out.replace(/\r\n/g, '\n'));
console.log(`Wrote licenses/THIRD_PARTY_NOTICES.txt for ${entries.length} packages:`);
for (const e of entries) console.log(`  ${e.name}@${e.version}  ${e.license}`);
