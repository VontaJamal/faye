interface Profile {
  id: string;
  name: string;
  voiceId: string;
  voiceName: string;
  wakeWord: string;
}

interface ProfilesResponse {
  activeProfileId: string;
  profiles: Profile[];
}

const setupStatus = document.querySelector<HTMLParagraphElement>("#setup-status");
const profileList = document.querySelector<HTMLDivElement>("#profile-list");
const healthPre = document.querySelector<HTMLPreElement>("#health");
const eventsList = document.querySelector<HTMLUListElement>("#events");

function setStatus(message: string, error = false): void {
  if (!setupStatus) {
    return;
  }
  setupStatus.textContent = message;
  setupStatus.classList.toggle("error", error);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function profileCard(profile: Profile, activeProfileId: string): HTMLElement {
  const card = document.createElement("article");
  card.className = `profile-card ${profile.id === activeProfileId ? "active" : ""}`;
  card.innerHTML = `
    <strong>${profile.name}</strong><br />
    <small>ID: ${profile.id}</small><br />
    <small>Voice: ${profile.voiceName} (${profile.voiceId})</small><br />
    <small>Wake: ${profile.wakeWord}</small>
  `;

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const wakeInput = document.createElement("input");
  wakeInput.type = "text";
  wakeInput.value = profile.wakeWord;
  wakeInput.setAttribute("aria-label", `Wake word for ${profile.name}`);

  const saveWake = document.createElement("button");
  saveWake.textContent = "Save Wake Word";
  saveWake.className = "secondary";
  saveWake.addEventListener("click", async () => {
    const wakeWord = wakeInput.value.trim();
    if (!wakeWord) {
      setStatus("Wake word cannot be empty.", true);
      return;
    }
    await api(`/v1/profiles/${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        wakeWord,
        wakeWordVariants: [wakeWord.toLowerCase()]
      })
    });
    setStatus(`Wake word updated for ${profile.name}`);
    await refreshProfiles();
  });

  const activate = document.createElement("button");
  activate.textContent = "Activate";
  activate.className = "secondary";
  activate.addEventListener("click", async () => {
    await api(`/v1/profiles/${profile.id}/activate`, { method: "POST" });
    setStatus(`Activated ${profile.name}`);
    await refreshProfiles();
  });

  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.className = "danger";
  remove.addEventListener("click", async () => {
    if (!confirm(`Delete profile ${profile.name}?`)) {
      return;
    }
    await api(`/v1/profiles/${profile.id}`, { method: "DELETE" });
    setStatus(`Deleted ${profile.name}`);
    await refreshProfiles();
  });

  actions.append(wakeInput, saveWake, activate, remove);
  card.append(actions);
  return card;
}

async function refreshProfiles(): Promise<void> {
  if (!profileList) {
    return;
  }

  const data = await api<ProfilesResponse>("/v1/profiles");
  profileList.innerHTML = "";

  for (const profile of data.profiles) {
    profileList.append(profileCard(profile, data.activeProfileId));
  }
}

async function refreshHealth(): Promise<void> {
  if (!healthPre) {
    return;
  }

  const health = await api<unknown>("/v1/health");
  healthPre.textContent = JSON.stringify(health, null, 2);
}

function bindSetupForm(): void {
  const form = document.querySelector<HTMLFormElement>("#setup-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const payload = {
      profileName: String(data.get("profileName") ?? "Primary Voice"),
      apiKey: String(data.get("apiKey") ?? ""),
      voiceId: String(data.get("voiceId") ?? ""),
      voiceName: String(data.get("voiceName") ?? ""),
      wakeWord: String(data.get("wakeWord") ?? "Faye Arise"),
      telegramToken: String(data.get("telegramToken") ?? ""),
      telegramChatId: String(data.get("telegramChatId") ?? "")
    };

    try {
      await api("/v1/setup", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setStatus("Setup saved.");
      await refreshProfiles();
      await refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  const testButton = document.querySelector<HTMLButtonElement>("#test-voice");
  testButton?.addEventListener("click", async () => {
    try {
      await api("/v1/speak/test", {
        method: "POST",
        body: JSON.stringify({ text: "Faye is online." })
      });
      setStatus("Voice test played.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function bindCreateProfileForm(): void {
  const form = document.querySelector<HTMLFormElement>("#create-profile-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);

    try {
      await api("/v1/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name")),
          voiceId: String(data.get("voiceId")),
          voiceName: String(data.get("voiceName")),
          wakeWord: String(data.get("wakeWord")),
          wakeWordVariants: [String(data.get("wakeWord")).toLowerCase()],
          model: "eleven_multilingual_v2",
          stability: 0.4,
          similarityBoost: 0.8,
          style: 0.7,
          elevenLabsApiKeyPath: "~/.openclaw/secrets/elevenlabs-api-key.txt",
          silenceThreshold: "0.5%"
        })
      });
      setStatus("Profile created.");
      form.reset();
      await refreshProfiles();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
}

function bindEvents(): void {
  if (!eventsList) {
    return;
  }

  const source = new EventSource("/v1/events");
  source.onmessage = (event) => {
    const li = document.createElement("li");
    li.textContent = event.data;
    eventsList.prepend(li);
    while (eventsList.children.length > 20) {
      eventsList.removeChild(eventsList.lastChild as Node);
    }
  };
}

async function bootstrap(): Promise<void> {
  bindSetupForm();
  bindCreateProfileForm();
  bindEvents();
  await refreshProfiles();
  await refreshHealth();
  setInterval(() => {
    void refreshHealth();
  }, 15000);
}

void bootstrap();
