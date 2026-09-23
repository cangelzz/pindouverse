import * as path from "path";
import * as os from "os";
import { runTests } from "@vscode/test-electron";

async function main() {
  // Known issue: on Windows, modern VS Code "Code.exe" is a thin launcher that
  // rejects the CLI args @vscode/test-electron passes. Pinning to old VS Code
  // sometimes works but is unreliable. CI runs this on Linux (with xvfb) where
  // it works, and the webview test suite covers the same surface area for
  // local Windows dev. Skip locally on Windows unless explicitly forced.
  if (os.platform() === "win32" && !process.env.PINDOU_FORCE_E2E) {
    console.log(
      "[e2e] Skipping on Windows (set PINDOU_FORCE_E2E=1 to run anyway)."
    );
    console.log("[e2e] CI runs this suite on Linux. Webview tests cover the same logic locally.");
    return;
  }

  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    await runTests({
      version: process.env.PINDOU_VSCODE_VERSION || "stable",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ["--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main();
