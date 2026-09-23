import type { ProjectFile } from "../types";
import type { PlatformResult } from "./result";

export interface ProjectDocumentRef {
  displayName: string;
  writable: boolean;
  handle?: FileSystemFileHandle;
  fallbackDownloadName?: string;
}

export interface OpenedProject {
  project: ProjectFile;
  document: ProjectDocumentRef;
}

export interface ProjectFileService {
  saveLiveProject?(mode: "save" | "saveAs"): Promise<PlatformResult<void>>;
  openProject(): Promise<PlatformResult<OpenedProject>>;
  saveProject(project: ProjectFile, current: ProjectDocumentRef): Promise<PlatformResult<ProjectDocumentRef>>;
  saveProjectAs(project: ProjectFile, suggestedName: string): Promise<PlatformResult<ProjectDocumentRef>>;
  exportProject(project: ProjectFile, suggestedName: string): Promise<PlatformResult<void>>;
}
