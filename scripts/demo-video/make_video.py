#!/usr/bin/env python3
"""Burn the English captions into the silent AI SEO Deck demo recording.

Usage:
  make_video.py --input rec.mp4 --starts 0,12.5,31,... [--end 230] [--crop W:H:X:Y] --out demo.mp4

--starts are the seconds (in the input) where each of the 10 scenes in captions.json begins.
A scene that is too short for its captions is lengthened by holding its last frame.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CPS = 15.0          # reading speed, characters per second
MIN_LINE = 2.6      # shortest time a caption stays up
GAP = 0.25          # pause between two captions
EDGE = 0.3          # space at the start and end of a scene


def probe(path):
    out = subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', path])
    d = json.loads(out)
    s = d['streams'][0]
    num, den = s['r_frame_rate'].split('/')
    return int(s['width']), int(s['height']), float(num) / float(den), float(d['format']['duration'])


def ts(t):
    t = max(0.0, t)
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return '%d:%02d:%05.2f' % (h, m, s)


def ass_escape(text):
    return text.replace('\\', '\\\\').replace('{', '(').replace('}', ')').replace('\n', '\\N')


def build(args):
    scenes = json.load(open(args.captions))['scenes']
    W0, H0, fps, dur = probe(args.input)
    starts = [float(x) for x in args.starts.split(',')]
    if len(starts) != len(scenes):
        sys.exit('need %d scene starts, got %d' % (len(scenes), len(starts)))
    end = float(args.end) if args.end else dur
    bounds = starts + [end]
    if any(bounds[i + 1] <= bounds[i] for i in range(len(starts))):
        sys.exit('scene starts must increase and stay before the end')

    # Output size after the optional crop, scaled down to at most 1920 wide, even numbers.
    if args.crop:
        cw, ch, cx, cy = [int(v) for v in args.crop.split(':')]
    else:
        cw, ch = W0, H0
    scale = min(1.0, 1920.0 / cw)
    W = int(cw * scale) // 2 * 2
    H = int(ch * scale) // 2 * 2

    events, segments, offset = [], [], 0.0
    for i, sc in enumerate(scenes):
        a, b = bounds[i], bounds[i + 1]
        length = b - a
        need = [max(MIN_LINE, len(l) / CPS) for l in sc['lines']]
        total_need = sum(need) + GAP * (len(need) - 1) + 2 * EDGE
        extra = max(0.0, total_need - length)
        span = length + extra
        # Spread the captions over the scene in proportion to their reading time.
        free = span - 2 * EDGE - GAP * (len(need) - 1)
        t = offset + EDGE
        for line, n in zip(sc['lines'], need):
            d = free * n / sum(need)
            events.append((t, t + d, line))
            t += d + GAP
        segments.append((a, b, extra))
        print('scene %-9s %6.1fs -> %6.1fs (held %.1fs)' % (sc['name'], length, span, extra))
        offset += span

    work = os.path.splitext(args.out)[0] + '_work'
    os.makedirs(work, exist_ok=True)
    pre = []
    if args.crop:
        pre.append('crop=%d:%d:%d:%d' % (cw, ch, cx, cy))
    pre.append('scale=%d:%d:flags=lanczos' % (W, H))
    pre.append('fps=30')
    listing = []
    # One scene at a time, so memory stays small even for long, large recordings.
    for i, (a, b, extra) in enumerate(segments):
        vf = list(pre)
        if extra > 0.01:
            vf.append('tpad=stop_mode=clone:stop_duration=%.3f' % extra)
        vf.append('format=yuv420p')
        seg = os.path.join(work, 'seg%02d.mp4' % i)
        subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-ss', '%.3f' % a, '-to', '%.3f' % b, '-i', args.input,
                               '-vf', ','.join(vf), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', seg])
        listing.append("file '%s'" % os.path.abspath(seg))
    lst = os.path.join(work, 'list.txt')
    open(lst, 'w').write('\n'.join(listing) + '\n')
    joined = os.path.join(work, 'joined.mp4')
    subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])

    ass_path = os.path.splitext(args.out)[0] + '.ass'
    fs = round(H * 0.034)
    style = ('Style: Cap,Inter,%d,&H00FFFFFF,&H00FFFFFF,&H0033140F,&H2033140F,-1,0,0,0,100,100,0,0,3,%d,0,2,%d,%d,%d,1'
             % (fs, max(6, round(H * 0.011)), round(W * 0.12), round(W * 0.12), round(H * 0.045)))
    with open(ass_path, 'w') as f:
        f.write('[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n' % (W, H))
        f.write('[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n')
        f.write(style + '\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n')
        for s, e, text in events:
            f.write('Dialogue: 0,%s,%s,Cap,,0,0,0,,%s\n' % (ts(s), ts(e), ass_escape(text)))

    subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-i', joined, '-vf', "subtitles='%s'" % ass_path.replace("'", r"\'"),
                           '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
                           '-movflags', '+faststart', args.out])
    print('wrote %s (%dx%d, %.1fs)' % (args.out, W, H, offset))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--starts', required=True)
    p.add_argument('--end')
    p.add_argument('--crop')
    p.add_argument('--captions', default=os.path.join(HERE, 'captions.json'))
    p.add_argument('--out', required=True)
    build(p.parse_args())
