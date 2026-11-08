# Stage 11 — Administrator System Preset Management Spec (Sector 487)

**Status:** Approved Architecture Specification  
**Authors:** Tier 1 EL-ARCHITECT  
**Context Atlas Sector:** `487` (under Sector 400 Architecture & Contracts)  
**Related ADR:** `.spec/DECISIONS.md` (2026-11-08)  
**Target Stages:** Stage 11 Slices 11.1–11.5

---

## 1. Problem Statement & Objectives

Currently in the Music Visualizer:
1. **Built-in System Presets** (43 presets across `showcase`, `flagship`, and `classics`) are statically hardcoded as JSON files in `src/presets/builtin/` and bundled into client JavaScript.
2. In `src/presets/session.ts` and `src/studio/studio.ts`, system presets have `builtin: true` and are strictly read-only. Methods like `save()`, `rename()`, `remove()`, and `setPresetFolder()` throw errors when invoked on built-in presets.
3. Users can only save personal variations locally in `localStorage` under `mv.userPresets`.
4. There is no existing remote persistence layer or admin capability allowing an administrator to update, delete, reorder, categorize, or add new system presets such that those modifications are permanently saved and propagated across all users.

### Objectives
1. **Remote Cloud Persistence:** Provide durable, zero-server-maintenance remote storage for system presets using Supabase PostgREST, while serving the application via Cloudflare Workers.
2. **Cloudflare Zero Trust & Admin Verification:** Provide email OTP verification at Cloudflare edge via Cloudflare Access (`Cf-Access-Authenticated-User-Email` matching `ADMIN_EMAIL`), backed by a Cloudflare Worker API route (`/api/admin/system_presets`) that uses the server-side Supabase service key without exposing credentials to client browsers. For local development, allow an `ADMIN_EMAIL` / dev passkey fallback.
3. **Studio UI Admin Mode:** Seamlessly unlock system preset fields (name, subfolder/category, save, delete) and allow user-to-system preset promotion when admin mode is active.
4. **Resilient Sync & Propagation Lifecycle:** Instantly render bundled/cached presets on startup, asynchronously sync with remote storage in the background, reconcile changes into active scenes, soft-delete archived presets (`is_deleted = true`), and gracefully fall back to local/cached presets when offline.

---

## 2. System Architecture & Topology

```mermaid
flowchart TD
    subgraph Client ["Client Browser (Visualizer App)"]
        UI["Studio Panel (Tweakpane UI)"]
        AG["Admin Gateway (adminGateway.ts)"]
        PS["Preset Session (session.ts)"]
        RP["Remote Presets Client (remotePresets.ts)"]
        LS[("localStorage Cache: mv.cachedSystemPresets")]
        BUILTIN["Repo Builtins (ALL_PRESETS)"]
    end

    subgraph Edge ["Cloudflare Edge & Worker"]
        CF_ZT["Cloudflare Access (Zero Trust) OTP\nCheck: email == ADMIN_EMAIL"]
        CF_W["Cloudflare Worker API Router\n(/api/admin/system_presets)"]
        CF_SEC[("Worker Secret: SUPABASE_SERVICE_ROLE_KEY\nADMIN_EMAIL")]
    end

    subgraph Backend ["Remote Cloud (Supabase)"]
        DB[("PostgreSQL: public.system_presets")]
        REST["PostgREST REST API"]
        RLS["Row Level Security Policies"]
    end

    UI -->|Admin Actions: Save / Delete / Promote| PS
    UI <-->|Admin Status Check & Toggle| AG
    PS -->|Mutate System Preset| RP
    RP -->|Authenticated via CF Access Cookie/JWT| CF_W
    CF_ZT -.->|Protects Route & Injects Headers| CF_W
    CF_SEC -.->|Server-Side Credentials| CF_W
    CF_W -->|Service Role / Edge Write| REST
    REST --> RLS --> DB
    
    BUILTIN -.->|Static Baseline| PS
    LS <-->|Cache Read / Write| RP
    RP -->|Fetch Active Presets (is_deleted=false)| CF_W
    RP -->|Reconcile & Update| PS
```

---

## 3. Data Contracts & Database Schema

### 3.1 Supabase Database Table (`system_presets`)
Additive migration placed in `supabase/migrations/20261108_system_presets.sql`:

