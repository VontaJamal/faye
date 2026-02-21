import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { expandHomePath, profileIdFromName, slugify, writeInstallAttemptReport, writeJsonAtomic } from "../utils";

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

test("writeJsonAtomic tolerates concurrent writes to the same file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-utils-atomic-"));
  const targetPath = path.join(tempDir, "runtime.json");

  const writeTasks = Array.from({ length: 80 }, (_, index) =>
    writeJsonAtomic(
      targetPath,
      {
        version: 1,
        writer: index,
        updatedAt: new Date().toISOString()
      },
      0o600
    )
  );

  await Promise.all(writeTasks);

  const raw = await fs.readFile(targetPath, "utf8");
  const parsed = JSON.parse(raw) as {
    version: number;
    writer: number;
    updatedAt: string;
  };

  assert.equal(parsed.version, 1);
  assert.equal(Number.isInteger(parsed.writer), true);
  assert.equal(typeof parsed.updatedAt, "string");

  const leftovers = (await fs.readdir(tempDir)).filter((entry) => entry.endsWith(".tmp"));
  assert.equal(leftovers.length, 0);
});

test("writeJsonAtomic keeps bridge runtime and processed-key payloads valid under contention", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faye-utils-bridge-"));
  const runtimePath = path.join(tempDir, "bridge-runtime-status.json");
  const processedKeysPath = path.join(tempDir, "bridge-processed-keys.json");

  await Promise.all(
    Array.from({ length: 48 }, (_, index) =>
      writeJsonAtomic(
        runtimePath,
        {
          state: index % 2 === 0 ? "idle" : "processing",
          updatedAt: new Date().toISOString(),
          consecutiveErrors: index,
          backoffMs: 2000,
          lastUpdateId: index
        },
        0o600
      )
    )
  );

  await Promise.all(
    Array.from({ length: 48 }, (_, index) =>
      writeJsonAtomic(
        processedKeysPath,
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          keys: [`command-${index}`]
        },
        0o600
      )
    )
  );

  const runtime = JSON.parse(await fs.readFile(runtimePath, "utf8")) as {
    state: string;
    updatedAt: string;
    consecutiveErrors: number;
    backoffMs: number;
    lastUpdateId: number;
  };
  const processed = JSON.parse(await fs.readFile(processedKeysPath, "utf8")) as {
    version: number;
    updatedAt: string;
    keys: string[];
  };

  assert.equal(["starting", "idle", "processing", "error"].includes(runtime.state), true);
  assert.equal(typeof runtime.updatedAt, "string");
  assert.equal(Number.isFinite(runtime.consecutiveErrors), true);
  assert.equal(Number.isFinite(runtime.backoffMs), true);
  assert.equal(Number.isFinite(runtime.lastUpdateId), true);

  assert.equal(processed.version, 1);
  assert.equal(typeof processed.updatedAt, "string");
  assert.equal(Array.isArray(processed.keys), true);
  assert.equal(processed.keys.length, 1);
  assert.equal(processed.keys[0]?.startsWith("command-"), true);
});
