"""Konverterer baseColorFactor i en .glb fra sRGB (slik fargene er autorert i MAT-tabellene)
til lineaert rom, slik glTF-spesifikasjonen krever. Uten dette viser model-viewer/three.js
fargene for lyst/utvasket (eik blir nesten hvit) - Marius 09.11.2026, regel 35.

Bruk:  python fiks_glb_farger.py <fil.glb> [flere.glb ...]   (skriver i samme fil)
Kjoeres ETTER legg_til_kanter.py. Idempotens: markeres med asset.extras.fargerLinear.
"""
import json, struct, sys


def srgb_til_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def fiks(sti):
    d = open(sti, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    if g.get("asset", {}).get("extras", {}).get("fargerLinear"):
        print(sti, "- allerede konvertert, hopper over")
        return
    n = 0
    for m in g.get("materials", []):
        pbr = m.get("pbrMetallicRoughness")
        if pbr and "baseColorFactor" in pbr:
            f = pbr["baseColorFactor"]
            pbr["baseColorFactor"] = [round(srgb_til_linear(v), 5) for v in f[:3]] + [f[3]]
            n += 1
    g.setdefault("asset", {}).setdefault("extras", {})["fargerLinear"] = True
    nj = json.dumps(g, separators=(",", ":")).encode()
    nj += b" " * ((-len(nj)) % 4)
    bin_ = d[20 + jl + 8:]
    tot = 12 + 8 + len(nj) + 8 + len(bin_)
    with open(sti, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, tot))
        f.write(struct.pack("<II", len(nj), 0x4E4F534A)); f.write(nj)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)
    print(sti, "-", n, "materialer konvertert")


for sti in sys.argv[1:]:
    fiks(sti)
