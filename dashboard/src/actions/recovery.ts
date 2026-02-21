import {
  FACTORY_RESET_CONFIRMATION,
  PANIC_STOP_CONFIRMATION,
  type DashboardState,
  type SystemRecoveryResponse,
  type SystemRecoveryResult
} from "../state/store.js";

interface RecoveryActionDeps {
  state: DashboardState;
  apiRequest: <T>(url: string, init?: RequestInit) => Promise<T>;
  setRecoveryStatus: (message: string, error?: boolean) => void;
  refreshHealth: () => Promise<void>;
}

function normalizedConfirmation(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function summarizeRecoveryResult(result: SystemRecoveryResult): string {
  const failures = result.errors.length;
  const base = result.action === "panic-stop" ? "Panic Stop completed." : "Factory Reset completed.";
  if (failures > 0) {
    return `${base} ${failures} warning${failures === 1 ? "" : "s"} reported.`;
  }
  return base;
}

export function bindRecoveryActions(deps: RecoveryActionDeps): void {
  const panicButton = deps.state.elements.panicStopButton;
  const resetButton = deps.state.elements.factoryResetButton;

  if (panicButton) {
    panicButton.addEventListener("click", async () => {
      const typed = normalizedConfirmation(deps.state.elements.panicConfirmationInput?.value ?? "");
      if (typed !== PANIC_STOP_CONFIRMATION) {
        deps.setRecoveryStatus(`Type ${PANIC_STOP_CONFIRMATION} exactly to enable Panic Stop.`, true);
        return;
      }

      panicButton.disabled = true;
      try {
        const response = await deps.apiRequest<SystemRecoveryResponse>("/v1/system/panic-stop", {
          method: "POST",
          body: JSON.stringify({
            confirmation: typed,
            reason: "dashboard_panic_stop"
          })
        });
        deps.setRecoveryStatus(summarizeRecoveryResult(response.result), response.ok !== true);
        if (deps.state.elements.panicConfirmationInput) {
          deps.state.elements.panicConfirmationInput.value = "";
        }
        await deps.refreshHealth();
      } catch (error) {
        deps.setRecoveryStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        panicButton.disabled = false;
      }
    });
  }

  if (!resetButton) {
    return;
  }

  resetButton.addEventListener("click", async () => {
    const resetTyped = normalizedConfirmation(deps.state.elements.factoryResetConfirmationInput?.value ?? "");
    if (resetTyped !== FACTORY_RESET_CONFIRMATION) {
      deps.setRecoveryStatus(`Type ${FACTORY_RESET_CONFIRMATION} exactly to enable Factory Reset.`, true);
      return;
    }

    resetButton.disabled = true;
    try {
      const response = await deps.apiRequest<SystemRecoveryResponse>("/v1/system/factory-reset", {
        method: "POST",
        body: JSON.stringify({
          confirmation: resetTyped,
          reason: "dashboard_factory_reset"
        })
      });
      const message = `${summarizeRecoveryResult(response.result)} Run install again and reopen the dashboard.`;
      deps.setRecoveryStatus(message, response.ok !== true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.setRecoveryStatus(
        `Factory reset likely interrupted the dashboard service. Start fresh with install, then run "faye open". (${message})`,
        false
      );
    } finally {
      resetButton.disabled = false;
      if (deps.state.elements.factoryResetConfirmationInput) {
        deps.state.elements.factoryResetConfirmationInput.value = "";
      }
    }
  });
}
