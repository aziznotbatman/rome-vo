# Extract HTML fragments from Rails UJS responses: $("#sel").html('...');
import re,sys,json
s=open(sys.argv[1]).read()
for m in re.finditer(r'\$\("([^"]+)"\)\.html\(\'((?:\\.|[^\\\'])*)\'\)',s,re.S):
    body=m.group(2)
    body=re.sub(r'\\(.)',lambda x:{'n':'\n','t':'\t'}.get(x.group(1),x.group(1)),body)
    print('<!-- SELECTOR',m.group(1),'-->'); print(body)
