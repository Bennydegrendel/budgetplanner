"""Bouwt één zelfstandig HTML-bestand uit app.html + core.js.

Gebruik:  python tools/build.py <map>
Voorbeeld: python tools/build.py claude-versie   -> claude-versie/budgetplanner.html
           python tools/build.py app             -> app/index.html

app.html bevat de plek /*__CORE__*/ ; daar komt de inhoud van core.js.
"""
import pathlib, sys

folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "app")
html = (folder / "app.html").read_text(encoding="utf-8")
core = (folder / "core.js").read_text(encoding="utf-8")
assert "/*__CORE__*/" in html, "app.html mist de plek /*__CORE__*/"
out = folder / ("budgetplanner.html" if folder.name == "claude-versie" else "index.html")
out.write_text(html.replace("/*__CORE__*/", core), encoding="utf-8")
print(f"Gebouwd: {out} ({out.stat().st_size // 1024} kB)")
