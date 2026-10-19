// The Whip base style: every word of a caption whips into a place of its own along one angle,
// holds while it's spoken, and whips out along another (docs/FUSION-NOTES.md, "Whip"). Twelve
// patterns place the words; this module lays them out and times the whips for the comp (comp.js)
// and the panel's preview alike, so both move the same. Patterns are drawn on a 1080 × 1920 frame
// around the panel's stand-in speaker and scaled into the timeline's frame. The studies they come
// from: design/styles/whip.html. Pure.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./fonts'));
    else (root.CapCore = root.CapCore || {}).whip = factory(root.CapCore.fonts);
})(this, function (fonts) {
    'use strict';

    const DW = 1080;
    const DH = 1920;
    // The stand-in speaker's head centre (the preview figure, its head top at 27 % of the frame).
    const HEAD = { x: 540, y: 637 };

    const rad = (d) => (d * Math.PI) / 180;
    const deg = (r) => (r * 180) / Math.PI;
    // Fusion's angle (0° right, 90° up) of the vector from `from` to (x, y), with y down.
    const angleFrom = (from, x, y) => deg(Math.atan2(from.y - y, x - from.x));
    // Any angle as (−180, 180].
    const wrap = (a) => 180 - ((((180 - a) % 360) + 360) % 360);
    const pickSpots = (spots, order, k) => order[k - 1].map((i) => spots[i]);

    // Lays a few words out on centred rows, all words of a row at one size: the widest that fits
    // `width` (design pixels), up to `maxPx`. gap: the space between words, in ems.
    function rows(list, ys, width, maxPx, gap, dirs) {
        const slots = [];
        list.forEach((row, r) => {
            const sum = row.reduce((a, w) => a + w.w1, 0) + gap * (row.length - 1);
            const px = Math.min(maxPx, width / sum);
            let x = 510 - (sum * px) / 2;
            for (const w of row) {
                slots.push(Object.assign({ x: x + (w.w1 * px) / 2, y: ys[r], align: 'center', px }, dirs(r, x + (w.w1 * px) / 2, ys[r])));
                x += (w.w1 + gap) * px;
            }
        });
        return slots;
    }

    // ------------------------------------------------------------ patterns
    // layout(words, captionIndex) returns one slot per word, in design pixels (1080 × 1920, y down):
    //   x, y        where the word rests: y is its visual centre, x its centre or (align) left/right edge
    //   maxW, maxPx the word is sized to fit: min(maxPx, maxW / its width), unless px is given
    //   in, out     the pattern's own whip angles (degrees, 0° right, 90° up): in is the side the
    //               word comes from, out the side it leaves toward
    //   tilt        degrees, counter-clockwise
    // Words carry their metrics per pixel of font size (w1 width, asc1/desc1 ink). Every pattern
    // keeps clear of the 9:16 safe-zone mask: 208 < y < 1480, and x < 913 below y 662.

    const PATTERNS = {
        // Big words in open spots around the head, flying straight in at the speaker, spinning off.
        constellation: {
            maxWords: 5,
            layout(ws) {
                const spots = [
                    { x: 290, y: 300, maxW: 480, maxPx: 200 }, { x: 800, y: 420, maxW: 420, maxPx: 160 },
                    { x: 175, y: 820, maxW: 290, maxPx: 140 }, { x: 520, y: 1150, maxW: 740, maxPx: 230 },
                    { x: 360, y: 1390, maxW: 540, maxPx: 150 }
                ];
                return pickSpots(spots, [[3], [0, 3], [0, 1, 3], [0, 1, 2, 3], [0, 1, 2, 3, 4]], ws.length).map((s) => {
                    const a = angleFrom(HEAD, s.x, s.y);
                    return Object.assign({ align: 'center', in: a, out: a + 90 }, s);
                });
            }
        },
        // A 3 × 2 grid of boxed words above the head, filled from a shallow angle and run through.
        grid: {
            maxWords: 6,
            layout(ws) {
                const k = ws.length;
                const counts = k <= 3 ? [k] : k === 4 ? [2, 2] : [3, k - 3];
                const ys = counts.length === 1 ? [362] : [296, 430];
                const slots = [];
                counts.forEach((m, r) => {
                    for (let j = 0; j < m; j++) slots.push({ x: 540 + (j - (m - 1) / 2) * 335, y: ys[r], align: 'center', maxW: 250, maxPx: 78, in: 12, out: 192 });
                });
                return slots;
            }
        },
        // Steps down to the right across the chest, in and out along the stair.
        stairs: {
            maxWords: 4,
            layout(ws) {
                const k = ws.length;
                const a = angleFrom({ x: 0, y: 0 }, 135, 128);
                return ws.map((w, i) => {
                    const x = 80 + i * 135;
                    return { x, y: 1430 - (k - 1 - i) * 128, align: 'left', maxW: 905 - x, maxPx: 118, in: a + 180, out: a };
                });
            }
        },
        // A poster block: each word stretched to the block's width, slammed in from alternating
        // sides, blown outward from the block's centre.
        impact: {
            maxWords: 3,
            layout(ws) {
                const BW = 780, TOP = 1000, BOTTOM = 1470, GAP = 22;
                let px = ws.map((w) => Math.min(340, BW / w.w1));
                let hs = ws.map((w, i) => (w.asc1 + w.desc1) * px[i]);
                const total = hs.reduce((a, b) => a + b, 0) + GAP * (ws.length - 1);
                const k = Math.min(1, (BOTTOM - TOP) / total);
                px = px.map((p) => p * k);
                hs = hs.map((h) => h * k);
                const top = BOTTOM - total * k;
                const cy = (top + BOTTOM) / 2;
                let y = top;
                return ws.map((w, i) => {
                    const c = y + hs[i] / 2;
                    y += hs[i] + GAP * k;
                    return { x: 510, y: c, align: 'center', px: px[i], in: i % 2 ? 0 : 180, out: deg(Math.atan2(cy - c, (i % 2 ? 1 : -1) * 200)) };
                });
            }
        },
        // Two rows meeting in the middle: the top row drops in, the bottom row rises; they shear apart.
        press: {
            maxWords: 5,
            layout(ws) {
                const split = Math.ceil(ws.length / 2);
                const list = ws.length === 1 ? [ws] : [ws.slice(0, split), ws.slice(split)];
                const ys = list.length === 1 ? [1250] : [1172, 1334];
                return rows(list, ys, 800, 140, 0.28, (r) => (r === 0 ? { in: 90, out: 180 } : { in: 270, out: 0 }));
            }
        },
        // An arc over the head, swept clockwise, drifting outward.
        halo: {
            maxWords: 3,
            layout(ws) {
                const k = ws.length, R = 350;
                const angles = [[90], [125, 55], [150, 90, 30]][k - 1];
                const maxW = [600, 380, 330][k - 1];
                return angles.map((a) => ({ x: HEAD.x + R * Math.cos(rad(a)), y: HEAD.y - R * Math.sin(rad(a)), align: 'center', maxW, maxPx: 96, in: a + 90, out: a }));
            }
        },
        // Left and right of the face in turn, each word from its own side, falling away outward.
        zigzag: {
            maxWords: 5,
            layout(ws) {
                const ys = [300, 405, 510, 615, 745];
                return ws.map((w, i) => (i % 2
                    ? { x: 680, y: ys[i], align: 'left', maxW: 360, maxPx: 110, in: 0, out: 305 }
                    : { x: 400, y: ys[i], align: 'right', maxW: 360, maxPx: 110, in: 180, out: 235 }));
            }
        },
        // An upside-down pyramid above the head: words converge on its tip and split to the sides.
        funnel: {
            maxWords: 6,
            layout(ws) {
                const counts = [[1], [2], [2, 1], [3, 1], [3, 2], [3, 2, 1]][ws.length - 1];
                const widths = { 3: 960, 2: 660, 1: 380 }, GAP = 0.3, TIP = { x: 540, y: 600 };
                const slots = [];
                let at = 0;
                counts.forEach((m, r) => {
                    const row = ws.slice(at, at + m);
                    at += m;
                    const sum = row.reduce((a, w) => a + w.w1, 0) + GAP * (m - 1);
                    const px = Math.min(r === 2 ? 90 : 96, widths[m] / sum);
                    let x = 540 - (sum * px) / 2;
                    for (const w of row) {
                        const cx = x + (w.w1 * px) / 2, y = 265 + r * 105;
                        slots.push({ x: cx, y, align: 'center', px, in: angleFrom(TIP, cx, y), out: cx < 500 ? 180 : cx > 580 ? 0 : 90 });
                        x += (w.w1 + GAP) * px;
                    }
                });
                return slots;
            }
        },
        // A loud collage: three scattered templates in turn, tilted words, an angle per word.
        collage: {
            maxWords: 5,
            layout(ws, gi) {
                const T = [
                    [[280, 330, 460, 190, -6], [790, 470, 400, 130, 5], [200, 860, 300, 110, -4], [520, 1180, 740, 220, 3], [330, 1400, 500, 120, -3]],
                    [[760, 320, 470, 170, 4], [230, 500, 340, 140, -7], [180, 860, 300, 110, 6], [480, 1140, 760, 240, -3], [640, 1400, 480, 130, 5]],
                    [[540, 290, 800, 150, -2], [870, 520, 300, 110, -5], [180, 760, 300, 120, 6], [440, 1170, 720, 210, 4], [720, 1400, 360, 130, -6]]
                ][gi % 3].map(([x, y, maxW, maxPx, tilt]) => ({ x, y, maxW, maxPx, tilt }));
                return pickSpots(T, [[3], [0, 3], [0, 1, 3], [0, 1, 2, 3], [0, 1, 2, 3, 4]], ws.length).map((s, i) => {
                    const a = (gi * 97 + i * 137 + 23) % 360;
                    return Object.assign({ align: 'center', in: a, out: a + 145 }, s);
                });
            }
        },
        // The corners of the safe area, framing the speaker: in from the corner, out to the side.
        frame: {
            maxWords: 4,
            layout(ws) {
                const spots = [
                    { x: 60, y: 285, align: 'left', maxW: 460, in: 135, out: 180 }, { x: 1020, y: 285, align: 'right', maxW: 460, in: 45, out: 0 },
                    { x: 60, y: 1415, align: 'left', maxW: 420, in: 225, out: 180 }, { x: 905, y: 1415, align: 'right', maxW: 420, in: 315, out: 0 }
                ];
                return pickSpots(spots, [[0], [0, 3], [0, 1, 3], [0, 1, 2, 3]], ws.length).map((s) => Object.assign({ maxPx: 96 }, s));
            }
        },
        // The everyday one: one or two centred lines in the subtitle zone, a short flick up into place.
        // Also takes any caption longer than its own pattern holds.
        line: {
            maxWords: 6,
            layout(ws) {
                const n = ws.length;
                const split = n <= 3 ? n : Math.ceil(n / 2);
                const list = split === n ? [ws] : [ws.slice(0, split), ws.slice(split)];
                const ys = list.length === 1 ? [1240] : [1180, 1300];
                return rows(list, ys, 800, 100, 0.3, () => ({ in: 290, out: 110 }));
            }
        },
        // One huge word at a time over the chest, each a fifth of a turn on from the last, punching through.
        punch: {
            maxWords: 1,
            // One word at a time: a short rest before it punches out (the study's).
            hold: 2,
            layout(ws, gi) {
                const a = (gi * 72 + 200) % 360;
                return ws.map(() => ({ x: 510, y: 1190, align: 'center', maxW: 800, maxPx: 300, in: a, out: a + 180 }));
            }
        }
    };
    const PATTERN_IDS = Object.keys(PATTERNS);

    // ------------------------------------------------------------ settings

    // look.whip. Angles in degrees (0° right, 90° up); frames at the timeline's rate.
    //   pattern            where the words go (PATTERN_IDS)
    //   inMode, inAngle    'pattern': the pattern's own angles; 'fixed': inAngle for every word
    //   outMode, outAngle  'pattern', 'fixed' (outAngle), 'back' (out the way it came in) or
    //                      'through' (on through, opposite the way it came)
    //   distance           how far a word whips, % of the frame width (of a 9:16 frame, scaled
    //                      with the pattern)
    //   inFrames, outFrames, overshoot (% past its place before it settles), stagger (frames
    //                      between the words' out-whips)
    //   shutter            motion blur, Text+'s shutter angle in degrees; 0 = none
    //   scale, x, y        the whole pattern's size (%) and centre (% of the frame from top left)
    //   spacing            extra letter spacing, % of an em
    //   glow, bar          a glow behind the words, an underline bar: colours, '' = none
    const DEFAULTS = {
        pattern: 'line', inMode: 'pattern', inAngle: 290, outMode: 'pattern', outAngle: 110,
        distance: 22, inFrames: 6, outFrames: 5, overshoot: 4, stagger: 1, shutter: 180,
        scale: 100, x: 50, y: 50, spacing: 0, glow: '', bar: ''
    };
    const IN_MODES = ['pattern', 'fixed'];
    const OUT_MODES = ['pattern', 'fixed', 'back', 'through'];

    const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    const num = (v, lo, hi, dflt) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

    // look.whip with every key present and in range.
    function settings(w) {
        const s = w && typeof w === 'object' ? w : {};
        const D = DEFAULTS;
        return {
            pattern: PATTERN_IDS.includes(s.pattern) ? s.pattern : D.pattern,
            inMode: IN_MODES.includes(s.inMode) ? s.inMode : D.inMode,
            inAngle: num(s.inAngle, 0, 359, D.inAngle),
            outMode: OUT_MODES.includes(s.outMode) ? s.outMode : D.outMode,
            outAngle: num(s.outAngle, 0, 359, D.outAngle),
            distance: num(s.distance, 0, 200, D.distance),
            inFrames: Math.round(num(s.inFrames, 1, 30, D.inFrames)),
            outFrames: Math.round(num(s.outFrames, 1, 30, D.outFrames)),
            overshoot: num(s.overshoot, 0, 50, D.overshoot),
            stagger: Math.round(num(s.stagger, 0, 10, D.stagger)),
            shutter: num(s.shutter, 0, 360, D.shutter),
            scale: num(s.scale, 30, 200, D.scale),
            x: num(s.x, 0, 100, D.x),
            y: num(s.y, 0, 100, D.y),
            spacing: num(s.spacing, 0, 50, D.spacing),
            glow: isHex(s.glow) ? s.glow : '',
            bar: isHex(s.bar) ? s.bar : ''
        };
    }

    // ------------------------------------------------------------ layout

    // Rough metrics for when no font can be measured (tests; the comp of a caption the panel didn't
    // lay out): an average advance per character by family, caps 0.72 em, the line 1.22 em.
    const ADVANCE = { Anton: 0.46, 'Bebas Neue': 0.4, Bangers: 0.5, 'Space Mono': 0.6, 'Archivo Black': 0.7, Montserrat: 0.68, Poppins: 0.64, Inter: 0.62, 'TikTok Sans': 0.58 };
    function estimate(text, family) {
        const a = ADVANCE[family] || 0.62;
        return { w1: a * Math.max(1, [...String(text)].length), l1: 0, asc1: 0.72, desc1: 0.02, fasc1: 0.95, fdesc1: 0.27 };
    }

    // Where each word of a caption goes. words: [{ text, emph, at }] as placed (case and
    // punctuation applied); `at` ({ x, y }, fractions of the frame from top left) is a place the
    // editor dragged the word to. opts: { whip (look.whip), width, height (the timeline's frame),
    // index (the caption's, for patterns that change from caption to caption), measure(word, i) →
    // the word's metrics per pixel of font size: w1 (width), l1 (left overhang), asc1/desc1 (ink
    // above/below the baseline), fasc1/fdesc1 (the font's line above/below it) }.
    // Returns per word, in the frame's pixels (y down): text, emph, px (font size), width, cx, cy
    // (the ink's centre), asc, desc, fasc, fdesc, in, out (angles, (−180, 180]), tilt, dist (pixels).
    function layout(words, opts) {
        if (!words.length) return [];
        const s = settings(opts.whip);
        const W = opts.width || DW;
        const H = opts.height || DH;
        const fit = (Math.min(W / DW, H / DH) * s.scale) / 100;
        const ms = words.map((w, i) => Object.assign({}, opts.measure ? opts.measure(w, i) : estimate(w.text)));
        let pattern = PATTERNS[s.pattern];
        // More words than the pattern holds (the phrase rules allow longer captions): two lines.
        if (ms.length > pattern.maxWords) pattern = PATTERNS.line;
        const slots = pattern.layout(ms, opts.index || 0);
        return words.map((w, i) => {
            const m = ms[i];
            const sl = slots[i];
            // Emphasis grows a word up to its slot's width; rows and blocks are already fitted to
            // theirs, so their words keep the row's size (as in the studies).
            const grow = w.emph && w.emph.size ? w.emph.size : 1;
            const pxD = sl.px != null ? sl.px : Math.min(sl.maxPx * grow, sl.maxW / m.w1);
            const wD = m.w1 * pxD;
            const cxD = sl.align === 'left' ? sl.x + wD / 2 : sl.align === 'right' ? sl.x - wD / 2 : sl.x;
            const px = pxD * fit;
            let cx = (W * s.x) / 100 + (cxD - DW / 2) * fit;
            let cy = (H * s.y) / 100 + (sl.y - DH / 2) * fit;
            if (w.at && isFinite(w.at.x) && isFinite(w.at.y)) {
                cx = w.at.x * W;
                cy = w.at.y * H;
            }
            const into = s.inMode === 'fixed' ? s.inAngle : sl.in;
            const out = { fixed: s.outAngle, back: into, through: into + 180 }[s.outMode];
            return {
                text: w.text, emph: w.emph || null, px, width: m.w1 * px, l: m.l1 * px, cx, cy,
                asc: m.asc1 * px, desc: m.desc1 * px, fasc: m.fasc1 * px, fdesc: m.fdesc1 * px,
                in: wrap(into), out: wrap(out == null ? sl.out : out), tilt: sl.tilt || 0,
                dist: (s.distance / 100) * DW * fit
            };
        });
    }

    // A placed word as Text+ draws it: Size from the font's line (Text+ makes the line
    // fonts.LINE_PER_SIZE × Size × frame width) and Center in Fusion's units (0–1, y up), on the
    // middle of the font's line box, where a centred Text+ puts it, rather than the ink's.
    function textPlus(p, width, height) {
        const lineMid = p.cy + (p.asc - p.desc) / 2 - (p.fasc - p.fdesc) / 2;
        return { size: (p.fasc + p.fdesc) / (fonts.LINE_PER_SIZE * width), center: [p.cx / width, 1 - lineMid / height] };
    }

    // The other way: a word's Text+ Center (as read back from Resolve, where it was dragged) as the
    // `at` layout() takes, the ink's centre in fractions of the frame from top left.
    function fromTextPlus(center, p, width, height) {
        const lineMid = (1 - center[1]) * height;
        return { x: center[0], y: (lineMid - (p.asc - p.desc) / 2 + (p.fasc - p.fdesc) / 2) / height };
    }

    // ------------------------------------------------------------ timing

    // Share of the distance covered after u (0–1) of the in-whip: a fast exponential snap, or,
    // with overshoot, past the place by `over` (0–1) at 62 % of the whip and settling back.
    function inProgress(u, over) {
        const snap = (x) => (1 - Math.pow(2, -7 * x)) / (1 - Math.pow(2, -7));
        if (!over) return snap(u);
        if (u < 0.62) return (1 + over) * snap(u / 0.62);
        const v = (u - 0.62) / 0.38;
        return 1 + over - over * v * v * (3 - 2 * v);
    }

    // The frames of each word's whips, counted from the clip's first frame. starts: each word's
    // first frame there. The out-whips take the clip's last frames, first word first, `stagger`
    // apart, the last one gone on the clip's last frame; when the clip ends too soon after the
    // last word lands (the next caption starts straight away) they shorten, then bunch up, never
    // shorter than 2 frames. Returns [{ inAt, inLen, outAt, outLen }].
    function timing(starts, clipLength, whip) {
        const s = settings(whip);
        const n = starts.length;
        const end = Math.max(1, Math.round(clipLength)) - 1;
        const inLen = s.inFrames;
        let outLen = s.outFrames;
        let st = s.stagger;
        const landed = Math.max(...starts.map((f) => f + inLen));
        const room = end - landed;
        if (outLen + st * (n - 1) > room) {
            outLen = Math.max(Math.min(2, outLen), Math.min(outLen, room - st * (n - 1)));
            if (outLen + st * (n - 1) > room) st = n > 1 ? Math.max(0, Math.floor((room - outLen) / (n - 1))) : 0;
        }
        outLen = Math.max(1, Math.min(outLen, end));
        const base = end - outLen - st * (n - 1);
        // A word that starts in the clip's last frames still shows before it goes.
        return starts.map((f, i) => {
            const inAt = Math.max(0, Math.round(f));
            return { inAt, inLen, outAt: Math.max(0, base + st * i, Math.min(inAt, end - outLen)), outLen };
        });
    }

    // A frame where every word has landed and none has left yet (Test and Live in viewer park
    // Resolve's playhead there), counted from the clip's first frame.
    function restFrame(starts, clipLength, whip) {
        if (!starts.length) return 0;
        const times = timing(starts, clipLength, whip);
        const landed = Math.max(...times.map((t) => t.inAt + t.inLen));
        const leaving = Math.min(...times.map((t) => t.outAt));
        return Math.max(0, Math.min(landed + 2, leaving));
    }

    // Frames a clip needs after its last word for the out-whips, plus a few to rest on: what
    // Deliver adds to a caption's clip when the next caption leaves room (timing.finalize tail).
    // lastLength: the last word's frames; a word shorter than its in-whip lands after it ends.
    function tail(wordCount, whip, lastLength) {
        const s = settings(whip);
        const hold = PATTERNS[s.pattern].hold == null ? 6 : PATTERNS[s.pattern].hold;
        return Math.max(0, s.inFrames - (lastLength || 0)) + s.outFrames + s.stagger * Math.max(0, wordCount - 1) + hold;
    }

    // Distance keys for one word as shares of its whip distance, one key a frame (linear between,
    // so the comp and the preview agree to the sub-frame motion blur samples).
    // In: the whole distance down to 0, overshooting past it when asked; out: 0 up to the whole
    // distance, speeding up.
    function inKeys(t, whip) {
        const over = settings(whip).overshoot / 100;
        const keys = [];
        for (let k = 0; k <= t.inLen; k++) keys.push([t.inAt + k, 1 - inProgress(k / t.inLen, over)]);
        return keys;
    }
    function outKeys(t) {
        const keys = [];
        for (let k = 0; k <= t.outLen; k++) keys.push([t.outAt + k, (k / t.outLen) * (k / t.outLen)]);
        return keys;
    }

    // Opacity keys for one word: fades in from its first frame to the rest opacity and out to
    // nothing as its out-whip ends. fade: look.fade ({ on, in, out, rest }); off: on and off cleanly.
    function opacityKeys(t, fade) {
        const on = fade && fade.on;
        const rest = on ? Math.min(100, Math.max(0, fade.rest == null ? 100 : fade.rest)) / 100 : 1;
        const end = t.outAt + t.outLen;
        // Starts too late to show at all (on or after the clip's last frame): never seen.
        if (end <= t.inAt) return [[0, 0]];
        const span = Math.max(1, end - t.inAt);
        let fin = on ? Math.max(0, Math.round(fade.in || 0)) : 0;
        let fout = on ? Math.max(0, Math.round(fade.out || 0)) : 0;
        if (fin + fout > span) {
            const k = span / (fin + fout);
            fin = Math.floor(fin * k);
            fout = Math.floor(fout * k);
        }
        const keys = [];
        if (fin) keys.push([t.inAt, 0], [t.inAt + fin, rest]);
        else keys.push([Math.max(0, t.inAt - 1), t.inAt ? 0 : rest], [t.inAt, rest]);
        if (fout) keys.push([end - fout, rest], [end, 0]);
        else keys.push([end - 1, rest], [end, 0]);
        return keys;
    }

    // A key list's value at frame t (linear between keys, held beyond them).
    function keysAt(keys, t) {
        if (t <= keys[0][0]) return keys[0][1];
        for (let i = 1; i < keys.length; i++) {
            const [f1, v1] = keys[i];
            if (t <= f1) {
                const [f0, v0] = keys[i - 1];
                return f1 === f0 ? v1 : v0 + ((v1 - v0) * (t - f0)) / (f1 - f0);
            }
        }
        return keys[keys.length - 1][1];
    }

    // Where a placed word is at frame t of its clip (fractional for motion-blur samples), and how
    // opaque; null when it isn't on screen. The two whips add up, like the comp's two chained
    // Vector Results.
    function wordAt(p, t, keys) {
        if (t < keys.timing.inAt || t >= keys.timing.outAt + keys.timing.outLen) return null;
        const din = keysAt(keys.in, t) * p.dist;
        const dout = t > keys.timing.outAt ? keysAt(keys.out, t) * p.dist : 0;
        return {
            x: p.cx + din * Math.cos(rad(p.in)) + dout * Math.cos(rad(p.out)),
            y: p.cy - din * Math.sin(rad(p.in)) - dout * Math.sin(rad(p.out)),
            opacity: keysAt(keys.opacity, t),
            moving: din !== 0 || dout !== 0
        };
    }

    // Everything a caption's words do in its clip: placed words plus their keys.
    // starts: frames from the clip's start; fade: look.fade.
    function animate(placed, starts, clipLength, whip, fade) {
        const times = timing(starts, clipLength, whip);
        return placed.map((p, i) => ({ timing: times[i], in: inKeys(times[i], whip), out: outKeys(times[i]), opacity: opacityKeys(times[i], fade) }));
    }

    return {
        DESIGN: { width: DW, height: DH, head: HEAD }, PATTERNS, PATTERN_IDS, DEFAULTS, IN_MODES, OUT_MODES,
        settings, estimate, layout, textPlus, fromTextPlus, inProgress, timing, restFrame, tail, inKeys, outKeys, opacityKeys, keysAt, wordAt, animate, wrap
    };
});
