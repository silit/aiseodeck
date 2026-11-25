#!/usr/bin/env python3
"""Builds the demo video from still frames captured on the live app.

  python3 scripts/demo-video/build_stills.py scenes.json out.mp4 [--stills-only DIR] [--crf N]

The demo video of the resubmission (November 2026) was made with this script from
assets/marketplace/resubmission-2026-11/demo-video-scenes.json. The frames it names (1568 x 744 captures
of the live app) are not kept in the repository. Run it from the root of the repository, with the scene
list in the folder that holds `frames/`. It needs ffmpeg, Pillow and the Inter fonts in FONT_DIR.

scenes.json: a list of scenes. A scene with "img" is a captured screen with a caption under it; one without is a
card ("title" and "text"). Fields: img, sec, text, ch (chapter name shown small in the band), crop_h (height of
the real picture inside the frame, in the frame's own pixels), title, logo.
Every scene is one still, encoded as its own file with the same size, frame rate and encoder settings; the files
are joined with the concat demuxer and no second encode.
"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
SRC_W, SRC_H = 1568, 744            # a captured frame; a shorter picture sits at the top
PIC_H = round(SRC_H * W / SRC_W)    # 911
BAND = (15, 20, 51)                 # the app's navy
LINE = (38, 46, 92)
INK = (255, 255, 255)
SOFT = (170, 179, 220)
YELLOW = (255, 225, 77)
FONT_DIR = '/usr/share/fonts/opentype/inter/'
FPS = 30


def font(name, size):
    return ImageFont.truetype(FONT_DIR + name, size)


def wrap(draw, text, fnt, width):
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def compose(scene, t0, total, base):
    canvas = Image.new('RGB', (W, H), BAND)
    d = ImageDraw.Draw(canvas)
    if scene.get('img'):
        im = Image.open(os.path.join(base, scene['img'])).convert('RGB')
        if im.size[0] != SRC_W:
            raise SystemExit('unexpected width %s in %s' % (im.size, scene['img']))
        ch = scene.get('crop_h') or im.size[1]
        im = im.crop((0, 0, SRC_W, min(ch, SRC_H, im.size[1])))
        im = im.resize((W, round(im.size[1] * W / SRC_W)), Image.LANCZOS)
        canvas.paste(im, (0, 0))
        d.rectangle([0, im.size[1], W, im.size[1] + 1], fill=LINE)
        fnt = font('Inter-Medium.otf', 33)
        lines = wrap(d, scene.get('text', ''), fnt, W - 300)
        if len(lines) > 3:
            raise SystemExit('caption too long (%d lines): %s' % (len(lines), scene.get('text')))
        lh = 45
        zone_top, zone_bot = PIC_H + 8, H - 26
        y = zone_top + (zone_bot - zone_top - lh * len(lines)) // 2 - 3
        for ln in lines:
            d.text(((W - d.textlength(ln, font=fnt)) // 2, y), ln, font=fnt, fill=INK)
            y += lh
        if scene.get('ch'):
            small = font('Inter-Medium.otf', 21)
            d.text((34, H - 44), scene['ch'], font=small, fill=SOFT)
    else:
        big = font('Inter-Bold.otf', 92)
        mid = font('Inter-Medium.otf', 36)
        title = scene.get('title', '')
        lines = []
        for para in scene.get('text', '').split('\n'):
            lines += wrap(d, para, mid, W - 520) or ['']
        logo_h = 150 if scene.get('logo') else 0
        block = (logo_h + 46 if logo_h else 0) + 104 + 56 + 52 * len(lines)
        y = (H - block) // 2 - 10
        if logo_h:
            lg = Image.open(scene['logo']).convert('RGBA').resize((logo_h, logo_h), Image.LANCZOS)
            canvas.paste(lg, ((W - logo_h) // 2, y), lg)
            y += logo_h + 46
        d.text(((W - d.textlength(title, font=big)) // 2, y), title, font=big, fill=INK)
        y += 104 + 14
        d.rectangle([(W - 110) // 2, y, (W + 110) // 2, y + 6], fill=YELLOW)
        y += 42
        for ln in lines:
            d.text(((W - d.textlength(ln, font=mid)) // 2, y), ln, font=mid, fill=SOFT)
            y += 52
    # where we are in the walk-through: a thin line along the bottom, by time
    d.rectangle([0, H - 6, W, H], fill=(30, 37, 80))
    d.rectangle([0, H - 6, round(W * (t0 + float(scene['sec'])) / total), H], fill=YELLOW)
    return canvas


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = sys.argv[1:]
    crf = '23'
    if '--crf' in opts:
        crf = opts[opts.index('--crf') + 1]
        args = [a for a in args if a != crf]
    stills_dir = None
    if '--stills-only' in opts:
        stills_dir = opts[opts.index('--stills-only') + 1]
        args = [a for a in args if a != stills_dir]
    scenes = json.load(open(args[0], encoding='utf-8'))
    out = args[1] if len(args) > 1 else None
    base = os.path.dirname(os.path.abspath(args[0]))
    total = sum(float(s['sec']) for s in scenes)
    work = stills_dir or tempfile.mkdtemp(prefix='demo-')
    os.makedirs(work, exist_ok=True)
    files, t0 = [], 0.0
    for n, s in enumerate(scenes):
        png = os.path.join(work, 's%03d.png' % n)
        compose(s, t0, total, base).save(png)
        t0 += float(s['sec'])
        if stills_dir:
            continue
        mp4 = os.path.join(work, 's%03d.mp4' % n)
        tmp = os.path.join(work, 's%03d.part.mp4' % n)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', png,
                        '-vf', 'format=yuv420p,loop=-1:1,trim=duration=%.3f' % float(s['sec']),
                        '-c:v', 'libx264', '-crf', crf, '-preset', 'slow', '-tune', 'stillimage',
                        '-pix_fmt', 'yuv420p', '-r', str(FPS), '-g', '600', '-video_track_timescale', '15360', tmp], check=True)
        os.rename(tmp, mp4)
        files.append(mp4)
    print('%d scenes, %.1f s (%d:%02d)' % (len(scenes), total, total // 60, total % 60))
    if stills_dir:
        print('stills in', work)
        return
    lst = os.path.join(work, 'list.txt')
    with open(lst, 'w') as f:
        for p in files:
            f.write("file '%s'\n" % p)
    tmp = out + '.part.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy',
                    '-movflags', '+faststart', tmp], check=True)
    os.rename(tmp, out)
    print('%s, %.2f MB' % (out, os.path.getsize(out) / 1e6))


if __name__ == '__main__':
    main()
