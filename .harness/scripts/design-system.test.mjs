import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dir = new URL('../design-system/', import.meta.url);
const bundle = readFileSync(new URL('bundle.css', dir), 'utf8');
const tokens = readFileSync(new URL('tokens.css', dir), 'utf8');

const rule = (sel) => {
  const re = new RegExp('(^|\\n|\\})' + sel.replace(/[.[\]]/g, '\\$&') + '\\{([^}]*)\\}');
  return bundle.match(re)?.[2] ?? '';
};

test('button, input, select and textarea share one control height and text size', () => {
  const btn = rule('.ui-btn');
  const field = rule('.ui-input,.ui-textarea,.ui-select');
  assert.match(btn, /min-height:var\(--control-h\)/);
  assert.match(field, /min-height:var\(--control-h\)/);
  assert.match(field, /font:400 var\(--control-fs\)/);
});

test('no control selector sets its own desktop height outside the shared tokens', () => {
  const desktop = bundle.slice(bundle.indexOf('@media (min-width:640px)'));
  const block = desktop.slice(0, desktop.indexOf('\n}\n'));
  for (const sel of ['.ui-btn', '.ui-input', '.ui-select', '.ui-textarea']) {
    const bare = new RegExp('(^|[\\s,])' + sel.replace('.', '\\.') + '(,|\\{)[^}]*min-height:');
    assert.doesNotMatch(block.replace(/\.ui-table [^{]*\{[^}]*\}/g, ''), bare, sel + ' must not set its own desktop height');
  }
});

test('tokens define the control sizes per breakpoint', () => {
  assert.match(tokens, /--control-h: var\(--touch-phone\)/);
  assert.match(tokens, /--control-fs: 16px/);
  assert.match(tokens, /@media \(min-width: 640px\)[\s\S]*--control-h: var\(--touch-desktop\)[\s\S]*--control-fs: 14px/);
  assert.match(tokens, /--control-h-compact: 32px/);
});

test('table cells get a compact density and paired fields stay inline', () => {
  assert.match(bundle, /\.ui-table \.ui-select[^{]*\{min-height:var\(--control-h-compact\)/);
  assert.match(bundle, /\.ui-control-pair\{display:flex;flex-wrap:nowrap/);
});

test('tokens.css uses [data-theme="light"] without :root prefix and does not redeclare --accent in light theme', () => {
  assert.doesNotMatch(tokens, /:root\[data-theme="light"\]/, 'must not use :root[data-theme="light"]');
  assert.match(tokens, /\[data-theme="light"\]\s*\{/, 'must use [data-theme="light"]');
  const lightBlockMatch = tokens.match(/\[data-theme="light"\]\s*\{([^}]*)\}/);
  assert.ok(lightBlockMatch, '[data-theme="light"] block must exist');
  const lightBlock = lightBlockMatch[1];
  assert.doesNotMatch(lightBlock, /--accent:\s*var\(--neon-violet\);/, 'must not redeclare --accent in [data-theme="light"]');
  assert.doesNotMatch(lightBlock, /--focus:\s*var\(--accent\);/, 'must not redeclare --focus in [data-theme="light"]');
});

test('bundle.css defines light-mode --glow-accent without 24px blur for non-violet accents', () => {
  assert.match(bundle, /@media\s*\(prefers-color-scheme:\s*light\)[\s\S]*?:root:not\(\[data-theme="dark"\]\)\[data-accent\]:not\(\[data-accent="violet"\]\)\s*\{[^}]*--glow-accent:\s*0 0 0 1px color-mix\(in oklch,\s*var\(--accent\)\s*35%,\s*transparent\);?[^}]*\}/);
  assert.match(bundle, /\[data-theme="light"\]\[data-accent\]:not\(\[data-accent="violet"\]\)\s*\{[^}]*--glow-accent:\s*0 0 0 1px color-mix\(in oklch,\s*var\(--accent\)\s*35%,\s*transparent\);?[^}]*\}/);

  const lightMediaMatch = bundle.match(/:root:not\(\[data-theme="dark"\]\)\[data-accent\]:not\(\[data-accent="violet"\]\)\s*\{([^}]*)\}/);
  assert.ok(lightMediaMatch);
  assert.doesNotMatch(lightMediaMatch[1], /24px/, 'light media --glow-accent must not have 24px blur');

  const lightAttrMatch = bundle.match(/\[data-theme="light"\]\[data-accent\]:not\(\[data-accent="violet"\]\)\s*\{([^}]*)\}/);
  assert.ok(lightAttrMatch);
  assert.doesNotMatch(lightAttrMatch[1], /24px/, 'data-theme=light --glow-accent must not have 24px blur');
});
