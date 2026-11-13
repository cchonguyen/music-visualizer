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
