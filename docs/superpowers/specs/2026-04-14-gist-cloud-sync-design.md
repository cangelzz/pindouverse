# Gist Cloud Sync Feature

**Date:** 2026-04-14
**Status:** Approved

## Context

Users need a way to sync their PindouVerse projects across devices. GitHub Gists provide free, versioned file storage accessible via API. Since the app already has GitHub OAuth (device code flow) for AI voice features, we extend it with `gist` scope to enable cloud project management.

## Naming Convention

Each project is stored as a single-file Gist. The filename follows: `pindouverse__<project-name>.pindou`. The app filters Gists by this prefix to list only PindouVerse projects.

## OAuth Scope Change

Extend the existing GitHub device code flow to request `gist` scope.

- **Tauri (desktop/mobile):** Change scope in `src-tauri/src/commands/github_auth.rs` from `""` to `"gist"`.
- **Browser/VS Code:** Call GitHub's device code endpoint directly from JavaScript with `gist` scope (same OAuth flow, no Rust needed).
- **Re-auth detection:** If existing token lacks `gist` scope, a Gist API call returns 401/403. The app detects this and prompts the user to re-authorize.

## UI — "云端" Button and Dialog

A "云端" button in the top menu bar. Only visible when user is logged in (`hasToken()` returns true).

### Dialog contents

- **Project list** — All Gists matching `pindouverse__*.pindou`. Shows project name (extracted from filename by removing prefix/suffix), last updated time, description.
- **Upload current** — Saves current project to a new or existing Gist. If a Gist with the same project name exists, updates it (PATCH). Otherwise creates new (POST). Prompts for project name if not set.
- **Download** — Loads a Gist project into the editor (replaces current canvas with confirmation if dirty).
- **Delete** — Deletes a Gist with confirmation dialog.
- **Version history** — Each Gist has built-in revision history via commits. Show revisions for a selected project. User can click any revision to restore that version.

## Gist API Wrapper — `src/utils/gistSync.ts`

Platform-agnostic module using `fetch` directly (works on all platforms — Tauri, browser, VS Code, mobile):

```typescript
interface GistProject {
  gistId: string;
  name: string;           // extracted from filename (without prefix/suffix)
  description: string;
  updatedAt: string;
  isPublic: boolean;
}

interface GistRevision {
  sha: string;
  committedAt: string;
}

listProjects(token: string): Promise<GistProject[]>
uploadProject(token: string, name: string, project: ProjectFile, gistId?: string): Promise<string>
downloadProject(token: string, gistId: string): Promise<ProjectFile>
deleteProject(token: string, gistId: string): Promise<void>
listRevisions(token: string, gistId: string): Promise<GistRevision[]>
downloadRevision(token: string, gistId: string, sha: string): Promise<ProjectFile>
```

All Gists are created as **secret** (not public) by default.

### API endpoints used

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List user's gists | GET | `/gists` (paginated, filter client-side by filename) |
| Create gist | POST | `/gists` |
| Update gist | PATCH | `/gists/:id` |
| Get gist | GET | `/gists/:id` |
| Delete gist | DELETE | `/gists/:id` |
| List revisions | GET | `/gists/:id/commits` |
| Get revision | GET | `/gists/:id/:sha` |

## Store Additions

Track cloud sync origin so the app knows when local state has diverged from cloud:

```typescript
cloudGistId: string | null          // Gist ID of the currently loaded project (null if local-only)
cloudUpdatedAt: string | null       // updatedAt timestamp from when project was last downloaded/uploaded
```

These are set when downloading or uploading a project. When the user edits locally, `isDirty` becomes true while `cloudUpdatedAt` stays the same — this mismatch drives the sync status indicator.

## Sync Status Indicator

A small status badge next to the "云端" button in the top menu bar, visible when the current project is linked to a Gist (`cloudGistId` is set):

| State | Indicator | Meaning |
|-------|-----------|---------|
| Synced | `☁️ ✓` (green) | Local matches cloud (not dirty since last upload/download) |
| Local changes | `☁️ ●` (orange) | Local edits not yet pushed (`isDirty` or edited since last sync) |
| Not linked | (none) | Project is local-only, no Gist association |

## Upload Overwrite Confirmation

When uploading to an existing Gist, the cloud version may have been updated from another device. Before overwriting:

1. Fetch the latest Gist `updatedAt` timestamp
2. If cloud `updatedAt` > local `cloudUpdatedAt` (cloud is newer than what we last downloaded), show a confirmation dialog:
   - **"云端版本已更新"** — "Cloud version has been updated since you last synced."
   - **Compare preview** — Side-by-side thumbnail rendering of local canvas vs cloud canvas. Uses the existing `PreviewThumbnail` pattern (render canvas to a small preview). Local on left, cloud on right, with timestamps.
   - **Three options:**
     - "覆盖云端" (Overwrite cloud) — Push local to Gist
     - "下载云端" (Download cloud) — Replace local with cloud version
     - "取消" (Cancel) — Do nothing
3. If cloud is NOT newer (or Gist is new), upload directly without confirmation.

## Compare Preview

The compare dialog renders two small canvas previews side-by-side:

- **Left: 本地版本** — Current local canvas state (from store)
- **Right: 云端版本** — Fetched from Gist (downloaded temporarily for preview)
- Each preview shows the full canvas scaled to fit ~200×200px, with the project name and last-modified timestamp below
- Uses a dedicated canvas element with `renderPixels` to draw the preview (same as `PreviewThumbnail` component)

## Visibility

- "云端" button only renders when `hasToken()` is true (from `src/utils/llmVoice.ts`)
- If user is not logged in, the feature is invisible
- Login is via the existing GitHub device code flow in the toolbar

## Files to modify/create

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/gistSync.ts` | Create | Gist API wrapper (list, upload, download, delete, revisions) |
| `src/App.tsx` | Modify | Add "云端" button and cloud projects dialog |
| `src-tauri/src/commands/github_auth.rs` | Modify | Add `gist` scope to device code request |

## Verification

- Login with GitHub → "云端" button appears
- Upload project → Gist created with `pindouverse__name.pindou` filename
- List projects → shows only PindouVerse gists
- Download project → loads into canvas, sync status shows ✓
- Edit locally → sync status changes to ● (orange)
- Upload → sync status returns to ✓
- Upload when cloud is newer → compare preview shows, user chooses
- Delete project → Gist removed
- Version history → shows revisions, can restore
- Not logged in → "云端" button hidden
- Token without `gist` scope ��� re-auth prompted
