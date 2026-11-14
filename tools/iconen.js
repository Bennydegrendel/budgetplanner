/* Maakt de app-iconen (roze € in een afgeschuind blokje) als PNG.
   Gebruik: node tools/iconen.js   (vraagt Playwright met Chromium)
   Resultaat in app/icons/. Alleen opnieuw nodig als het logo verandert. */
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.join(__dirname, "..", "app", "icons");

// size = pixels; block = grootte van het roze blokje t.o.v. het geheel; bg = achtergrond (null = doorzichtig)
const ICONS = [
  { file: "icon-192.png", size: 192, block: 1, bg: null },
  { file: "icon-512.png", size: 512, block: 1, bg: null },
  { file: "maskable-192.png", size: 192, block: 0.58, bg: "#000" },  // Android knipt er een cirkel/vorm uit
  { file: "maskable-512.png", size: 512, block: 0.58, bg: "#000" },
  { file: "apple-touch-icon.png", size: 180, block: 0.78, bg: "#000" }, // iPhone: geen doorzichtigheid
  { file: "favicon-32.png", size: 32, block: 1, bg: null },
];

const page = (size, block, bg) => {
  const b = Math.round(size * block), notch = Math.round(b * 0.28);
  return `<!DOCTYPE html><html><head>
  <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@700&display=block" rel="stylesheet">
  <style>html,body{margin:0;background:${bg || "transparent"}}
  .wrap{width:${size}px;height:${size}px;display:grid;place-items:center}
  .mark{width:${b}px;height:${b}px;background:#ff2bd6;color:#000;display:grid;place-items:center;
    font:700 ${Math.round(b * 0.72)}px/1 Rajdhani,sans-serif;padding-top:${Math.round(b * 0.04)}px;box-sizing:border-box;
    clip-path:polygon(0 0,calc(100% - ${notch}px) 0,100% ${notch}px,100% 100%,${notch}px 100%,0 calc(100% - ${notch}px))}
  </style></head><body><div class="wrap"><div class="mark">€</div></div></body></html>`;
};

(async () => {
  const browser = await chromium.launch();
  for (const ic of ICONS) {
    const p = await browser.newPage({ viewport: { width: ic.size, height: ic.size } });
    await p.setContent(page(ic.size, ic.block, ic.bg), { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, ic.file), omitBackground: !ic.bg });
    console.log("gemaakt:", ic.file);
  }
  await browser.close();
})();
