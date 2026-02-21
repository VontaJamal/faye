#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    i += 1;
  }
  return flags;
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[middle - 1] ?? sorted[middle] ?? 0;
    const right = sorted[middle] ?? left;
    return Math.round((left + right) / 2);
  }
  return sorted[middle] ?? null;
}

async function loadReports(reportsDir) {
  const entries = await fs.readdir(reportsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^install-attempt-.*\.json$/.test(entry.name))
    .map((entry) => path.join(reportsDir, entry.name));

  const reports = [];
  for (const filePath of files) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      reports.push({ filePath, report: parsed });
    } catch {
      // ignore malformed files in KPI aggregation
    }
  }

  return reports;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const reportsDir = typeof flags.get("reports-dir") === "string" ? String(flags.get("reports-dir")) : path.join(process.cwd(), ".faye", "reports");
  const jsonOutput = flags.has("json");

  let reports;
  try {
    reports = await loadReports(reportsDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`E_INSTALL_KPI_READ_FAILED: ${message}`);
    process.exit(1);
    return;
  }

  const installReports = reports.map((entry) => entry.report).filter((report) => report && typeof report.success === "boolean");
  const totalAttempts = installReports.length;
  const successfulAttempts = installReports.filter((report) => report.success === true).length;
  const failedAttempts = totalAttempts - successfulAttempts;
  const successRate = totalAttempts > 0 ? successfulAttempts / totalAttempts : 0;

  const durations = installReports
    .map((report) => (typeof report.durationMs === "number" ? Math.max(0, Math.round(report.durationMs)) : null))
    .filter((value) => value !== null);

  const timestamps = installReports
    .map((report) => (typeof report.generatedAt === "string" ? report.generatedAt : null))
    .filter((value) => value !== null)
    .sort();

  const summary = {
    generatedAt: new Date().toISOString(),
    reportsDir,
    totalAttempts,
    successfulAttempts,
    failedAttempts,
    successRate,
    medianDurationMs: median(durations),
    window: {
      firstAttemptAt: timestamps[0] ?? null,
      lastAttemptAt: timestamps[timestamps.length - 1] ?? null
    }
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Install KPI Summary");
    console.log(`Reports dir: ${reportsDir}`);
    console.log(`Attempts: ${totalAttempts}`);
    console.log(`Successes: ${successfulAttempts}`);
    console.log(`Failures: ${failedAttempts}`);
    console.log(`Success rate: ${(summary.successRate * 100).toFixed(1)}%`);
    console.log(`Median duration: ${summary.medianDurationMs ?? "n/a"} ms`);
    console.log(`Window: ${summary.window.firstAttemptAt ?? "n/a"} -> ${summary.window.lastAttemptAt ?? "n/a"}`);
  }

  if (totalAttempts === 0) {
    console.error("E_INSTALL_KPI_NO_REPORTS");
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E_INSTALL_KPI_INTERNAL: ${message}`);
  process.exit(1);
});
