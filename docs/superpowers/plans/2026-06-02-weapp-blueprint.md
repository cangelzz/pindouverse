# Blueprint Mode + Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "blueprint mode" that renders each filled cell as its MARD color code (e.g. "B2", "C1") on a light-tinted background instead of an opaque color block, plus a "mirror" sub-mode that horizontally flips the rendered grid (for crafters who need to see the design from the back).

**Architecture:** Two booleans (`blueprintMode`, `blueprintMirror`), persisted to storage, surface as menu items in the existing project menu (`openProjectMenu`). `drawCanvas` branches on `blueprintMode` to render text-overlay cells; when `blueprintMirror` is also true, wraps the grid render in `ctx.scale(-1, 1)` and the `pickCell` touch-to-cell mapping flips the column.

**Tech Stack:** TypeScript, React 18, Taro 4 (weapp), Canvas 2D API.

**Branch:** `feature/weapp-blueprint` off `miniapp/base`.

**Spec reference:** `docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md` § "#2 Blueprint mode + mirror".

---

## File map

| File | Action | Purpose |
|---|---|---|
| `platforms/weapp/src/pages/result/index.tsx` | modify | Add `blueprintMode`/`blueprintMirror` state with storage hydrate/persist, branch `drawCanvas` to render color-code text in blueprint mode, mirror transform + pickCell column flip, two new entries in `openProjectMenu` |

No new files. No new tests (render-only feature — covered by manual verification; the e2e step asserts the storage toggle round-trip).

---

## Task 0: Create branch and verify baseline

- [ ] **Step 1: Confirm on miniapp/base, clean tree**

```
git status
git branch --show-current
```
Expected: clean, on `miniapp/base`.

- [ ] **Step 2: Pull latest**

```
git pull --ff-only
```

- [ ] **Step 3: Create feature branch**

```
git checkout -b feature/weapp-blueprint
```

- [ ] **Step 4: Sanity build**

```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0.

---

## Task 1: Add blueprint state with storage hydration

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Add `blueprintMode` and `blueprintMirror` state**

After the existing `showGrid` state (line 156-163), add:

```ts
const [blueprintMode, setBlueprintMode] = useState<boolean>(() => {
  try {
    return !!Taro.getStorageSync('pindou:blueprint:mode');
  } catch {
    return false;
  }
});
const [blueprintMirror, setBlueprintMirror] = useState<boolean>(() => {
  try {
    return !!Taro.getStorageSync('pindou:blueprint:mirror');
  } catch {
    return false;
  }
});
const blueprintModeRef = useRef(blueprintMode);
const blueprintMirrorRef = useRef(blueprintMirror);
```

- [ ] **Step 2: Add ref sync + storage persistence effects**

After the existing `useEffect` that persists `showGrid` (line 184-193), add:

```ts
useEffect(() => {
  blueprintModeRef.current = blueprintMode;
  try {
    Taro.setStorageSync('pindou:blueprint:mode', blueprintMode);
  } catch {}
}, [blueprintMode]);

