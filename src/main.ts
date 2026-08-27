import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS, SETTINGS_VERSION, SUPERSEDED_MODELS,
  type GhostwriterSettings,
} from "./settings";
import { OllamaClient } from "./ollama";
import { ghostKeymap, requestPlugin, suggestionField, type Status } from "./ghost";

export default class GhostwriterPlugin extends Plugin {
  cfg!: GhostwriterSettings;
  private client!: OllamaClient;
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
        this.cfg.enabled = !this.cfg.enabled;
        await this.saveSettings();
        new Notice(`Ghostwriter ${this.cfg.enabled ? "on" : "off"}`);
      },
    });
  }

  private setStatus(s: Status) {
    if (!this.statusEl) return;
    const label: Record<Status, string> = {
      off: "Ghostwriter: off",
      ready: "Ghostwriter ✓",
      thinking: "Ghostwriter …",
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

  onunload() { this.client?.cancel(); }

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
  constructor(app: App, private plugin: GhostwriterPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable in this vault")
      .setDesc("Off by default. Each completion sends surrounding note text to the model endpoint.")
      .addToggle((t) => t.setValue(this.plugin.cfg.enabled).onChange(async (v) => {
        this.plugin.cfg.enabled = v; await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Model")
      .setDesc("qwen3:0.6b — 666 MB, 27-118 ms. Pull GGUF from HuggingFace with `ollama pull hf.co/<repo>`.")
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
