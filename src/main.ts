import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { DEFAULT_SETTINGS, type GhostwriterSettings } from "./settings";
import { OllamaClient } from "./ollama";
import { ghostKeymap, requestPlugin, suggestionField } from "./ghost";

export default class GhostwriterPlugin extends Plugin {
  cfg!: GhostwriterSettings;
  private client!: OllamaClient;

  async onload() {
    this.cfg = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.client = new OllamaClient(this.cfg);

    this.registerEditorExtension([
      suggestionField,
      ghostKeymap,
      requestPlugin(this.client, () => this.cfg, () => this.allowedHere()),
    ]);

    this.addSettingTab(new GhostwriterSettingTab(this.app, this));
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
