import { createApiServer } from "./api";
import { ElevenLabsClient } from "./elevenlabs";
import { EventHub } from "./events";
import { createLogger } from "./logger";
import { ServiceControl } from "./service-control";
import { ConfigStore } from "./store";

export async function startApiServer(): Promise<void> {
  const logger = createLogger();
  const store = new ConfigStore(logger);
  await store.init();

  const events = new EventHub(({ error, event }) => {
    logger.warn("EVENT_LISTENER_FAILED", "Event listener threw during fanout", {
      eventType: event.type,
      message: error instanceof Error ? error.message : String(error)
    });
  });
  const elevenLabs = new ElevenLabsClient(logger);
  const services = new ServiceControl(logger);

  const app = createApiServer({
    store,
    events,
    logger,
    elevenLabs,
    services
  });

  const port = 4587;
  app.listen(port, "127.0.0.1", () => {
    logger.info("API_LISTENING", "Faye API listening", {
      baseUrl: `http://127.0.0.1:${port}`,
      dashboard: "http://127.0.0.1:4587"
    });
  });
}

if (require.main === module) {
  startApiServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
