import * as path from "node:path";
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { TOOL_LIMITS } from "../../../src/blueprint/toolContract";

export function isPathWithinRoot(root: string, candidate: string, flavor: "win32" | "posix"): boolean {
  const paths = path[flavor];
  if (!paths.isAbsolute(root) || !paths.isAbsolute(candidate)) return false;
  const relative = paths.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
}

export interface BlueprintFileGrant {
  id: string;
  path: string;
  canonicalPath: string;
  mode: "read" | "write";
  editorId: string;
  operationId: string;
  expiresAt: number;
}

async function canonicalFile(file: string): Promise<string> {
  try { return await realpath(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonicalFile(parent), path.basename(file));
  }
}

export class BlueprintFileAccess {
  private readonly grants = new Map<string, BlueprintFileGrant>();
  constructor(private readonly roots: string[], private readonly trusted: () => boolean) {}

  async authorize(file: string, mode: "read" | "write", editorId: string, operationId: string, userSelected = false): Promise<BlueprintFileGrant> {
    if (!this.trusted()) throw new Error("Workspace trust is required for Agent file access");
    if (!path.isAbsolute(file) || file.startsWith("\\\\") || file.startsWith("//") || file.includes("\0")) throw new Error("Only absolute local file paths are supported");
    if (process.platform === "win32" && file.slice(2).includes(":")) throw new Error("Alternate data streams are not allowed");
    const extension = path.extname(file).toLowerCase();
    if (!(mode === "read" ? [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"] : [".png", ".jpg", ".jpeg", ".pindou"]).includes(extension))
      throw new Error("Unsupported file type for this operation");
    const canonicalPath = await canonicalFile(file);
    const roots = await Promise.all(this.roots.map(root => realpath(root).catch(() => undefined)));
    const flavor = process.platform === "win32" ? "win32" : "posix";
    if (!userSelected && !roots.some(root => root && isPathWithinRoot(root, canonicalPath, flavor))) throw new Error("Select this outside-workspace file through a file dialog");
    const info = await stat(file).catch(error => {
      if (mode === "write" && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info && !info.isFile()) throw new Error("A regular file is required");
    if (mode === "read" && (!info || info.size < 1 || info.size > TOOL_LIMITS.imageBytes)) throw new Error("Input image exceeds byte limits");
    await access(info ? file : path.dirname(file), mode === "read" ? constants.R_OK : constants.W_OK);
    const grant = { id: randomUUID(), path: file, canonicalPath, mode, editorId, operationId, expiresAt: Date.now() + TOOL_LIMITS.mediaTimeoutMs };
    for (const [id, previous] of this.grants) if (previous.expiresAt < Date.now()) this.grants.delete(id);
    this.grants.set(grant.id, grant);
    return grant;
  }

  async validate(id: string, mode: "read" | "write", editorId: string, operationId: string): Promise<BlueprintFileGrant> {
    const grant = this.grants.get(id);
    if (!grant || !this.trusted() || grant.expiresAt < Date.now() || grant.editorId !== editorId
      || grant.operationId !== operationId || grant.mode !== mode) throw new Error("File grant is missing, expired, or bound to a different operation");
    if (await canonicalFile(grant.path) !== grant.canonicalPath) throw new Error("Authorized file path changed");
    return grant;
  }

  revokeOperation(operationId: string): void {
    for (const [id, grant] of this.grants) if (grant.operationId === operationId) this.grants.delete(id);
  }

  revokeEditor(editorId: string): void {
    for (const [id, grant] of this.grants) if (grant.editorId === editorId) this.grants.delete(id);
  }
}