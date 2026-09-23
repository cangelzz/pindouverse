import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { readExtensionVersion } from "../scripts/extension-version.mjs";

const root = resolve(import.meta.dirname, "..");

describe("extension product version", () => {
  it("uses the VS Code package as the shared extension version source", () => {
    expect(readExtensionVersion()).toBe("1.5.0");
    expect(JSON.parse(readFileSync(resolve(root, "platforms/vscode/package.json"), "utf8")).version).toBe("1.5.0");
  });

  it("does not derive the extension version from desktop version files", () => {
    expect(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version).toBe("1.3.4");
    expect(readFileSync(resolve(root, "VERSION"), "utf8").trim()).toBe("1.3");
    expect(readExtensionVersion()).not.toBe("1.3.4");
  });
});
