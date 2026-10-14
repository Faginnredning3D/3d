"""VRML 2.0 (imos-eksport) -> binaer glTF (.glb).

Flater hierarkiet, grupperer trekanter per materiale, bygger inn teksturer.
Bruk:  python wrl2glb.py <inn.wrl> <ut.glb>
"""
import sys, os, json, struct, io, math, re
import numpy as np
from PIL import Image

TEX_ROOT_MAP = [(r"\\fidc02\imos AG", "I:"), (r"\fidc02\imos AG", "I:")]
TEX_TINT = {'ix_oak_m.jpg': [0.42, 0.30, 0.22], 'i_wood_oak_gloss.jpg': [0.42, 0.30, 0.22]}  # moerk beis paa eik
TEX_OVERRIDE = {'fag_fenixj5003_oro_cortez.jpg': r'I:\Library\IVIS\IX_ALUMINIUM_BRUSHED.JPG'}
MAX_TEX = 2048


# ---------------------------------------------------------------- tokenizer
def tokenize(text):
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == "#":
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
        elif c in " \t\r\n,":
            i += 1
        elif c in "{}[]":
            out.append(c)
            i += 1
        elif c == '"':
            j = i + 1
            buf = []
            while j < n and text[j] != '"':
                # imos skriver raa Windows-stier, saa bare \" og \\ er escape
                if text[j] == "\\" and j + 1 < n and text[j + 1] in '"\\':
                    buf.append(text[j + 1])
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            out.append('"' + "".join(buf))
            i = j + 1
        else:
            j = i
            while j < n and text[j] not in ' \t\r\n,{}[]"#':
                j += 1
            out.append(text[i:j])
            i = j
    return out


class P:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def next(self):
        v = self.t[self.i]
        self.i += 1
        return v


def is_num(s):
    try:
        float(s)
        return True
    except (TypeError, ValueError):
        return False


def parse_node(p, defs):
    """Leser [DEF navn] Type { ... } eller USE navn. Returnerer dict."""
    tok = p.next()
    name = None
    if tok == "DEF":
        name = p.next()
        tok = p.next()
    if tok == "USE":
        return defs.get(p.next())
    ntype = tok
    node = {"_type": ntype}
    if p.peek() == "{":
        p.next()
        while p.peek() is not None and p.peek() != "}":
            node.update(parse_field(p, defs))
        if p.peek() == "}":
            p.next()
    if name:
        node["_name"] = name
        defs[name] = node
    return node


def parse_field(p, defs):
    key = p.next()
    v = p.peek()
    if v == "[":
        p.next()
        items, nums = [], []
        while p.peek() is not None and p.peek() != "]":
            if is_num(p.peek()):
                nums.append(float(p.next()))
            elif p.peek() == "[":        # nested, hopp over
                depth = 0
                while p.peek() is not None:
                    t = p.next()
                    if t == "[":
                        depth += 1
                    elif t == "]":
                        depth -= 1
                        if depth == 0:
                            break
            else:
                items.append(parse_node(p, defs))
        if p.peek() == "]":
            p.next()
        return {key: nums if nums else items}
    if is_num(v):
        nums = []
        while p.peek() is not None and is_num(p.peek()):
            nums.append(float(p.next()))
        return {key: nums[0] if len(nums) == 1 else nums}
    if v in ("TRUE", "FALSE"):
        p.next()
        return {key: v == "TRUE"}
    if v is not None and v.startswith('"'):
        return {key: p.next()[1:]}
    return {key: parse_node(p, defs)}


# ---------------------------------------------------------------- matriser
def mat_translate(t):
    m = np.eye(4)
    m[:3, 3] = t
    return m


def mat_scale(s):
    m = np.eye(4)
    m[0, 0], m[1, 1], m[2, 2] = s
    return m