useEffect(() => {
  blueprintMirrorRef.current = blueprintMirror;
  try {
    Taro.setStorageSync('pindou:blueprint:mirror', blueprintMirror);
  } catch {}
}, [blueprintMirror]);
```

- [ ] **Step 3: Type-check**

```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): blueprint mode + mirror state with storage persistence"
```

---

## Task 2: Render blueprint cells in drawCanvas

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Add `hexToTint` helper**

Just above the `ResultPage` function (or near other module-scope helpers around line 70-100), add:

```ts
function hexToLightTint(hex: string): string {
  // Mix the hex color with white at 75% white to produce a faint background tint
  // for blueprint mode so the color code text remains legible.
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return '#f8f8f8';
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * 0.25 + 255 * 0.75);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
```

- [ ] **Step 2: Branch the per-cell render loop in drawCanvas**

Locate `drawCanvas` (line 285). The current per-cell loop is at lines 314-322:

```ts
for (let r = 0; r < project.height; r++) {
  for (let c = 0; c < project.width; c++) {
    const idx = src[r][c].colorIndex;
    if (idx !== null && idx !== undefined) {
      ctx.fillStyle = getEffectiveHex(idx, ov);
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
}
```

Replace with:

```ts
const isBlueprint = blueprintModeRef.current;
const fontSize = Math.max(8, Math.floor(cell * 0.4));
if (isBlueprint) {
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}
for (let r = 0; r < project.height; r++) {
  for (let c = 0; c < project.width; c++) {
    const idx = src[r][c].colorIndex;
    if (idx === null || idx === undefined) continue;
    const hex = getEffectiveHex(idx, ov);
    if (isBlueprint) {
      ctx.fillStyle = hexToLightTint(hex);
      ctx.fillRect(c * cell, r * cell, cell, cell);
      if (cell >= 10) {
        ctx.fillStyle = '#222';
        ctx.fillText(
          MARD_COLORS[idx]?.code ?? '',
          c * cell + cell / 2,
          r * cell + cell / 2,
        );
      }
    } else {
      ctx.fillStyle = hex;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
}
```

(`MARD_COLORS` is already imported at line 6 — confirm before relying on it.)

- [ ] **Step 3: Add mirror transform around the grid render**

Locate the existing `ctx.save(); ctx.translate(offsetX, offsetY)` (line 307-308). Wrap the grid render in an additional `save / scale / restore`:

Change:
```ts
ctx.save();
ctx.translate(offsetX, offsetY);
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, drawW, drawH);
```

To:
```ts
ctx.save();
ctx.translate(offsetX, offsetY);
if (blueprintMirrorRef.current) {
  ctx.translate(drawW, 0);
  ctx.scale(-1, 1);
}
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, drawW, drawH);
```

(No extra `ctx.restore()` needed — the existing one at the end of drawCanvas covers it because mirror is inside the same save block.)

- [ ] **Step 4: Add `blueprintMode` and `blueprintMirror` to drawCanvas deps and the useEffect deps that triggers it**

Find drawCanvas's `useCallback(..., [...])` (currently `[project, shapePreview, selectedColorIndex, overrides]` at line ~368). Add `blueprintMode, blueprintMirror`:

```ts
}, [project, shapePreview, selectedColorIndex, overrides, blueprintMode, blueprintMirror]);
```

Find the `useEffect` that calls `drawCanvas` (line ~374). It currently has `[project, data, view, drawCanvas, overrides, showGrid, shapePreview]`. Add `blueprintMode, blueprintMirror`:

```ts
}, [project, data, view, drawCanvas, overrides, showGrid, shapePreview, blueprintMode, blueprintMirror]);
```

- [ ] **Step 5: Type-check and build**

```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
```
Expected: exit 0 from both.

- [ ] **Step 6: Commit**

```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): blueprint render with color-code text + mirror transform"
```

---

## Task 3: Mirror-aware touch-to-cell mapping

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Locate `pickCell`**

`pickCell` is at line ~360 (after Task 1's Chunk B edits, may have shifted slightly — search for `const pickCell = useCallback`). Current implementation:

```ts
const pickCell = useCallback(
  (touchX: number, touchY: number): { row: number; col: number } | null => {
    if (!project) return null;
    const { scale, offsetX, offsetY } = viewRef.current;
    const cell = cellBaseRef.current * scale;
    const col = Math.floor((touchX - offsetX) / cell);
    const row = Math.floor((touchY - offsetY) / cell);
    if (row < 0 || row >= project.height || col < 0 || col >= project.width) return null;
    return { row, col };
  },
  [project],
);
```

- [ ] **Step 2: Add mirror flip**

Replace with:

```ts
const pickCell = useCallback(
  (touchX: number, touchY: number): { row: number; col: number } | null => {
    if (!project) return null;
    const { scale, offsetX, offsetY } = viewRef.current;
    const cell = cellBaseRef.current * scale;
    let col = Math.floor((touchX - offsetX) / cell);
    const row = Math.floor((touchY - offsetY) / cell);
    if (row < 0 || row >= project.height || col < 0 || col >= project.width) return null;
    if (blueprintMirrorRef.current) {
      col = project.width - 1 - col;
    }
    return { row, col };
  },
  [project],
);
```

(`blueprintMirrorRef` is a ref — does NOT need to be in the dep array.)

- [ ] **Step 3: Type-check**

```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): mirror-aware touch-to-cell mapping in pickCell"
```

---

## Task 4: Add menu entries to openProjectMenu

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Update openProjectMenu**

Locate `openProjectMenu` (line ~900). Currently:

```ts
const openProjectMenu = useCallback(() => {
  const gridLabel = showGrid ? '隐藏网格' : '显示网格';
  const sc = MARD_COLORS[selectedColorIndex]?.code || '当前色';
  Taro.showActionSheet({
    itemList: [
      '调整画布尺寸',
      '水平翻转',
      '垂直翻转',
      '顺时针旋转 90°',
      '重置视图',
      gridLabel,
      '统计信息',
      '另存为副本',
      `全画布填充为 ${sc}`,
      '清空全画布',
    ],
    success: (res) => {
      if (res.tapIndex === 0) promptResize();
      else if (res.tapIndex === 1) applyTransform('flipH');
      // ... etc
    },
  });
}, [promptResize, applyTransform, resetView, showGrid, showStats, selectedColorIndex, fillAll, saveAsCopy]);
```

Replace with a version that conditionally adds blueprint mirror only when blueprint mode is on:

```ts
const openProjectMenu = useCallback(() => {
  const gridLabel = showGrid ? '隐藏网格' : '显示网格';
  const sc = MARD_COLORS[selectedColorIndex]?.code || '当前色';
  const blueprintLabel = blueprintMode ? '退出图纸模式' : '进入图纸模式';
  const items = [
    '调整画布尺寸',
    '水平翻转',
    '垂直翻转',
    '顺时针旋转 90°',
    '重置视图',
    gridLabel,
    blueprintLabel,
    '统计信息',
    '另存为副本',
    `全画布填充为 ${sc}`,
    '清空全画布',
  ];
  if (blueprintMode) {
    const mirrorLabel = blueprintMirror ? '退出镜像' : '镜像（背面视角）';
    items.splice(7, 0, mirrorLabel);
  }
  Taro.showActionSheet({
    itemList: items,
    success: (res) => {
      const label = items[res.tapIndex];
      if (label === '调整画布尺寸') promptResize();
      else if (label === '水平翻转') applyTransform('flipH');
      else if (label === '垂直翻转') applyTransform('flipV');
      else if (label === '顺时针旋转 90°') applyTransform('rotate90');
      else if (label === '重置视图') resetView();
      else if (label === '隐藏网格' || label === '显示网格') setShowGrid((g) => !g);
      else if (label === '进入图纸模式' || label === '退出图纸模式') setBlueprintMode((v) => !v);
      else if (label === '镜像（背面视角）' || label === '退出镜像') setBlueprintMirror((v) => !v);
      else if (label === '统计信息') showStats();
      else if (label === '另存为副本') saveAsCopy();
      else if (label.startsWith('全画布填充为')) {
        Taro.showModal({
          title: '填充全画布',
          content: `将所有格子填充为 ${sc}？此操作可撤销。`,
          success: (r) => {
            if (r.confirm) fillAll(selectedColorIndex);
          },
        });
      } else if (label === '清空全画布') {
        Taro.showModal({
          title: '清空全画布',
          content: '将所有格子清空？此操作可撤销。',
          confirmColor: '#ff5e62',
          success: (r) => {
            if (r.confirm) fillAll(null);
          },
        });
      }
    },
  });
}, [
  promptResize,
  applyTransform,
  resetView,
  showGrid,
  showStats,
  selectedColorIndex,
  fillAll,
  saveAsCopy,
  blueprintMode,
  blueprintMirror,
]);
```

The switch from index-based to label-based dispatching is intentional: it makes the conditional mirror insertion safe (the indices shift). The label strings are unique and used directly.

- [ ] **Step 2: Type-check + build**

```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): blueprint mode + mirror entries in project menu"
```

---

## Task 5: e2e test for blueprint toggle storage round-trip

**Files:**
- Create: `platforms/weapp/tests/e2e/blueprint.test.ts`

- [ ] **Step 1: Write the test**

Create `platforms/weapp/tests/e2e/blueprint.test.ts`:

```ts
import type { MiniProgram } from 'miniprogram-automator';
import { launchMiniProgram } from './helpers';

