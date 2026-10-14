"""Henter ut unike hjoernepunkter fra en .glb og skriver dem som kompakt JSON.

Punktene brukes til snapping under maaling i nettleseren.
Bruk:  python snappunkter.py <modell.glb> <snap.json>
"""
import json, struct, sys
import numpy as np


def les_glb(sti):
    d = open(sti, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    bin_start = 20 + jl + 8
    return g, d[bin_start:]


def accessor(g, buf, idx):
    a = g["accessors"][idx]
    bv = g["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    if a["componentType"] == 5126 and a["type"] == "VEC3":
        return np.frombuffer(buf, dtype=np.float32, count=n * 3, offset=off).reshape(-1, 3)
    raise ValueError("uventet accessor")


def main():
    src, dst = sys.argv[1], sys.argv[2]
    g, buf = les_glb(src)

    deler = []
    for pr in g["meshes"][0]["primitives"]:
        deler.append(accessor(g, buf, pr["attributes"]["POSITION"]))
    P = np.vstack(deler)
    print(f"vertekser totalt: {len(P):,}")

    # Rund til naermeste mm og fjern duplikater - paa kassegeometri er hver
    # unike posisjon et hjoerne.
    R = np.round(P).astype(np.int32)
    U = np.unique(R, axis=0)
    print(f"unike hjoernepunkter: {len(U):,}")

    data = {
        "enhet": "mm",
        "min": U.min(axis=0).tolist(),
        "maks": U.max(axis=0).tolist(),
        "punkter": U.ravel().tolist(),
    }
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    import os
    print(f"skrevet {os.path.getsize(dst)/1024:.0f} kB -> {dst}")


if __name__ == "__main__":
    main()
