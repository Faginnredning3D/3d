"""Finner tekst på en kundeside som ikke er oversatt, og lager oppgavefil for oversettelse.

Bruk:  python sprak_mangler.py <sidemappe>
Skriver <sidemappe>/sprak/_mangler.json = liste over norske tekster som mangler i ordbøkene
(felles _felles/sprak/<kode>.json + sidens egne <sidemappe>/sprak/<kode>.json).

Oversett listen til hvert språk og lagre som <sidemappe>/sprak/<kode>.json:
  {"tekster": {"<norsk>": "<oversatt>", ...}, "maler": {}}
Språk: pl es lt it ru ro. Behold mål, koder, merkenavn, firma- og stedsnavn uendret.
"""
import io, json, os, re, sys
from html.parser import HTMLParser

SPRAK = ['pl', 'es', 'lt', 'it', 'ru', 'ro']

class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.skip = 0; s.t = []
    def handle_starttag(s, tag, a):
        if tag in ('script', 'style', 'svg', 'option'): s.skip += 1
        for k, v in a:
            if k in ('title', 'aria-label', 'alt') and v: s.t.append(' '.join(v.split()))
    def handle_endtag(s, tag):
        if tag in ('script', 'style', 'svg', 'option'): s.skip -= 1
    def handle_data(s, d):
        d = ' '.join(d.split())
        if not s.skip and d and re.search('[A-Za-zÆØÅæøå]{2,}', d): s.t.append(d)

side = sys.argv[1]
rot = os.path.dirname(os.path.abspath(side.rstrip('/\\')))
p = P(); p.feed(io.open(os.path.join(side, 'index.html'), encoding='utf-8').read())
tekster = list(dict.fromkeys(p.t))

def last(f):
    return json.load(io.open(f, encoding='utf-8')) if os.path.exists(f) else {'tekster': {}, 'maler': {}}

mangler = set()
for k in SPRAK:
    felles, egen = last(os.path.join(rot, '_felles', 'sprak', f'{k}.json')), last(os.path.join(side, 'sprak', f'{k}.json'))
    ord_ = {**felles['tekster'], **egen['tekster']}
    maler = [re.compile('^' + re.escape(m).replace(r'\{0\}', '.+?').replace(r'\{1\}', '.+?').replace(r'\{2\}', '.+?') + '$')
             for m in {**felles['maler'], **egen['maler']}]
    for t in tekster:
        if t not in ord_ and not any(m.match(t) for m in maler):
            mangler.add(t)
os.makedirs(os.path.join(side, 'sprak'), exist_ok=True)
ut = sorted(mangler)
json.dump(ut, io.open(os.path.join(side, 'sprak', '_mangler.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(ut)} tekster mangler oversettelse -> {os.path.join(side, "sprak", "_mangler.json")}')
for t in ut[:40]: print('  ', t)
