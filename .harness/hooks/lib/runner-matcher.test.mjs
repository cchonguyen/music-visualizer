// Run with: node --test .harness/hooks/lib/runner-matcher.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestOrBuild, advancesGreen } from './runner-matcher.mjs';

const executes = ['npx vitest run --reporter=dot', 'pytest -q --tb=short', 'uv run pytest', 'npm test', 'pnpm run build', 'bun test', 'node --test .harness/hooks/lib/runner-matcher.test.mjs', 'ruff check --quiet && pytest -q',
  'go test ./...', 'cargo test --quiet', 'cargo build', 'python3 -m pytest -q', 'python -m unittest discover', 'make test'];
const staticOnly = ['ruff check --quiet', 'ruff format --check .', 'npx eslint .', 'npm run lint --silent', 'npm run typecheck --silent', 'pnpm typecheck --quiet', 'npx tsc --noEmit', 'mypy src', 'pyright', 'make check'];
const neither = ['cat test/x.txt', 'git commit -m "build fix"', 'npm install', 'pnpm add vitest', 'uv sync', 'pip install pytest', 'go mod tidy', 'cargo add serde', 'python -m pip install pytest', 'make clean'];

test('test and build runs advance the green checkpoint', () => {
  for (const cmd of executes) {
    assert.ok(isTestOrBuild(cmd), `runner: ${cmd}`);
    assert.ok(advancesGreen(cmd), `green: ${cmd}`);
  }
});

test('static checks count as runs but never advance the green checkpoint', () => {
  for (const cmd of staticOnly) {
    assert.ok(isTestOrBuild(cmd), `runner: ${cmd}`);
    assert.ok(!advancesGreen(cmd), `not green: ${cmd}`);
  }
});

test('installs and unrelated commands match neither', () => {
  for (const cmd of neither) {
    assert.ok(!isTestOrBuild(cmd), `not runner: ${cmd}`);
    assert.ok(!advancesGreen(cmd), `not green: ${cmd}`);
  }
});
