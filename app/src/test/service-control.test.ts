import assert from "node:assert/strict";
import test from "node:test";

import { ServiceControl } from "../service-control";
import type { Logger } from "../logger";

function makeLogger(messages: Array<{ level: string; code: string }>): Logger {
  return {
    info: (code) => {
      messages.push({ level: "info", code });
    },
    warn: (code) => {
      messages.push({ level: "warn", code });
    },
    error: (code) => {
      messages.push({ level: "error", code });
    }
  };
}

test("service-control routes status and restart calls through injected runner", async () => {
  const calls: Array<{ scriptPath: string; args: string[] }> = [];
  const loggerMessages: Array<{ level: string; code: string }> = [];

  const services = new ServiceControl(makeLogger(loggerMessages), {
    listenerScript: "/tmp/listener.sh",
    dashboardScript: "/tmp/dashboard.sh",
    bridgeScript: "/tmp/bridge.sh",
    runShellFn: async (scriptPath, args) => {
      calls.push({ scriptPath, args: [...args] });
      return { code: 0, stdout: "ok", stderr: "" };
    }
  });

  await services.listenerStatus();
  await services.dashboardStatus();
  await services.bridgeStatus();
  await services.stopListener();
  await services.stopDashboard();
  await services.stopBridge();
  await services.restartListener();
  await services.restartDashboard();
  await services.restartBridge();

  assert.deepEqual(calls.map((item) => `${item.scriptPath} ${item.args.join(" ")}`), [
    "/tmp/listener.sh status",
    "/tmp/dashboard.sh status",
    "/tmp/bridge.sh status",
    "/tmp/listener.sh stop",
    "/tmp/dashboard.sh stop",
    "/tmp/bridge.sh stop",
    "/tmp/listener.sh restart",
    "/tmp/dashboard.sh restart",
    "/tmp/bridge.sh restart"
  ]);
  assert.equal(loggerMessages.length, 0);
});

test("service-control logs warnings for failed restarts", async () => {
  const loggerMessages: Array<{ level: string; code: string }> = [];

  const services = new ServiceControl(makeLogger(loggerMessages), {
    runShellFn: async () => ({ code: 1, stdout: "", stderr: "failed" })
  });

  await services.stopListener();
  await services.stopDashboard();
  await services.stopBridge();
  await services.restartListener();
  await services.restartDashboard();
  await services.restartBridge();

  assert.equal(loggerMessages.some((entry) => entry.code === "LISTENER_STOP_FAILED"), true);
  assert.equal(loggerMessages.some((entry) => entry.code === "DASHBOARD_STOP_FAILED"), true);
  assert.equal(loggerMessages.some((entry) => entry.code === "BRIDGE_STOP_FAILED"), true);
  assert.equal(loggerMessages.some((entry) => entry.code === "LISTENER_RESTART_FAILED"), true);
  assert.equal(loggerMessages.some((entry) => entry.code === "DASHBOARD_RESTART_FAILED"), true);
  assert.equal(loggerMessages.some((entry) => entry.code === "BRIDGE_RESTART_FAILED"), true);
});
