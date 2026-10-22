/* Faginnredning – språkvalg på 3D-kundesidene.
 *
 * Sidene skrives på norsk. Denne fila oversetter teksten i nettleseren, også tekst som
 * sidens egne skript lager underveis (hjelpetekster, teller, godkjenning). Ordbøkene
 * ligger i _felles/sprak/<kode>.json: {"tekster": {norsk: oversatt}, "maler": {norsk mal: oversatt mal}}.
 * En side kan ha egne tillegg i <sidemappe>/sprak/<kode>.json (samme format).
 *
 * Språk velges i nedtrekkslista øverst, eller med ?sprak=pl i lenken (lenke til kunde).
 * Valget huskes i nettleseren. Norsk er standard.
 */
(function () {
  'use strict';
  const SPRAK = [
    ['nb', 'Norsk'], ['pl', 'Polski'], ['es', 'Español'], ['lt', 'Lietuvių'],
    ['it', 'Italiano'], ['ru', 'Русский'], ['ro', 'Română'],
  ];
  const KODER = SPRAK.map(s => s[0]);
  const ROT = (document.currentScript && document.currentScript.src.replace(/sprak\.js.*$/, '')) || '../_felles/';
  // Maler der plassholderne alltid er tall (ellers kunne «{0} av {1}» treffe vanlig tekst).
  const TALLMALER = new Set(['{0} av {1}', 'Maks {0} mål – trykk Angre eller Tøm alle', '{0} mål satt · klikk to nye punkter',
    'Side {0} av {1}', 'Tegning side {0} av {1}', ' · {0} merknad sendt', ' · {0} merknader sendt']);
  const MND = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
  const ATTR = ['title', 'aria-label', 'alt', 'placeholder'];

  let sprak = 'nb', ordbok = null, maler = [];
  const original = new WeakMap();     // tekstnode -> norsk originaltekst
  const origAttr = new WeakMap();     // element -> {attr: norsk}
  let skriver = false;

  const lagret = () => { try { return localStorage.getItem('fag-sprak'); } catch (_) { return null; } };
  const lagre = (k) => { try { localStorage.setItem('fag-sprak', k); } catch (_) {} };
  const normal = (s) => s.replace(/\s+/g, ' ').trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function velgStart() {
    const q = new URLSearchParams(location.search);
    const fraLenke = (q.get('sprak') || q.get('lang') || '').toLowerCase();
    if (KODER.includes(fraLenke)) return fraLenke;
    const l = lagret();
    return KODER.includes(l) ? l : 'nb';
  }

  async function hent(url) {
    try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch (_) { return null; }
  }

  async function lastOrdbok(k) {
    if (k === 'nb') return null;
    const [felles, side] = await Promise.all([hent(`${ROT}sprak/${k}.json?v=2`), hent(`sprak/${k}.json`)]);
    const o = { tekster: {}, maler: {} };
    for (const d of [felles, side]) if (d) { Object.assign(o.tekster, d.tekster || {}); Object.assign(o.maler, d.maler || {}); }
    maler = Object.entries(o.maler)
      .sort((a, b) => b[0].length - a[0].length)
      .map(([no, ut]) => {
        const tall = TALLMALER.has(no);
        const re = new RegExp('^' + esc(no).replace(/\\\{(\d)\\\}/g, tall ? '(\\d+)' : '(.+?)') + '$');
        return { re, ut };
      });
    return o;
  }

  function datoTil(tekst) {
    const m = /^(\d{1,2})\. ?([a-zæøå]+) (\d{4})$/i.exec(tekst.trim());
    if (!m) return null;
    const i = MND.indexOf(m[2].toLowerCase());
    if (i < 0) return null;
    return new Date(+m[3], i, +m[1]).toLocaleDateString(sprak, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function oversett(norsk) {
    if (!ordbok) return null;
    const n = normal(norsk);
    if (!n) return null;
    if (ordbok.tekster[n] != null) return ordbok.tekster[n];
    for (const { re, ut } of maler) {
      const m = re.exec(n);
      if (!m) continue;
      return ut.replace(/\{(\d)\}/g, (_, i) => {
        const v = m[+i + 1] ?? '';
        return ordbok.tekster[v] ?? datoTil(v) ?? v;
      });
    }
    return null;
  }

  function behandleTekst(node) {
    const p = node.parentElement;
    if (!p || /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(p.tagName) || p.closest('[data-ikke-oversett]')) return;
    if (!original.has(node)) original.set(node, node.data);
    const no = original.get(node);
    let ny = no;
    if (sprak !== 'nb') {
      const t = oversett(no);
      if (t != null) {
        const lead = no.match(/^\s*/)[0], trail = no.match(/\s*$/)[0];
        ny = (t.startsWith(' ') ? '' : lead) + t + (t.endsWith(' ') || t.endsWith(',') ? '' : trail);
      }
    }
    if (node.data !== ny) node.data = ny;
  }

  function behandleAttr(el) {
    let o = origAttr.get(el);
    for (const a of ATTR) {
      if (!el.hasAttribute(a)) continue;
      if (!o) origAttr.set(el, o = {});
      if (!(a in o)) o[a] = el.getAttribute(a);
      const ny = sprak === 'nb' ? o[a] : (oversett(o[a]) ?? o[a]);
      if (el.getAttribute(a) !== ny) el.setAttribute(a, ny);
    }
  }

  function behandle(rot) {
    skriver = true;
    if (rot.nodeType === 3) behandleTekst(rot);
    else if (rot.nodeType === 1) {
      if (!rot.closest('[data-ikke-oversett]')) behandleAttr(rot);
      const w = document.createTreeWalker(rot, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = w.nextNode())) n.nodeType === 3 ? behandleTekst(n) : behandleAttr(n);
    }
    skriver = false;
  }

  // Tekst som sidens skript endrer etterpå, oversettes fortløpende.
  const vakt = new MutationObserver((liste) => {
    if (skriver) return;
    for (const m of liste) {
      if (m.type === 'characterData') { original.set(m.target, m.target.data); behandle(m.target); }
      else if (m.type === 'attributes') {
        const o = origAttr.get(m.target);
        if (o) o[m.attributeName] = m.target.getAttribute(m.attributeName);
        behandle(m.target);
      }
      else m.addedNodes.forEach(n => behandle(n));
    }
  });

  async function settSprak(k, lagreValg) {
    sprak = KODER.includes(k) ? k : 'nb';
    ordbok = await lastOrdbok(sprak);
    if (sprak !== 'nb' && !ordbok) sprak = 'nb';
    document.documentElement.lang = sprak;
    if (lagreValg) {
      lagre(sprak);
      const u = new URL(location.href);
      if (sprak === 'nb') u.searchParams.delete('sprak'); else u.searchParams.set('sprak', sprak);
      history.replaceState(null, '', u);
    }
    velger.value = sprak;
    behandle(document.body);
    if (document.title) {
      if (!original.has(document)) original.set(document, document.title);
      const no = original.get(document);
      document.title = sprak === 'nb' ? no : (oversett(no) ?? no);
    }
  }

  /* ---------- nedtrekksliste i toppfeltet ------------------------------ */
  const velger = document.createElement('select');
  velger.id = 'sprakvalg';
  velger.setAttribute('aria-label', 'Velg språk');
  velger.setAttribute('data-ikke-oversett', '');
  for (const [k, navn] of SPRAK) {
    const o = document.createElement('option'); o.value = k; o.textContent = navn; velger.append(o);
  }
  velger.addEventListener('change', () => settSprak(velger.value, true));
  const stil = document.createElement('style');
  stil.textContent = `
    #sprakvalg { font: 600 12px/1 var(--body, system-ui); letter-spacing: .02em; color: var(--ink);
      background: var(--surface); border: 1px solid var(--line); border-radius: 2px; padding: 6px 26px 6px 9px;
      appearance: none; cursor: pointer;
      background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
      background-position: right 12px center, right 7px center; background-size: 5px 5px; background-repeat: no-repeat; }
    #sprakvalg:focus-visible { outline: 2px solid var(--spark); outline-offset: 2px; }
    .sprakboks { display: flex; align-items: center; gap: 6px; }
    .sprakboks svg { width: 16px; height: 16px; color: var(--ink-soft); flex: none; }
    html:not([lang="nb"]) .gk-sprak-merknad { display: block; }
    .gk-sprak-merknad { display: none; font-style: italic; color: var(--ink-soft); }`;
  document.head.append(stil);

  function monter() {
    const boks = document.createElement('label');
    boks.className = 'sprakboks';
    boks.setAttribute('data-ikke-oversett', '');
    boks.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
    boks.append(velger);
    const hode = document.querySelector('.masthead');
    const kunde = hode && hode.querySelector('.kunde');
    if (kunde) kunde.after(boks); else if (hode) hode.append(boks); else document.body.prepend(boks);
    vakt.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
    settSprak(velgStart(), new URLSearchParams(location.search).has('sprak'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
