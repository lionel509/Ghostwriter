// Copies the built plugin into a vault. Reads OBSIDIAN_VAULT so this works for
// anyone who clones the repo, with the local path only as a fallback.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const vault = process.env.OBSIDIAN_VAULT
  ?? "/Users/lionelweng/Documents/BlackRock";
const dest = join(vault, ".obsidian", "plugins", "ghostwriter");

if (!existsSync(vault)) {
  console.error(`Vault not found: ${vault}\nSet OBSIDIAN_VAULT to override.`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(dest, f));
console.log(`Installed to ${dest}`);
