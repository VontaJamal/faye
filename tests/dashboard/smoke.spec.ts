import { expect, test, type Page, type Route } from "@playwright/test";

interface MockState {
  setupPosts: number;
  listenerRestarts: number;
  bridgeRestarts: number;
  speakTests: number;
  setupPayloads: Array<Record<string, unknown>>;
  onboarding: {
    checklist: {
      bridgeRequired: boolean;
      completed: number;
      total: number;
      items: Array<{ id: string; label: string; ok: boolean; message: string }>;
    };
    firstSetupAt: string | null;
    firstVoiceSuccessAt: string | null;
    timeToFirstSuccessMs: number | null;
    lastVoiceTestAt: string | null;
    lastVoiceTestOk: boolean | null;
  };
}

function initialState(): MockState {
  return {
    setupPosts: 0,
    listenerRestarts: 0,
    bridgeRestarts: 0,
    speakTests: 0,
    setupPayloads: [],
    onboarding: {
      checklist: {
        bridgeRequired: false,
        completed: 3,
        total: 4,
        items: [
          {
            id: "services-ready",
            label: "Services ready",
            ok: true,
            message: "listener + dashboard must be running (bridge optional)"
          },
          {
            id: "api-key-ready",
            label: "API key ready",
            ok: false,
            message: "active profile key file exists and has 0600 permissions"
          },
          {
            id: "profile-configured",
            label: "Profile configured",
            ok: true,
            message: "profile has real voice and wake-word values"
          },
          {
            id: "voice-test-passed",
            label: "Voice test passed",
            ok: false,
            message: "latest dashboard voice test completed successfully"
          }
        ]
      },
      firstSetupAt: null,
      firstVoiceSuccessAt: null,
      timeToFirstSuccessMs: null,
      lastVoiceTestAt: null,
      lastVoiceTestOk: null
    }
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function healthFromState(state: MockState): Record<string, unknown> {
  return {
    ok: true,
    doctor: {
      ok: true
    },
    services: {
      listener: { code: 0, stdout: "listener: running", stderr: "" },
      dashboard: { code: 0, stdout: "dashboard: running", stderr: "" },
      bridge: { code: 0, stdout: "bridge: running", stderr: "" }
    },
    bridgeRuntime: {
      state: "idle",
      updatedAt: "2026-02-21T00:00:00.000Z",
      consecutiveErrors: 0,
      backoffMs: 0
    },
    roundTrip: {
      watchdogMs: 5000,
      autoRetryLimit: 1,
      activeSessions: 0,
      pendingSessions: [],
      totals: {
        started: 1,
        retriesSent: 0,
        completed: 1,
        timeouts: 0
      },
      lastCompleted: {
        sessionId: "session-1",
        at: "2026-02-21T00:00:00.000Z",
        retryCount: 0,
        status: "ok"
      },
      lastTimeout: null
    },
    metrics: {
      generatedAt: "2026-02-21T00:00:00.000Z",
      eventCounts: {
        wakeDetections: 2,
        messageTranscribed: 2,
        listenerErrors: 0,
        bridgeSpeakReceived: 2
      },
      roundTrip: {
        bridgeSpokenOk: 2,
        bridgeSpokenError: 0,
        bridgeSpokenDuplicate: 0,
        retriesSent: 0,
        timeouts: 0,
        activeTrackedSessions: 0
      },
      latency: {
        samples: 2,
        lastMs: 1320,
        p50Ms: 1320,
        p95Ms: 1450,
        p99Ms: 1450,
        maxMs: 1450
      },
      errorRate: {
        numerator: 0,
        denominator: 2,
        value: 0
      }
    },
    onboarding: state.onboarding
  };
}

async function installDashboardApiMocks(page: Page): Promise<MockState> {
  const state = initialState();

  await page.route("**/v1/events", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream"
      },
      body: 'data: {"id":"event-1","type":"listener_status","time":"2026-02-21T00:00:00.000Z","payload":{"state":"running"}}\n\n'
    });
  });

  await page.route("**/v1/health", async (route) => {
    await json(route, healthFromState(state));
  });

  await page.route("**/v1/profiles", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, {
        activeProfileId: "primary-profile",
        profiles: [
          {
            id: "primary-profile",
            name: "Primary Voice",
            voiceId: "voice_123",
            voiceName: "Main",
            wakeWord: "Faye Arise"
          }
        ]
      });
      return;
    }

    await json(route, { profile: { id: "new-profile" } }, 201);
  });

  await page.route("**/v1/setup", async (route) => {
    state.setupPosts += 1;
    state.setupPayloads.push(route.request().postDataJSON() as Record<string, unknown>);

    state.onboarding.checklist.items = state.onboarding.checklist.items.map((item) =>
      item.id === "api-key-ready" ? { ...item, ok: true } : item
    );
    state.onboarding.checklist.completed = state.onboarding.checklist.items.filter((item) => item.ok).length;
    state.onboarding.firstSetupAt = "2026-02-21T00:01:00.000Z";

    await json(route, {
      profile: {
        id: "primary-profile"
      },
      listenerRestart: {
        code: 0,
        stdout: "listener restarted",
        stderr: ""
      }
    }, 201);
  });

  await page.route("**/v1/listener/restart", async (route) => {
    state.listenerRestarts += 1;
    await json(route, {
      result: {
        code: 0,
        stdout: "listener restarted",
        stderr: ""
      }
    });
  });

  await page.route("**/v1/bridge/restart", async (route) => {
    state.bridgeRestarts += 1;
    await json(route, {
      result: {
        code: 0,
        stdout: "bridge restarted",
        stderr: ""
      }
    });
  });

  await page.route("**/v1/speak/test", async (route) => {
    state.speakTests += 1;
    state.onboarding.checklist.items = state.onboarding.checklist.items.map((item) =>
      item.id === "voice-test-passed" ? { ...item, ok: true } : item
    );
    state.onboarding.checklist.completed = state.onboarding.checklist.items.filter((item) => item.ok).length;
    state.onboarding.firstVoiceSuccessAt = "2026-02-21T00:05:00.000Z";
    state.onboarding.lastVoiceTestAt = "2026-02-21T00:05:00.000Z";
    state.onboarding.lastVoiceTestOk = true;
    state.onboarding.timeToFirstSuccessMs = 240000;

    await json(route, {
      ok: true,
      profileId: "primary-profile"
    });
  });

  return state;
}

