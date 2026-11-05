import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectProject, applyScaffold, summarize, receiptOf, SCAFFOLD, DEFAULT_TEMPLATES_DIR } from './start-project.mjs';

const tempProject = () => fs.mkdtempSync(path.join(os.tmpdir(), 'start-project-'));
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text, 'utf8');
};

test('an empty folder is detected as empty and every scaffold file is missing', () => {
  const root = tempProject();
  try {
    const state = inspectProject(root);
    assert.equal(state.state, 'empty');
    assert.equal(state.missing.length, SCAFFOLD.length);
    assert.equal(state.present.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a folder with code but no harness files is detected as existing; a README alone does not count', () => {
  const root = tempProject();
  try {
    write(root, 'README.md', '# hi');
    assert.equal(inspectProject(root).state, 'empty');
    write(root, 'package.json', '{}');
    assert.equal(inspectProject(root).state, 'existing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a partly set-up project is detected as partial, and a fully set-up one as complete', () => {
  const root = tempProject();
  try {
    write(root, '.spec/PROGRESS.md', 'my queue');
    const partial = inspectProject(root);
    assert.equal(partial.state, 'partial');
    assert.ok(partial.present.some((f) => f.dest === '.spec/PROGRESS.md'));
    assert.ok(!partial.missing.some((f) => f.dest === '.spec/PROGRESS.md'));

    applyScaffold(root);
    assert.equal(inspectProject(root).state, 'complete');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('apply writes only missing files and never overwrites an existing one', () => {
  const root = tempProject();
  try {
    const sentinels = {
      '.spec/PROGRESS.md': 'OWNER QUEUE — do not touch',
      '.spec/SYSTEM_SPEC.md': 'OWNER SPEC — do not touch',
      '.spec/DECISIONS.md': 'OWNER DECISIONS — do not touch',
    };
    for (const [rel, text] of Object.entries(sentinels)) write(root, rel, text);

    const first = applyScaffold(root);
    assert.deepEqual(
      first.skipped.sort(),
      Object.keys(sentinels).sort(),
    );
    assert.equal(first.created.length, SCAFFOLD.length - 3);
    for (const [rel, text] of Object.entries(sentinels)) {
      assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, `${rel} was overwritten`);
    }
    assert.ok(fs.existsSync(path.join(root, '.spec/OVERVIEW.md')));
    assert.ok(fs.existsSync(path.join(root, '.spec/harness.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('apply is idempotent: a second run creates nothing and changes nothing', () => {
  const root = tempProject();
  try {
    applyScaffold(root);
    const snapshot = fs.readFileSync(path.join(root, '.spec/PROGRESS.md'), 'utf8');
    const second = applyScaffold(root);
    assert.deepEqual(second.created, []);
    assert.equal(second.skipped.length, SCAFFOLD.length);
    assert.equal(fs.readFileSync(path.join(root, '.spec/PROGRESS.md'), 'utf8'), snapshot);
    assert.equal(receiptOf(second), `✓ No new files were needed. Left ${SCAFFOLD.length} existing file(s) untouched.`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('apply refuses to run when the spoke templates are missing, and writes nothing', () => {
  const root = tempProject();
  const emptyTemplates = fs.mkdtempSync(path.join(os.tmpdir(), 'no-templates-'));
  try {
    assert.throws(() => applyScaffold(root, { templatesDir: emptyTemplates }), /Missing spoke templates/);
    assert.equal(fs.existsSync(path.join(root, '.spec')), false);
    const lines = summarize(inspectProject(root, { templatesDir: emptyTemplates }));
    assert.match(lines[1], /Cannot write yet/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(emptyTemplates, { recursive: true, force: true });
  }
});

test('the summary names files and modes in plain English and never prints file contents', () => {
  const root = tempProject();
  try {
    write(root, '.spec/PROGRESS.md', 'SECRET-LOOKING TEXT');
    write(root, '.spec/harness.json', '{"workMode":"vibe"}');
    const text = summarize(inspectProject(root)).join('\n');
    assert.match(text, /Already in place \(left alone\):\n {2}- \.spec\/PROGRESS\.md/);
    assert.match(text, /Will create \(\d+\):/);
    assert.match(text, /Work mode: Vibe Mode/);
    assert.ok(!text.includes('SECRET-LOOKING TEXT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the default templates ship with every file the scaffold needs', () => {
  for (const f of SCAFFOLD) {
    assert.ok(fs.existsSync(path.join(DEFAULT_TEMPLATES_DIR, f.template)), `missing template ${f.template}`);
  }
});

test('the scaffold sets no default model anywhere', () => {
  for (const f of SCAFFOLD) {
    const body = fs.readFileSync(path.join(DEFAULT_TEMPLATES_DIR, f.template), 'utf8');
    assert.doesNotMatch(body, /"model"\s*:/, `${f.template} sets a model`);
  }
});
