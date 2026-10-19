  /* --- kantlist: kantene med kantlist er egne materialer «KANT:<type>» -----
     (konverteren henter kantlist per kant fra imos sin PXM-fil). Knappen farger
     hver kantlisttype med egen farge og viser forklaring. Kanter uten kantlist
     beholder dekoren. Vis innmat og kantlist brukes ikke samtidig. */
  const kantknapp = document.getElementById('kantknapp');
  const kantforkl = document.getElementById('kantforkl');
  const KANTFARGER = ['#E4572E', '#1F6FEB', '#8E3FD1', '#0E9F6E', '#C98A00', '#D6336C'];
  const kantOrig = new Map();
  let kantTyper = null;

  function hexTilRgb(h) {
    const n = parseInt(h.slice(1), 16);
    // model-viewer forventer lineaere farger
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.pow(v / 255, 2.2));
  }
  function kantEtikett(type) {
    const m = /^([A-Za-z]+)_(\d+(?:[,.]\d+)?)_(.+)$/.exec(type);
    return m ? `${m[1].toUpperCase()} ${m[2]} mm · ${m[3].replace(/_/g, ' ')}` : type.replace(/_/g, ' ');
  }
  function finnKanttyper() {
    const typer = new Map();
    (mv.model ? mv.model.materials : []).forEach(m => {
      const t = /KANT:(.+)$/.exec(m.name || '');
      if (!t) return;
      if (!typer.has(t[1])) typer.set(t[1], []);
      typer.get(t[1]).push(m);
    });
    return typer;
  }
  function byggForklaring() {
    kantforkl.textContent = '';
    const h = document.createElement('strong');
    h.textContent = 'Kantlist';
    kantforkl.appendChild(h);
    [...kantTyper.keys()].forEach((t, i) => {
      const rad = document.createElement('span');
      rad.className = 'kantrad';
      const f = document.createElement('i');
      f.style.background = KANTFARGER[i % KANTFARGER.length];
      rad.appendChild(f);
      rad.appendChild(document.createTextNode(kantEtikett(t)));
      kantforkl.appendChild(rad);
    });
    const n = document.createElement('span');
    n.className = 'kantnote';
    n.textContent = 'Kanter uten farge har ikke kantlist.';
    kantforkl.appendChild(n);
  }
  function settKantlist(paa) {
    let i = 0;
    for (const [, ms] of kantTyper) {
      const farge = hexTilRgb(KANTFARGER[i++ % KANTFARGER.length]);
      ms.forEach(m => {
        const pbr = m.pbrMetallicRoughness;
        if (!kantOrig.has(m)) kantOrig.set(m, {
          farge: pbr.baseColorFactor.slice(),
          tekstur: pbr.baseColorTexture ? pbr.baseColorTexture.texture : null,
          glod: m.emissiveFactor ? m.emissiveFactor.slice() : [0, 0, 0],
        });
        const o = kantOrig.get(m);
        if (paa) {
          if (pbr.baseColorTexture) pbr.baseColorTexture.setTexture(null);
          pbr.setBaseColorFactor([farge[0], farge[1], farge[2], 1]);
          m.setEmissiveFactor(farge.map(v => v * 0.55));
        } else {
          if (pbr.baseColorTexture) pbr.baseColorTexture.setTexture(o.tekstur);
          pbr.setBaseColorFactor(o.farge);
          m.setEmissiveFactor(o.glod);
        }
      });
    }
    kantknapp.setAttribute('aria-pressed', String(paa));
    kantforkl.hidden = !paa;
  }
  function klarKantlist() {
    kantTyper = finnKanttyper();
    if (!kantTyper.size) return;          // modellen mangler kantlistdata
    kantknapp.hidden = false;
    byggForklaring();
  }
  if (mv.loaded) klarKantlist(); else mv.addEventListener('load', klarKantlist, { once: true });

  kantknapp.addEventListener('click', () => {
    if (!kantTyper || !kantTyper.size) return;
    const paa = kantknapp.getAttribute('aria-pressed') !== 'true';
    const inn = document.getElementById('innmat');
    if (paa && inn && inn.getAttribute('aria-pressed') === 'true') inn.click();
    settKantlist(paa);
  });
  document.getElementById('innmat')?.addEventListener('click', () => {
    if (kantknapp.getAttribute('aria-pressed') === 'true') settKantlist(false);
  }, true);

