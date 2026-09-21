import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const examplesRoot = path.join(root, 'examples');
const removedTerms = /\bdefinePlugin\b|\bplugin runtime\b|bindings-(?:loops|model)\b|v0\.(?:1|2|6\.[12])\b/i;
const unsafePatterns = /\bon(?:click|load|error)\s*=|srcdoc\s*=|javascript:|(?:eval|new\s+Function)\s*\(/i;

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(entryPath);
    return entry.name.endsWith('.html') ? [entryPath] : [];
  });
}

function localPath(value, source) {
  if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('http:') ||
      value.startsWith('https:') || value.startsWith('data:') || value.startsWith('mailto:')) {
    return null;
  }
  return path.resolve(path.dirname(source), value.split('#')[0].split('?')[0]);
}

function checkModuleSource(source, sourcePath, errors) {
  const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: source,
    encoding: 'utf8',
  });
  if (syntax.status !== 0) {
    errors.push(`${path.relative(root, sourcePath)}: invalid module syntax\n${syntax.stderr.trim()}`);
  }

  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1] || match[2];
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
    const resolved = specifier.startsWith('/')
      ? path.resolve(root, `.${specifier}`)
      : path.resolve(path.dirname(sourcePath), specifier);
    const candidates = path.extname(resolved)
      ? [resolved]
      : [resolved, `${resolved}.js`, path.join(resolved, 'index.js')];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      errors.push(`${path.relative(root, sourcePath)}: missing import ${specifier}`);
    }
  }
}

const errors = [];
const files = htmlFiles(examplesRoot);
if (files.length === 0) errors.push('examples/: no HTML examples discovered');

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  if (removedTerms.test(html) || unsafePatterns.test(html)) {
    errors.push(`${path.relative(root, file)}: obsolete API/term or unsafe browser pattern`);
  }

  const dom = new JSDOM(html);
  const templates = new Set([...dom.window.document.querySelectorAll('template[id]')].map((el) => el.id));
  for (const templateRef of dom.window.document.querySelectorAll('partial[name]')) {
    const expected = `tpl-${templateRef.getAttribute('name')}`;
    if (!templates.has(expected)) {
      errors.push(`${path.relative(root, file)}: partial "${templateRef.getAttribute('name')}" has no ${expected}`);
    }
  }

  for (const element of dom.window.document.querySelectorAll('[src], [href]')) {
    const target = element.getAttribute('src') || element.getAttribute('href');
    const resolved = localPath(target, file);
    if (resolved && !fs.existsSync(resolved)) {
      errors.push(`${path.relative(root, file)}: missing local reference ${target}`);
    }
  }

  for (const script of dom.window.document.querySelectorAll('script[type="module"]')) {
    const src = script.getAttribute('src');
    if (src) {
      const resolved = localPath(src, file);
      if (!resolved || !fs.existsSync(resolved)) {
        errors.push(`${path.relative(root, file)}: missing module ${src}`);
      } else {
        checkModuleSource(fs.readFileSync(resolved, 'utf8'), resolved, errors);
      }
    } else {
      checkModuleSource(script.textContent, file, errors);
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} HTML examples, local references, templates, and module syntax.`);
}
