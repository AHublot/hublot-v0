// Fabrique dist/preview.html (document) et dist/preview-fragment.html (fragment pour artefact) :
// CSS et JS inlinés, sans dépendance (petit assembleur de modules ES).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve('src');
const mods = new Map();
function load(file) {
  if (mods.has(file)) return;
  let src = readFileSync(file, 'utf8');
  const names = [];
  mods.set(file, null);
  src = src.replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';?/gm, (_, what, spec) => {
    const dep = resolve(dirname(file), spec); load(dep);
    const id = JSON.stringify(relative(root, dep));
    if (what.startsWith('* as ')) return `const ${what.slice(5)} = __r(${id});`;
    return `const ${what.replace(/\s+as\s+/g, ': ')} = __r(${id});`;
  });
  src = src.replace(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm, (m, n) => { names.push(n); return m.replace(/^export\s+/, ''); });
  src = src.replace(/^export\s*\{([^}]*)\};?/gm, (_, l) => { l.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => names.push(x)); return ''; });
  mods.set(file, `__d(${JSON.stringify(relative(root, file))}, function(){\n${src}\nreturn {${names.join(',')}};\n});`);
}
load(resolve('src/app.js'));
const js = `(function(){const D={},C={};function __d(i,f){D[i]=f}function __r(i){return C[i]||(C[i]=D[i]())}\n${[...mods.values()].join('\n')}\n__r("app.js");})();`;
const css = readFileSync('styles/app.css', 'utf8');
const idx = readFileSync('index.html', 'utf8');
const body = idx.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/, '');
const safe = js.replace(/<\/script>/g, '<\\/script>');
const fonts = idx.match(/<link rel="stylesheet" href="(https:\/\/fonts[^"]+)">/)[1];
mkdirSync('dist', { recursive: true });
writeFileSync('dist/preview-fragment.html', `<title>Hublot Aperçu</title>\n<link rel="stylesheet" href="${fonts}">\n<style>${css}</style>\n${body}\n<script>${safe}</script>`);
writeFileSync('dist/preview.html', idx.replace(/<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n?/g, '').replace('<link rel="stylesheet" href="styles/app.css">', `<style>${css}</style>`).replace('<script type="module" src="src/app.js"></script>', `<script>${safe}</script>`));
console.log('ok', Math.round(safe.length / 1024), 'Ko JS');
