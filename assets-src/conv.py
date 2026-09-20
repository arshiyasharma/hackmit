import sys, os
from PIL import Image
OUT='/Users/josegaelcruzlopez/Desktop/hackmit/public/assets'
def still(name, sub, size=(3840,2160), q=62):
    im=Image.open(f'{name}.png').convert('RGB')
    w,h=im.size; tw=min(w, int(h*size[0]/size[1])); th=int(tw*size[1]/size[0])
    im=im.crop(((w-tw)//2,(h-th)//2,(w-tw)//2+tw,(h-th)//2+th)).resize(size, Image.LANCZOS)
    dst=f'{OUT}/{sub}/{name}.avif'; im.save(dst, quality=q); print(name, os.path.getsize(dst)//1024,'KB')
    return im
if __name__=='__main__':
    for n in sys.argv[1:]:
        sub='fabric' if n.startswith('FAB') else {'R':'rooms','A':'rooms','F':'facade','T':'approve'}[n[0]]
        still(n, sub)
