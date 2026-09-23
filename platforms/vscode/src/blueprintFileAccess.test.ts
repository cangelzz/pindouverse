import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlueprintFileAccess, isPathWithinRoot } from "./blueprintFileAccess";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("rejects sibling prefixes and traversal", () => {
  expect(isPathWithinRoot("C:\\art", "C:\\art\\drawing.png", "win32")).toBe(true);
  expect(isPathWithinRoot("C:\\art", "C:\\art-private\\drawing.png", "win32")).toBe(false);
  expect(isPathWithinRoot("/art", "/art/../private/drawing.png", "posix")).toBe(false);
});

it("binds file grants to editor, invocation and workspace trust", async () => {
  const root = await mkdtemp(join(tmpdir(), "pindou-tools-"));
  directories.push(root);
  const trusted = vi.fn(() => true);
  const access = new BlueprintFileAccess([root], trusted);
  const output = join(root, "new.png");
  const grant = await access.authorize(output, "write", "editor-1", "tool:1");
  await expect(access.validate(grant.id, "read", "editor-1", "tool:1")).rejects.toThrow();
  await expect(access.validate(grant.id, "write", "editor-2", "tool:1")).rejects.toThrow();
  expect((await access.validate(grant.id, "write", "editor-1", "tool:1")).path).toBe(output);
  trusted.mockReturnValue(false);
  await expect(access.validate(grant.id, "write", "editor-1", "tool:1")).rejects.toThrow();
});

it("requires a real user selection outside workspace roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "pindou-tools-"));
  directories.push(root);
  await mkdir(join(root, "workspace"));
  const path = join(root, "outside.png");
  await writeFile(path, "fixture");
  const access = new BlueprintFileAccess([join(root, "workspace")], () => true);
  await expect(access.authorize(path, "read", "editor-1", "tool:1")).rejects.toThrow();
});