test("page load renders status chips and first-success checklist", async ({ page }) => {
  await installDashboardApiMocks(page);
  await page.goto("/");

  await expect(page.locator("#service-summary")).toContainText("Listener: running");
  await expect(page.locator("#service-summary")).toContainText("Dashboard: running");
  await expect(page.locator("#first-success-checklist")).toContainText("Progress: 3/4");
  await expect(page.locator("#first-success-checklist")).toContainText("Voice test passed");
});

test("invalid setup blocks submit with field-level errors", async ({ page }) => {
  const state = await installDashboardApiMocks(page);
  await page.goto("/");

  await page.fill("#setup-profile-name", "");
  await page.fill("#setup-voice-id", "");
  await page.fill("#setup-voice-name", "");
  await page.click("button:has-text('Save Setup')");

  await expect(page.locator("[data-setup-error='profileName']")).toContainText("Profile name is required");
  await expect(page.locator("[data-setup-error='voiceId']")).toContainText("Voice ID is required");
  await expect(page.locator("[data-setup-error='voiceName']")).toContainText("Voice name is required");
  await expect(page.locator("[data-setup-error='apiKey']")).toContainText("API key is required");
  await expect(page.locator("#setup-validation-summary")).toContainText("Please fix these fields");

  expect(state.setupPosts).toBe(0);
});

test("valid setup submits and clears validation summary", async ({ page }) => {
  const state = await installDashboardApiMocks(page);
  await page.goto("/");

  await page.fill("#setup-profile-name", "Primary Voice");
  await page.fill("#setup-voice-id", "voice_main_123");
  await page.fill("#setup-voice-name", "Main Voice");
  await page.fill("#setup-api-key", "sk_test_123456");
  await page.fill("#setup-wake-word", "Faye Arise");
  await page.click("button:has-text('Save Setup')");

  await expect(page.locator("#setup-status")).toContainText("Setup saved");
  await expect(page.locator("#setup-validation-summary")).not.toContainText("Please fix these fields");
  expect(state.setupPosts).toBe(1);
  expect(state.setupPayloads[0]?.voiceId).toBe("voice_main_123");
});

test("quick actions call restart endpoints and update status", async ({ page }) => {
  const state = await installDashboardApiMocks(page);
  await page.goto("/");

  await page.click("#restart-listener");
  await expect(page.locator("#setup-status")).toContainText("Listener restart requested");

  await page.click("#restart-bridge");
  await expect(page.locator("#setup-status")).toContainText("Bridge restart requested");

  await page.click("#refresh-health");
  await expect(page.locator("#setup-status")).toContainText("Status refreshed");

  expect(state.listenerRestarts).toBe(1);
  expect(state.bridgeRestarts).toBe(1);
});

test("voice test success advances checklist to complete", async ({ page }) => {
  const state = await installDashboardApiMocks(page);
  state.onboarding.checklist.items = state.onboarding.checklist.items.map((item) =>
    item.id === "api-key-ready" ? { ...item, ok: true } : item
  );
  state.onboarding.checklist.completed = state.onboarding.checklist.items.filter((item) => item.ok).length;
  await page.goto("/");

  await expect(page.locator("#first-success-checklist")).toContainText("Progress: 3/4");

  await page.click("#test-voice");
  await expect(page.locator("#setup-status")).toContainText("Voice test played");
  await expect(page.locator("#first-success-checklist")).toContainText("Progress: 4/4");
  await expect(page.locator("#first-success-checklist")).toContainText("Ready. You can now talk to your agent in a stable loop.");

  expect(state.speakTests).toBe(1);
});
