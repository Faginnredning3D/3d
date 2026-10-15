"""Bytter bare tegningssidene og PDF-en paa en eksisterende side (modell og tekst urort).

Bruk:  python oppdater_tegninger.py <sidemappe i repo> <kildemappe med sider\\*.png og samlet.pdf> "<teg_tekst>"
"""
import os, re, shutil, sys, time
from PIL import Image

side, kilde, teg_tekst = sys.argv[1], sys.argv[2], sys.argv[3]
stamp = time.strftime("%Y%m%d%H%M%S")
t = open(os.path.join(side, "index.html"), encoding="utf-8").read()

pdfnavn = re.search(r'class="lastned" href="([^"?]+)', t).group(1)
shutil.copy(os.path.join(kilde, "samlet.pdf"), os.path.join(side, pdfnavn))

sd = os.path.join(side, "sider")
for f in os.listdir(sd):
    os.remove(os.path.join(sd, f))
sider = sorted(f for f in os.listdir(os.path.join(kilde, "sider")) if f.endswith(".png"))
for f in sider:
    shutil.copy(os.path.join(kilde, "sider", f), os.path.join(sd, f))

figs = []
for i, f in enumerate(sider, 1):
    im = Image.open(os.path.join(sd, f))
    ligg = " liggende" if im.width > im.height else ""
    figs.append(f'''    <figure class="side{ligg}">
      <a href="sider/{f}?v={stamp}" target="_blank" rel="noopener"><img src="sider/{f}?v={stamp}" width="{im.width}" height="{im.height}" loading="lazy" alt="Tegning side {i} av {len(sider)}"></a>
      <figcaption>Side {i} av {len(sider)}</figcaption>
    </figure>''')
seksjon = f'''<section class="tegninger" id="tegninger">
  <div class="teg-hode">
    <div>
      <h2>Tegninger</h2>
      <p>{teg_tekst} &middot; Ordreinfo, pakkliste og produksjonstegning. Trykk p&aring; en side for full st&oslash;rrelse.</p>
    </div>
    <a class="lastned" href="{pdfnavn}?v={stamp}" download>Last ned PDF</a>
  </div>
{chr(10).join(figs)}
</section>'''
t = re.sub(r'<section class="tegninger".*?</section>', lambda m: seksjon, t, count=1, flags=re.S)
t = re.sub(r"const SIDE_VERSJON = '\d+'", "const SIDE_VERSJON = '" + stamp + "'", t)
open(os.path.join(side, "versjon.txt"), "w").write(stamp)
open(os.path.join(side, "index.html"), "w", encoding="utf-8", newline="\n").write(t)
print("oppdatert", side, "sider:", len(sider), "versjon:", stamp)
