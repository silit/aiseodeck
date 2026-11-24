#!/usr/bin/env python3
"""Burn the English captions into the silent AI SEO Deck demo recording.

Usage:
  make_video.py --input rec.mp4 --captions captions.json --starts 0,12.5,31,... [--end 230] [--crop W:H:X:Y] [--delogo X:Y:W:H] --out demo.mp4
  make_video.py --input rec.mp4 --captions captions.json --ranges 0-12.6,13.6-18.8,... --out demo.mp4

--captions is the caption file of this recording: {"scenes": [{"name": "...", "lines": ["...", "..."]}]}.
--starts are the seconds (in the input) where each scene of the caption file begins; the scenes follow each other.
--ranges gives each scene its own start-end instead, so the parts between two ranges are cut out.
--delogo hides a fixed overlay (such as an operating system watermark) in the cropped frame.
A scene that is too short for its captions is lengthened by holding its last frame.
"""
import argparse, json, os, subprocess, sys

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
    if args.ranges:
        ranges = []
        for part in args.ranges.split(','):
            a, b = part.split('-')
            ranges.append((float(a), float(b)))
        if len(ranges) != len(scenes):
            sys.exit('need %d scene ranges, got %d' % (len(scenes), len(ranges)))
        if any(b <= a for a, b in ranges) or any(ranges[i + 1][0] < ranges[i][1] for i in range(len(ranges) - 1)):
            sys.exit('each range must end after it starts, and the ranges must not overlap')
        if ranges[-1][1] > dur + 0.05:
            sys.exit('the last range ends after the recording (%.1fs)' % dur)
    else:
        starts = [float(x) for x in args.starts.split(',')]
        if len(starts) != len(scenes):
            sys.exit('need %d scene starts, got %d' % (len(scenes), len(starts)))
        end = float(args.end) if args.end else dur
        bounds = starts + [end]
        if any(bounds[i + 1] <= bounds[i] for i in range(len(starts))):
            sys.exit('scene starts must increase and stay before the end')
        ranges = list(zip(bounds[:-1], bounds[1:]))

    # Output size after the optional crop, scaled down to at most 1920 wide, even numbers.
    if args.crop:
        cw, ch, cx, cy = [int(v) for v in args.crop.split(':')]
    else:
        cw, ch = W0, H0
    scale = min(1.0, 1920.0 / cw)
    W = int(cw * scale) // 2 * 2
    H = int(ch * scale) // 2 * 2

    segments = []
    for i, sc in enumerate(scenes):
        a, b = ranges[i]
        length = b - a
        need = [max(MIN_LINE, len(l) / CPS) for l in sc['lines']]
        total_need = sum(need) + GAP * (len(need) - 1) + 2 * EDGE
        extra = max(0.0, total_need - length)
        segments.append((a, b, extra))
        print('scene %-9s %6.1fs -> %6.1fs (held %.1fs)' % (sc['name'], length, length + extra, extra))

    work = os.path.splitext(args.out)[0] + '_work'
    os.makedirs(work, exist_ok=True)
    pre = []
    if args.crop:
        pre.append('crop=%d:%d:%d:%d' % (cw, ch, cx, cy))
    if args.delogo:
        lx, ly, lw, lh = [int(v) for v in args.delogo.split(':')]
        pre.append('delogo=x=%d:y=%d:w=%d:h=%d' % (lx, ly, lw, lh))
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

    # Captions go by the real length of each encoded scene (frame rounding adds up), so they never drift.
    events, offset = [], 0.0
    for i, sc in enumerate(scenes):
        span = probe(os.path.join(work, 'seg%02d.mp4' % i))[3]
        need = [max(MIN_LINE, len(l) / CPS) for l in sc['lines']]
        # Spread the captions over the scene in proportion to their reading time.
        free = span - 2 * EDGE - GAP * (len(need) - 1)
        t = offset + EDGE
        # "raise": lift this scene's captions (a share of the height above the bottom), clear of buttons there
        raise_by = float(sc.get('raise', 0))
        for line, n in zip(sc['lines'], need):
            d = free * n / sum(need)
            events.append((t, t + d, line, raise_by))
            t += d + GAP
        offset += span

    ass_path = os.path.splitext(args.out)[0] + '.ass'
    fs = round(H * 0.034)
    style = ('Style: Cap,Inter,%d,&H00FFFFFF,&H00FFFFFF,&H0033140F,&H2033140F,-1,0,0,0,100,100,0,0,3,%d,0,2,%d,%d,%d,1'
             % (fs, max(6, round(H * 0.011)), round(W * 0.12), round(W * 0.12), round(H * 0.045)))
    with open(ass_path, 'w') as f:
        f.write('[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n' % (W, H))
        f.write('[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n')
        f.write(style + '\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n')
        for s, e, text, raise_by in events:
            mv = round(H * raise_by) if raise_by > 0 else 0
            f.write('Dialogue: 0,%s,%s,Cap,,0,0,%d,,%s\n' % (ts(s), ts(e), mv, ass_escape(text)))

    subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-i', joined, '-vf', "subtitles='%s'" % ass_path.replace("'", r"\'"),
                           '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
                           '-movflags', '+faststart', args.out])
    print('wrote %s (%dx%d, %.1fs)' % (args.out, W, H, offset))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--starts')
    p.add_argument('--ranges')
    p.add_argument('--end')
    p.add_argument('--crop')
    p.add_argument('--delogo')
    p.add_argument('--captions', required=True, help='the captions of this recording, a JSON file with scenes')
    p.add_argument('--out', required=True)
    a = p.parse_args()
    if not a.starts and not a.ranges:
        p.error('give --starts or --ranges')
    build(a)
