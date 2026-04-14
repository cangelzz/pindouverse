import { describe, it, expect } from "vitest";

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
