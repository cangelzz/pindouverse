# Gist Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Gist-based cloud project management — list, upload, download, delete, version history, sync status, and compare preview for conflict resolution.

**Architecture:** A new `src/utils/gistSync.ts` module wraps the GitHub Gist API using `fetch` (platform-agnostic). The Zustand store gains `cloudGistId` and `cloudUpdatedAt` fields. A new "云端" button + dialog in App.tsx manages the UI. The existing OAuth device code flow gets `gist` scope added. A `CloudComparePreview` component renders side-by-side canvas thumbnails for conflict resolution.

**Tech Stack:** React 19, Zustand 5, TypeScript, GitHub Gist REST API, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/gistSync.ts` | Create | Gist API wrapper (list, upload, download, delete, revisions) |
| `src/store/editorStore.ts` | Modify | Add `cloudGistId`, `cloudUpdatedAt` state fields |
| `src/components/Cloud/CloudDialog.tsx` | Create | Cloud projects dialog (list, upload, download, delete, history) |
| `src/components/Cloud/CloudComparePreview.tsx` | Create | Side-by-side canvas preview for conflict resolution |
| `src/App.tsx` | Modify | Add "云端" button + sync status indicator, render CloudDialog |
| `src-tauri/src/commands/github_auth.rs` | Modify | Add `gist` scope |
| `tests/core/gistSync.test.ts` | Create | Unit tests for gistSync utilities |

---

### Task 1: Gist API Wrapper + Tests

**Files:**
- Create: `src/utils/gistSync.ts`
- Create: `tests/core/gistSync.test.ts`

- [ ] **Step 1: Create the Gist API wrapper**

Create `src/utils/gistSync.ts`:

```typescript
import type { ProjectFile } from "../types";

const GIST_API = "https://api.github.com";
const PREFIX = "pindouverse__";
const SUFFIX = ".pindou";

export interface GistProject {
  gistId: string;
  name: string;
  description: string;
  updatedAt: string;
  isPublic: boolean;
}