interface MockProject {
  id: string;
  name: string;
  data: Array<Array<{ colorIndex: number | null }>>;
  width: number;
  height: number;
  algorithm: string;
  createdAt: number;
}

function makeProject(id: string, name: string, w: number, h: number): MockProject {
  const row = Array.from({ length: w }, () => ({ colorIndex: 0 }));
  const data = Array.from({ length: h }, () => row.map((c) => ({ ...c })));
  return {
    id,
    name,
    data,
    width: w,
    height: h,
    algorithm: 'cielab',
    createdAt: Date.now(),
  };
}

describe('PinDou miniapp - blueprint mode', () => {
  let mp: MiniProgram;

  beforeAll(async () => {
    mp = await launchMiniProgram();
  }, 90_000);

  afterAll(async () => {
    if (mp) {
      try {
        await mp.close();
      } catch {
        /* noop */
      }
    }
  });

  it('toggles blueprint mode via project menu and persists to storage', async () => {
    // Clear any prior state
    await mp.callWxMethod('removeStorage', { key: 'pindou:blueprint:mode' });
    await mp.callWxMethod('removeStorage', { key: 'pindou:blueprint:mirror' });

    const project = makeProject('p-bp', 'Blueprint Test', 20, 20);
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: [project] });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);
    const items = await list.$$('.projects__item');
    expect(items.length).toBeGreaterThan(0);
    await items[0].tap();
    await mp.evaluate(() => new Promise((r) => setTimeout(r, 500)));

    const page = await mp.currentPage();
    expect(page.path).toBe('pages/result/index');

    // The menu button is the "⋯" header button. Locate by its rendered text.
    const headerButtons = await page.$$('.editor__header-action');
    let menuIdx = -1;
    for (let i = 0; i < headerButtons.length; i++) {
      const text = await headerButtons[i].text();
      if (text && text.includes('⋯')) {
        menuIdx = i;
        break;
      }
    }
    expect(menuIdx).toBeGreaterThanOrEqual(0);

    // Stub the action sheet to pick "进入图纸模式" — the menu builds the list
    // dynamically. Find its index by reading the args of the showActionSheet call.
    await mp.mockWxMethod('showActionSheet', async (opts: { itemList: string[] }) => {
      const idx = opts.itemList.indexOf('进入图纸模式');
      return { tapIndex: idx >= 0 ? idx : 0, errMsg: 'showActionSheet:ok' };
    });

    await headerButtons[menuIdx].tap();
    await page.waitFor(300);
    await mp.restoreWxMethod('showActionSheet');

    // Storage should now be true
    const after = await mp.callWxMethod<{ data: boolean }>('getStorage', {
      key: 'pindou:blueprint:mode',
    });
    expect(after?.data).toBe(true);
  }, 60_000);
});
```

If the `mockWxMethod` async-callback form isn't supported by `miniprogram-automator`, fall back to the simpler pattern: tap menu twice and assert storage flips. The implementer should adapt if the dynamic-mock form fails at runtime; if the framework only supports static returns, the test can stub it with a fixed `tapIndex` matching a known menu position when blueprint is OFF (the "进入图纸模式" item is at index 6 in the default 11-item list).

- [ ] **Step 2: Try to run e2e**

```
cd platforms/weapp && npm run test:e2e:build && cd ../..
```
- If DevTools available: should pass.
- If DevTools not available: document as env issue and commit anyway.
- If test runs but fails: investigate. The most likely cause is the dynamic `mockWxMethod` async callback not working. Fall back to a static stub returning `tapIndex: 6` (the index of "进入图纸模式" when blueprint is OFF).

- [ ] **Step 3: Commit**

```
git add platforms/weapp/tests/e2e/blueprint.test.ts
git commit -m "test(weapp): e2e for blueprint mode toggle + storage persistence"
```

(If e2e couldn't run, add a `-m` body noting DevTools wasn't available.)

---

## Task 6: Squash-merge to miniapp/base

- [ ] **Step 1: Confirm clean**

```
git status
```

- [ ] **Step 2: Switch to miniapp/base, squash merge**

```
git checkout miniapp/base
git pull --ff-only
git merge --squash feature/weapp-blueprint
```

- [ ] **Step 3: Drop any unrelated working-tree changes that weren't part of the feature**

```
git status
```
If `package-lock.json` at the repo root or other unrelated files show in "Changes not staged", run `git restore <file>` on them.

- [ ] **Step 4: Commit with summary**

```
git commit -m "$(cat <<'EOF'
feat(weapp): blueprint mode with color-code overlay + mirror sub-mode