def mat_rotate(r):
    x, y, z, a = r
    ln = math.sqrt(x * x + y * y + z * z)
    if ln < 1e-12 or abs(a) < 1e-12:
        return np.eye(4)
    x, y, z = x / ln, y / ln, z / ln
    c, s, t = math.cos(a), math.sin(a), 1 - math.cos(a)
    m = np.eye(4)
    m[:3, :3] = [
        [t * x * x + c,     t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c,     t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ]
    return m


def transform_matrix(node):
    tr = node.get("translation", [0, 0, 0])
    rot = node.get("rotation", [0, 0, 1, 0])
    sc = node.get("scale", [1, 1, 1])
    ctr = node.get("center", [0, 0, 0])
    so = node.get("scaleOrientation", [0, 0, 1, 0])
    tr = tr if isinstance(tr, list) else [tr, 0, 0]
    sc = sc if isinstance(sc, list) else [sc, sc, sc]
    ctr = ctr if isinstance(ctr, list) else [ctr, 0, 0]
    m = mat_translate(tr) @ mat_translate(ctr) @ mat_rotate(rot) @ mat_rotate(so)
    m = m @ mat_scale(sc) @ mat_rotate([so[0], so[1], so[2], -so[3]])
    return m @ mat_translate([-c for c in ctr])


# ---------------------------------------------------------------- traversering
class Bucket:
    def __init__(self):
        self.pos, self.uv, self.idx = [], [], []


def appearance_key(app):
    if app is None:
        return ("default", (0.8, 0.8, 0.8), 0.0, None)
    mat = app.get("material") or {}
    dc = mat.get("diffuseColor", [0.8, 0.8, 0.8])
    dc = dc if isinstance(dc, list) else [dc, dc, dc]
    tr = mat.get("transparency", 0.0)
    tr = tr if isinstance(tr, float) else 0.0
    tex = app.get("texture") or {}
    url = tex.get("url") if isinstance(tex, dict) else None
    front = "FRONT" if "__FRONT__" in (app.get("_name") or "") else ""
    return (front or app.get("_type", "A"), tuple(round(c, 4) for c in dc[:3]), round(tr, 3), url)


# imos eksporterer snitt- og fasademarkoerer (flagg, etiketter) som egne noder,
# skalert 20x og plassert titalls meter unna modellen. De skal ikke med.
ANNOT = re.compile(r"imos(flag|label)", re.I)


def walk(node, mat, buckets, stats):
    if not isinstance(node, dict):
        return
    nm = node.get("_name")
    if nm and ANNOT.search(nm):
        stats["annot"] = stats.get("annot", 0) + 1
        return
    t = node.get("_type")
    if t in ("Transform", "Group", "Collision", "Anchor", "Billboard"):
        if t == "Transform":
            mat = mat @ transform_matrix(node)
        for ch in node.get("children", []) or []:
            walk(ch, mat, buckets, stats)
        return
    if t == "Shape":
        geo = node.get("geometry")
        if not isinstance(geo, dict) or geo.get("_type") != "IndexedFaceSet":
            return
        coord = geo.get("coord")
        if not isinstance(coord, dict):
            return
        pts = coord.get("point")
        ci = geo.get("coordIndex")
        if not pts or not ci:
            return
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 3)
        ci = [int(v) for v in ci]

        tcn = geo.get("texCoord")
        tc = np.asarray(tcn.get("point"), dtype=np.float32).reshape(-1, 2) if isinstance(tcn, dict) and tcn.get("point") else None
        tci = [int(v) for v in geo.get("texCoordIndex", [])] or None

        key = appearance_key(node.get("appearance"))
        b = buckets.setdefault(key, Bucket())

        hom = np.hstack([pts, np.ones((len(pts), 1))])
        world = (mat @ hom.T).T[:, :3]

        faces, cur, curt = [], [], []
        for k, v in enumerate(ci):
            if v == -1:
                if len(cur) >= 3:
                    faces.append((cur, curt))
                cur, curt = [], []
            else:
                cur.append(v)
                if tci is not None and k < len(tci):
                    curt.append(tci[k])
        if len(cur) >= 3:
            faces.append((cur, curt))

        for poly, polyt in faces:
            for j in range(1, len(poly) - 1):
                for a in (0, j, j + 1):
                    vi = poly[a]
                    if vi >= len(world):
                        continue
                    b.idx.append(len(b.pos))
                    b.pos.append(world[vi])
                    if tc is not None and polyt and a < len(polyt) and polyt[a] < len(tc):
                        u, vv = tc[polyt[a]]
                        b.uv.append((float(u), float(-vv)))
                    else:
                        b.uv.append((0.0, 0.0))
        stats["shapes"] += 1
        return
    for ch in node.get("children", []) or []:
        walk(ch, mat, buckets, stats)


# ---------------------------------------------------------------- glb
SRC_DIR = ""


