import re,sys
h=open(sys.argv[1]).read()
for f in h.split("<div class='movie movie--preview'>")[1:]:
  t=re.search(r"class='movie__title'[^>]*>\s*(.*?)\s*</a>",f,re.S).group(1); l=re.search(r'Lingua:\s*</strong>\s*(.*?)\s*</p>',f,re.S)
  print(t,'|',l and l.group(1),'|',len(re.findall('data-time',f)),'|',sorted(set(re.findall(r"fa-map-marker fa-lg'></i>\s*</a>\s*(.*?)\s*</div>",f,re.S))))
