import sys
from pypdf import PdfWriter, PdfReader
v=sys.argv[1]
w=PdfWriter()
for f in ['head','load','teg']:
    for p in PdfReader(v+'\\'+f+'.pdf').pages: w.add_page(p)
w.write(v+'\\samlet.pdf'); print('sider', len(w.pages))
