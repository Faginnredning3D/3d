/* Faginnredning – bevegelig 3D-visning (simulering) på kundesidene.
 *
 * Sider som har mappa sim/ (sim.json + GLB-er, generert fra produksjonsgrunnlaget) får
 * en ekstra visning i samme scene som model-viewer: dører svinger på hengslene og skuffer
 * glir på skinnene. Kunden trykker på en dør/skuff for å åpne/lukke, eller bruker knappene
 * «Åpne alt» / «Lukk alt» som modulen legger i verktøyraden. Mangler sim/ gjør modulen
 * ingenting – siden virker som før.
 *
 * Bruk (modulskript på siden, krever importmap for "three"):
 *   import { startSim } from '../_felles/sim3d.js';
 *   startSim({ stage, mv, hint, verktoy, standardHint, versjon });
 *
 * Måling, kantlist og «skjul fronter/vegger» hører til model-viewer-visningen; modulen
 * bytter selv tilbake dit når de knappene brukes, og tilbake til simuleringen når kunden
 * bruker bevegelsesknappene. Visningsterningen virker i begge visninger.
 */
export async function startSim(o) {
  let meta;
  try {
    const r = await fetch('sim/sim.json?v=' + o.versjon, { cache: 'no-cache' });
    if (!r.ok) return null;
    meta = await r.json();
  } catch (_) { return null; }

  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

  const scene = new THREE.Scene();
  const kamera = new THREE.PerspectiveCamera(32, 1, 10, 80000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const lerret = renderer.domElement;
  lerret.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;touch-action:none;';
  o.mv.insertAdjacentElement('afterend', lerret);

  // samme lys som model-viewer (Marius 09.11: sim skal se UT SOM vanlig visning, ikke mørkere):
  // model-viewer sitt «neutral» environment er generert fra three sin RoomEnvironment,
  // og tone-mapping="neutral" tilsvarer NeutralToneMapping (fallback ACESFilmic på eldre three)
  renderer.toneMapping = THREE.NeutralToneMapping !== undefined ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const ctrl = new OrbitControls(kamera, lerret);
  ctrl.enableDamping = true;
  ctrl.minPolarAngle = 0.03; ctrl.maxPolarAngle = Math.PI - 0.03;   // samme klemming som index.html
  ctrl.screenSpacePanning = true;
  ctrl.mouseButtons.LEFT = null;   // venstre-dra håndteres av drei() (pivot under musa); touch går som før
  // Egen hjulzoom mot musepekeren (Marius 09.11): OrbitControls zoomer en fast prosent pr event
  // uansett deltaY, så touchpad/presisjonsmus (mange små events) fyker gjennom modellen.
  // NØYAKTIG samme formel som model-viewer-blokken i index.html (Marius er fornøyd med den):
  // f = exp(sum deltaY * 0.0006), klemt [0.75, 1.35] pr skjermbilde.
  ctrl.enableZoom = false;
  let hjulSum = 0, hjulX = 0, hjulY = 0;
  lerret.addEventListener('wheel', e => {
    e.preventDefault();
    hjulSum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    hjulX = e.clientX; hjulY = e.clientY;
  }, { passive: false });
  // synlighet opp foreldrekjeden (skjulte vegger skal verken fange klikk, zoom eller rotasjonspivot)
  const synligOpp = (obj) => { for (let x = obj; x; x = x.parent) if (x.visible === false) return false; return true; };
  // vegger er halvtransparente sett utenfra (B01: alpha 0,28): man ser møblene gjennom dem, så de
  // skal heller ikke fange klikk/pivot/zoom - ellers "dør" alle klikk når kameraet står utenfor rommet
  const treffbar = (obj) => {
    if (!synligOpp(obj)) return false;
    const m = obj.material;
    if (m && /^vegg$/i.test(m.name || '')) return false;
    if (m && m.transparent && m.opacity < 0.5) return false;
    return true;
  };
  const pekRay = new THREE.Raycaster(), pekNdc = new THREE.Vector2();
  function punktUnder(cx, cy) {
    const rect = lerret.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    pekNdc.x = ((cx - rect.x) / rect.width) * 2 - 1;
    pekNdc.y = -((cy - rect.y) / rect.height) * 2 + 1;
    pekRay.setFromCamera(pekNdc, kamera);
    for (const h of pekRay.intersectObjects(scene.children, true)) if (treffbar(h.object)) return h.point.clone();
    return null;
  }
  const MIN_AVSTAND = 120;   // mm, som model-viewer-blokken i index.html
  function zoomMot(f, x, y) {
    // mot punktet på modellen under musa/fingrene, ellers mot siktepunktet - som model-viewer-visningen
    const P = punktUnder(x, y) || ctrl.target.clone();
    const r0 = kamera.position.distanceTo(ctrl.target);
    if (f < 1 && r0 * f < MIN_AVSTAND) return;
    kamera.position.sub(P).multiplyScalar(f).add(P);
    ctrl.target.sub(P).multiplyScalar(f).add(P);
  }
  function hjulZoom() {
    if (!hjulSum) return;
    const f = Math.min(1.35, Math.max(0.75, Math.exp(hjulSum * 0.0006)));
    hjulSum = 0;
    zoomMot(f, hjulX, hjulY);
  }
  /* --- klypezoom på telefon/nettbrett (Marius 09.11: «zoomen må alltid fungere»): enableZoom=false over slår
     også av OrbitControls' klyp, så to fingre zoomer her mot midtpunktet mellom fingrene (panorering med to
     fingre og rotasjon med én finger går fortsatt via OrbitControls). Et klyp skal aldri åpne/lukke en dør. --- */
  const finger = new Map();
  let klypD = 0, klypBrukt = false;
  const fingrene = () => [...finger.values()];
  const fingerAvstand = () => { const [a, b] = fingrene(); return Math.hypot(a.x - b.x, a.y - b.y); };
  lerret.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (finger.size === 0) klypBrukt = false;                 // ny berøring
    finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (finger.size >= 2) { klypBrukt = true; klypD = finger.size === 2 ? fingerAvstand() : 0; }
  });
  lerret.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !finger.has(e.pointerId)) return;
    finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (finger.size !== 2 || !klypD) return;
    const d = fingerAvstand();
    if (d < 1) return;
    const f = Math.min(1.35, Math.max(0.75, klypD / d));      // fingrene fra hverandre = nærmere
    klypD = d;
    const [a, b] = fingrene();
    zoomMot(f, (a.x + b.x) / 2, (a.y + b.y) / 2);
  });
  const slippFinger = e => {
    if (!finger.delete(e.pointerId)) return;
    klypD = finger.size === 2 ? fingerAvstand() : 0;
  };
  lerret.addEventListener('pointerup', slippFinger);
  lerret.addEventListener('pointercancel', slippFinger);
  lerret.addEventListener('pointerleave', slippFinger);

  /* --- rotasjon rundt punktet man tar tak i (identisk med model-viewer-blokken i index.html):
     venstre-dra dreier kamera OG siktepunkt rundt punktet under musa (gir: loddrett akse gjennom P,
     stigning: kameraets høyre-akse gjennom P), så punktet ligger i ro på skjermen. Touch går
     fortsatt via OrbitControls. --- */
  const FART = 0.006;        // radianer pr skjermpiksel, samme som index.html
  const OPP = new THREE.Vector3(0, 1, 0);
  let dra = null;
  function drei(P, dx, dy) {
    const C = kamera.position, T = ctrl.target;
    const a = -dx * FART;
    C.sub(P).applyAxisAngle(OPP, a).add(P);
    T.sub(P).applyAxisAngle(OPP, a).add(P);
    const hoyre = new THREE.Vector3().subVectors(T, C).normalize().cross(OPP).normalize();
    const b = -dy * FART;
    const C2 = C.clone().sub(P).applyAxisAngle(hoyre, b).add(P);
    const T2 = T.clone().sub(P).applyAxisAngle(hoyre, b).add(P);
    const off = new THREE.Vector3().subVectors(C2, T2);
    const phi2 = Math.acos(Math.min(1, Math.max(-1, off.y / off.length())));
    if (phi2 > 0.03 && phi2 < Math.PI - 0.03) { C.copy(C2); T.copy(T2); }
  }
  lerret.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    dra = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, flyttet: 0,
            P: punktUnder(e.clientX, e.clientY) || ctrl.target.clone(), id: e.pointerId };
    try { lerret.setPointerCapture(e.pointerId); } catch (_) {}
  });
  lerret.addEventListener('pointermove', e => {
    if (!dra || e.pointerId !== dra.id) return;
    const dx = e.clientX - dra.x, dy = e.clientY - dra.y;
    dra.x = e.clientX; dra.y = e.clientY;
    dra.flyttet = Math.max(dra.flyttet, Math.hypot(e.clientX - dra.x0, e.clientY - dra.y0));
    if (dra.flyttet <= 6) return;   // museklikk har alltid litt jitter: ikke rotér før det er et ekte dra (som index.html)
    if (dx || dy) drei(dra.P, dx, dy);
  });
  const slippDra = e => {
    if (!dra || e.pointerId !== dra.id) return;
    dra = null;
    try { lerret.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  lerret.addEventListener('pointerup', slippDra);
  lerret.addEventListener('pointercancel', slippDra);
  lerret.addEventListener('dblclick', e => {
    const P = punktUnder(e.clientX, e.clientY);   // dobbeltklikk = gå inn på punktet, som i index.html
    if (!P) return;
    const r1 = Math.max(250, kamera.position.distanceTo(ctrl.target) * 0.35);
    const retn = new THREE.Vector3().subVectors(kamera.position, ctrl.target).normalize();
    ctrl.target.copy(P);
    kamera.position.copy(P).addScaledVector(retn, r1);
  });

  const laster = new GLTFLoader();
  const lastEnGang = (fil) => new Promise((ok, feil) => laster.load('sim/' + fil + '?v=' + o.versjon, g => ok(g.scene), undefined, feil));
  // GitHub Pages svarer av og til 503 på enkeltfiler: prøv igjen før vi gir opp, ellers
  // dør hele sim-oppstarten på én fil og siden står uten Åpne/Lukk alt (Marius 09.11)
  async function last(fil) {
    const vent = [300, 800, 1500];
    for (let i = 0; ; i++) {
      try { return await lastEnGang(fil); }
      catch (e) {
        if (i >= vent.length) throw e;
        await new Promise(r => setTimeout(r, vent[i]));
      }
    }
  }

  // 3D-visning alltid skyggelagt MED svarte kantlinjer (Marius 09.11) - gjelder også sim-scenen
  const kantMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85 });
  function kanter(obj) {
    obj.traverse(x => {
      if (!x.isMesh) return;
      // GLB-fargene er autorert som skjermfarger (sRGB): konverter til lineært én gang pr materiale,
      // ellers vises eikefronter o.l. blasse/grå (glTF tolker baseColorFactor som lineær)
      if (x.material && x.material.color && !x.material.userData.fargeOK) {
        x.material.color.convertSRGBToLinear(); x.material.userData.fargeOK = true;
      }
      if (x.userData.harKant || /^vegg$/i.test((x.material && x.material.name) || '')) return;
      if (x.material) { x.material.polygonOffset = true; x.material.polygonOffsetFactor = 1; x.material.polygonOffsetUnits = 1; }
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(x.geometry, 25), kantMat);
      l.raycast = () => {}; x.add(l); x.userData.harKant = true;
    });
    return obj;
  }

  const ramme = new THREE.Box3();
  const grupper = {};            // id -> {parent, indre(container), meta, andel, maal}
  const korpus = kanter(await last('korpus.glb'));
  scene.add(korpus);
  ramme.expandByObject(korpus);
  const veggMesh = [];           // romveggene (materiale VEGG): kan skjules også i simuleringen
  korpus.traverse(x => { if (x.isMesh && /^vegg$/i.test((x.material && x.material.name) || '')) veggMesh.push(x); });

  // alle gruppe- og beslags-GLB-er parallelt (raskere, færre timeouts), og fail-soft:
  // en fil som feiler etter alle forsøkene hoppes over - resten av simuleringen virker
  const artNavn = [...new Set(meta.beslag.map(b => b.glb))];
  const [gLast, aLast] = await Promise.all([
    Promise.allSettled(meta.grupper.map(g => last(g.glb))),
    Promise.allSettled(artNavn.map(n => last(n))),
  ]);
  meta.grupper.forEach((g, i) => {
    if (gLast[i].status !== 'fulfilled') { console.warn('sim: hoppet over gruppe', g.glb, gLast[i].reason); return; }
    const parent = new THREE.Group(); const indre = new THREE.Group();
    const p = g.pivot;
    parent.position.set(p[0], p[1], p[2]); indre.position.set(-p[0], -p[1], -p[2]);
    parent.add(indre); scene.add(parent);
    const inner = kanter(gLast[i].value);
    inner.traverse(x => x.userData.gruppe = g.id);
    indre.add(inner);
    grupper[g.id] = { parent, indre, meta: g, andel: 0, maal: 0 };
    ramme.expandByObject(parent);
  });
  const artCache = {};
  artNavn.forEach((n, i) => {
    if (aLast[i].status === 'fulfilled') artCache[n] = kanter(aLast[i].value);
    else console.warn('sim: hoppet over beslag', n, aLast[i].reason);
  });
  for (const b of meta.beslag) {
    if (!artCache[b.glb]) continue;
    if (b.gruppe && !grupper[b.gruppe]) continue;
    const inst = artCache[b.glb].clone(true);
    inst.applyMatrix4(new THREE.Matrix4().fromArray(b.matrise));
    if (b.gruppe) { inst.traverse(x => x.userData.gruppe = b.gruppe); grupper[b.gruppe].indre.add(inst); }
    else scene.add(inst);
  }

  /* --- kamera: samme retninger som visningsterningen (model-viewer-konvensjon) --- */
  const senter = ramme.getCenter(new THREE.Vector3());
  const R = ramme.getSize(new THREE.Vector3()).length() / 2;
  ctrl.target.copy(senter);
  ctrl.minDistance = 1; ctrl.maxDistance = R * 6;   // minsteavstand håndteres av MIN_AVSTAND-vakta (120 mm, som mv)
  function orbitTil(bane) {
    const [t, p] = bane.split(' ');
    const th = parseFloat(t) * Math.PI / 180, ph = parseFloat(p) * Math.PI / 180;
    const vfov = kamera.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * kamera.aspect);
    const r = R * 1.15 / Math.sin(Math.min(vfov, hfov) / 2);
    kamera.position.set(senter.x + r * Math.sin(ph) * Math.sin(th),
                        senter.y + r * Math.cos(ph),
                        senter.z + r * Math.sin(ph) * Math.cos(th));
    ctrl.target.copy(senter);
  }

  /* --- bevegelse --- */
  function settMaal(id, v) {
    const g = grupper[id];
    g.maal = v;
    if (v > 0 && g.meta.dor && grupper[g.meta.dor]) grupper[g.meta.dor].maal = 1;   // åpne døra foran innvendig skuff
  }
  const apneAlt = () => Object.keys(grupper).forEach(id => settMaal(id, grupper[id].meta.indre ? 0.8 : 1));
  const lukkAlt = () => Object.keys(grupper).forEach(id => grupper[id].maal = 0);

  const ray = new THREE.Raycaster(); const pek = new THREE.Vector2();
  let nede = null, klikkTimer = null;
  lerret.addEventListener('pointerdown', e => nede = [e.clientX, e.clientY]);
  lerret.addEventListener('pointerup', e => {
    if (!nede || Math.hypot(e.clientX - nede[0], e.clientY - nede[1]) > 6) return;   // dra = rotasjon
    if (e.pointerType === 'touch' && klypBrukt) return;                              // klyp/to fingre = zoom, ikke klikk
    const cx = e.clientX, cy = e.clientY;
    clearTimeout(klikkTimer);
    klikkTimer = setTimeout(() => {      // vent på ev. dobbeltklikk (gå inn på punkt), som i index.html
      const b = lerret.getBoundingClientRect();
      pek.x = ((cx - b.left) / b.width) * 2 - 1; pek.y = -((cy - b.top) / b.height) * 2 + 1;
      ray.setFromCamera(pek, kamera);
      for (const h of ray.intersectObjects(scene.children, true)) {
        if (!treffbar(h.object)) continue;   // skjulte/gjennomsiktige vegger skal ikke fange klikket
        let x = h.object, id = null;
        while (x) { if (x.userData.gruppe) { id = x.userData.gruppe; break; } x = x.parent; }
        if (id) settMaal(id, grupper[id].maal > 0.05 ? 0 : (grupper[id].meta.indre ? 0.8 : 1));
        break;   // traff korpus/benkeplate: gjør ingenting
      }
    }, 260);
  });
  lerret.addEventListener('dblclick', () => clearTimeout(klikkTimer));

  /* --- tegnesløyfe (bare når visningen er aktiv) --- */
  let aktiv = false;
  const klokke = new THREE.Clock();
  function passform() {
    const b = o.stage.getBoundingClientRect();
    kamera.aspect = b.width / Math.max(1, b.height); kamera.updateProjectionMatrix();
    renderer.setSize(b.width, b.height, false); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  }
  addEventListener('resize', () => { if (aktiv) passform(); });
  function tegn() {
    if (!aktiv) return;
    requestAnimationFrame(tegn);
    steg();
  }
  function steg() {
    const dt = Math.min(klokke.getDelta(), 0.05);
    for (const id in grupper) {
      const g = grupper[id];
      const d = g.maal - g.andel;
      if (Math.abs(d) > 1e-4) {
        g.andel += Math.sign(d) * Math.min(Math.abs(d), dt * 1.4);
        const t = Math.max(0, g.andel);
        if (g.meta.type === 'dor') g.parent.rotation.y = g.meta.fortegn * g.meta.vinkel * Math.PI / 180 * t;
        else {
          const r = g.meta.retn || [0, 0, 1], s = g.meta.slag * t, p = g.meta.pivot;   // retn: skuffens utrekksretning (eldre sim.json: +z)
          g.parent.position.set(p[0] + r[0] * s, p[1] + r[1] * s, p[2] + r[2] * s);
        }
      }
    }
    // dybdepresisjon: near/far følger kameraavstanden, ellers slår skjulte kantlinjer gjennom
    // flatene når man zoomer ut (near 10 mot far 80000 gir for grovt dybdebuffer)
    const dk = kamera.position.distanceTo(ctrl.target);
    kamera.near = Math.max(50, dk / 50);
    kamera.far = Math.max(kamera.near * 100, dk + 4 * R);
    kamera.updateProjectionMatrix();
    hjulZoom();
    ctrl.update();
    renderer.render(scene, kamera);
  }

  /* --- bytte mellom simulering og model-viewer --- */
  const simHint = 'Trykk på en dør eller skuff for å åpne/lukke · dra for å rotere · rull for zoom';
  function visSim() {
    if (aktiv) return;
    // måling/kantlist hører til model-viewer: slå dem av før bytte
    for (const id of ['maalknapp', 'kantknapp']) {
      const k = document.getElementById(id);
      if (k && k.getAttribute('aria-pressed') === 'true') k.click();
    }
    aktiv = true;
    // ta med kameraet fra model-viewer, så visningsbyttet ikke merkes (Marius 09.11)
    // NB: model-viewer sine «m» er GLB-enheter, dvs. mm i våre modeller - ALDRI skaler med 1000
    try {
      if (o.mv.loaded && o.mv.getCameraOrbit) {
        const ob = o.mv.getCameraOrbit(), tg = o.mv.getCameraTarget();
        const r = ob.radius;
        if (isFinite(r) && r > 1) {
          ctrl.target.set(tg.x, tg.y, tg.z);
          kamera.position.set(ctrl.target.x + r * Math.sin(ob.phi) * Math.sin(ob.theta),
                              ctrl.target.y + r * Math.cos(ob.phi),
                              ctrl.target.z + r * Math.sin(ob.phi) * Math.cos(ob.theta));
          const fv = o.mv.getFieldOfView && o.mv.getFieldOfView();
          if (isFinite(fv) && fv > 1) { kamera.fov = fv; kamera.updateProjectionMatrix(); }
        }
      }
    } catch (e) {}
    o.mv.style.visibility = 'hidden';
    lerret.style.display = 'block';
    if (o.hint) o.hint.textContent = simHint;
    passform(); klokke.getDelta(); tegn();
  }
  function visMV() {
    if (!aktiv) return;
    aktiv = false;
    // gi kameraet tilbake til model-viewer i samme posisjon
    try {
      const off = kamera.position.clone().sub(ctrl.target), r = off.length();
      if (isFinite(r) && r > 1) {
        const phi = Math.acos(Math.min(1, Math.max(-1, off.y / r)));
        const th = Math.atan2(off.x, off.z);
        o.mv.cameraTarget = `${ctrl.target.x}m ${ctrl.target.y}m ${ctrl.target.z}m`;
        o.mv.cameraOrbit = `${th}rad ${phi}rad ${r}m`;
        if (o.mv.jumpCameraToGoal) o.mv.jumpCameraToGoal();
      }
    } catch (e) {}
    lerret.style.display = 'none';
    o.mv.style.visibility = '';
    if (o.hint && o.standardHint) o.hint.textContent = o.standardHint;
  }

  // model-viewer-knappene bytter til den visningen de hører til
  for (const id of ['maalknapp', 'kantknapp', 'frontknapp']) {
    const k = document.getElementById(id);
    if (k) k.addEventListener('click', visMV);
  }
  // «Skjul vegger» virker også i simuleringen (Marius 08.11: må kunne trykke GJENNOM skjult vegg
  // og åpne skuffer). Sidens egen handler toggler model-viewer-materialene + aria-pressed først;
  // her speiles tilstanden på sim-veggene i stedet for å bytte visning.
  const vk = document.getElementById('veggknapp');
  if (vk) {
    if (veggMesh.length) {
      let veggSkjult = false;
      vk.addEventListener('click', () => {
        veggSkjult = !veggSkjult;
        veggMesh.forEach(m => m.visible = !veggSkjult);
        // sidens model-viewer-handler hopper over toggling til modellen er lastet: hold knappen i synk selv
        if ((vk.getAttribute('aria-pressed') === 'true') !== veggSkjult) {
          vk.setAttribute('aria-pressed', String(veggSkjult));
          vk.textContent = veggSkjult ? 'Vis vegger' : 'Skjul vegger';
        }
      });
    } else vk.addEventListener('click', visMV);   // sim uten vegger: oppfør deg som før
  }
  // visningsterningen virker i begge visninger
  document.querySelectorAll('.terning button[data-orbit]').forEach(b =>
    b.addEventListener('click', () => { if (aktiv) orbitTil(b.dataset.orbit); }));

  /* --- knapper i verktøyraden --- */
  const ka = document.createElement('button'); ka.id = 'simapne'; ka.textContent = 'Åpne alt';
  const kl = document.createElement('button'); kl.id = 'simlukk'; kl.textContent = 'Lukk alt';
  ka.addEventListener('click', () => { visSim(); apneAlt(); });
  kl.addEventListener('click', () => { visSim(); lukkAlt(); });
  const foran = o.verktoy.querySelector('#maalknapp');
  o.verktoy.insertBefore(kl, foran); o.verktoy.insertBefore(ka, kl);

  orbitTil('32deg 72deg');
  visSim();                      // bevegelig visning er standard når sim-data finnes
  const api = { visSim, visMV, apneAlt, lukkAlt, erAktiv: () => aktiv, kamera, ctrl, grupper, tegnFrame: steg };
  window.FAGSIM = api;           // feilsøking/verifikasjon fra konsollen
  return api;
}