```sql
create table if not exists public.system_presets (
  id text primary key,
  name text not null,
  subfolder text not null default 'classics', -- 'showcase' | 'flagship' | 'classics'
  preset_data jsonb not null,
  sort_order integer not null default 0,
  tags text[] not null default '{}',
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Index for fast ordered listing
create index if not exists idx_system_presets_order on public.system_presets(sort_order, updated_at desc);

-- Row Level Security (RLS)
alter table public.system_presets enable row level security;

-- 1. Anonymous and authenticated public read access
create policy "Public read system presets"
  on public.system_presets
  for select
  to anon, authenticated
  using (not is_deleted);

-- 2. Authenticated Admin insert
create policy "Admin insert system presets"
  on public.system_presets
  for insert
  to authenticated
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

-- 3. Authenticated Admin update
create policy "Admin update system presets"
  on public.system_presets
  for update
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );

-- 4. Authenticated Admin delete
create policy "Admin delete system presets"
  on public.system_presets
  for delete
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' or
    auth.role() = 'service_role'
  );
```

### 3.2 TypeScript Data Interfaces (`src/presets/remotePresets.ts`)

```ts
import type { Preset } from './format';
import type { SystemSubfolder } from './builtin';

export interface RemotePresetRecord {
  id: string;
  name: string;
  subfolder: SystemSubfolder;
  preset_data: Preset;
  sort_order: number;
  tags: string[];
  updated_at: string;
}

export interface CachedSystemPresets {
  version: number;
  syncedAt: number;
  etag?: string;
  presets: RemotePresetRecord[];
}

export interface RemoteConfig {
  supabaseUrl: string;
  anonKey: string;
  adminPasskeyHash?: string;
}
```

---

## 4. Admin Security & Role Verification Architecture

> [!WARNING]
> Harness tripwire rule: `{ name: 'auth file', test: (f) => /(^|[/._-])auth([/._-]|$)/i }`.
> Never name files containing `auth` (e.g. `adminAuth.ts` is forbidden).
> The security manager module is named `src/presets/adminGateway.ts`.

### 4.1 Interface Contract (`src/presets/adminGateway.ts`)

```ts
export interface AdminSessionState {
  isAdmin: boolean;
  adminToken?: string;
  adminEmail?: string;
  role?: 'admin' | 'superadmin';
}

export interface AdminCredentials {
  secret?: string;      // Admin passkey / service role token
  email?: string;       // Supabase admin email
  password?: string;    // Supabase admin password
}

export interface IAdminGateway {
  isAdmin(): boolean;
  getState(): AdminSessionState;
  login(credentials: AdminCredentials): Promise<{ success: boolean; error?: string }>;
  logout(): void;
  getHeaders(): Record<string, string>;
  subscribe(listener: (state: AdminSessionState) => void): () => void;
}
```

### 4.2 Admin Modes & Storage
1. **Passkey / Service Secret Mode:**
   - Owner enters admin passkey or service token in Studio.
   - Verified against SHA-256 hash or via lightweight probe to PostgREST endpoint.
   - Upon verification, sets `isAdmin = true` and saves token in `sessionStorage` (`mv.adminSessionToken`).
   - Cleared automatically when browser tab or session is closed.
2. **Supabase JWT Admin Role Mode:**
   - For authenticated users logging in with credentials.
   - JWT inspected for `app_metadata.role === 'admin'`.
3. **Mock Mode (for Tests):**
   - Test harness can instantiate `new AdminGateway({ mock: true, defaultAdmin: true })` for deterministic unit testing.

---

## 5. System Preset Lifecycle & Propagation

### 5.1 Regular User Startup & Offline Fallback
1. **Synchronous Immediate Boot:**
   - `main.ts` instantiates `PresetSession(comp, SCHEMAS, safeStorage())`.
   - Populates session with repo built-in presets (`ALL_PRESETS`).
   - If `localStorage['mv.cachedSystemPresets']` exists and is valid, overlays cached presets.
   - Visualizer renders preset immediately with zero network delay.
2. **Asynchronous Background Sync (`syncSystemPresets`):**
   - Queries `GET /rest/v1/system_presets?select=*&is_deleted=eq.false&order=sort_order.asc`.
   - On success:
     - Parses each preset through `parsePreset(data, SCHEMAS)` to sanitize and validate schema.
     - Calls `session.applyRemoteSystemPresets(remotePresets)`.
     - Writes validated records to `localStorage['mv.cachedSystemPresets']`.
     - Refreshes Studio optgroup dropdown (`studio.refreshPresetDropdown()`).
   - On network error or offline status:
     - Silently swallows error with an informational log (`console.info('Using local/cached system presets.')`).
     - App continues unaffected.

