  /* --- innmat: doerene er materialene merket FRONT i modellen --------------
     (imos-utseender med __FRONT__ faar navnet FRONT i konverteringen).
     Mangler navnet, brukes DOR_INDEKS som reserve. Opprinnelig farge huskes,
     saa beiset eik ikke blir lys naar doerene vises igjen. */
  const innmat = document.getElementById('innmat');
  const DOR_INDEKS = __DOR_INDEKS__;
  const dorMat = () => {
    const ms = mv.model ? mv.model.materials : [];
    const f = ms.filter(m => /FRONT/i.test(m.name || ''));
    return f.length ? f : (ms[DOR_INDEKS] ? [ms[DOR_INDEKS]] : []);
  };
  const origFarge = new Map();
  innmat.addEventListener('click', () => {
    const ms = dorMat();
    if (!ms.length) return;
    const vis = innmat.getAttribute('aria-pressed') !== 'true';
    ms.forEach(m => {
      if (!origFarge.has(m)) origFarge.set(m, m.pbrMetallicRoughness.baseColorFactor.slice());
      const c = origFarge.get(m);
      m.setAlphaMode(vis ? 'BLEND' : 'OPAQUE');
      m.pbrMetallicRoughness.setBaseColorFactor([c[0], c[1], c[2], vis ? 0.12 : c[3]]);
    });
    innmat.setAttribute('aria-pressed', String(vis));
    innmat.textContent = vis ? 'Vis dører' : 'Vis innmat';
  });

