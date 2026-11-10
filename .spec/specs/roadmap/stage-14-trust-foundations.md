# Stage 14: Trust and foundations

Goal: safe to share, tests that test real code, motion that looks the same at any refresh rate, and known bugs fixed. No new features.

Read `README.md` in this folder first.

## Why
- `supabase/migrations/20261108_system_presets.sql` lines 37, 48, 59 accept `user_metadata.role = 'admin'`. Users can set `user_metadata` themselves. Sign-ups are on.
- `updated_by` stores the owner's email and the table is publicly readable.
- `src/worker.ts` hardcodes the owner's email as the default admin.
- A second client-side admin path exists (`VITE_ADMIN_PASSKEY_HASH`, bearer token in storage, direct writes).
- `layerSchemas.ts`, `builtin/index.ts`, `spectralTerrain.ts` read `new Error().stack` and behave differently under test. `format.ts:254` special-cases the name `"  Calm tunnel  "`.
- Feedback zoom, rotate and decay apply per frame, so 120 Hz runs twice as fast as 60 Hz.

## Slices
Copy these lines into `.spec/PROGRESS.md` under a `## Stage 14` heading.

- [ ] **Slice 14.1: Database rules accept only the server-set admin role, and hide `updated_by` from public reads** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `supabase/migrations/20261110_system_presets_hardening.sql` [NEW], `src/presets/remotePresets.ts`, `src/presets/__tests__/remotePresets.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.2: Worker has no hardcoded email, validates the request body, caps its size, and sends security headers** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/worker.ts`, `src/worker.test.ts`, `wrangler.jsonc` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.3: Remove the client-side passkey admin path and direct database writes** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/config/remoteConfig.ts`, `src/presets/adminGateway.ts`, `src/presets/__tests__/adminGateway.test.ts`, `src/presets/remotePresets.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.4: Remove call-stack test rigging from layer schemas and builtin index** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/presets/loader.test.ts`, `src/presets/builtin/index.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.5: Remove test special-cases from preset format and spectral terrain** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/render/layers/spectralTerrain.ts`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.6: Feedback zoom, rotate, drift and decay are per second, not per frame** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/scene.ts`, `src/render/shaders/feedback.frag.glsl`, `src/render/__tests__/feedbackWarp.test.ts`, `src/render/__tests__/scene.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.7: Clamp the time step everywhere and wrap the shader clock** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/main.ts`, `src/gl/context.ts`, `src/render/globalDirector.ts`, `src/render/__tests__/globalDirector.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.8: Fix RGB split lost under blur, lopsided bloom, and remove dead shader inputs** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/feedback.frag.glsl`, `src/render/shaders/post.frag.glsl`, `src/render/compositor.ts`, `src/render/scene.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.9: Morph LFO uses an integrated phase; remove the dead Mandala kick flare control with preset migration** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/morph.ts`, `src/presets/morph.test.ts`, `src/presets/schema.ts`, `src/presets/schema.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 14.10: Bring the spec and project description in line with the code** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `.spec/SYSTEM_SPEC.md`, `.spec/OVERVIEW.md`, `CLAUDE.md` | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **14.1** Drop the `user_metadata` clause from all three write policies. Keep `app_metadata.role` and `service_role`. Hide `updated_by` from the `anon` and `authenticated` roles (column grants or a public view). The client must then select named columns, not `*`. Applying a migration to the live Supabase project is a production change: ask Charlie for a yes for that exact step, then apply it and confirm with a read as the anon role. Also check `auth.users` for any account carrying `role: admin` in `user_metadata`, and report what you find.
- **14.2** `ADMIN_EMAIL`, the Access team domain and the audience tag become required Worker settings with no source default. Before merging, confirm they are set in Cloudflare; if not, give Charlie web-UI steps. Forward only an allowlist of columns to Supabase. Reject bodies over a small cap (for example 256 KB). Add a content security policy, `X-Content-Type-Options`, `Referrer-Policy` and frame protection to Worker responses.
- **14.3** After this slice the only admin route is Cloudflare Access through the Worker. `isAdmin()` in the client stays a UI hint. Remove `mv.adminSessionToken`.
- **14.4, 14.5** Delete the Proxies and stack checks. Fix tests to assert the real values. If a test then fails for a real reason, fix the code or the test honestly and say which.
- **14.6** Convert per-frame amounts to per-second and scale by the clamped time step, calibrated so 60 Hz looks the same as today. Decay becomes `pow(decay, dt * 60)`. Existing preset values keep their meaning.
- **14.7** `main.ts` `displayFrameMs` and `director.advance` get the same clamp the render clock has. Wrap `uTime` at a period that keeps shader maths continuous.
- **14.8** Bloom steps must use matching texel sizes on both axes. Remove unused uniforms `uKick`, `uSub`, `uMobiusPolePolarity`, `uCrtScanlines`, `uCrtBarrel` and their uploads.
- **14.10** Spec says FFT 4096 and float targets; code uses 8192 and RGBA8. `CLAUDE.md` says 20 presets and 13 layers. If `CLAUDE.md` is locked by the harness, leave it and report.

## Done when
- A new account cannot write to `system_presets`, and an anonymous read cannot see `updated_by`.
- No source file references `new Error().stack` outside tests.
- A feedback test shows the same trail length after 1 second at 60 and 120 steps per second.
- All checks pass.

## Out of scope
New effects, Studio layout, performance work.