def drop_outliers(buckets, lo=0.5, hi=99.5, margin=0.25):
    """Fjerner trekanter som ligger langt utenfor hovedmassen (imos legger av og til
    hjelpegeometri titalls meter unna, som ellers krymper modellen til et punkt)."""
    allpos = np.vstack([np.asarray(b.pos) for b in buckets.values() if b.pos])
    p_lo = np.percentile(allpos, lo, axis=0)
    p_hi = np.percentile(allpos, hi, axis=0)
    span = np.maximum(p_hi - p_lo, 1.0)
    lo_b, hi_b = p_lo - span * margin, p_hi + span * margin
    fjernet = 0
    for b in buckets.values():
        if not b.pos:
            continue
        pos = np.asarray(b.pos)
        ok_v = np.all((pos >= lo_b) & (pos <= hi_b), axis=1)
        idx = np.asarray(b.idx).reshape(-1, 3)
        keep_tri = ok_v[idx].all(axis=1)
        fjernet += int((~keep_tri).sum())
        idx = idx[keep_tri].ravel()
        used = np.unique(idx)
        remap = np.full(len(pos), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        b.pos = [pos[i] for i in used]
        b.uv = [b.uv[i] for i in used]
        b.idx = remap[idx].tolist()
    print(f"filtrert bort {fjernet} trekanter utenfor hovedmassen", flush=True)
    print(f"  ramme: {lo_b.round(0)} .. {hi_b.round(0)}", flush=True)


def drop_outside_room(buckets, margin=150.0):
    """Fjerner trekanter som ligger utenfor romskallet (stoerste boks i modellen).
    imos legger av og til hjelpegeometri langt utenfor rommet."""
    best, bvol = None, 0
    for b in buckets.values():
        if not b.pos:
            continue
        p = np.asarray(b.pos)
        sz = p.max(axis=0) - p.min(axis=0)
        if sz[0] * sz[1] > bvol:      # romskallet er bredest og hoeyest
            bvol, best = sz[0] * sz[1], (p.min(axis=0) - margin, p.max(axis=0) + margin)
    if best is None:
        return
    lo_b, hi_b = best
    fjernet = 0
    for b in buckets.values():
        if not b.pos:
            continue
        pos = np.asarray(b.pos)
        ok_v = np.all((pos >= lo_b) & (pos <= hi_b), axis=1)
        idx = np.asarray(b.idx).reshape(-1, 3)
        keep = ok_v[idx].all(axis=1)
        fjernet += int((~keep).sum())
        idx = idx[keep].ravel()
        used = np.unique(idx)
        remap = np.full(len(pos), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        b.pos = [pos[i] for i in used]
        b.uv = [b.uv[i] for i in used]
        b.idx = remap[idx].tolist()
    print(f"fjernet {fjernet} trekanter utenfor rommet", flush=True)

def drop_shell(buckets):
    """Fjerner romskallet: materialgrupper som dekker hele rommet i bredde og dybde
    OG er full romhoeyde. Gulvet (tynt i hoeyden) beholdes som underlag."""
    allpos = np.vstack([np.asarray(b.pos) for b in buckets.values() if b.pos])
    gx = allpos[:, 0].max() - allpos[:, 0].min()
    gz = allpos[:, 2].max() - allpos[:, 2].min()
    for key in list(buckets):
        b = buckets[key]
        if not b.pos:
            continue
        pos = np.asarray(b.pos)
        sz = pos.max(axis=0) - pos.min(axis=0)
        if sz[0] > 0.9 * gx and sz[2] > 0.9 * gz and sz[1] > 500:
            print(f"  fjerner romskall-gruppe ({len(pos)} vertekser, {sz.round(0)})", flush=True)
            del buckets[key]


def drop_ceiling(buckets, band=250.0):
    """Fjerner vannrette flater oeverst i modellen (himling), slik at man ser ned i rommet."""
    allpos = np.vstack([np.asarray(b.pos) for b in buckets.values() if b.pos])
    ytop = allpos[:, 1].max()
    fjernet = 0
    for b in buckets.values():
        if not b.pos:
            continue
        pos = np.asarray(b.pos)
        idx = np.asarray(b.idx).reshape(-1, 3)
        a, c, d = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
        n = np.cross(c - a, d - a)
        ln = np.linalg.norm(n, axis=1)
        ln[ln == 0] = 1.0
        vannrett = np.abs(n[:, 1] / ln) > 0.9
        hoyt = (pos[idx, 1] > ytop - band).all(axis=1)
        drop = vannrett & hoyt
        fjernet += int(drop.sum())
        idx = idx[~drop].ravel()
        used = np.unique(idx)
        remap = np.full(len(pos), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        b.pos = [pos[i] for i in used]
        b.uv = [b.uv[i] for i in used]
        b.idx = remap[idx].tolist()
    print(f"fjernet {fjernet} himlingstrekanter (over y={ytop-band:.0f})", flush=True)


def resolve_tex(url):
    if not url:
        return None
    p = url
    for a, b in TEX_ROOT_MAP:
        if p.lower().startswith(a.lower()):
            p = b + p[len(a):]
            break
    if p.startswith(".\\") or p.startswith("./"):       # VR Link: relativ til .wrl
        p = os.path.join(SRC_DIR, p[2:].replace("/", os.sep))
    elif not os.path.isabs(p):
        p = os.path.join(SRC_DIR, p.replace("/", os.sep))
    o = TEX_OVERRIDE.get(os.path.basename(p).lower())
    if o: p = o
    return p if os.path.exists(p) else None


def build_glb(buckets, out_path):
    bin_parts, views, accessors, materials, meshes_prims = [], [], [], [], []
    images, textures, samplers = [], [], []
    tex_cache, offset = {}, 0

    def add_view(data, target=None):
        nonlocal offset
        pad = (-len(data)) % 4
        data = data + b"\x00" * pad
        bin_parts.append(data)
        v = {"buffer": 0, "byteOffset": offset, "byteLength": len(data) - pad}
        if target:
            v["target"] = target
        views.append(v)
        offset += len(data)
        return len(views) - 1

    for key, b in buckets.items():
        if not b.pos:
            continue
        pos = np.asarray(b.pos, dtype=np.float32)
        uv = np.asarray(b.uv, dtype=np.float32)
        # slaa sammen identiske vertekser (posisjon + uv) og bygg indeks paa nytt
        combo = np.hstack([pos, uv])
        _, first, inv = np.unique(combo, axis=0, return_index=True, return_inverse=True)
        order = np.argsort(first)
        remap = np.empty(len(first), dtype=np.uint32)
        remap[order] = np.arange(len(first), dtype=np.uint32)
        idx = remap[inv.ravel()].astype(np.uint32)
        keep = first[order]
        pos, uv = pos[keep], uv[keep]

        vp = add_view(pos.tobytes(), 34962)
        accessors.append({"bufferView": vp, "componentType": 5126, "count": len(pos),
                          "type": "VEC3", "min": pos.min(axis=0).tolist(),
                          "max": pos.max(axis=0).tolist()})
        a_pos = len(accessors) - 1

        vt = add_view(uv.tobytes(), 34962)
        accessors.append({"bufferView": vt, "componentType": 5126, "count": len(uv), "type": "VEC2"})
        a_uv = len(accessors) - 1

        vi = add_view(idx.tobytes(), 34963)
        accessors.append({"bufferView": vi, "componentType": 5125, "count": len(idx), "type": "SCALAR"})
        a_idx = len(accessors) - 1

        typ, rgb, transp, url = key
        pbr = {"baseColorFactor": [rgb[0], rgb[1], rgb[2], 1.0 - transp],
               "metallicFactor": 0.0, "roughnessFactor": 0.75}

        local = resolve_tex(url)
        if local:
            if local not in tex_cache:
                im = Image.open(local).convert("RGB")
                if max(im.size) > MAX_TEX:
                    im.thumbnail((MAX_TEX, MAX_TEX), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=90)
                iv = add_view(buf.getvalue())
                images.append({"bufferView": iv, "mimeType": "image/jpeg"})
                if not samplers:
                    samplers.append({"wrapS": 10497, "wrapT": 10497})
                textures.append({"source": len(images) - 1, "sampler": 0})
                tex_cache[local] = len(textures) - 1
            pbr["baseColorTexture"] = {"index": tex_cache[local]}
            t = TEX_TINT.get(os.path.basename(url or "").lower(), [1.0, 1.0, 1.0])
            pbr["baseColorFactor"] = [t[0], t[1], t[2], 1.0 - transp]

        m = {"name": "FRONT" if typ == "FRONT" else "", "pbrMetallicRoughness": pbr, "doubleSided": False}
        if transp > 0.01:
            m["alphaMode"] = "BLEND"
        materials.append(m)

        meshes_prims.append({"attributes": {"POSITION": a_pos, "TEXCOORD_0": a_uv},
                             "indices": a_idx, "material": len(materials) - 1})

    binary = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "Faginnredning wrl2glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": meshes_prims}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    if images:
        gltf["images"], gltf["textures"], gltf["samplers"] = images, textures, samplers

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    binary += b"\x00" * ((-len(binary)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binary), 0x004E4942)); f.write(binary)
    return total, len(meshes_prims), sum(len(b.pos) for b in buckets.values())


def main():
    global SRC_DIR
    src, dst = sys.argv[1], sys.argv[2]
    SRC_DIR = os.path.dirname(os.path.abspath(src))
    text = open(src, "r", encoding="utf-8", errors="replace").read()
    print(f"leser {os.path.getsize(src)/1e6:.1f} MB ...", flush=True)
    toks = tokenize(text)
    print(f"{len(toks):,} tokens", flush=True)

    p, defs, roots = P(toks), {}, []
    while p.peek() is not None:
        before = p.i
        try:
            roots.append(parse_node(p, defs))
        except Exception as e:
            print("parsefeil:", e)
            break
        if p.i == before:
            p.i += 1

    buckets, stats = {}, {"shapes": 0}
    for r in roots:
        walk(r, np.eye(4), buckets, stats)
    print(f"{stats['shapes']} shapes -> {len(buckets)} materialgrupper "
          f"({stats.get('annot', 0)} annotasjonsnoder hoppet over)", flush=True)
    drop_outside_room(buckets)
    drop_ceiling(buckets)
    drop_shell(buckets)

    size, prims, verts = build_glb(buckets, dst)
    print(f"GLB: {size/1e6:.2f} MB | {prims} primitiver | {verts:,} vertekser")


if __name__ == "__main__":
    main()





