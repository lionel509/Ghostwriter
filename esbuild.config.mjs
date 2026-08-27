import esbuild from "esbuild";
import builtins from "builtin-modules";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // Obsidian supplies these at runtime; bundling them would break the plugin.
  // The @codemirror/* entries matter here — bundling a second copy of the
  // editor state would give us StateFields the real editor never sees.
  external: [
    "obsidian", "electron",
    "@codemirror/state", "@codemirror/view", "@codemirror/autocomplete",
    "@codemirror/language", "@codemirror/commands", "@codemirror/search",
    "@lezer/common", "@lezer/highlight", "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  platform: "node",
  logLevel: "info",
  treeShaking: true,
  outfile: "main.js",
  minify: false,
});