export interface GistRevision {
  sha: string;
  committedAt: string;
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toFilename(name: string): string {
  return `${PREFIX}${name}${SUFFIX}`;
}

function fromFilename(filename: string): string | null {
  if (!filename.startsWith(PREFIX) || !filename.endsWith(SUFFIX)) return null;
  return filename.slice(PREFIX.length, -SUFFIX.length);
}

/** List all PindouVerse projects in the user's Gists */
export async function listProjects(token: string): Promise<GistProject[]> {
  const projects: GistProject[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${GIST_API}/gists?per_page=100&page=${page}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const gists: any[] = await res.json();
    if (gists.length === 0) break;
    for (const gist of gists) {
      const files = Object.keys(gist.files || {});
      for (const fname of files) {
        const name = fromFilename(fname);
        if (name !== null) {
          projects.push({
            gistId: gist.id,
            name,
            description: gist.description || "",
            updatedAt: gist.updated_at,
            isPublic: gist.public,
          });
          break; // one project per gist
        }
      }
    }
    if (gists.length < 100) break;
    page++;
  }
  return projects;
}

/** Upload a project to a new or existing Gist. Returns the Gist ID. */
export async function uploadProject(
  token: string,
  name: string,
  project: ProjectFile,
  gistId?: string,
): Promise<{ gistId: string; updatedAt: string }> {
  const filename = toFilename(name);
  const content = JSON.stringify(project, null, 2);

  if (gistId) {
    // Update existing
    const res = await fetch(`${GIST_API}/gists/${gistId}`, {
      method: "PATCH",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `PindouVerse: ${name}`,
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return { gistId: data.id, updatedAt: data.updated_at };
  } else {
    // Create new
    const res = await fetch(`${GIST_API}/gists`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `PindouVerse: ${name}`,
        public: false,
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return { gistId: data.id, updatedAt: data.updated_at };
  }
}

/** Download a project from a Gist */
export async function downloadProject(
  token: string,
  gistId: string,
): Promise<{ project: ProjectFile; updatedAt: string }> {
  const res = await fetch(`${GIST_API}/gists/${gistId}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const files = data.files || {};
  for (const fname of Object.keys(files)) {
    if (fromFilename(fname) !== null) {
      const content = files[fname].content;
      return { project: JSON.parse(content), updatedAt: data.updated_at };
    }
  }
  throw new Error("No .pindou file found in Gist");
}

/** Delete a Gist */
export async function deleteProject(token: string, gistId: string): Promise<void> {
  const res = await fetch(`${GIST_API}/gists/${gistId}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status} ${res.statusText}`);
}

/** List revisions (commits) of a Gist */
export async function listRevisions(token: string, gistId: string): Promise<GistRevision[]> {
  const res = await fetch(`${GIST_API}/gists/${gistId}/commits`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`List revisions failed: ${res.status} ${res.statusText}`);
  const commits: any[] = await res.json();
  return commits.map((c) => ({
    sha: c.version,
    committedAt: c.committed_at,
  }));
}

/** Download a specific revision of a Gist */
export async function downloadRevision(
  token: string,
  gistId: string,
  sha: string,
): Promise<ProjectFile> {
  const res = await fetch(`${GIST_API}/gists/${gistId}/${sha}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Download revision failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const files = data.files || {};
  for (const fname of Object.keys(files)) {
    if (fromFilename(fname) !== null) {
      return JSON.parse(files[fname].content);
    }
  }
  throw new Error("No .pindou file found in Gist revision");
}

/** Get the updatedAt timestamp of a Gist without downloading content */
export async function getGistUpdatedAt(token: string, gistId: string): Promise<string> {
  const res = await fetch(`${GIST_API}/gists/${gistId}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.updated_at;
}

// Re-export helpers for testing
export { toFilename, fromFilename };
```

- [ ] **Step 2: Create unit tests for filename helpers**

Create `tests/core/gistSync.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Inline the pure functions for testing (same as gistSync.ts)
const PREFIX = "pindouverse__";
const SUFFIX = ".pindou";

function toFilename(name: string): string {
  return `${PREFIX}${name}${SUFFIX}`;
}

function fromFilename(filename: string): string | null {
  if (!filename.startsWith(PREFIX) || !filename.endsWith(SUFFIX)) return null;
  return filename.slice(PREFIX.length, -SUFFIX.length);
}

describe("gist filename helpers", () => {
  it("toFilename creates correct filename", () => {
    expect(toFilename("my-art")).toBe("pindouverse__my-art.pindou");
    expect(toFilename("花朵设计")).toBe("pindouverse__花朵设计.pindou");
  });

  it("fromFilename extracts project name", () => {
    expect(fromFilename("pindouverse__my-art.pindou")).toBe("my-art");
    expect(fromFilename("pindouverse__花朵设计.pindou")).toBe("花朵设计");
  });

  it("fromFilename returns null for non-pindou files", () => {
    expect(fromFilename("readme.md")).toBeNull();
    expect(fromFilename("pindouverse__test.json")).toBeNull();
    expect(fromFilename("other__test.pindou")).toBeNull();
  });

  it("round-trips correctly", () => {
    const name = "test-project-123";
    expect(fromFilename(toFilename(name))).toBe(name);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All tests pass (38 existing + 4 new = 42)

- [ ] **Step 4: Commit**

```bash
git add src/utils/gistSync.ts tests/core/gistSync.test.ts
git commit -m "feat: add Gist API wrapper for cloud project sync"
```

---

### Task 2: Store — Add Cloud Sync State

**Files:**
- Modify: `src/store/editorStore.ts`

- [ ] **Step 1: Add state fields to interface**

After `importedFileName: string | null;` (around line 59), add:

```typescript
  // Cloud sync
  cloudGistId: string | null;
  cloudUpdatedAt: string | null;
  cloudProjectName: string | null;
```

- [ ] **Step 2: Add action signatures**

After `beginStroke` / `endStroke` signatures, add:

```typescript
  setCloudSync: (gistId: string | null, updatedAt: string | null, name: string | null) => void;
```

- [ ] **Step 3: Add initial state values**

After `importedFileName: null,` in the create block, add:

```typescript
  cloudGistId: null,
  cloudUpdatedAt: null,
  cloudProjectName: null,
```

- [ ] **Step 4: Add action implementation**

After the `endStroke` implementation, add:

```typescript
  setCloudSync: (gistId, updatedAt, name) => set({
    cloudGistId: gistId,
    cloudUpdatedAt: updatedAt,
    cloudProjectName: name,
  }),
```

- [ ] **Step 5: Clear cloud sync on newCanvas and openProject**

In the `newCanvas` implementation, add `cloudGistId: null, cloudUpdatedAt: null, cloudProjectName: null,` to the `set()` call.

In the `openProject` implementation, add the same three null fields to the `set()` call.

- [ ] **Step 6: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 42 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/store/editorStore.ts
git commit -m "feat: add cloud sync state (cloudGistId, cloudUpdatedAt) to store"
```

---

### Task 3: OAuth Scope Change

**Files:**
- Modify: `src-tauri/src/commands/github_auth.rs`

- [ ] **Step 1: Change scope from empty to "gist"**

In `src-tauri/src/commands/github_auth.rs`, find:

```rust
            "scope": ""
```

Change to:

```rust
            "scope": "gist"
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/commands/github_auth.rs
git commit -m "feat: add gist scope to GitHub OAuth device code flow"
```

---

### Task 4: CloudComparePreview Component

**Files:**
- Create: `src/components/Cloud/CloudComparePreview.tsx`

- [ ] **Step 1: Create the compare preview component**

```bash
mkdir -p src/components/Cloud
```

Create `src/components/Cloud/CloudComparePreview.tsx`:

```typescript
import { useRef, useEffect } from "react";
import { MARD_COLORS } from "../../data/mard221";
import type { CanvasData } from "../../types";

interface ComparePreviewProps {
  localData: CanvasData;
  localSize: { width: number; height: number };
  localTimestamp: string;
  cloudData: CanvasData;
  cloudSize: { width: number; height: number };
  cloudTimestamp: string;
  onChooseLocal: () => void;
  onChooseCloud: () => void;
  onCancel: () => void;
}

function renderPreview(
  canvas: HTMLCanvasElement,
  data: CanvasData,
  width: number,
  height: number,
  maxSize: number,
) {
  const aspect = width / height;
  const w = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
  const h = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const sx = w / width;
  const sy = h / height;

  // Draw checkerboard background
  ctx.fillStyle = "#e5e5e5";
  ctx.fillRect(0, 0, w, h);
  const checkSize = 4;
  ctx.fillStyle = "#d0d0d0";
  for (let r = 0; r < h; r += checkSize) {
    for (let c = 0; c < w; c += checkSize) {
      if ((Math.floor(r / checkSize) + Math.floor(c / checkSize)) % 2 === 0) {
        ctx.fillRect(c, r, checkSize, checkSize);
      }
    }
  }

  // Draw pixels
  for (let r = 0; r < height && r < data.length; r++) {
    for (let c = 0; c < width && c < data[r].length; c++) {
      const cell = data[r][c];
      if (cell.colorIndex !== null) {
        const color = MARD_COLORS[cell.colorIndex];
        ctx.fillStyle = color?.hex || "#FF00FF";
        ctx.fillRect(
          Math.floor(c * sx),
          Math.floor(r * sy),
          Math.ceil(sx),
          Math.ceil(sy),
        );
      }
    }
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CloudComparePreview(props: ComparePreviewProps) {
  const localRef = useRef<HTMLCanvasElement>(null);
  const cloudRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (localRef.current) {
      renderPreview(localRef.current, props.localData, props.localSize.width, props.localSize.height, 200);
    }
  }, [props.localData, props.localSize]);

  useEffect(() => {
    if (cloudRef.current) {
      renderPreview(cloudRef.current, props.cloudData, props.cloudSize.width, props.cloudSize.height, 200);
    }
  }, [props.cloudData, props.cloudSize]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl w-[520px] p-4">
        <h2 className="font-semibold text-sm mb-1">云端版本已更新</h2>
        <p className="text-xs text-gray-500 mb-3">云端版本比本地更新，请选择保留哪个版本。</p>

        <div className="flex gap-4 justify-center mb-4">
          {/* Local */}
          <div className="flex flex-col items-center">
            <div className="text-xs font-semibold text-blue-600 mb-1">本地版本</div>
            <canvas
              ref={localRef}
              className="border border-gray-300 rounded"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="text-[10px] text-gray-400 mt-1">
              {props.localSize.width}×{props.localSize.height} · {formatTime(props.localTimestamp)}
            </div>
          </div>

          {/* Cloud */}
          <div className="flex flex-col items-center">
            <div className="text-xs font-semibold text-green-600 mb-1">云端版本</div>
            <canvas
              ref={cloudRef}
              className="border border-gray-300 rounded"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="text-[10px] text-gray-400 mt-1">
              {props.cloudSize.width}×{props.cloudSize.height} · {formatTime(props.cloudTimestamp)}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-center">
          <button
            onClick={props.onChooseLocal}
            className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            覆盖云端
          </button>
          <button
            onClick={props.onChooseCloud}
            className="px-3 py-1.5 text-xs rounded bg-green-500 text-white hover:bg-green-600"
          >
            下载云端
          </button>
          <button
            onClick={props.onCancel}
            className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 42 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/Cloud/CloudComparePreview.tsx
git commit -m "feat: add CloudComparePreview component for sync conflict resolution"
```

---

### Task 5: CloudDialog Component

**Files:**
- Create: `src/components/Cloud/CloudDialog.tsx`

- [ ] **Step 1: Create the cloud dialog component**

Create `src/components/Cloud/CloudDialog.tsx`:

```typescript
import { useState, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { getGitHubToken } from "../../utils/llmVoice";
import {
  listProjects,
  uploadProject,
  downloadProject,
  deleteProject,
  listRevisions,
  downloadRevision,
  getGistUpdatedAt,
  type GistProject,
  type GistRevision,
} from "../../utils/gistSync";
import { CloudComparePreview } from "./CloudComparePreview";
import type { ProjectFile, CanvasData } from "../../types";

interface CloudDialogProps {
  onClose: () => void;
}

export function CloudDialog({ onClose }: CloudDialogProps) {
  const [projects, setProjects] = useState<GistProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGist, setSelectedGist] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<GistRevision[] | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [showUploadInput, setShowUploadInput] = useState(false);

  // Compare preview state
  const [compareState, setCompareState] = useState<{
    cloudProject: ProjectFile;
    cloudUpdatedAt: string;
    gistId: string;
    name: string;
  } | null>(null);

  const canvasData = useEditorStore((s) => s.canvasData);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const isDirty = useEditorStore((s) => s.isDirty);
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
  const cloudUpdatedAt = useEditorStore((s) => s.cloudUpdatedAt);
  const cloudProjectName = useEditorStore((s) => s.cloudProjectName);
  const loadCanvasData = useEditorStore((s) => s.loadCanvasData);
  const setCloudSync = useEditorStore((s) => s.setCloudSync);

  const token = getGitHubToken();

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects(token);
      setProjects(list);
    } catch (e: any) {
      setError(e.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Load on first render
  if (projects === null && !loading && !error) {
    refresh();
  }

  const handleUpload = async (name: string, gistId?: string) => {
    if (!token || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Check for conflict if updating existing gist
      if (gistId && cloudUpdatedAt) {
        const currentCloudUpdatedAt = await getGistUpdatedAt(token, gistId);
        if (new Date(currentCloudUpdatedAt) > new Date(cloudUpdatedAt)) {
          // Cloud is newer — show compare preview
          const { project: cloudProject } = await downloadProject(token, gistId);
          setCompareState({
            cloudProject,
            cloudUpdatedAt: currentCloudUpdatedAt,
            gistId,
            name,
          });
          setLoading(false);
          return;
        }
      }

      await doUpload(name, gistId);
    } catch (e: any) {
      setError(e.message || "Upload failed");
      setLoading(false);
    }
  };

  const doUpload = async (name: string, gistId?: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const state = useEditorStore.getState();
      const project: ProjectFile = {
        version: 1,
        canvasSize: state.canvasSize,
        canvasData: state.canvasData,
        gridConfig: state.gridConfig,
        createdAt: state.cloudUpdatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = await uploadProject(token, name, project, gistId);
      setCloudSync(result.gistId, result.updatedAt, name);
      useEditorStore.setState({ isDirty: false });
      await refresh();
      setShowUploadInput(false);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (gistId: string, name: string) => {
    if (!token) return;
    if (isDirty && !confirm("当前有未保存的修改，下载云端项目将替换当前画布。继续？")) return;
    setLoading(true);
    setError(null);
    try {
      const { project, updatedAt } = await downloadProject(token, gistId);
      loadCanvasData(project.canvasData, project.canvasSize);
      if (project.gridConfig) {
        const store = useEditorStore.getState();
        useEditorStore.setState({
          gridConfig: { ...store.gridConfig, ...project.gridConfig },
        });
      }
      setCloudSync(gistId, updatedAt, name);
      onClose();
    } catch (e: any) {
      setError(e.message || "Download failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (gistId: string, name: string) => {
    if (!token) return;
    if (!confirm(`确定删除云端项目 "${name}"？此操作不可撤销。`)) return;
    setLoading(true);
    setError(null);
    try {
      await deleteProject(token, gistId);
      if (cloudGistId === gistId) {
        setCloudSync(null, null, null);
      }
      await refresh();
    } catch (e: any) {
      setError(e.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  const handleShowRevisions = async (gistId: string) => {
    if (!token) return;
    setSelectedGist(gistId);
    setLoading(true);
    try {
      const revs = await listRevisions(token, gistId);
      setRevisions(revs);
    } catch (e: any) {
      setError(e.message || "Failed to load revisions");
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreRevision = async (gistId: string, sha: string) => {
    if (!token) return;
    if (isDirty && !confirm("当前有未保存的修改，恢复版本将替换当前画布。继续？")) return;
    setLoading(true);
    try {
      const project = await downloadRevision(token, gistId, sha);
      loadCanvasData(project.canvasData, project.canvasSize);
      if (project.gridConfig) {
        const store = useEditorStore.getState();
        useEditorStore.setState({
          gridConfig: { ...store.gridConfig, ...project.gridConfig },
        });
      }
      onClose();
    } catch (e: any) {
      setError(e.message || "Restore failed");
    } finally {
      setLoading(false);
    }
  };

  // Compare preview handlers
  if (compareState) {
    const state = useEditorStore.getState();
    return (
      <CloudComparePreview
        localData={state.canvasData}
        localSize={state.canvasSize}
        localTimestamp={state.cloudUpdatedAt || new Date().toISOString()}
        cloudData={compareState.cloudProject.canvasData}
        cloudSize={compareState.cloudProject.canvasSize}
        cloudTimestamp={compareState.cloudUpdatedAt}
        onChooseLocal={async () => {
          setCompareState(null);
          await doUpload(compareState.name, compareState.gistId);
        }}
        onChooseCloud={async () => {
          setCompareState(null);
          await handleDownload(compareState.gistId, compareState.name);
        }}
        onCancel={() => setCompareState(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[440px] max-h-[75vh] flex flex-col">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">☁️ 云端项目</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {error && (
          <div className="mx-4 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {loading && projects === null ? (
            <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
          ) : revisions && selectedGist ? (
            // Revision list
            <div>
              <button
                onClick={() => { setRevisions(null); setSelectedGist(null); }}
                className="text-xs text-blue-500 hover:underline mb-2"
              >
                ← 返回项目列表
              </button>
              <h3 className="text-xs font-semibold text-gray-600 mb-2">版本历史</h3>
              {revisions.map((rev, i) => (
                <div key={rev.sha} className="flex items-center gap-2 py-1.5 border-b text-xs">
                  <span className="text-gray-400 w-6">{i + 1}</span>
                  <span className="flex-1 text-gray-600">
                    {new Date(rev.committedAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleRestoreRevision(selectedGist, rev.sha)}
                    className="px-2 py-0.5 bg-green-500 text-white rounded text-[10px] hover:bg-green-600"
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          ) : (
            // Project list
            <div className="flex flex-col gap-1">
              {projects && projects.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">暂无云端项目</p>
              )}
              {projects?.map((p) => (
                <div
                  key={p.gistId}
                  className={`flex items-center gap-2 p-2 rounded border text-xs ${
                    cloudGistId === p.gistId ? "bg-blue-50 border-blue-300" : "bg-gray-50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {p.name}
                      {cloudGistId === p.gistId && (
                        <span className="text-blue-500 ml-1 text-[10px]">● 当前</span>
                      )}
                    </div>
                    <div className="text-gray-400 text-[10px]">
                      {new Date(p.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(p.gistId, p.name)}
                    className="px-2 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600 shrink-0"
                  >
                    下载
                  </button>
                  <button
                    onClick={() => handleShowRevisions(p.gistId)}
                    className="px-2 py-0.5 border rounded text-[10px] hover:bg-gray-100 shrink-0"
                  >
                    历史
                  </button>
                  <button
                    onClick={() => handleDelete(p.gistId, p.name)}
                    className="px-2 py-0.5 border rounded text-[10px] text-red-400 hover:bg-red-50 shrink-0"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="px-4 py-2 border-t flex gap-2 items-center">
          {showUploadInput ? (
            <>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="项目名称"
                className="flex-1 px-2 py-1 text-xs border rounded"
                autoFocus
              />
              <button
                onClick={() => {
                  const name = uploadName.trim();
                  if (!name) return;
                  // Check if a gist with this name already exists
                  const existing = projects?.find((p) => p.name === name);
                  handleUpload(name, existing?.gistId);
                }}
                disabled={!uploadName.trim() || loading}
                className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50"
              >
                上传
              </button>
              <button
                onClick={() => setShowUploadInput(false)}
                className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  // If already linked to a gist, upload directly
                  if (cloudGistId && cloudProjectName) {
                    handleUpload(cloudProjectName, cloudGistId);
                  } else {
                    setUploadName(cloudProjectName || "");
                    setShowUploadInput(true);
                  }
                }}
                disabled={loading}
                className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {cloudGistId ? "同步到云端" : "上传当前项目"}
              </button>
              <button
                onClick={refresh}
                disabled={loading}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                {loading ? "加载中..." : "刷新"}
              </button>
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100"
              >
                关闭
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 42 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/Cloud/CloudDialog.tsx
git commit -m "feat: add CloudDialog component — list, upload, download, delete, history"
```

---

### Task 6: App.tsx — Cloud Button + Sync Status

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

Add at the top imports:

```typescript
import { CloudDialog } from "./components/Cloud/CloudDialog";
import { hasToken } from "./utils/llmVoice";
```

- [ ] **Step 2: Add state**

After `const [showHistory, setShowHistory] = useState(false);`, add:

```typescript
  const [showCloud, setShowCloud] = useState(false);
```

- [ ] **Step 3: Add store bindings**

After existing store bindings, add:

```typescript
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
```

- [ ] **Step 4: Add "云端" button with sync status in the top menu bar**

Find the "历史记录" button and add AFTER it:

```tsx
        {hasToken() && (
          <>
            <button
              onClick={() => setShowCloud(true)}
              className="px-2 py-1 rounded hover:bg-gray-200"
            >
              云端
            </button>
            {cloudGistId && (
              <span className={`text-xs ${isDirty ? "text-orange-500" : "text-green-600"}`}>
                {isDirty ? "☁️●" : "☁️✓"}
              </span>
            )}
          </>
        )}
```

- [ ] **Step 5: Add CloudDialog rendering**

Before `{/* Bottom status bar */}`, add:

```tsx
      {showCloud && <CloudDialog onClose={() => setShowCloud(false)} />}
```

- [ ] **Step 6: Run tests**

Run: `cd c:\Repo\pindou && npm test`
Expected: All 42 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add cloud button with sync status indicator and CloudDialog"
```

---

### Task 7: Rebuild VS Code Extension + Final Test

**Files:**
- No source changes

- [ ] **Step 1: Run all tests**

```bash
cd c:\Repo\pindou && npm test
```

Expected: All 42 tests pass

- [ ] **Step 2: Rebuild VS Code extension**

```bash
cd c:\Repo\pindou\platforms\vscode && npm run build
```

- [ ] **Step 3: Run Playwright test**

```bash
cd c:\Repo\pindou\platforms\vscode && npx playwright test
```

Expected: PASS