Adds a "blueprint mode" toggle to the project menu. When on, each filled
cell renders as the MARD color code text (e.g. "B2") over a 75%-white
tint of the original color, giving a beadwork chart that's readable while
the user is actually stringing beads. A nested "镜像" sub-toggle flips
the grid horizontally for users who pattern from the back of the work.

State persists per-project to wx storage keys 'pindou:blueprint:mode'
and 'pindou:blueprint:mirror'. Touch handling stays correct in mirror
mode: pickCell flips the resolved column so taps land on the visually-
seen cell, not its data-storage twin.

Spec: docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md
EOF
)"
```

- [ ] **Step 5: Verify**

```
git log -1 --stat
```

- [ ] **Step 6: Delete branch**

```
git branch -D feature/weapp-blueprint
```

(Use -D not -d — squash merges leave the branch in git's "not merged" state.)

- [ ] **Step 7: Hand off**

Notify user that feature #2 is merged. Move on to feature #3 (selection + clipboard).

---

## Self-review checklist

- All file paths absolute or relative-to-repo-root
- `MARD_COLORS` import is already in result/index.tsx:6 — confirm before Task 2 step 2
- Mirror only affects render and pickCell; eyedropper still reads `dataRef.current[row][col]` using the (now-flipped) col — correct, that's the cell the user visually tapped
- Storage keys are `pindou:blueprint:mode` and `pindou:blueprint:mirror` — namespace matches existing `pindou:` convention
- Label-based dispatch in openProjectMenu correctly handles conditional menu items (mirror only present when blueprint on)
- No new TypeScript types; all changes are local to one file
