import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

interface TestControls {
  waitForEditor(uri: string): Promise<void>;
  setSaveDestination(path: string | undefined): void;
  failNextDestination(): void;
}

async function invoke(name: string, input: object = {}) {
  const response = await vscode.lm.invokeTool(`pindouverse_${name}`, { input, toolInvocationToken: undefined });
  return JSON.parse(response.content.filter(part => part instanceof vscode.LanguageModelTextPart).map(part => part.value).join(""));
}

suite("Pindou Agent tools", () => {
  let controls: TestControls;
  let directory: string;
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<TestControls>("PindouVerse.pindouverse");
    assert.ok(extension);
    controls = await extension.activate();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "pindou-agent-host-"));
  });
  suiteTeardown(async () => {
    controls.setSaveDestination(undefined);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function newEditor() {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("pindouverse.newProject");
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom);
    await controls.waitForEditor(input.uri.toString());
    const result = await invoke("inspect_blueprint");
    assert.equal(result.ok, true);
    return result.stamp;
  }

  test("registers all thirteen tools and saves into a restored destination editor", async function () {
    this.timeout(60_000);
    const stamp = await newEditor();
    assert.equal(vscode.lm.tools.filter(tool => tool.name.startsWith("pindouverse_")).length, 13);
    const colors = await invoke("search_palette", { editorId: stamp.editorId, limit: 1 });
    const changed = await invoke("set_beads", { editorId: stamp.editorId, projectGeneration: stamp.projectGeneration,
      expectedRevision: stamp.revision, layerId: stamp.activeLayerId, beads: [{ x: 0, y: 0, color: colors.value[0].code }] });
    assert.equal(changed.ok, true);
    const destination = path.join(directory, "saved.pindou");
    controls.setSaveDestination(destination);
    const saved = await invoke("save_blueprint", { editorId: stamp.editorId, projectGeneration: stamp.projectGeneration, expectedRevision: changed.stamp.revision });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.notEqual(saved.stamp.editorId, stamp.editorId);
    assert.equal(saved.stamp.isDirty, false);
    assert.ok((await fs.readFile(destination, "utf8")).length > 0);
    const inspected = await invoke("inspect_blueprint", { editorId: saved.stamp.editorId });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.value.beadCount, 1);
  });

  test("a failed destination retains the source editor after file write", async function () {
    this.timeout(60_000);
    const stamp = await newEditor();
    controls.setSaveDestination(path.join(directory, "written-before-failure.pindou"));
    controls.failNextDestination();
    const result = await invoke("save_blueprint", { editorId: stamp.editorId, projectGeneration: stamp.projectGeneration });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "save_handoff_failed");
    assert.equal(result.error.details.fileWritten, true);
    const inspected = await invoke("inspect_blueprint", { editorId: stamp.editorId });
    assert.equal(inspected.ok, true);
    const modified = await invoke("set_beads", { editorId: stamp.editorId, projectGeneration: stamp.projectGeneration,
      layerId: stamp.activeLayerId, beads: [{ x: 0, y: 0, color: null }] });
    assert.equal(modified.ok, true);
  });
});