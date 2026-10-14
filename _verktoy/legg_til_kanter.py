"""Legger til kantlinjer (LINES) i en .glb fra wrl2glb, slik at skapkantene blir tydelige.

En kant tas med naar den bare har en nabo-trekant, eller naar flatene paa hver
side moetes med mer enn VINKEL grader. Diagonalene i plane flater faller dermed
bort, og runde roer (mange smaa fasetter) gir ikke striper.
Bruk:  python legg_til_kanter.py <inn.glb> <ut.glb>
"""
import json, struct, sys
import numpy as np

VINKEL = 40.0
FARGE = [0.16, 0.17, 0.16, 1.0]
BREDDE = 2.0     # mm, listens tverrmaal
FORSKYV = 0.8    # mm ut fra flaten
MAKS_VERT = 10000  # finmaskede smaadeler (laassylindre, rosetter) faar ikke kantlinjer


def les(sti):
    d = open(sti, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]
    return g, bytearray(d[28 + jl:28 + jl + bl])


def acc(g, buf, i):
    a = g["accessors"][i]
    v = g["bufferViews"][a["bufferView"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    dt, n = {5126: (np.float32, None), 5125: (np.uint32, 1)}[a["componentType"]][0], \
        {"VEC3": 3, "VEC2": 2, "SCALAR": 1}[a["type"]]
    return np.frombuffer(bytes(buf), dtype=dt, count=a["count"] * n, offset=off).reshape(-1, n)


def kanter(pos, idx):
    tri = idx.reshape(-1, 3)
    p = np.round(pos, 1)
    a, b, c = p[tri[:, 0]], p[tri[:, 1]], p[tri[:, 2]]
    nrm = np.cross(b - a, c - a)
    ln = np.linalg.norm(nrm, axis=1)
    ok = ln > 1e-6
    nrm[ok] /= ln[ok, None]
    naboer = {}
    for t in np.nonzero(ok)[0]:
        for i, j in ((0, 1), (1, 2), (2, 0)):
            pa, pb = tuple(p[tri[t, i]]), tuple(p[tri[t, j]])
            k = (pa, pb) if pa < pb else (pb, pa)
            naboer.setdefault(k, []).append(t)
    grense = np.cos(np.radians(VINKEL))
    ut = []
    for k, ts in naboer.items():
        if len(ts) == 1 or min(float(np.dot(nrm[ts[0]], nrm[t])) for t in ts[1:]) < grense:
            ut.append((k, nrm[ts].sum(axis=0)))
    return ut


def main():
    src, dst = sys.argv[1], sys.argv[2]
    g, buf = les(src)
    alle = {}
    prims = g["meshes"][0]["primitives"]
    for pr in prims:
        pos = acc(g, buf, pr["attributes"]["POSITION"])
        if len(pos) > MAKS_VERT:
            continue
        idx = acc(g, buf, pr["indices"]).ravel()
        for k, n in kanter(pos, idx):
            alle[k] = alle.get(k, 0) + n
    print(f"{len(alle):,} kantlinjer")
    # model-viewer viser ikke LINES, saa hver kant blir en tynn firkantlist,
    # skjoevet litt ut fra flatene slik at den ligger synlig paa hjoernet.
    B, UT = BREDDE / 2.0, FORSKYV
    verts, tris = [], []
    for (pa, pb), nsum in alle.items():
        a, b = np.array(pa), np.array(pb)
        d = b - a
        L = np.linalg.norm(d)
        if L < 0.5:
            continue
        d /= L
        o = np.asarray(nsum, dtype=float)
        on = np.linalg.norm(o)
        o = o / on if on > 1e-6 else np.zeros(3)
        a, b = a + o * UT, b + o * UT
        hj = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
        u = np.cross(d, hj); u /= np.linalg.norm(u)
        v = np.cross(d, u)
        base = len(verts)
        for p in (a, b):
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                verts.append(p + u * su * B + v * sv * B)
        for i in range(4):
            j = (i + 1) % 4
            tris += [base + i, base + 4 + i, base + 4 + j, base + i, base + 4 + j, base + j]
    seg = np.asarray(verts, dtype=np.float32)
    tri_idx = np.asarray(tris, dtype=np.uint32)

    def legg_til(data, target):
        pad = (-len(buf)) % 4
        buf.extend(b"\x00" * pad)
        g["bufferViews"].append({"buffer": 0, "byteOffset": len(buf), "byteLength": len(data), "target": target})
        buf.extend(data)
        return len(g["bufferViews"]) - 1

    vp = legg_til(seg.tobytes(), 34962)
    g["accessors"].append({"bufferView": vp, "componentType": 5126, "count": len(seg), "type": "VEC3",
                           "min": seg.min(axis=0).tolist(), "max": seg.max(axis=0).tolist()})
    a_pos = len(g["accessors"]) - 1
    vi = legg_til(tri_idx.tobytes(), 34963)
    g["accessors"].append({"bufferView": vi, "componentType": 5125, "count": len(tri_idx), "type": "SCALAR"})
    a_idx = len(g["accessors"]) - 1
    g["materials"].append({"name": "kantlinjer", "pbrMetallicRoughness": {"baseColorFactor": FARGE,
                           "metallicFactor": 0.0, "roughnessFactor": 1.0},
                           "doubleSided": True,
                           "extensions": {"KHR_materials_unlit": {}}})
    g.setdefault("extensionsUsed", [])
    if "KHR_materials_unlit" not in g["extensionsUsed"]:
        g["extensionsUsed"].append("KHR_materials_unlit")
    prims.append({"attributes": {"POSITION": a_pos}, "indices": a_idx, "material": len(g["materials"]) - 1})

    buf.extend(b"\x00" * ((-len(buf)) % 4))
    g["buffers"][0]["byteLength"] = len(buf)
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(buf)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(buf), 0x004E4942)); f.write(bytes(buf))
    print(f"GLB: {total/1e6:.2f} MB")


if __name__ == "__main__":
    main()
