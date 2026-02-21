import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { UxKpiReportSchema, type InstallAttemptReport, type UxKpiReport } from "./types";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string, mode = 0o700): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonAtomic(filePath: string, value: unknown, mode = 0o600): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tmpFile = `${filePath}.tmp`;
  const json = `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(tmpFile, json, { mode });
  await fs.rename(tmpFile, filePath);
  await fs.chmod(filePath, mode);
}

export async function writeSecret(filePath: string, value: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, `${value.trim()}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

export async function writeInstallAttemptReport(
  report: InstallAttemptReport,
  options?: {
    reportsDir?: string;
    prefix?: string;
  }
): Promise<string> {
  const reportsDir = options?.reportsDir ?? path.join(process.cwd(), ".faye", "reports");
  const prefix = options?.prefix ?? "install-attempt";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(reportsDir, `${prefix}-${stamp}-${process.pid}.json`);
  await writeJsonAtomic(filePath, report, 0o600);
  return filePath;
}

export async function readUxKpiReport(filePath: string): Promise<UxKpiReport | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }
  const parsed = await readJsonFile<unknown>(filePath);
  return UxKpiReportSchema.parse(parsed);
}

export async function writeUxKpiReport(filePath: string, report: UxKpiReport): Promise<void> {
  const valid = UxKpiReportSchema.parse(report);
  await writeJsonAtomic(filePath, valid, 0o600);
}

export async function readSecret(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.trim();
}

export async function fileMode(filePath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mode & 0o777;
  } catch {
    return null;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function profileIdFromName(name: string): string {
  const base = slugify(name) || "profile";
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`.slice(0, 64);
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function expandHomePath(maybePath: string): string {
  if (maybePath === "~") {
    return process.env.HOME ?? maybePath;
  }
  if (maybePath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", maybePath.slice(2));
  }
  return maybePath;
}
