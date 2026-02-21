import test from "node:test";
import assert from "node:assert/strict";

import { EventHub } from "../events";

test("event hub isolates listener failures during fanout", () => {
  const hub = new EventHub();
  let received = 0;

  hub.subscribe(() => {
    throw new Error("listener failed");
  });
  hub.subscribe(() => {
    received += 1;
  });

  const published = hub.publish("wake_detected", { session_id: "s-1" });
  assert.equal(published.type, "wake_detected");
  assert.equal(received, 1);
});

test("event hub retains most recent 100 events", () => {
  const hub = new EventHub();

  for (let i = 0; i < 130; i += 1) {
    hub.publish("listener_status", { index: i });
  }

  const recent = hub.recentEvents();
  assert.equal(recent.length, 100);
  assert.equal((recent[0]?.payload["index"] as number) >= 30, true);
});
