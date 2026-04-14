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

async function throwOnError(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const body = await res.json();
    detail = body.message || JSON.stringify(body);
  } catch {
    detail = res.statusText;
  }
  throw new Error(`${action}: ${res.status} ${detail}`);
}

export function toFilename(name: string): string {
  return `${PREFIX}${name}${SUFFIX}`;
}

export function fromFilename(filename: string): string | null {
  if (!filename.startsWith(PREFIX) || !filename.endsWith(SUFFIX)) return null;
  return filename.slice(PREFIX.length, -SUFFIX.length);
}

export async function listProjects(token: string): Promise<GistProject[]> {
  const projects: GistProject[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${GIST_API}/gists?per_page=100&page=${page}`, {
      headers: headers(token),
    });
    if (!res.ok) await throwOnError(res, "获取项目列表失败");
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
          break;
        }
      }
    }
    if (gists.length < 100) break;
    page++;
  }
  return projects;
}

export async function uploadProject(
  token: string,
  name: string,
  project: ProjectFile,
  gistId?: string,
): Promise<{ gistId: string; updatedAt: string }> {
  const filename = toFilename(name);
  const content = JSON.stringify(project, null, 2);

  if (gistId) {
    const res = await fetch(`${GIST_API}/gists/${gistId}`, {
      method: "PATCH",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `PindouVerse: ${name}`,
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) await throwOnError(res, "上传失败");
    const data = await res.json();
    return { gistId: data.id, updatedAt: data.updated_at };
  } else {
    const res = await fetch(`${GIST_API}/gists`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `PindouVerse: ${name}`,
        public: false,
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) await throwOnError(res, "上传失败");
    const data = await res.json();
    return { gistId: data.id, updatedAt: data.updated_at };
  }
}

export async function downloadProject(
  token: string,
  gistId: string,
): Promise<{ project: ProjectFile; updatedAt: string }> {
  const res = await fetch(`${GIST_API}/gists/${gistId}`, {
    headers: headers(token),
  });
  if (!res.ok) await throwOnError(res, "下载失败");
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

export async function deleteProject(token: string, gistId: string): Promise<void> {
  const res = await fetch(`${GIST_API}/gists/${gistId}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) await throwOnError(res, "删除失败");
}

export async function listRevisions(token: string, gistId: string): Promise<GistRevision[]> {
  const res = await fetch(`${GIST_API}/gists/${gistId}/commits`, {
    headers: headers(token),
  });
  if (!res.ok) await throwOnError(res, "获取版本历史失败");
  const commits: any[] = await res.json();
  return commits.map((c) => ({
    sha: c.version,
    committedAt: c.committed_at,
  }));
}

export async function downloadRevision(
  token: string,
  gistId: string,
  sha: string,
): Promise<ProjectFile> {
  const res = await fetch(`${GIST_API}/gists/${gistId}/${sha}`, {
    headers: headers(token),
  });
  if (!res.ok) await throwOnError(res, "下载版本失败");
  const data = await res.json();
  const files = data.files || {};
  for (const fname of Object.keys(files)) {
    if (fromFilename(fname) !== null) {
      return JSON.parse(files[fname].content);
    }
  }
  throw new Error("No .pindou file found in Gist revision");
}

export async function getGistUpdatedAt(token: string, gistId: string): Promise<string> {
  const res = await fetch(`${GIST_API}/gists/${gistId}`, {
    headers: headers(token),
  });
  if (!res.ok) await throwOnError(res, "获取Gist状态失败");
  const data = await res.json();
  return data.updated_at;
}
