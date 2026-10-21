"""Bygger en kundeside i Faginnredning3D/3d ut fra malen (en eksisterende side).

Bruk:  python bygg_side.py config.json
config.json:
{
  "repo": "...\\repo3d", "mal": "2026-076-P3-D012-Garderobe", "mappe": "2026-076-Forrom-P4-E013",
  "kilde": "...\\web",            # inneholder modell.glb, snap.json, aside.html, sider\\side-XX.png, samlet.pdf
  "tittel": "...", "ordre": "...", "h1": "...", "kunde": "...", "alt": "...",
  "innmat": 2,                     # materialindeks for doerene, eller null for aa skjule knappen
  "pdfnavn": "....pdf", "teg_tekst": "REV&nbsp;A &middot; 14.10.2026"
}
"""
import json, os, re, shutil, sys, time
from PIL import Image

c = json.load(open(sys.argv[1], encoding="utf-8"))
src_dir = os.path.join(c["repo"], c["mal"])
dst = os.path.join(c["repo"], c["mappe"])
os.makedirs(os.path.join(dst, "sider"), exist_ok=True)
for f in os.listdir(os.path.join(dst, "sider")):
    os.remove(os.path.join(dst, "sider", f))

k = c["kilde"]
shutil.copy(os.path.join(k, "modell.glb"), os.path.join(dst, "modell.glb"))
shutil.copy(os.path.join(k, "snap.json"), os.path.join(dst, "snap.json"))
shutil.copy(os.path.join(k, "samlet.pdf"), os.path.join(dst, c["pdfnavn"]))
sider = sorted(f for f in os.listdir(os.path.join(k, "sider")) if f.endswith(".png"))
for f in sider:
    shutil.copy(os.path.join(k, "sider", f), os.path.join(dst, "sider", f))

t = open(os.path.join(src_dir, "index.html"), encoding="utf-8").read()
stamp = time.strftime("%Y%m%d%H%M%S")

t = re.sub(r"<title>.*?</title>", "<title>" + c["tittel"] + "</title>", t, count=1, flags=re.S)
t = re.sub(r'<span class="ordre">.*?</span>', '<span class="ordre">' + c["ordre"] + "</span>", t, count=1, flags=re.S)
t = re.sub(r"<h1>.*?</h1>", "<h1>" + c["h1"] + "</h1>", t, count=1, flags=re.S)
t = re.sub(r'<span class="kunde">.*?</span>', '<span class="kunde">' + c["kunde"] + "</span>", t, count=1, flags=re.S)
t = re.sub(r'(<model-viewer[^>]*?\salt=")[^"]*(")', lambda m: m.group(1) + c["alt"] + m.group(2), t, count=1, flags=re.S)
aside = open(os.path.join(k, "aside.html"), encoding="utf-8").read()
t = re.sub(r"  <aside>.*?</aside>", lambda m: aside, t, count=1, flags=re.S)
# Fast linje paa alle kundesider (Marius 21.10.2026): produksjonstid fra godkjent tegning.
PRODTID = ('    <section class="blokk prodtid">\n      <h2>Produksjonstid</h2>\n'
           '      <p>Normal produksjonstid er <strong>8&nbsp;uker fra godkjent tegning</strong>, med mindre annet er avtalt.</p>\n'
           '    </section>\n')
if "blokk prodtid" not in t:
    t = re.sub(r"(<aside>\s*\n)", lambda m: m.group(1) + PRODTID, t, count=1)

if c.get("innmat") is None:
    t = re.sub(r'\s*<button id="innmat"[^>]*>.*?</button>', "", t)
    t = re.sub(r"  /\* --- innmat:.*?\n  \}\);\n", "", t, flags=re.S)
else:
    t = re.sub(r"mv\.model\.materials\[\d+\]", "mv.model.materials[%d]" % c["innmat"], t)

figs = []
for i, f in enumerate(sider, 1):
    im = Image.open(os.path.join(k, "sider", f))
    ligg = " liggende" if im.width > im.height else ""
    figs.append(f'''    <figure class="side{ligg}">
      <a href="sider/{f}?v={stamp}" target="_blank" rel="noopener"><img src="sider/{f}?v={stamp}" width="{im.width}" height="{im.height}" loading="lazy" alt="Tegning side {i} av {len(sider)}"></a>
      <figcaption>Side {i} av {len(sider)}</figcaption>
    </figure>''')
seksjon = f'''<section class="tegninger" id="tegninger">
  <div class="teg-hode">
    <div>
      <h2>Tegninger</h2>
      <p>{c["teg_tekst"]} &middot; Ordreinfo, pakkliste og produksjonstegning. Trykk p&aring; en side for full st&oslash;rrelse.</p>
    </div>
    <a class="lastned" href="{c["pdfnavn"]}?v={stamp}" download>Last ned PDF</a>
  </div>
{chr(10).join(figs)}
</section>'''
t = re.sub(r'<section class="tegninger".*?</section>', lambda m: seksjon, t, count=1, flags=re.S)

t = re.sub(r"modell\.glb\?v=\d+", "modell.glb?v=" + stamp, t)
t = re.sub(r"snap\.json\?v=\d+", "snap.json?v=" + stamp, t)
t = re.sub(r"const SIDE_VERSJON = '\d+'", "const SIDE_VERSJON = '" + stamp + "'", t)
open(os.path.join(dst, "versjon.txt"), "w").write(stamp)
open(os.path.join(dst, "index.html"), "w", encoding="utf-8", newline="\n").write(t)
print("bygget", dst, "sider:", len(sider), "versjon:", stamp)
