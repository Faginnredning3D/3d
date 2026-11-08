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

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcabb, 1.05));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.3); d1.position.set(4000, 6000, 7000); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xfff3e0, 0.5); d2.position.set(-5000, 3500, -2000); scene.add(d2);

  const ctrl = new OrbitControls(kamera, lerret);
  ctrl.enableDamping = true; ctrl.maxPolarAngle = Math.PI * 0.55;

  const laster = new GLTFLoader();
  const last = (fil) => new Promise((ok, feil) => laster.load('sim/' + fil + '?v=' + o.versjon, g => ok(g.scene), undefined, feil));

  const ramme = new THREE.Box3();
  const grupper = {};            // id -> {parent, indre(container), meta, andel, maal}
  const korpus = await last('korpus.glb');
  scene.add(korpus);
  ramme.expandByObject(korpus);

  for (const g of meta.grupper) {
    const parent = new THREE.Group(); const indre = new THREE.Group();
    const p = g.pivot;
    parent.position.set(p[0], p[1], p[2]); indre.position.set(-p[0], -p[1], -p[2]);
    parent.add(indre); scene.add(parent);
    const inner = await last(g.glb);
    inner.traverse(x => x.userData.gruppe = g.id);
    indre.add(inner);
    grupper[g.id] = { parent, indre, meta: g, andel: 0, maal: 0 };
    ramme.expandByObject(parent);
  }
  const artCache = {};
  for (const b of meta.beslag) {
    if (!artCache[b.glb]) artCache[b.glb] = await last(b.glb);
    const inst = artCache[b.glb].clone(true);
    inst.applyMatrix4(new THREE.Matrix4().fromArray(b.matrise));
    if (b.gruppe) { inst.traverse(x => x.userData.gruppe = b.gruppe); grupper[b.gruppe].indre.add(inst); }
    else scene.add(inst);
  }

  /* --- kamera: samme retninger som visningsterningen (model-viewer-konvensjon) --- */
  const senter = ramme.getCenter(new THREE.Vector3());
  const R = ramme.getSize(new THREE.Vector3()).length() / 2;
  ctrl.target.copy(senter);
  ctrl.minDistance = R * 0.25; ctrl.maxDistance = R * 6;
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
  let nede = null;
  lerret.addEventListener('pointerdown', e => nede = [e.clientX, e.clientY]);
  lerret.addEventListener('pointerup', e => {
    if (!nede || Math.hypot(e.clientX - nede[0], e.clientY - nede[1]) > 6) return;   // dra = rotasjon
    const b = lerret.getBoundingClientRect();
    pek.x = ((e.clientX - b.left) / b.width) * 2 - 1; pek.y = -((e.clientY - b.top) / b.height) * 2 + 1;
    ray.setFromCamera(pek, kamera);
    for (const h of ray.intersectObjects(scene.children, true)) {
      let x = h.object, id = null;
      while (x) { if (x.userData.gruppe) { id = x.userData.gruppe; break; } x = x.parent; }
      if (id) settMaal(id, grupper[id].maal > 0.05 ? 0 : (grupper[id].meta.indre ? 0.8 : 1));
      break;   // traff korpus/benkeplate: gjør ingenting
    }
  });

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
    o.mv.style.visibility = 'hidden';
    lerret.style.display = 'block';
    if (o.hint) o.hint.textContent = simHint;
    passform(); klokke.getDelta(); tegn();
  }
  function visMV() {
    if (!aktiv) return;
    aktiv = false;
    lerret.style.display = 'none';
    o.mv.style.visibility = '';
    if (o.hint && o.standardHint) o.hint.textContent = o.standardHint;
  }

  // model-viewer-knappene bytter til den visningen de hører til
  for (const id of ['maalknapp', 'kantknapp', 'frontknapp', 'veggknapp']) {
    const k = document.getElementById(id);
    if (k) k.addEventListener('click', visMV);
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
  const api = { visSim, visMV, apneAlt, lukkAlt, erAktiv: () => aktiv, kamera, ctrl, grupper };
  window.FAGSIM = api;           // feilsøking/verifikasjon fra konsollen
  return api;
}
