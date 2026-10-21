/* Faginnredning – tegningsgodkjenning på 3D-kundesider.
 *
 * Siden setter window.FAG_GODKJENNING = { tegning, rev, tittel, kunde, pdf, api }
 * før denne fila lastes. Uten «api» kjører modulen i TESTMODUS: e-postkoden vises
 * på skjermen, og alt lagres i nettleseren. Med «api» (Cloudflare Worker) sendes
 * koden på e-post og hendelser/godkjenninger lagres på serveren.
 *
 * Flyt: e-post + kode -> se modell og tegninger -> «Godkjenn tegning» -> vilkår
 * (må krysses av) -> signatur + navn -> kvittering (PDF) med fingeravtrykk av
 * tegnings-PDF-en. Alternativt «Jeg har merknader».
 */
(function () {
  'use strict';
  const K = window.FAG_GODKJENNING;
  if (!K) return;
  const TEST = !K.api;

  const VILKAR = {
    versjon: '1.0',
    tittel: 'Vilkår for tegningsgodkjenning',
    ingress: 'Ved å godkjenne tegningen bekrefter du følgende på vegne av oppdragsgiver:',
    punkter: [
      ['Hva godkjenningen gjelder', 'Godkjenningen gjelder tegning og revisjon slik de er angitt i godkjenningen. Den omfatter mål, utforming, antall, materialer, overflater, farger, kantlist og beslag slik de fremgår av tegningen.'],
      ['Tegningen gjelder foran 3D-modellen', '3D-modellen er en illustrasjon som skal gjøre tegningen lettere å forstå. Farger, teksturer og lys på skjerm kan avvike fra virkelige materialer. Ved avvik mellom 3D-modellen og tegningen (PDF) gjelder tegningen.'],
      ['Mål og forhold på byggeplass', 'Oppdragsgiver er ansvarlig for at målene i tegningen stemmer med byggets mål, og for at vegger, gulv og tak har nødvendig bæreevne. Dette gjelder med mindre Faginnredning har tatt mål på stedet etter egen avtale. Vi anbefaler at du kontrollerer målene mot byggets tegninger før du godkjenner.'],
      ['Produksjonstid og produksjonsstart', 'Normal produksjonstid er 8 uker fra godkjent tegning, med mindre annet er avtalt i kontrakt eller ordrebekreftelse. Produksjon starter først når tegningen er godkjent, og avtalt leveringstid regnes fra godkjenningsdato. Ved produksjonsstart faktureres 50 % i henhold til Betingelser for leveranse punkt 8, med mindre annet er avtalt.'],
      ['Endringer etter godkjenning', 'Endringer etter godkjenning regnes som tilleggsarbeid og faktureres etter medgått tid og materialer, også om produksjonen allerede er startet. Endringer kan forlenge leveringstiden. Endringer må meldes skriftlig, og en ny revisjon må godkjennes før den settes i produksjon.'],
      ['Har du merknader?', 'Har du merknader til tegningen, skal du ikke godkjenne. Bruk knappen «Jeg har merknader», så sender vi en ny revisjon til godkjenning.'],
      ['Naturmaterialer og toleranser', 'Variasjoner i mønster og fargespill i tre og finer er normale og gir ikke grunnlag for reklamasjon. For øvrig gjelder Betingelser for leveranse punkt 4 om kvalitetsvurdering.'],
      ['Vårt ansvar', 'Godkjenningen fritar ikke Faginnredning for ansvar for å levere i samsvar med godkjent tegning, eller for feil i vår produksjon og montasje.'],
      ['Fullmakt og elektronisk signatur', 'Du bekrefter at du har fullmakt til å godkjenne på vegne av oppdragsgiver. Elektronisk godkjenning med bekreftet e-postadresse og signatur er like bindende som underskrift på papir.'],
      ['Øvrige vilkår', 'For øvrig gjelder Faginnredning AS sine Betingelser for leveranse og eventuell kontrakt. Ved motstrid går kontrakt og skriftlige særavtaler foran disse vilkårene. Tegninger og beskrivelser er Faginnredning sin eiendom og skal ikke kopieres uten skriftlig samtykke.'],
      ['Lagring av opplysninger', 'Navn, e-postadresse, firma, tidspunkt og signatur lagres som dokumentasjon av godkjenningen. Opplysningene brukes kun til oppfølging av denne leveransen, og kvitteringen arkiveres i prosjektmappen.'],
    ],
    avkrysning: 'Jeg har lest og godtar vilkårene for tegningsgodkjenning.',
  };

  /* ---------- lagring (testmodus) / server ---------------------------- */
  const NOKKEL = 'fag-godkj:' + K.tegning;
  const les = (n, std) => { try { return JSON.parse(localStorage.getItem(NOKKEL + ':' + n)) ?? std; } catch (_) { return std; } };
  const skriv = (n, v) => { try { localStorage.setItem(NOKKEL + ':' + n, JSON.stringify(v)); } catch (_) {} };

  async function api(sti, data) {
    if (TEST) return testApi(sti, data);
    const r = await fetch(K.api + sti, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ tegning: K.tegning, rev: K.rev, ...data }),
    });
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.json();
  }
  function testApi(sti, data) {
    const logg = les('logg', []);
    const hendelse = (type, extra) => { logg.push({ type, tid: new Date().toISOString(), epost: data.epost || okt?.epost, ...extra }); skriv('logg', logg); };
    if (sti === '/kode') {
      const kode = String(Math.floor(100000 + Math.random() * 900000));
      skriv('ventekode', { kode, epost: data.epost });
      return { ok: true, testkode: kode };
    }
    if (sti === '/bekreft') {
      const v = les('ventekode', null);
      if (!v || v.kode !== data.kode || v.epost !== data.epost) throw new Error('Feil kode. Prøv igjen.');
      hendelse('åpnet', { navn: data.navn, firma: data.firma });
      return { ok: true };
    }
    if (sti === '/hendelse') { hendelse(data.type, data.detaljer || {}); return { ok: true }; }
    if (sti === '/godkjenn') { skriv('godkjenning', data.post); hendelse('godkjent', { rev: K.rev }); return { ok: true }; }
    if (sti === '/merknad') { const m = les('merknader', []); m.push(data.post); skriv('merknader', m); hendelse('merknad', {}); return { ok: true }; }
    if (sti === '/status') return { godkjenning: les('godkjenning', null), merknader: les('merknader', []) };
    return { ok: false };
  }

  /* ---------- hjelpere -------------------------------------------------- */
  const el = (tag, attr = {}, ...barn) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attr)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const b of barn.flat(Infinity)) if (b != null) e.append(b.nodeType ? b : document.createTextNode(b));
    return e;
  };
  const datoTekst = (iso) => new Date(iso).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const gyldigEpost = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

  async function fingeravtrykk() {
    try {
      const r = await fetch(K.pdf, { cache: 'no-store' });
      const buf = await r.arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return 'ikke tilgjengelig'; }
  }

  /* ---------- økt ------------------------------------------------------- */
  let okt = les('okt', null);   // {navn, firma, epost, tid}

  /* ---------- statuslinje ---------------------------------------------- */
  const status = el('div', { class: 'gk-status', role: 'status' });
  function visStatus(g, antMerknader) {
    status.textContent = '';
    if (g && g.rev === K.rev) {
      status.className = 'gk-status gk-godkjent';
      status.append(el('strong', {}, `Godkjent REV ${g.rev}`), ` av ${g.navn}${g.firma ? ', ' + g.firma : ''} · ${datoTekst(g.tid)}`);
      godkjennKnapp.disabled = true; godkjennKnapp.textContent = 'Godkjent';
      merknadKnapp.hidden = true;
    } else {
      status.className = 'gk-status gk-venter';
      status.append(el('strong', {}, `REV ${K.rev} venter på godkjenning`),
        antMerknader ? ` · ${antMerknader} merknad${antMerknader > 1 ? 'er' : ''} sendt` : '');
    }
  }

  /* ---------- knapper i sidespalten ----------------------------------- */
  const godkjennKnapp = el('button', { class: 'gk-knapp gk-primar', type: 'button', onclick: () => apneGodkjenning() }, 'Godkjenn tegning');
  const merknadKnapp = el('button', { class: 'gk-knapp', type: 'button', onclick: () => apneMerknad() }, 'Jeg har merknader');
  const kvittKnapp = el('button', { class: 'gk-lenke', type: 'button', hidden: true, onclick: () => lagKvittering(les('godkjenning', null)) }, 'Last ned kvittering (PDF)');
  const blokk = el('section', { class: 'blokk gk-blokk' },
    el('h2', {}, 'Godkjenning'), status,
    el('div', { class: 'gk-knapper' }, godkjennKnapp, merknadKnapp), kvittKnapp,
    el('p', { class: 'gk-hjelp' }, 'Produksjon starter først når tegningen er godkjent.'));

  /* ---------- dialog-ramme --------------------------------------------- */
  function dialog(tittel, innhold, { lukkbar = true } = {}) {
    const d = el('dialog', { class: 'gk-dialog', 'aria-label': tittel });
    const lukk = el('button', { class: 'gk-lukk', type: 'button', 'aria-label': 'Lukk', onclick: () => d.close() }, '×');
    d.append(el('div', { class: 'gk-hode' }, el('h2', {}, tittel), lukkbar ? lukk : null), innhold);
    if (!lukkbar) d.addEventListener('cancel', e => e.preventDefault());
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    return d;
  }
  const feilFelt = () => el('p', { class: 'gk-feil', role: 'alert', hidden: true });
  const visFeil = (f, t) => { f.textContent = t; f.hidden = !t; };

  /* ---------- 1. inngang: navn, firma, e-post, kode ------------------- */
  function inngang() {
    const navn = el('input', { id: 'gk-navn', autocomplete: 'name', required: true });
    const firma = el('input', { id: 'gk-firma', autocomplete: 'organization' });
    const epost = el('input', { id: 'gk-epost', type: 'email', autocomplete: 'email', required: true });
    const kode = el('input', { id: 'gk-kode', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 });
    const feil = feilFelt();
    const testinfo = el('p', { class: 'gk-test', hidden: true });
    const steg2 = el('div', { hidden: true },
      el('label', { for: 'gk-kode' }, 'Kode fra e-posten'), kode, testinfo);
    const knapp = el('button', { class: 'gk-knapp gk-primar', type: 'submit' }, 'Send kode');
    let sendt = false;
    const skjema = el('form', { class: 'gk-skjema', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); visFeil(feil, '');
      if (!sendt) {
        if (!navn.value.trim()) return visFeil(feil, 'Skriv inn navnet ditt.');
        if (!gyldigEpost(epost.value.trim())) return visFeil(feil, 'Skriv inn en gyldig e-postadresse.');
        knapp.disabled = true;
        try {
          const r = await api('/kode', { epost: epost.value.trim().toLowerCase() });
          sendt = true; steg2.hidden = false; kode.focus();
          [navn, firma, epost].forEach(i => i.readOnly = true);
          knapp.textContent = 'Åpne tegningene';
          if (r.testkode) { testinfo.hidden = false; testinfo.textContent = `Testmodus: koden er ${r.testkode} (i drift sendes den på e-post).`; }
        } catch (err) { visFeil(feil, err.message); }
        knapp.disabled = false;
        return;
      }
      knapp.disabled = true;
      try {
        const data = { navn: navn.value.trim(), firma: firma.value.trim(), epost: epost.value.trim().toLowerCase(), kode: kode.value.trim() };
        await api('/bekreft', data);
        okt = { navn: data.navn, firma: data.firma, epost: data.epost, tid: new Date().toISOString() };
        skriv('okt', okt);
        d.close(); start();
      } catch (err) { visFeil(feil, err.message); knapp.disabled = false; }
    } },
      el('p', {}, `Du er invitert til å se ${K.tittel}. Skriv inn navn og e-post, så sender vi deg en engangskode.`),
      el('label', { for: 'gk-navn' }, 'Navn'), navn,
      el('label', { for: 'gk-firma' }, 'Firma'), firma,
      el('label', { for: 'gk-epost' }, 'E-post'), epost,
      steg2, feil, knapp,
      el('p', { class: 'gk-liten' }, 'Vi registrerer hvem som åpner tegningene, slik at vi kan følge opp godkjenningen.'));
    document.documentElement.classList.add('gk-last');
    const d = dialog('Velkommen', skjema, { lukkbar: false });
    d.addEventListener('close', () => document.documentElement.classList.remove('gk-last'));
    navn.focus();
  }

  /* ---------- 2. godkjenning: vilkår + signatur ------------------------ */
  function vilkarHtml() {
    return el('div', { class: 'gk-vilkar', tabindex: 0 },
      el('h3', {}, `${VILKAR.tittel} · versjon ${VILKAR.versjon}`),
      el('p', {}, VILKAR.ingress),
      VILKAR.punkter.map(([h, t], i) => [el('h4', {}, `${i + 1}. ${h}`), el('p', {}, t)]));
  }

  function signaturfelt() {
    const c = el('canvas', { class: 'gk-signatur', 'aria-label': 'Tegn signaturen din her' });
    let tegnet = false, ned = false, ctx;
    const tilpass = () => {
      const r = c.getBoundingClientRect(), s = window.devicePixelRatio || 1;
      c.width = r.width * s; c.height = r.height * s;
      ctx = c.getContext('2d'); ctx.scale(s, s);
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13241F';
    };
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => { ned = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
    c.addEventListener('pointermove', (e) => { if (!ned) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); if (!tegnet) { tegnet = true; c.dispatchEvent(new Event('endret')); } });
    c.addEventListener('pointerup', () => { ned = false; });
    return {
      c, tilpass,
      tegnet: () => tegnet,
      tom: () => { ctx.clearRect(0, 0, c.width, c.height); tegnet = false; c.dispatchEvent(new Event('endret')); },
      bilde: () => c.toDataURL('image/png'),
    };
  }

  function apneGodkjenning() {
    const sig = signaturfelt();
    const kryss = el('input', { type: 'checkbox', id: 'gk-kryss' });
    const navn = el('input', { id: 'gk-signavn', value: okt?.navn || '', autocomplete: 'name' });
    const feil = feilFelt();
    const signer = el('button', { class: 'gk-knapp gk-primar', type: 'submit', disabled: true }, 'Signer og godkjenn');
    const oppdater = () => { signer.disabled = !(kryss.checked && sig.tegnet() && navn.value.trim().length > 2); };
    [kryss, navn].forEach(i => i.addEventListener('input', oppdater));
    sig.c.addEventListener('endret', oppdater);

    const skjema = el('form', { class: 'gk-skjema', onsubmit: async (e) => {
      e.preventDefault(); signer.disabled = true; signer.textContent = 'Lagrer …';
      try {
        const post = {
          tegning: K.tegning, tittel: K.tittel, kunde: K.kunde, rev: K.rev,
          vilkarVersjon: VILKAR.versjon, navn: navn.value.trim(), firma: okt?.firma || '',
          epost: okt?.epost || '', tid: new Date().toISOString(),
          pdf: K.pdf.split('?')[0], sha256: await fingeravtrykk(),
          signatur: sig.bilde(), nettleser: navigator.userAgent,
        };
        await api('/godkjenn', { post });
        d.close();
        visStatus(post, 0); kvittKnapp.hidden = false;
        takk(post);
      } catch (err) { visFeil(feil, err.message); signer.disabled = false; signer.textContent = 'Signer og godkjenn'; }
    } },
      el('dl', { class: 'gk-fakta' },
        el('dt', {}, 'Tegning'), el('dd', {}, K.tittel),
        el('dt', {}, 'Revisjon'), el('dd', {}, 'REV ' + K.rev),
        el('dt', {}, 'Kunde'), el('dd', {}, K.kunde),
        el('dt', {}, 'Godkjennes av'), el('dd', {}, `${okt?.navn || ''}${okt?.firma ? ', ' + okt.firma : ''} (${okt?.epost || ''})`)),
      vilkarHtml(),
      el('label', { class: 'gk-kryss', for: 'gk-kryss' }, kryss, VILKAR.avkrysning),
      el('label', { for: 'gk-signavn' }, 'Fullt navn'), navn,
      el('div', { class: 'gk-sighode' }, el('span', {}, 'Signatur – tegn med finger eller mus'),
        el('button', { class: 'gk-lenke', type: 'button', onclick: () => sig.tom() }, 'Tøm')),
      sig.c, feil, signer);
    const d = dialog('Godkjenn tegning', skjema);
    requestAnimationFrame(sig.tilpass);
  }

  function takk(post) {
    const d = dialog('Takk – tegningen er godkjent', el('div', { class: 'gk-skjema' },
      el('p', {}, `REV ${post.rev} av ${K.tittel} er godkjent ${datoTekst(post.tid)}. Normal produksjonstid er 8 uker fra i dag.`),
      el('p', {}, TEST ? 'Testmodus: i drift får du kvitteringen på e-post, og den arkiveres hos Faginnredning.' : 'Kvitteringen er sendt til deg på e-post.'),
      el('button', { class: 'gk-knapp gk-primar', type: 'button', onclick: () => lagKvittering(post) }, 'Last ned kvittering (PDF)')));
  }

  /* ---------- 3. merknader --------------------------------------------- */
  function apneMerknad() {
    const tekst = el('textarea', { id: 'gk-merknad', rows: 6, required: true });
    const feil = feilFelt();
    const d = dialog('Jeg har merknader', el('form', { class: 'gk-skjema', onsubmit: async (e) => {
      e.preventDefault();
      if (tekst.value.trim().length < 3) return visFeil(feil, 'Skriv hva som må endres.');
      try {
        await api('/merknad', { post: { rev: K.rev, tekst: tekst.value.trim(), navn: okt?.navn, firma: okt?.firma, epost: okt?.epost, tid: new Date().toISOString() } });
        d.close();
        visStatus(null, les('merknader', []).length || 1);
        dialog('Takk for merknadene', el('div', { class: 'gk-skjema' }, el('p', {}, 'Vi ser på merknadene og sender en ny revisjon til godkjenning.')));
      } catch (err) { visFeil(feil, err.message); }
    } },
      el('p', {}, `Skriv hva som må endres i REV ${K.rev}. Henvis gjerne til side og mål i tegningen.`),
      el('label', { for: 'gk-merknad' }, 'Merknader'), tekst, feil,
      el('button', { class: 'gk-knapp gk-primar', type: 'submit' }, 'Send merknader')));
    tekst.focus();
  }

  /* ---------- 4. kvittering som PDF ----------------------------------- */
  function lastJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    return new Promise((ok, feil) => {
      const s = el('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' });
      s.onload = () => ok(window.jspdf); s.onerror = () => feil(new Error('Kunne ikke laste PDF-verktøy'));
      document.head.append(s);
    });
  }
  async function lagKvittering(p) {
    if (!p) return;
    const { jsPDF } = await lastJsPdf();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const GR = [28, 52, 46], GRAA = [85, 102, 95], V = 20, B = 170;
    let y = 22;
    doc.setFillColor(...GR); doc.rect(0, 0, 210, 12, 'F');
    doc.setTextColor(223, 216, 196); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('FAGINNREDNING', V, 8);
    doc.setTextColor(...GR); doc.setFontSize(20); doc.text('Kvittering – tegningsgodkjenning', V, y += 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAA);
    doc.text(TEST ? 'TESTMODUS – ikke en gyldig godkjenning' : 'Elektronisk godkjenning via faginnredning3d', V, y += 7);
    y += 6;
    const rad = (k, v) => {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRAA); doc.setFontSize(8.5); doc.text(k.toUpperCase(), V, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 30, 27); doc.setFontSize(10.5);
      const linjer = doc.splitTextToSize(String(v), B - 48); doc.text(linjer, V + 48, y); y += 6 * linjer.length + 1;
    };
    rad('Tegning', p.tittel); rad('Revisjon', 'REV ' + p.rev); rad('Kunde', p.kunde);
    rad('Godkjent av', `${p.navn}${p.firma ? ', ' + p.firma : ''}`); rad('E-post', p.epost);
    rad('Tidspunkt', datoTekst(p.tid) + ' (' + p.tid + ')'); rad('Vilkår', `${VILKAR.tittel}, versjon ${p.vilkarVersjon}`);
    rad('Tegningsfil', p.pdf); rad('SHA-256', p.sha256);
    y += 2; doc.setDrawColor(...GR); doc.line(V, y, V + B, y); y += 7;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAA); doc.text('SIGNATUR', V, y); y += 2;
    doc.addImage(p.signatur, 'PNG', V, y, 70, 26); y += 30;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(20, 30, 27); doc.text(p.navn, V, y); y += 10;
    doc.setFontSize(8.5); doc.setTextColor(...GRAA);
    doc.text(doc.splitTextToSize('SHA-256 er et digitalt fingeravtrykk av tegnings-PDF-en som ble godkjent. Endres PDF-en, endres fingeravtrykket. Normal produksjonstid er 8 uker fra godkjent tegning.', B), V, y);
    // vilkårene på side 2
    doc.addPage(); y = 20;
    doc.setTextColor(...GR); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(`${VILKAR.tittel} – versjon ${VILKAR.versjon}`, V, y); y += 8;
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 30, 27);
    doc.text(doc.splitTextToSize(VILKAR.ingress, B), V, y); y += 7;
    VILKAR.punkter.forEach(([h, t], i) => {
      const l = doc.splitTextToSize(t, B);
      if (y + 6 + l.length * 4.4 > 285) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...GR); doc.text(`${i + 1}. ${h}`, V, y); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 30, 27); doc.text(l, V, y); y += l.length * 4.4 + 2.5;
    });
    doc.save(`Tegningsgodkjenning ${K.tegning} REV ${p.rev}.pdf`);
  }

  /* ---------- logging av bruk ------------------------------------------ */
  function loggBruk() {
    const start = Date.now();
    const brukt = new Set();
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b.id && !brukt.has(b.id)) { brukt.add(b.id); api('/hendelse', { type: 'brukte', detaljer: { knapp: b.id } }).catch(() => {}); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        const sek = Math.round((Date.now() - start) / 1000);
        if (TEST) api('/hendelse', { type: 'tid', detaljer: { sekunder: sek } });
        else navigator.sendBeacon?.(K.api + '/hendelse', JSON.stringify({ tegning: K.tegning, rev: K.rev, type: 'tid', detaljer: { sekunder: sek } }));
      }
    });
  }

  /* ---------- oppstart -------------------------------------------------- */
  async function start() {
    const aside = document.querySelector('aside');
    const prod = aside.querySelector('.prodtid');
    (prod ? prod.after.bind(prod) : aside.prepend.bind(aside))(blokk);
    const s = await api('/status', {});
    visStatus(s.godkjenning, (s.merknader || []).length);
    kvittKnapp.hidden = !(s.godkjenning && s.godkjenning.rev === K.rev);
    if (TEST) document.body.append(el('div', { class: 'gk-testmerke' },
      'TESTMODUS – godkjenning lagres bare i denne nettleseren ',
      el('button', { type: 'button', onclick: () => { Object.keys(localStorage).filter(k => k.startsWith(NOKKEL)).forEach(k => localStorage.removeItem(k)); location.reload(); } }, 'Nullstill')));
    loggBruk();
  }

  if (okt) start(); else inngang();
})();
