import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { expandHomePath, profileIdFromName, slugify, writeInstallAttemptReport } from "../utils";

test("slugify normalizes input and trims separators", () => {
  assert.equal(slugify("  Faye Primary Voice  "), "faye-primary-voice");
  assert.equal(slugify("***"), "");
});

test("profileIdFromName creates bounded IDs", () => {
  const id = profileIdFromName("A very long profile name with symbols !!! and spaces");
  assert.equal(id.length <= 64, true);
  assert.equal(/^[a-z0-9-]+$/.test(id), true);
});

test("expandHomePath resolves tilde paths", () => {
  const home = process.env.HOME ?? "";
  assert.equal(expandHomePath("~"), home);
  assert.equal(expandHomePath("~/foo/bar"), path.join(home, "foo", "bar"));
  assert.equal(expandHomePath("/tmp/abc"), "/tmp/abc");
});

test("writeInstallAttemptReport writes a report file and returns path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-utils-report-"));

  const reportPath = await writeInstallAttemptReport(
    {
      schemaVersion: 1,
      attemptId: "install-test-123456",
      generatedAt: new Date().toISOString(),
      source: "manual",
      success: true,
      durationMs: 100,
      platform: "test-platform",
      nodeVersion: process.versions.node,
      doctorOk: true,
      servicesOk: true,
      firstSpeakOk: true,
      steps: [
        {
          name: "example",
          ok: true,
          code: "OK",
          message: "done",
          durationMs: 100
        }
      ],
      notes: ["test"]
    },
    {
      reportsDir: tempDir,
      prefix: "install-attempt"
    }
  );

  const raw = await fs.readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw);

  assert.equal(path.basename(reportPath).startsWith("install-attempt-"), true);
  assert.equal(parsed.attemptId, "install-test-123456");
  assert.equal(parsed.success, true);
});
