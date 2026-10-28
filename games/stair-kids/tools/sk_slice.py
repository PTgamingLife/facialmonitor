"""sk_slice.py — 把 AI 生成的 4x2 sprite sheet（白底）去背並切成 8 張單格 PNG。

用法：python sk_slice.py <sheet.png> <輸出資料夾>
輸出：run0~run3、idle、fall、hurt、land 共 8 張，與 sk_meta.json（各格的高度與錨點）。
"""
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

sk_NAMES = ['run0', 'run1', 'run2', 'run3', 'idle', 'fall', 'hurt', 'land']
sk_OUT_H = 256          # 輸出時以 idle 的高度為基準縮到這個像素
sk_WHITE = 236          # RGB 都高於此值且飽和度低，視為背景


def sk_is_bg(p):
    r, g, b = p[:3]
    return min(r, g, b) >= sk_WHITE and max(r, g, b) - min(r, g, b) < 14


def sk_remove_bg(im):
    """從四邊 flood fill 白色背景，角色內部的白色高光不會被挖掉"""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if bg[i] or not sk_is_bg(px[x, y]):
            continue
        bg[i] = 1
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    alpha = Image.frombytes('L', (w, h), bytes(0 if v else 255 for v in bg))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(alpha)
    return im


def sk_bbox_in(im, box):
    cell = im.crop(box)
    bb = cell.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()
    if not bb:
        raise ValueError(f'空白格：{box}')
    return (box[0] + bb[0], box[1] + bb[1], box[0] + bb[2], box[1] + bb[3])


def sk_slice(src, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    im = sk_remove_bg(Image.open(src))
    w, h = im.size
    boxes = []
    for row in range(2):
        for col in range(4):
            cell = (col * w // 4, row * h // 2, (col + 1) * w // 4, (row + 1) * h // 2)
            boxes.append(sk_bbox_in(im, cell))
    idle = boxes[4]
    k = sk_OUT_H / (idle[3] - idle[1])          # 全部格子用同一個縮放，保持相對大小
    meta = {'ref': sk_OUT_H, 'frames': {}}
    for name, bb in zip(sk_NAMES, boxes):
        fr = im.crop(bb)
        fw, fh = max(1, round(fr.width * k)), max(1, round(fr.height * k))
        fr = fr.resize((fw, fh), Image.LANCZOS)
        fr.save(out / f'{name}.png', optimize=True)
        meta['frames'][name] = {'w': fw, 'h': fh}
    (out / 'sk_meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(out, meta['frames'])


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('用法：python sk_slice.py <sheet.png> <輸出資料夾>')
    sk_slice(sys.argv[1], sys.argv[2])
