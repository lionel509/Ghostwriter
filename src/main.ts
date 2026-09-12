import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS, SETTINGS_VERSION, SUPERSEDED_MODELS,
  type GhostwriterSettings,
} from "./settings";
import { OllamaClient } from "./ollama";
import { ghostKeymap, requestPlugin, suggestionField, type Status } from "./ghost";

export default class GhostwriterPlugin extends Plugin {
  cfg!: GhostwriterSettings;
  /** Public so the settings tab can hand the weights back when the model or the
   *  on/off switch changes. */
  client!: OllamaClient;
  private statusEl: HTMLElement | null = null;

  async onload() {
    this.cfg = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    await this.migrate();
    this.client = new OllamaClient(this.cfg);

    // Without this there is no way to tell "waiting for you to type more" from
    // "the plugin is dead" — which is exactly the question that came up first.
    this.statusEl = this.addStatusBarItem();
    this.setStatus(this.cfg.enabled ? "ready" : "off");

    this.registerEditorExtension([
      suggestionField,
      ghostKeymap,
      requestPlugin(
        this.client,
        () => this.cfg,
        () => this.allowedHere(),
        (s) => this.setStatus(s),
      ),
    ]);

    this.addSettingTab(new GhostwriterSettingTab(this.app, this));
    this.addCommand({
      id: "test-connection",
      name: "Test connection",
      callback: async () => new Notice(await this.client.ping(), 6000),
    });
    this.addCommand({
      id: "toggle",
      name: "Toggle inline completion for this vault",
      callback: async () => {
        await this.setEnabled(!this.cfg.enabled);
        new Notice(`Ghostwriter ${this.cfg.enabled ? "on" : "off"}`);
      },
    });

    // The model's life starts with the vault. Obsidian runs onload when this
    // vault opens, so the 1.6 GB load happens while the window is still
    // painting rather than on the first keystroke of the first sentence.
    // Deliberately not awaited — a slow load must not hold up vault startup.
    if (this.cfg.enabled) void this.warmUp();
  }

  /** Load the weights and say so. Without the "warming" state the status bar
   *  showed a confident tick while the first request was still blocked behind a
   *  multi-second load. */
  async warmUp() {
    this.setStatus("warming");
    const ok = await this.client.warm();
    this.setStatus(ok ? "ready" : "error");
  }

  /** The on/off switch owns residency. Until now "off" cost exactly as much
   *  memory as "on" — the plugin stopped asking for completions but never told
   *  Ollama it was done, so the weights stayed pinned. */
  async setEnabled(v: boolean) {
    this.cfg.enabled = v;
    await this.saveSettings();
    if (v) { await this.warmUp(); return; }
    this.client.cancel();
    await this.client.release();
    this.setStatus("off");
  }

  private setStatus(s: Status) {
    if (!this.statusEl) return;
    const label: Record<Status, string> = {
      off: "Ghostwriter: off",
      warming: "Ghostwriter: loading model…",
      ready: "Ghostwriter ✓",
      thinking: "Ghostwriter …",
      showing: "Ghostwriter ▸ suggesting",
      quiet: "Ghostwriter: nothing to add",
      late: "Ghostwriter: too slow, dropped",
      short: "Ghostwriter: need more text",
      error: "Ghostwriter: no model",
    };
    this.statusEl.setText(label[s]);
  }

  /** Move an install off a model that used to be the default. Only touches a
   *  value that matches a known old default — a model the user actually chose
   *  is never overwritten. */
  private async migrate() {
    if ((this.cfg.settingsVersion ?? 0) >= SETTINGS_VERSION) return;
    const old = this.cfg.model;
    if (SUPERSEDED_MODELS.includes(old)) {
      this.cfg.model = DEFAULT_SETTINGS.model;
      new Notice(`Ghostwriter: model updated ${old} → ${this.cfg.model}`, 8000);
    }
    this.cfg.settingsVersion = SETTINGS_VERSION;
    await this.saveSettings();
  }

  /** Fires when this vault closes: quit, vault switch, or the plugin being
   *  disabled. keep_alive:-1 means nothing else will ever evict the model, so
   *  this call is the only thing bounding its lifetime to the vault's. */
  onunload() {
    this.client?.cancel();
    void this.client?.release();
  }

  /** Off unless this vault was explicitly enabled, and never inside a blocked
   *  folder. Every completion sends a window of the note to a process outside
   *  Obsidian, so the default is off and the opt-in is per vault. */
  private allowedHere(): boolean {
    if (!this.cfg.enabled) return false;
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return false;
    return !this.cfg.blockedFolders.some(
      (f) => f && (file.path === f || file.path.startsWith(f.replace(/\/*$/, "/"))),
    );
  }

  async saveSettings() { await this.saveData(this.cfg); }
}

class GhostwriterSettingTab extends PluginSettingTab {
  /** The model name as it was when the tab opened, so hide() can tell a real
   *  change from a no-op. */
  private modelAtOpen = "";

  constructor(app: App, private plugin: GhostwriterPlugin) { super(app, plugin); }

  /** Text fields fire onChange per keystroke, so swapping weights there would
   *  load and unload a model once per character typed into the name. The swap
   *  waits until the tab closes instead. */
  async hide() {
    if (this.plugin.cfg.model === this.modelAtOpen) return;
    await this.plugin.client.release();
    if (this.plugin.cfg.enabled) await this.plugin.warmUp();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.modelAtOpen = this.plugin.cfg.model;

    new Setting(containerEl)
      .setName("Enable in this vault")
      .setDesc("Off by default. Each completion sends surrounding note text to the model endpoint.")
      .addToggle((t) => t.setValue(this.plugin.cfg.enabled).onChange(async (v) => {
        await this.plugin.setEnabled(v);
      }));

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Default: Qwen3.5-2B-Base, 1.6 GB resident. Pull GGUF from HuggingFace with `ollama pull hf.co/<repo>`.")
      .addText((t) => t.setValue(this.plugin.cfg.model).onChange(async (v) => {
        this.plugin.cfg.model = v.trim(); await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Endpoint")
      .addText((t) => t.setValue(this.plugin.cfg.endpoint).onChange(async (v) => {
        this.plugin.cfg.endpoint = v.replace(/\/+$/, ""); await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Debounce (ms)")
      .setDesc("Quiet time after the last keystroke before requesting. 350 aims at a natural pause.")
      .addText((t) => t.setValue(String(this.plugin.cfg.debounceMs)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) {
          this.plugin.cfg.debounceMs = n; await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName("Keep model loaded")
      .setDesc('-1 pins it while the vault is open. "10m" releases it after ten idle minutes. 0 loads it fresh every time.')
      .addText((t) => t.setValue(String(this.plugin.cfg.keepAlive)).onChange(async (v) => {
        const raw = v.trim();
        if (!raw) return;
        this.plugin.cfg.keepAlive = /^-?\d+$/.test(raw) ? Number(raw) : raw;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Blocked folders")
      .setDesc("One vault-relative path per line. Never completes inside these.")
      .addTextArea((t) => t
        .setValue(this.plugin.cfg.blockedFolders.join("\n"))
        .onChange(async (v) => {
          this.plugin.cfg.blockedFolders =
            v.split("\n").map((s) => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));
  }
}
