import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const ci = read(".github/workflows/ci.yml");
const release = read(".github/workflows/release.yml");
const rootReadme = read("README.md");
const vscodeReadme = read("platforms/vscode/README.md");
const claudeGuidelines = read("CLAUDE.md");
const versioningInstructions = read(".github/instructions/versioning.instructions.md");
const viteConfig = read("vite.config.ts");
const rootPackage = JSON.parse(read("package.json")) as { version: string; scripts: Record<string, string> };
const scripts = rootPackage.scripts;
const vscodePackage = JSON.parse(read("platforms/vscode/package.json")) as { version: string; scripts: Record<string, string> };
const vscodeLock = JSON.parse(read("platforms/vscode/package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
const vscodeScripts = vscodePackage.scripts;

function indentedBlock(source: string, header: string, indent: number) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${" ".repeat(indent)}${header}`);
  expect(start, `missing ${header}`).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) end += 1;
  return lines.slice(start, end).join("\n");
}

const jobBlock = (workflow: string, job: string) => indentedBlock(workflow, `${job}:`, 2);
const namedStep = (job: string, name: string) => indentedBlock(job, `- name: ${name}`, 6);
const actionStep = (job: string, action: string) => indentedBlock(job, `- uses: ${action}`, 6);

function expectOrdered(job: string, values: string[]) {
  let previous = -1;
  for (const value of values) {
    const position = job.indexOf(value);
    expect(position, `missing ${value}`).toBeGreaterThan(previous);
    previous = position;
  }
}

function stepContaining(job: string, value: string) {
  const lines = job.split("\n");
  const match = lines.findIndex((line) => line.includes(value));
  expect(match, `missing ${value}`).toBeGreaterThanOrEqual(0);
  let start = match;
  while (start >= 0 && !/^ {6}- /.test(lines[start])) start -= 1;
  expect(start, `missing step for ${value}`).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && !/^ {6}- /.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

describe("browser extension workflow contract", () => {
  it("serializes release runs across refs", () => {
    const concurrency = indentedBlock(release, "concurrency:", 0);
    expect(concurrency).toContain("group: release");
    expect(concurrency).toContain("cancel-in-progress: false");
    expect(concurrency).not.toContain("github.ref");
  });

  it("keeps all extension commands backed by package scripts", () => {
    for (const name of [
      "ext:build:chrome",
      "ext:build:edge",
      "ext:validate",
      "ext:test:packaging",
      "ext:test:contract",
      "ext:test:e2e",
      "ext:screenshots:validate",
      "test:screenshots",
      "ext:package",
    ]) {
      expect(scripts[name], `missing package script ${name}`).toBeTypeOf("string");
    }
  });

  it("keeps root Vitest exclusions shell-independent", () => {
    expect(scripts.test).toBe("vitest run");
    expect(viteConfig).toContain('"**/platforms/extension/e2e/**"');
  });

  it("wires VS Code unit tests into its standard test command and CI", () => {
    expect(vscodeScripts["test:unit"]).toBe("vitest run --config vitest.config.ts");
    expect(vscodeScripts.test).toContain("npm run test:unit");
    const job = jobBlock(ci, "test-vscode");
    expect(job).toContain("run: cd platforms/vscode && npm run test:unit");
  });

  it("tests, validates, packages, and always uploads browser extension CI artifacts", () => {
    const job = jobBlock(ci, "test-extension");
    expect(job).toContain("runs-on: ubuntu-24.04");
    const setup = actionStep(job, "actions/setup-node@v6");
    expect(setup).toContain("node-version: 22");
    expect(setup).toContain("cache: npm");
    const commands = [
      "run: npm ci",
      "run: npx playwright install --with-deps chromium",
      "run: npm run ext:build:chrome",
      "run: npm run ext:build:edge",
      "run: npm run ext:validate",
      "run: npm run ext:test:packaging",
      "run: npm run ext:test:contract",
      "run: xvfb-run -a npm run ext:test:e2e",
      "run: npm run test:screenshots",
      "run: npm run ext:package",
    ];
    expectOrdered(job, commands);
    for (const command of commands) expect(stepContaining(job, command)).not.toContain("if:");
    const upload = actionStep(job, "actions/upload-artifact@v4");
    expect(upload).toContain("if: always()");
    expect(upload).toContain("if-no-files-found: warn");
    expect(upload).toContain("artifacts/*.zip");
    expect(upload).toMatch(/^\s+test-results\/$/m);
    expect(upload).toMatch(/^\s+playwright-report\/$/m);
  });

  it("documents VS Code as the primary platform and browser extensions as secondary", () => {
    expect(rootReadme).toMatch(/VS Code[^\n]*(主平台|primary)/i);
    expect(rootReadme).toMatch(/Chrome[^\n]*Edge[^\n]*(次要|secondary)/i);
  });

  it("gives ordinary users a Marketplace install path before the VS Code source workflow", () => {
    const vscodeSection = rootReadme.slice(
      rootReadme.indexOf("## 1. VS Code"),
      rootReadme.indexOf("## 2. Chrome"),
    );
    const marketplace = "https://marketplace.visualstudio.com/items?itemName=PindouVerse.pindouverse";
    expect(vscodeSection).toContain(marketplace);
    expect(vscodeSection).toMatch(/(普通用户|安装)[^\n]*Marketplace/i);
    expect(vscodeSection).toMatch(/开发者[^\n]*源码/);
    expect(vscodeSection.indexOf(marketplace)).toBeLessThan(vscodeSection.indexOf("```bash"));
  });

  it("labels desktop as legacy and warns about historical installers", () => {
    expect(rootReadme).toMatch(/Desktop[^\n]*Legacy/i);
    expect(rootReadme).toMatch(/(历史|historical)[^\n]*(安装包|installer)/i);
    expect(rootReadme).toMatch(/(严重|serious)[^\n]*(兼容|compatibility)[^\n]*(安全|security)/i);
  });

  it("presents the VS Code extension as the primary platform without advertising the old desktop app", () => {
    expect(vscodeReadme).toMatch(/VS Code[^\n]*(主平台|primary)/i);
    expect(vscodeReadme).not.toContain("The desktop app (Windows/macOS/Linux) and mobile app are also available.");
  });

  it("keeps extension and legacy desktop version lines separate in contributor guidance", () => {
    expect(claudeGuidelines).toContain(
      "The root version system applies only to the **Legacy / Deprecated Desktop/Tauri client**",
    );
    expect(versioningInstructions).toContain(
      "exclusively for the Legacy / Deprecated Desktop/Tauri client",
    );
    expect(claudeGuidelines).toContain(
      "The VS Code extension has an independent version in `platforms/vscode/package.json`",
    );
    expect(versioningInstructions).toContain(
      "Routine extension releases must not use `scripts/version.sh` or the Legacy Desktop release workflow",
    );
  });

  it("reserves minor bumps for approved emergency Legacy Desktop maintenance releases", () => {
    for (const guidance of [claudeGuidelines, versioningInstructions]) {
      expect(guidance).not.toMatch(/minor[^\n]*feature release/i);
      expect(guidance).toMatch(/minor[^\n]*approved emergency Legacy Desktop maintenance release/i);
    }
  });

  it("documents manual review and publication of the prepared draft", () => {
    for (const guidance of [claudeGuidelines, versioningInstructions]) {
      expect(guidance).toMatch(/workflow[^\n]*only prepares? (?:a )?draft/i);
      expect(guidance).toMatch(/maintainer[^\n]*review[^\n]*assets[^\n]*notes[^\n]*manually[^\n]*Publish/i);
    }
  });

  it("labels the CI desktop build as legacy while preserving dependencies and Tauri build", () => {
    const build = jobBlock(ci, "build");
    expect(build).toContain("name: Legacy Desktop build (compile validation only)");
    expect(build).toMatch(/needs:\s*\[test, test-vscode, test-extension\]/);
    expect(build).toContain("npm run tauri build");
  });

  it("makes legacy desktop release an explicitly confirmed manual workflow", () => {
    expect(release).toMatch(/^name: Legacy Desktop Release$/m);
    const trigger = indentedBlock(release, "on:", 0);
    expect(trigger).toMatch(/^on:\n  workflow_dispatch:/);
    expect(trigger.match(/^  [A-Za-z_][\w-]*:/gm)).toEqual(["  workflow_dispatch:"]);
    expect(trigger).toContain("confirm_emergency_release:");
    const confirmationInput = indentedBlock(trigger, "confirm_emergency_release:", 6);
    expect(confirmationInput).toContain("required: true");
    expect(confirmationInput).toContain("type: string");
    expect(trigger).not.toContain("bump_major:");
  });

  it("rejects legacy desktop releases unless the exact emergency confirmation is supplied", () => {
    const confirmation = namedStep(jobBlock(release, "compute-version"), "Confirm emergency-only release");
    expect(confirmation).toContain("CONFIRMATION: ${{ inputs.confirm_emergency_release }}");
    expect(confirmation).toContain('if [ "${CONFIRMATION}" != "RELEASE_LEGACY_DESKTOP" ]; then');
    expect(confirmation).toMatch(/^\s+exit 1$/m);
  });

  it("gates desktop builds on every test job", () => {
    expect(jobBlock(ci, "build")).toMatch(/needs:\s*\[test, test-vscode, test-extension\]/);
  });

  it("binds version, draft, builds, and uploads to the dispatched source commit", () => {
    const compute = jobBlock(release, "compute-version");
    expect(compute).toContain("source_sha: ${{ steps.ver.outputs.source_sha }}");
    expect(namedStep(compute, "Compute version")).toContain('SOURCE_SHA=$(git rev-parse HEAD)');
    expect(namedStep(compute, "Compute version")).toContain('echo "source_sha=${SOURCE_SHA}" >> "$GITHUB_OUTPUT"');

    const sourceRef = "ref: ${{ needs.compute-version.outputs.source_sha }}";
    for (const name of ["build-and-upload", "finalize-release"]) {
      expect(actionStep(jobBlock(release, name), "actions/checkout@v6")).toContain(sourceRef);
    }

    const build = jobBlock(release, "build-and-upload");
    const buildStep = namedStep(build, "Build Legacy Desktop app");
    expect(buildStep).toContain("uses: tauri-apps/tauri-action@v0");
    expect(buildStep).toContain("releaseDraft: true");
    expect(build).toContain("SOURCE_SHA: ${{ needs.compute-version.outputs.source_sha }}");
    expect(build).toContain('ACTUAL_SHA=$(git rev-parse HEAD)');
    expect(build).toContain('if [ "$ACTUAL_SHA" != "$SOURCE_SHA" ]; then');
    expectOrdered(build, ["Verify source commit before upload", "Build Legacy Desktop app"]);
  });

  it("serializes an exact-commit draft before parallel asset uploads", () => {
    const draft = jobBlock(release, "create-draft-release");
    expect(draft).toContain("needs: compute-version");
    expect(draft).toContain("permissions:");
    expect(draft).toContain("contents: write");
    expect(draft).toContain("TAG: ${{ needs.compute-version.outputs.tag }}");
    expect(draft).toContain("VERSION: ${{ needs.compute-version.outputs.version }}");
    expect(draft).toContain("SOURCE_SHA: ${{ needs.compute-version.outputs.source_sha }}");
    expect(draft).toContain("gh release view");
    expect(draft).toContain("--json isDraft,targetCommitish");
    expect(draft).toContain('if [ "${TARGET_COMMITISH}" != "${SOURCE_SHA}" ]; then');
    expect(draft).toContain("gh release create");
    expect(draft).toContain('--target "${SOURCE_SHA}"');
    expect(draft).toMatch(/^\s+--draft\s*\\?$/m);
    expect((release.match(/^  create-draft-release:$/gm) ?? [])).toHaveLength(1);
    expect(jobBlock(release, "build-and-upload")).toContain("needs: [compute-version, create-draft-release]");
  });

  it("keeps extension products at 1.5.0 while desktop version files remain unchanged", () => {
    expect(vscodePackage.version).toBe("1.5.0");
    expect(vscodeLock.version).toBe(vscodePackage.version);
    expect(vscodeLock.packages[""].version).toBe(vscodePackage.version);
    expect(rootPackage.version).toBe("1.3.4");
    expect(read("VERSION").trim()).toBe("1.3");
    expect(read("src-tauri/Cargo.toml")).toMatch(/^version = "1\.3\.4"$/m);
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("1.3.4");
  });

  it("keeps the root GitHub release desktop-only", () => {
    expect(release).not.toMatch(/^  build-browser-extensions:$/m);
    expect(release).not.toContain("pindouverse-chrome-");
    expect(release).not.toContain("pindouverse-edge-");
    expect(jobBlock(release, "finalize-release")).toMatch(/needs:\s*\[compute-version, create-draft-release, build-and-upload\]/);
  });

  it("prepares draft release notes without any publication mutation", () => {
    const finalize = jobBlock(release, "finalize-release");
    expect(finalize).toContain("name: Prepare Legacy Desktop draft release notes");
    expect(finalize).toContain("- name: Update draft release notes");
    expect(release).not.toMatch(/--draft(?:=|\s+)false/);
    expect(release).not.toMatch(/gh\s+release\s+(?:edit|create)[^\n]*(?:--draft(?:=|\s+)false|--latest)/);
    expect(release).not.toMatch(/gh\s+api[^\n]*(?:\/releases\/[^\s]+|\/releases\/latest)[^\n]*\s-X\s+(?:PATCH|POST)/i);
  });
});
