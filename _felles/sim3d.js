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

  // dempet lys: summen skal ikke klippe fargene mot hvitt (Marius 09.11: eik skal se ut som eik)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcabb, 0.85));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.55); d1.position.set(4000, 6000, 7000); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xfff3e0, 0.3); d2.position.set(-5000, 3500, -2000); scene.add(d2);

  const ctrl = new OrbitControls(kamera, lerret);
  ctrl.enableDamping = true; ctrl.maxPolarAngle = Math.PI * 0.55;
  ctrl.screenSpacePanning = true;
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
  function hjulZoom() {
    if (!hjulSum) return;
    const f = Math.min(1.35, Math.max(0.75, Math.exp(hjulSum * 0.0006)));
    hjulSum = 0;
    const rect = lerret.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const d0 = kamera.position.distanceTo(ctrl.target);
    const k = Math.min(Math.max(d0 * f, ctrl.minDistance), ctrl.maxDistance) / d0;
    if (k === 1) return;
    // skaler kamera + target om punktet under pekeren i target-planet, så pekerpunktet står stille
    const ndc = { x: ((hjulX - rect.x) / rect.width) * 2 - 1, y: -((hjulY - rect.y) / rect.height) * 2 + 1 };
    const D = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(kamera).sub(kamera.position).normalize();
    const N = ctrl.target.clone().sub(kamera.position).normalize();
    const t = ctrl.target.clone().sub(kamera.position).dot(N) / Math.max(D.dot(N), 0.05);
    const C = kamera.position.clone().addScaledVector(D, t);
    kamera.position.sub(C).multiplyScalar(k).add(C);
    ctrl.target.sub(C).multiplyScalar(k).add(C);
  }

  const laster = new GLTFLoader();
  const last = (fil) => new Promise((ok, feil) => laster.load('sim/' + fil + '?v=' + o.versjon, g => ok(g.scene), undefined, feil));

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

  for (const g of meta.grupper) {
    const parent = new THREE.Group(); const indre = new THREE.Group();
    const p = g.pivot;
    parent.position.set(p[0], p[1], p[2]); indre.position.set(-p[0], -p[1], -p[2]);
    parent.add(indre); scene.add(parent);
    const inner = kanter(await last(g.glb));
    inner.traverse(x => x.userData.gruppe = g.id);
    indre.add(inner);
    grupper[g.id] = { parent, indre, meta: g, andel: 0, maal: 0 };
    ramme.expandByObject(parent);
  }
  const artCache = {};
  for (const b of meta.beslag) {
    if (!artCache[b.glb]) artCache[b.glb] = kanter(await last(b.glb));
    const inst = artCache[b.glb].clone(true);
    inst.applyMatrix4(new THREE.Matrix4().fromArray(b.matrise));
    if (b.gruppe) { inst.traverse(x => x.userData.gruppe = b.gruppe); grupper[b.gruppe].indre.add(inst); }
    else scene.add(inst);
  }

  /* --- kamera: samme retninger som visningsterningen (model-viewer-konvensjon) --- */
  const senter = ramme.getCenter(new THREE.Vector3());
  const R = ramme.getSize(new THREE.Vector3()).length() / 2;
  ctrl.target.copy(senter);
  ctrl.minDistance = 150; ctrl.maxDistance = R * 6;   // 150 mm: helt inntil detaljer uten å havne inne i modellen
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
    const synlig = (obj) => { for (let x = obj; x; x = x.parent) if (x.visible === false) return false; return true; };
    for (const h of ray.intersectObjects(scene.children, true)) {
      if (!synlig(h.object)) continue;   // skjulte vegger (raycasteren ser dem fortsatt) skal ikke fange klikket
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
    try {
      if (o.mv.loaded && o.mv.getCameraOrbit) {
        const ob = o.mv.getCameraOrbit(), tg = o.mv.getCameraTarget();
        const r = ob.radius * 1000;
        if (isFinite(r) && r > 1) {
          ctrl.target.set(tg.x * 1000, tg.y * 1000, tg.z * 1000);
          kamera.position.set(ctrl.target.x + r * Math.sin(ob.phi) * Math.sin(ob.theta),
                              ctrl.target.y + r * Math.cos(ob.phi),
                              ctrl.target.z + r * Math.sin(ob.phi) * Math.cos(ob.theta));
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
        o.mv.cameraTarget = `${ctrl.target.x / 1000}m ${ctrl.target.y / 1000}m ${ctrl.target.z / 1000}m`;
        o.mv.cameraOrbit = `${th}rad ${phi}rad ${r / 1000}m`;
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
