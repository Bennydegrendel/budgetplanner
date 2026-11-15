/* Volledige controle vóór een vrijgave. Start in de hoofdmap:  node tests/alles.js
   1) bouwt app/index.html  2) controleert het rekenwerk  3) controleert de app in een browser. */
const { execSync, spawnSync } = require("child_process"), path = require("path");
const root = path.resolve(__dirname, "..");
console.log("Bouwen…"); execSync("python3 tools/build.py app", { cwd: root, stdio: "inherit" });
const run = f => spawnSync(process.execPath, [path.join(__dirname, f)], { cwd: root, stdio: "inherit" }).status;
const a = run("core.test.js"), b = run("app.test.js");
console.log(a || b ? "\n✗ Er zijn fouten. Niet vrijgeven." : "\n✓ Alles in orde.");
process.exit(a || b ? 1 : 0);