### 5.2 Admin Remote Mutation Pipeline
When an administrator modifies a system preset in Studio:
1. **Save / Update:**
   - User clicks `"Save System Preset 👑"`.
   - `session.saveSystemPreset(id)` validates that `adminGateway.isAdmin() === true`.
   - Sends `POST /rest/v1/system_presets` with `Prefer: resolution=merge-duplicates` (upsert) and admin headers.
   - Updates `entry.savedJson` locally and displays toast `"System preset saved remotely & propagated to all users"`.
2. **Add / Promote:**
   - User selects a custom user preset and clicks `"Promote to System Preset 👑"`.
   - Prompts for system subfolder (`showcase`, `flagship`, or `classics`).
   - Converts `entry.builtin = true`, generates slug ID, and pushes to remote store.
   - Immediately moves preset into the appropriate System optgroup.
3. **Delete:**
   - User clicks `"Delete"` on a system preset.
   - Arms two-tap protocol (`DELETE_ARMED_LABEL = 'Tap again to delete'`).
   - Second tap calls `session.removeSystemPreset(id)`.
   - Sends `PATCH /rest/v1/system_presets?id=eq.{id}` with `{ is_deleted: true }` or `DELETE`.
   - Preset removed from local session and remote store.

---

## 6. Studio UI Admin Mode Experience

### 6.1 State Transitions
```
[ Regular User Mode ]
    ├── System Presets: Read-only name, locked subfolder, Save is disabled, Delete is hidden.
    └── "Admin Access" blade button in Studio footer.
             │
      (User enters Secret/Passkey)
             ▼
[ Administrator Mode Active (👑) ]
    ├── Gold Admin badge displayed in Studio header.
    ├── System Presets:
    │     ├── Name input: Editable.
    │     ├── Subfolder dropdown: Editable ('showcase' | 'flagship' | 'classics').
    │     ├── Save button: "Save System Preset 👑" (saves locally & pushes remotely).
    │     └── Delete button: Visible, active with 2-tap confirmation.
    ├── User Presets:
    │     └── Action button: "Promote to System Preset 👑".
    └── Footer button: "Exit Admin Mode" (clears session and returns to user mode).
```

---

## 7. Stage 11 Implementation Slices (<5 Files Each)

- **Slice 11.1: Database Migration, Remote Config & Remote Preset Contracts** `[CORE / DATA]`
  - Target files:
    - `supabase/migrations/20261108_system_presets.sql` [NEW]
    - `src/config/remoteConfig.ts` [NEW]
    - `src/presets/remotePresets.ts` [NEW]
    - `src/presets/__tests__/remotePresets.test.ts` [NEW]
  - Coords: `[400, 410, 487]`
  - Verify: `npm run typecheck && npx vitest run src/presets/__tests__/remotePresets.test.ts && npm run build`

- **Slice 11.2: Admin Gateway & Session Security Verification** `[CORE / DATA]`
  - Target files:
    - `src/presets/adminGateway.ts` [NEW]
    - `src/presets/__tests__/adminGateway.test.ts` [NEW]
  - Coords: `[400, 410, 487]`
  - Verify: `npm run typecheck && npx vitest run src/presets/__tests__/adminGateway.test.ts && npm run build`

- **Slice 11.3: PresetSession Admin Mutation & Remote Sync Engine** `[CORE / DATA]`
  - Target files:
    - `src/presets/session.ts`
    - `src/presets/session.test.ts`
  - Coords: `[400, 410, 487]`
  - Verify: `npm run typecheck && npx vitest run src/presets/session.test.ts && npm run build`

- **Slice 11.4: Studio Admin UI Controls & System Preset Management** `[UI / VISUAL]`
  - Target files:
    - `src/studio/adminControls.ts` [NEW]
    - `src/studio/studio.ts`
    - `src/studio/studio.test.ts`
    - `src/style.css`
  - Coords: `[400, 410, 487]`
  - Verify: `npm run typecheck && npx vitest run src/studio/studio.test.ts && npm run build`

- **Slice 11.5: Application Startup Sync & Offline Reconciliation Integration** `[CORE / DATA]`
  - Target files:
    - `src/main.ts`
    - `src/presets/__tests__/presetSyncIntegration.test.ts` [NEW]
  - Coords: `[400, 410, 487]`
  - Verify: `npm run typecheck && npx vitest run src/presets/__tests__/presetSyncIntegration.test.ts && npm run build`
