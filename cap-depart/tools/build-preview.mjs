// Fabrique dist/preview.html : un seul fichier (CSS + JS inlinés) pour une prévisualisation.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const js = (await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', write: false })).outputFiles[0].text;
const css = readFileSync('styles/app.css', 'utf8');
let html = readFileSync('index.html', 'utf8')
  .replace(/<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n?/g, '')
  .replace('<link rel="stylesheet" href="styles/app.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="src/app.js"></script>', `<script>${js.replace(/<\/script>/g, '<\\/script>')}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/preview.html', html);
console.log('dist/preview.html', Math.round(html.length / 1024), 'Ko');
