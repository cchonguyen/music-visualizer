// Shared by post-tool-scrub.mjs and post-tool-failure.mjs so both agree on what counts as a test/build run
const RUNNER = /\b(vitest|jest|tsc|eslint|typecheck|pytest|mypy|pyright)\b|\bruff\s+(check|format\s+--check)\b|\bnode\s+--test\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck)\b|\bgo\s+test\b|\bcargo\s+(test|build)\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bmake\s+(test|check)\b/i;
// Subset that executes code: only these may advance the Vibe Mode "last known green" checkpoint (static checks can pass on broken logic)
const EXECUTES = /\b(vitest|jest|pytest)\b|\bnode\s+--test\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)\b|\bgo\s+test\b|\bcargo\s+(test|build)\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bmake\s+test\b/i;
const INSTALL = /\b(pip3?|uv\s+pip|uv|npm|pnpm|yarn|bun)\s+(install|add|i|sync)\b/i;
export const isTestOrBuild = (cmd) => RUNNER.test(cmd) && !INSTALL.test(cmd);
export const advancesGreen = (cmd) => EXECUTES.test(cmd) && !INSTALL.test(cmd);
