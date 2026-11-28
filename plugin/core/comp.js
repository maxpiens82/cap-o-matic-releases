// Writes the Fusion composition (.comp text) for one caption. Recipe and input names are in
// docs/FUSION-NOTES.md: a Base Text+ with the whole caption, optional emphasis layers, and an
// Active Text+ that shows only the spoken word through stepped write-on keyframes. Whip is its
// own recipe: one Text+ per word, moved by Vector Results (buildWhip).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./textfx'), require('./fonts'), require('./whip'));
    else (root.CapCore = root.CapCore || {}).comp = factory(root.CapCore.textfx, root.CapCore.fonts, root.CapCore.whip);
})(this, function (textfx, fonts, whip) {
    'use strict';

    const STYLES = {
        highlight: {
            mode: 'karaoke',
            base: { fill: '#FFFFFF' },
            active: { fill: '#111111', box: { color: '#7CF29A', level: 2, extH: 0.04, extV: 0.03, round: 0.3 } }
        },
        pop: {
            mode: 'reveal',
            base: { fill: '#FFFFFF' },
            active: { fill: '#FFD93B', pop: true }
        },
        underline: {
            mode: 'karaoke',
            base: { fill: '#FFFFFF' },
            active: { fillOff: true, bar: { color: '#FF6B3D' } }
        },
        ribbon: {
            mode: 'karaoke',
            base: { fill: '#FFFFFF', box: { color: '#111111', level: 1, extH: 0.05, extV: 0.04, round: 0.12 } },
            active: { fill: '#FFB547' }
        },
        glow: {
            mode: 'karaoke',
            base: { fill: '#DDEBF7', glow: { color: '#6EBEFF', soft: 18, strength: 0.6 } },
            active: { fill: '#FFFFFF', glow: { color: '#8CD2FF', soft: 22, strength: 0.6 } }
        },
        // The whole line, dimmed; the spoken word lights up.
        spotlight: {
            mode: 'karaoke',
            base: { fill: '#FFFFFF', dim: 0.45 },
            active: { fill: '#FFFFFF' }
        },
        // The caption as it is, no word timing; a box behind it when the look asks for one.
        plain: {
            mode: 'plain',
            base: { fill: '#FFFFFF' }
        },
        // Letters appear as each word is spoken, at the word's own pace.
        typewriter: {
            mode: 'type',
            base: { fill: '#FFFFFF' }
        },
        // Every word whips into a place of its own and out again (core/whip.js, buildWhip).
        whip: {
            mode: 'whip',
            base: { fill: '#FFFFFF' }
        }
    };

    // A style with what a preset or Deliver sets on top of it:
    //   accent  the spoken word's color, or its box, bar or glow color
    //   box     { color, opacity 0–100 } of the line box (Ribbon, Plain)
    //   pop     false: Pop's words appear without growing
    //   dim     0–100, how visible Spotlight's other words are
    function tuned(look) {
        const s = JSON.parse(JSON.stringify(STYLES[look.style] || STYLES.highlight));
        const a = s.active;
        if (look.accent && a) {
            if (a.box) a.box.color = look.accent;
            else if (a.bar) a.bar.color = look.accent;
            else if (a.glow) {
                a.glow.color = look.accent;
                if (s.base.glow) s.base.glow.color = look.accent;
            } else a.fill = look.accent;
        }
        if (look.box && (s.base.box || s.mode === 'plain')) {
            const shape = s.base.box || { level: 1, extH: 0.05, extV: 0.04, round: 0.12 };
            s.base.box = Object.assign({}, shape, { color: look.box.color, alpha: look.box.opacity / 100 });
        }
        if (a && a.pop && look.pop === false) a.pop = false;
        if (look.dim != null && s.base.dim != null) s.base.dim = look.dim / 100;
        return s;
    }
    const DEFAULT_FONT = 'Montserrat';
    const DEFAULT_WEIGHT = 'ExtraBold';

    // ------------------------------------------------------------ Lua text helpers

    function lua(s) {
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
    }

    function num(v) {
        return String(Math.round(Number(v) * 1e8) / 1e8);
    }

    // Write-on fractions. Text+ shows character i when start*N <= i < end*N, so a boundary placed
    // exactly on a character can round either way; a tenth of a character inside is unambiguous.
    const EDGE = 0.1;
    function startAt(chars, N) {
        return Math.max(0, (chars - EDGE) / N);
    }
    function endAt(chars, N) {
        return Math.min(1, Math.max(0, (chars - EDGE) / N));
    }

    function rgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
        const n = m ? parseInt(m[1], 16) : 0xffffff;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    }

    function input(v) {
        if (v && typeof v === 'object' && v.expr) return input(v.value).replace(/, \}$/, `, Expression = ${lua(v.expr)}, }`);
        if (v && typeof v === 'object' && v.mod) return `Input { SourceOp = ${lua(v.mod)}, Source = "StyledText", }`;
        if (v && typeof v === 'object' && v.op) return `Input { SourceOp = ${lua(v.op)}, Source = ${lua(v.src)}, }`;
        if (v && typeof v === 'object' && !Array.isArray(v)) return `Input { SourceOp = ${lua(v.spline)}, Source = "Value", }`;
        if (Array.isArray(v)) return `Input { Value = { ${v.map(num).join(', ')} }, }`;
        if (typeof v === 'string') return `Input { Value = ${lua(v)}, }`;
        return `Input { Value = ${num(v)}, }`;
    }

    function toolBlock(name, type, inputs) {
        const rows = Object.entries(inputs).map(([k, v]) => `\t\t\t\t${k} = ${input(v)}`).join(',\n');
        return `\t\t${name} = ${type} {\n\t\t\tInputs = {\n${rows}\n\t\t\t},\n\t\t},\n`;
    }

    function textTool(name, inputs) {
        return toolBlock(name, 'TextPlus', inputs);
    }

    // Drop shadow through Text+'s own shadow element (3), set the way a real Resolve export does it
    // (tests/fixtures/template-textplus.comp). Fusion's "Shadow" node rendered nothing. Distance and
    // softness are in pixels at 1080 wide, the angle in degrees, 0 = right, 90 = up. Measured on
    // renders: Offset3 counts in text sizes (1 = Size × frame width) on both axes, and SoftnessX/Y
    // already scale with the frame width (20 spreads ~23 px at 1080 wide, ~41 px at 1920).
    function shadowInputs(sh, textSize) {
        const rad = (sh.angle * Math.PI) / 180;
        const unit = 1080 * textSize;
        return Object.assign({
            Enabled3: 1,
            Offset3: [(sh.distance * Math.cos(rad)) / unit, (sh.distance * Math.sin(rad)) / unit],
            Softness3: 1,
            SoftnessX3: sh.softness,
            SoftnessY3: sh.softness,
            SoftnessOnFillColorToo3: 1
        }, color(3, sh.color, sh.opacity / 100));
    }

    // keys: [[frame, value]]; later keys at the same frame win; frames sorted ascending.
    function spline(name, keys, step) {
        const byFrame = new Map();
        for (const [f, v] of keys) byFrame.set(Math.max(0, Math.round(f)), v);
        const rows = [...byFrame.entries()].sort((a, b) => a[0] - b[0])
            .map(([f, v]) => `\t\t\t\t[${f}] = { ${num(v)}, Flags = { ${step ? 'StepIn' : 'Linear'} = true } }`).join(',\n');
        return `\t\t${name} = BezierSpline {\n\t\t\tNameSet = true,\n\t\t\tKeyFrames = {\n${rows}\n\t\t\t}\n\t\t},\n`;
    }

    // Text+ element colors are premultiplied: white at alpha 0.42 still renders white (render check
    // 2026-10-13, Spotlight over black), so a see-through color carries its alpha in RGB too.
    function color(n, hex, alpha) {
        const a = alpha == null ? 1 : alpha;
        const [r, g, b] = rgb(hex).map((c) => c * a);
        return { [`Red${n}`]: r, [`Green${n}`]: g, [`Blue${n}`]: b, [`Alpha${n}`]: a };
    }

    const box = (b) => Object.assign({ Enabled4: 1, Level4: b.level, ExtendHorizontal4: b.extH, ExtendVertical4: b.extV, Round4: b.round }, color(4, b.color, b.alpha));
    // A solid outline around each glyph: shading element 2 in its default outline shape, as in
    // Resolve's own "Gradient Outline" title, drawn outside the glyph only so the fill keeps its
    // full width. width is Text+'s Thickness, counted in text sizes like the shadow offset.
    const outlineInputs = (o) => Object.assign({ Enabled2: 1, Thickness2: o.width, OutsideOnly2: 1 }, color(2, o.color, 1));
    const bar = (b) => Object.assign({ Enabled4: 1, Level4: 2, ExtendHorizontal4: 0, ExtendVertical4: -0.42, Offset4: [0, -0.035] }, color(4, b.color));
    // The glow is a blurred copy behind the letters. PriorityBack 9 drew it on top of them (white
    // text under a pink glow turned into pink blobs, render check 2026-10-13); 0 puts it behind.
    const glow = (g) => Object.assign({ Enabled2: 1, ElementShape2: 0, Level2: 3, Softness2: 1, SoftnessX2: g.soft, SoftnessY2: g.soft, SoftnessGlow2: g.strength, PriorityBack2: 0 }, color(2, g.color, 0.9));

    // ------------------------------------------------------------ character-level styling

    // Emphasis is styled inside the Text+ through its StyledTextCLS modifier, written the way a
    // real Resolve export does it (tests/fixtures/template-cls-dropshadow.comp): entries
    // { property, first char, last char (inclusive), Value | String }, characters counted like
    // JavaScript string indexes. Unlike WordSizeX/Y, a CLS size reflows the line.
    const CLS = { font: 100, style: 109, size: 102, red: 2401 };
    const styleFor = fonts.styleFor;

    // opts: { size (the layer's Text+ size), colors (false: layout only), emphOf }
    function clsRows(words, opts) {
        const rows = [];
        for (const w of words) {
            const e = opts.emphOf(w);
            if (!e) continue;
            const span = `${w.s}, ${w.e - 1}`;
            if (e.size && e.size !== 1) rows.push(`{ ${CLS.size}, ${span}, Value = ${num(opts.size * e.size)} }`);
            if (e.font) rows.push(`{ ${CLS.font}, ${span}, String = ${lua(e.font)} }`, `{ ${CLS.style}, ${span}, String = ${lua(e.fontStyle || styleFor(e.font))} }`);
            if (opts.colors && e.color) rgb(e.color).forEach((v, c) => rows.push(`{ ${CLS.red + c}, ${span}, Value = ${num(v)} }`));
        }
        return rows;
    }

    function clsInput(rows, indent) {
        const t = '\t'.repeat(indent);
        const array = rows.map((r) => `${t}\t\t\t${r}`).join(',\n');
        return `${t}CharacterLevelStyling = Input {\n${t}\tValue = StyledText {\n${t}\t\tArray = {\n${array}${array ? '\n' : ''}` +
            `${t}\t\t},\n${t}\t\tValue = ""\n${t}\t},\n${t}},\n`;
    }

    function clsTool(name, text, rows) {
        return `\t\t${name} = StyledTextCLS {\n\t\t\tInputs = {\n\t\t\t\tText = Input { Value = ${lua(text)}, },\n${clsInput(rows, 4)}\t\t\t},\n\t\t},\n`;
    }

    // ------------------------------------------------------------ caption layout

    // Applies case/punctuation, drops words that end up empty, and lays the text out.
    // Returns { text, words: [{ text, s, e, f, fe, emph, at }] } with s/e character offsets, f/fe
    // the word's start and end frames relative to the clip, and `at` where a Whip word was dragged.
    function prepare(caption, clipStart, look) {
        const kept = [];
        let lineBreak = null;
        caption.words.forEach((w, i) => {
            const t = textfx.apply(w.text, look.caseMode, look.strip);
            if (!t) return;
            if (caption.lineBreak != null && i >= caption.lineBreak && lineBreak == null && kept.length) lineBreak = kept.length;
            kept.push({ text: t, f: Math.max(0, w.start - clipStart), fe: Math.max(0, w.end - clipStart), emph: w.emph || null, at: w.at || null });
        });
        let text = '';
        kept.forEach((w, i) => {
            if (i > 0) text += i === lineBreak ? '\n' : ' ';
            w.s = text.length;
            text += w.text;
            w.e = text.length;
        });
        return { text, words: kept };
    }

    // ------------------------------------------------------------ starter styles

    // look: { style, width, height, size, x, y (0–100, from top-left), caseMode, strip,
    //         font, fontStyle, color (main text override), emphOverride: { color, size },
    //         accent, box, pop, dim (see tuned), outline: { on, color, width },
    //         fade: { on, in, out (frames), rest (%) }, tracking: { on, from (%), over (% of the caption) } }
    function build(caption, clip, look) {
        const style = tuned(look);
        if (style.mode === 'whip') return buildWhip(caption, clip, look);
        const duration = Math.max(1, clip.end - clip.start);
        const { text, words } = prepare(caption, clip.start, look);
        const N = Math.max(1, text.length);
        const first = words.length ? words[0] : null;
        const at = (w, k) => (k === 0 ? 0 : w.f);
        const emphOf = (w) => (w.emph ? Object.assign({}, w.emph, look.emphOverride || {}) : null);

        const common = {
            GlobalOut: duration - 1,
            Width: look.width || 1920,
            Height: look.height || 1080,
            UseFrameFormatSettings: 1,
            StyledText: text,
            Font: look.font || DEFAULT_FONT,
            Style: look.fontStyle || (look.font ? styleFor(look.font) : DEFAULT_WEIGHT),
            Size: look.size || 0.075,
            Center: [(look.x == null ? 50 : look.x) / 100, 1 - (look.y == null ? 75 : look.y) / 100],
            VerticalJustificationNew: 3,
            HorizontalJustificationNew: 3
        };

        const tools = [];
        const extra = []; // splines and modifiers
        const reveal = style.mode === 'reveal' && !!first;
        // The shadow goes on the layers that draw each glyph first: Base, and Active only in
        // reveal styles (Pop). Karaoke Active words sit exactly on top of Base, so a shadow there
        // would double up.
        const shadow = look.shadow ? shadowInputs(look.shadow, common.Size) : null;
        // The outline follows the same rule. It uses shading element 2, so a glowing layer keeps
        // its glow instead.
        const outline = look.outline && look.outline.on ? outlineInputs(look.outline) : null;

        // Emphasized words are styled in place. Every text layer gets the same font and size
        // ranges so they line up; colors go where the layer shows them.
        const emphasized = words.some((w) => emphOf(w));
        const styled = (name, inputs, colors) => {
            if (!emphasized) return inputs;
            extra.push(clsTool(`${name}CLS`, text, clsRows(words, { size: common.Size, colors, emphOf })));
            return Object.assign(inputs, { StyledText: { mod: `${name}CLS` } });
        };

        // A line-level box behind the whole caption, on its own layer with the text fill off.
        if (style.base.box) {
            const backing = Object.assign({}, common, { Enabled1: 0 }, box(style.base.box));
            if (reveal) {
                backing.End = { spline: 'BoxEnd' };
                extra.push(spline('BoxEnd', words.map((w, k) => [at(w, k), endAt(w.e, N)]), true));
            }
            tools.push(['Backing', styled('Backing', backing, false)]);
        }

        // Base: the whole caption. Reveal styles show it up to the word being spoken; Spotlight
        // shows it dimmed; Typewriter types it out.
        const base = Object.assign({}, common, color(1, look.color || style.base.fill, style.base.dim), { Start: 0 });
        if (style.base.glow) Object.assign(base, glow(style.base.glow));
        else if (outline) Object.assign(base, outline);
        if (shadow) Object.assign(base, shadow);
        if (reveal) {
            base.End = { spline: 'BaseEnd' };
            extra.push(spline('BaseEnd', [[0, 0]].concat(words.slice(1).map((w) => [w.f, endAt(w.s, N)])), true));
        } else if (style.mode === 'type' && first) {
            // Each word types from the end of the previous one (its space included) between its
            // start and end frames, then holds until the next word starts.
            base.End = { spline: 'BaseEnd' };
            const keys = [];
            words.forEach((w, k) => {
                const from = k === 0 ? 0 : words[k - 1].e;
                const f0 = at(w, k);
                keys.push([f0, endAt(from, N)], [Math.max(f0 + 1, w.fe), endAt(w.e, N)]);
            });
            extra.push(spline('BaseEnd', keys, false));
        } else {
            base.End = endAt(N, N);
        }
        tools.push(['Base', styled('Base', base, true)]);

        // Active: only the spoken word. In Pop it carries the emphasis colors too; karaoke styles
        // keep their own color for the spoken word. Plain and Typewriter have none.
        if (first && style.active) {
            const a = style.active;
            const active = Object.assign({}, common, { Start: { spline: 'ActiveStart' }, End: { spline: 'ActiveEnd' } });
            if (a.fillOff) active.Enabled1 = 0;
            else Object.assign(active, color(1, a.fill));
            if (a.box) Object.assign(active, box(a.box));
            if (a.bar) Object.assign(active, bar(a.bar));
            if (a.glow) Object.assign(active, glow(a.glow));
            else if (outline && reveal) Object.assign(active, outline);
            if (shadow && reveal) Object.assign(active, shadow);
            extra.push(spline('ActiveStart', words.map((w, k) => [at(w, k), startAt(w.s, N)]), true));
            extra.push(spline('ActiveEnd', words.map((w, k) => [at(w, k), endAt(w.e, N)]), true));
            if (a.pop) {
                // Each word pops in: 60% → 110% → 100% of its size, cut short by the next word, then
                // holds 100% to its last frame. The keys are linear: without that hold the size slid
                // from 100% back toward the next word's 60% across the whole word (long words shrank).
                const keys = [];
                words.forEach((w, k) => {
                    const f0 = at(w, k);
                    const limit = words[k + 1] ? words[k + 1].f - 1 : Infinity;
                    keys.push([f0, 0.6]);
                    if (f0 + 2 <= limit) keys.push([f0 + 2, 1.1]);
                    if (f0 + 5 <= limit) keys.push([f0 + 5, 1]);
                    if (Number.isFinite(limit) && limit > f0) keys.push([limit, 1]);
                });
                active.WordSizeX = { spline: 'ActiveSize' };
                active.WordSizeY = { spline: 'ActiveSize' };
                extra.push(spline('ActiveSize', keys, false));
            }
            tools.push(['Active', styled('Active', active, !!a.pop)]);
        }

        // The other text layers follow Base's font, so a font picked in Resolve's Inspector keeps
        // every layer lined up.
        for (const [name, inputs] of tools) {
            if (name === 'Base') continue;
            inputs.Font = { value: common.Font, expr: 'Base.Font' };
            inputs.Style = { value: common.Style, expr: 'Base.Style' };
        }

        // Letters drifting apart (driftKeys): every layer's letter spacing (Text+ CharacterSpacing,
        // 1 = normal) from one spline, so the layers stay lined up. The panel measures how far each
        // caption may spread before its widest line leaves the frame (caption.driftMax).
        const tr = look.tracking && look.tracking.on ? look.tracking : null;
        if (tr && tr.speed > 0) {
            extra.push(spline('Tracking', driftKeys(tr, duration, look.fps || 30, caption.driftMax), false));
            for (const [, inputs] of tools) inputs.CharacterSpacing = { spline: 'Tracking' };
        }
        return assemble(tools, extra, duration, common.Center, fadeKeys(look.fade, duration));
    }

    // What the caption shows in Resolve's Edit-page Inspector (Title tab). Size and Position act on
    // a Transform after the merge, so boxes, emphasis and shadow scale and move with the text.
    const PUBLISHED = [
        ['Base', 'Font', { ControlGroup: 1 }], ['Base', 'Style', { ControlGroup: 1 }],
        ['Base', 'Red1', { Name: 'Text Color', ControlGroup: 2 }], ['Base', 'Green1', { ControlGroup: 2 }], ['Base', 'Blue1', { ControlGroup: 2 }],
        ['Place', 'Size', { Name: 'Size', Default: 1 }], ['Place', 'Center', { Name: 'Position' }]
    ];

    // The caption is one MacroOperator named "Template" in a comp tagged TEMPLATE_ID: only that pair
    // gets the Inspector controls (verified in Resolve 21.1: the tag or the name alone show nothing).
    // A macro is transparent in the file, so MediaOut1 links straight to the inner Transform.
    // The drift setting's start (%) as Text+ CharacterSpacing. Text+ moves each letter by
    // about 1.43 em per unit (render check 2026-10-15: at 0.8 the word spaces vanish and letters
    // overlap), so the setting is scaled down: 80 % → 0.95, about −0.07 em a letter; 50 % → 0.875.
    const TRACK_SCALE = 0.25;
    function trackingStart(from) {
        return 1 - (1 - Math.min(100, Math.max(0, from)) / 100) * TRACK_SCALE;
    }

    // Drift (owner, 2026-10-17): the letters keep spreading for the whole caption at the same speed in
    // every caption, whatever its length: `speed` % of the setting per second (on the same scale as
    // `from`), from `from` %. Straight for the first DRIFT_LINEAR seconds, then easing out to a stop at
    // the caption's end, so a long caption doesn't end up too wide. `max` (the caption's driftMax, the
    // most spacing its widest line takes inside the frame) stops it there and holds; a line with no
    // room at all keeps its starting spacing. Keys: [frame, CharacterSpacing].
    const DRIFT_LINEAR = 1.5;
    function driftKeys(tr, duration, fps, max) {
        const last = Math.max(1, duration - 1);
        const start = trackingStart(tr.from);
        const v = (tr.speed / 100) * TRACK_SCALE / fps;
        const lin = Math.min(last, Math.round(DRIFT_LINEAR * fps));
        const keys = [[0, start], [lin, start + v * lin]];
        const tail = last - lin;
        if (tail > 0) for (const u of [0.25, 0.5, 0.75, 1]) keys.push([lin + u * tail, start + v * lin + v * tail * (u - u * u / 2)]);
        const top = max == null ? Infinity : Math.max(max, start);
        if (keys[keys.length - 1][1] <= top) return keys;
        const out = [keys[0]];
        for (let i = 1; i < keys.length; i++) {
            const [f0, v0] = keys[i - 1], [f1, v1] = keys[i];
            if (v1 <= top) {
                out.push(keys[i]);
                continue;
            }
            const at = v1 === v0 ? f0 : f0 + (f1 - f0) * (top - v0) / (v1 - v0);
            out.push([at, top], [last, top]);
            break;
        }
        return out;
    }

    // Fade in, hold at the rest opacity, fade out: Blend keys for the whole caption, or null when it
    // stays fully opaque. fade: { on, in, out (frames), rest (10–100 %) }.
    function fadeKeys(fade, duration) {
        if (!fade || !fade.on) return null;
        const last = Math.max(1, duration - 1);
        const rest = Math.min(100, Math.max(0, fade.rest == null ? 100 : fade.rest)) / 100;
        let fin = Math.max(0, Math.round(fade.in || 0));
        let fout = Math.max(0, Math.round(fade.out || 0));
        // Short captions: both fades share the length.
        if (fin + fout > last) {
            const k = last / (fin + fout);
            fin = Math.floor(fin * k);
            fout = Math.floor(fout * k);
        }
        if (!fin && !fout && rest >= 1) return null;
        const keys = fin ? [[0, 0], [fin, rest]] : [[0, rest]];
        if (fout) keys.push([last - fout, rest], [last, 0]);
        return keys;
    }

    // The frame Test and Live in viewer park Resolve's playhead on (counted from the clip's first
    // frame): the caption at its widest while it still shows in full. Without drift that's the last
    // word settled (Pop's grow takes 5 frames); with drift the letters spread to the very end, so as
    // late as possible. Either way never into the fade-out (owner, 2026-11-26: the playhead sat on
    // the clip's last frame, already faded away) nor before the fade-in ends. words: [{ start, end }]
    // in clip frames. Starter styles only: bin templates get no fade or drift; Whip has restFrame.
    function showFrame(words, length, look) {
        const last = Math.max(0, length - 1);
        // fadeKeys: [0, 0] → [in, rest] with a fade-in, [last − out, rest] → [last, 0] with a fade-out.
        const keys = fadeKeys(look && look.fade, length) || [];
        const n = keys.length;
        const faded = n > 1 && keys[0][1] === 0 ? keys[1][0] : 0;
        const shown = n > 1 && keys[n - 1][1] === 0 ? keys[n - 2][0] : last;
        const drift = look && look.tracking && look.tracking.on && look.tracking.speed > 0;
        const w = words && words.length ? words[words.length - 1] : null;
        const settled = w ? Math.max(w.end - 1, w.start + 6) : 0;
        const want = drift ? shown : Math.min(settled, shown);
        return Math.round(Math.min(last, Math.max(0, faded, want)));
    }

    function assemble(tools, extra, duration, center, fade) {
        let body = tools.map(([name, inputs]) => textTool(name, inputs)).join('') + extra.join('');
        let last = tools[0][0];
        for (let i = 1; i < tools.length; i++) {
            const merge = `Merge${i}`;
            body += `\t\t${merge} = Merge {\n\t\t\tInputs = {\n\t\t\t\tBackground = Input { SourceOp = ${lua(last)}, Source = "Output", },\n` +
                `\t\t\t\tForeground = Input { SourceOp = ${lua(tools[i][0])}, Source = "Output", },\n\t\t\t},\n\t\t},\n`;
            last = merge;
        }
        // The fade: the whole caption merged over a clear frame, its Blend keyed.
        if (fade) {
            body += toolBlock('Clear', 'Background', { GlobalOut: duration - 1, UseFrameFormatSettings: 1, TopLeftAlpha: 0 }) +
                spline('FadeBlend', fade, false) +
                `\t\tFade = Merge {\n\t\t\tInputs = {\n\t\t\t\tBackground = Input { SourceOp = "Clear", Source = "Output", },\n` +
                `\t\t\t\tForeground = Input { SourceOp = ${lua(last)}, Source = "Output", },\n` +
                `\t\t\t\tBlend = Input { SourceOp = "FadeBlend", Source = "Value", },\n\t\t\t},\n\t\t},\n`;
            last = 'Fade';
        }
        return wrap(body + placeTool(last, center), PUBLISHED, duration);
    }

    // Pivot on the caption so Size grows it in place; Center 0.5 means "where Cap-o-matic put it".
    function placeTool(last, center) {
        return `\t\tPlace = Transform {\n\t\t\tInputs = {\n\t\t\t\tInput = Input { SourceOp = ${lua(last)}, Source = "Output", },\n` +
            `\t\t\t\tPivot = ${input(center)},\n\t\t\t},\n\t\t},\n`;
    }

    // The tools as the "Template" macro of a tagged comp, publishing `published` ([tool, input,
    // { Name, Default, ControlGroup }]) to the Inspector, rendered through Place.
    function wrap(body, list, duration) {
        const published = list.map(([op, src, extraKeys], i) => {
            const keys = Object.entries(extraKeys).map(([k, v]) => `${k} = ${typeof v === 'string' ? lua(v) : num(v)}, `).join('');
            return `\t\t\t\tInput${i + 1} = InstanceInput { SourceOp = ${lua(op)}, Source = ${lua(src)}, ${keys}},\n`;
        }).join('');
        const macro = `\t\tTemplate = MacroOperator {\n\t\t\tCtrlWZoom = false,\n\t\t\tNameSet = true,\n\t\t\tInputs = ordered() {\n${published}\t\t\t},\n` +
            `\t\t\tOutputs = {\n\t\t\t\tMainOutput1 = InstanceOutput { SourceOp = "Place", Source = "Output", },\n\t\t\t},\n` +
            `\t\t\tViewInfo = GroupInfo { Pos = { 0, 0 } },\n\t\t\tTools = ordered() {\n${body.replace(/^(?=.)/gm, '\t\t')}\t\t\t},\n\t\t},\n`;
        const out = `\t\tMediaOut1 = Saver {\n\t\t\tInputs = {\n\t\t\t\tIndex = Input { Value = "0", },\n\t\t\t\tInput = Input { SourceOp = "Place", Source = "Output", },\n\t\t\t},\n\t\t},\n`;
        return `Composition {\n\tCurrentTime = 0,\n\tRenderRange = { 0, ${duration - 1} },\n\tGlobalRange = { 0, ${duration - 1} },\n` +
            `\tCustomData = { TEMPLATE_ID = "Text+" },\n\tTools = ordered() {\n${macro}${out}\t},\n}\n`;
    }

    // ------------------------------------------------------------ whip

    // The Fusion names Whip needs that no export in the repo shows yet, in one place to correct
    // after the desk check (docs/STATUS.md, "Whip"; tools/whip_desk_check.py reads them from a
    // Vector Result built by hand). From shipped and shared .setting files (Blackmagic's Fall and
    // Bounce transition, SirEdric's TiltShift, FloatingPanels; research 2026-10-18):
    //   vector, vectorOut  the Vector Result modifier's ID ("Modify With > Vector") and its output
    //   chain              true: two per word, the out one's Origin linked to the in one's Position,
    //                      so both angles are plain numbers the Inspector can show (not seen in a
    //                      shared file yet); false: one per word, its Angle switched by a stepped key
    //   aspect             its Image Aspect: Position = Origin + Distance × (cos A, sin A × aspect)
    //                      in Fusion's 0–1 units, Distance in frame widths, so width / height keeps
    //                      a whip the same length in every direction
    //   blur               Text+ motion blur (Settings tab); rotate: Text+ 2D rotation (Layout, Angle Z)
    const FUSION = {
        vector: 'Vector', vectorOut: 'Position', chain: true, aspect: (w, h) => w / h,
        blur: { on: 'MotionBlur', quality: 'Quality', shutter: 'ShutterAngle', bias: 'CenterBias', spread: 'SampleSpread' },
        rotate: 'AngleZ'
    };
    // Samples on each side of the frame (Fusion's Quality); the shared whips use 6 to 16.
    const BLUR_QUALITY = 6;
    // Text+ moves each letter about 1.43 em per unit of CharacterSpacing (render check 2026-10-15).
    const SPACING_EM = 1.43;

    const mergeTool = (name, bg, fg, extra) => toolBlock(name, 'Merge', Object.assign({ Background: { op: bg, src: 'Output' }, Foreground: { op: fg, src: 'Output' } }, extra));

    // A Whip caption: every word its own Text+ (W1, W2, …) whose Center comes from Vector Results:
    // W<n>In (Origin = where the word rests, Angle = the side it comes from, Distance keyed from the
    // whole whip down to 0) and W<n>Out (Origin = W<n>In's result, Angle = the side it leaves
    // toward, Distance keyed from 0 up). Each word fades through its own Merge (Blend keyed) over a
    // clear frame and blurs with Text+'s own motion blur. Layout and keys come from core/whip.js,
    // as the panel's preview draws them; caption.whip carries the panel's measurements of each
    // word ({ index, metrics }; without them, rough ones).
    function buildWhip(caption, clip, look) {
        const s = whip.settings(look.whip);
        const W = look.width || 1920;
        const H = look.height || 1080;
        const duration = Math.max(1, clip.end - clip.start);
        const { words } = prepare(caption, clip.start, look);
        const font = look.font || DEFAULT_FONT;
        const fontStyle = look.fontStyle || (look.font ? styleFor(look.font) : DEFAULT_WEIGHT);
        const meta = caption.whip || {};
        const emphOf = (w) => (w.emph ? Object.assign({}, w.emph, look.emphOverride || {}) : null);
        const placed = whip.layout(words.map((w) => ({ text: w.text, emph: emphOf(w), at: w.at })), {
            whip: s, width: W, height: H, index: meta.index || 0,
            measure: (w, i) => (meta.metrics && meta.metrics[i]) || whip.estimate(w.text, (w.emph && w.emph.font) || font, s.spacing)
        });
        const keys = whip.animate(placed, words.map((w) => w.f), duration, s, look.fade && look.fade.on ? look.fade : null);
        const name = (i) => `W${i + 1}`;
        // The first word in the caption's own font and colour leads; the others follow it, so the
        // Inspector's Font and Text Color change them all (emphasized words keep theirs).
        const lead = placed.findIndex((p) => !(p.emph && p.emph.font));
        const tint = placed.findIndex((p) => !(p.emph && p.emph.color));
        const outline = look.outline && look.outline.on ? outlineInputs(look.outline) : null;
        const b = FUSION.blur;
        const aspect = FUSION.aspect(W, H);

        let body = toolBlock('Clear', 'Background', { GlobalOut: duration - 1, UseFrameFormatSettings: 1, TopLeftAlpha: 0 });
        let last = 'Clear';
        placed.forEach((p, i) => {
            const n = name(i);
            const e = p.emph;
            const tp = whip.textPlus(p, W, H);
            const follow = (j, key, value) => (j < 0 || j === i ? value : { value, expr: `${name(j)}.${key}` });
            const own = !!(e && e.font);
            const inputs = {
                GlobalOut: duration - 1, Width: W, Height: H, UseFrameFormatSettings: 1, StyledText: p.text,
                Font: own ? e.font : follow(lead, 'Font', font),
                Style: own ? e.fontStyle || styleFor(e.font) : follow(lead, 'Style', fontStyle),
                Size: tp.size,
                Center: { op: FUSION.chain ? `${n}Out` : `${n}Path`, src: FUSION.vectorOut },
                VerticalJustificationNew: 3, HorizontalJustificationNew: 3
            };
            for (const [k, v] of Object.entries(color(1, e && e.color ? e.color : look.color || '#FFFFFF'))) {
                inputs[k] = e && e.color ? v : k === 'Alpha1' ? v : follow(tint, k, v);
            }
            if (s.glow) Object.assign(inputs, glow({ color: s.glow, soft: 18, strength: 0.6 }));
            else if (outline) Object.assign(inputs, outline);
            if (look.shadow) Object.assign(inputs, shadowInputs(look.shadow, tp.size));
            // Element 4 is either the underline bar or a box behind the word.
            if (s.bar) Object.assign(inputs, bar({ color: s.bar }));
            else if (look.box) Object.assign(inputs, box({ level: 1, extH: 0.05, extV: 0.04, round: 0.12, color: look.box.color, alpha: look.box.opacity / 100 }));
            if (s.spacing) inputs.CharacterSpacing = 1 + s.spacing / 100 / SPACING_EM;
            if (p.tilt) inputs[FUSION.rotate] = p.tilt;
            // Motion blur on every word, set from W1's (published as Motion Blur and Shutter Angle).
            const on = s.shutter > 0 ? 1 : 0;
            const shutter = s.shutter || 180;
            Object.assign(inputs, {
                [b.on]: i ? { value: on, expr: `W1.${b.on}` } : on, [b.quality]: BLUR_QUALITY,
                [b.shutter]: i ? { value: shutter, expr: `W1.${b.shutter}` } : shutter, [b.bias]: 0, [b.spread]: 1
            });
            body += textTool(n, inputs);

            const d = p.dist / W;
            const k = keys[i];
            if (FUSION.chain) {
                body += toolBlock(`${n}In`, FUSION.vector, { Origin: tp.center, Distance: { spline: `${n}InDist` }, Angle: p.in, ImageAspect: aspect }) +
                    spline(`${n}InDist`, k.in.map(([f, v]) => [f, v * d]), false) +
                    toolBlock(`${n}Out`, FUSION.vector, { Origin: { op: `${n}In`, src: FUSION.vectorOut }, Distance: { spline: `${n}OutDist` }, Angle: p.out, ImageAspect: aspect }) +
                    spline(`${n}OutDist`, k.out.map(([f, v]) => [f, v * d]), false);
            } else {
                // One Vector Result: the angle steps from in to out while the word rests (Distance 0).
                // In a squeezed clip the in-whip finishes first and the out-whip follows it.
                const step = Math.max(k.timing.outAt, k.timing.inAt + k.timing.inLen);
                const shift = step - k.timing.outAt;
                body += toolBlock(`${n}Path`, FUSION.vector, { Origin: tp.center, Distance: { spline: `${n}Dist` }, Angle: { spline: `${n}Angle` }, ImageAspect: aspect }) +
                    spline(`${n}Dist`, k.in.filter(([f]) => f < step).concat(k.out.map(([f, v]) => [f + shift, v])).map(([f, v]) => [f, v * d]), false) +
                    spline(`${n}Angle`, [[0, p.in], [step, p.out]], true);
            }
            body += spline(`${n}Fade`, k.opacity, false) + mergeTool(`Merge${i + 1}`, last, n, { Blend: { spline: `${n}Fade` } });
            last = `Merge${i + 1}`;
        });

        const published = [];
        if (lead >= 0) published.push([name(lead), 'Font', { ControlGroup: 1 }], [name(lead), 'Style', { ControlGroup: 1 }]);
        if (tint >= 0) published.push([name(tint), 'Red1', { Name: 'Text Color', ControlGroup: 2 }], [name(tint), 'Green1', { ControlGroup: 2 }], [name(tint), 'Blue1', { ControlGroup: 2 }]);
        published.push(['Place', 'Size', { Name: 'Size', Default: 1 }], ['Place', 'Center', { Name: 'Position' }]);
        if (placed.length) published.push(['W1', b.on, { Name: 'Motion Blur' }], ['W1', b.shutter, { Name: 'Shutter Angle' }]);
        // Each word's place (a point: a crosshair in the viewer, with the Edit page's Fusion
        // Overlay on), size and whip angles, each resetting to what Cap-o-matic gave it.
        placed.forEach((p, i) => {
            const n = name(i);
            const tp = whip.textPlus(p, W, H);
            published.push([FUSION.chain ? `${n}In` : `${n}Path`, 'Origin', { Name: `Word ${i + 1} Position`, DefaultX: tp.center[0], DefaultY: tp.center[1] }],
                [n, 'Size', { Name: `Word ${i + 1} Size`, Default: tp.size }]);
            if (FUSION.chain) published.push([`${n}In`, 'Angle', { Name: `Word ${i + 1} In`, Default: p.in }], [`${n}Out`, 'Angle', { Name: `Word ${i + 1} Out`, Default: p.out }]);
        });
        return wrap(body + placeTool(last, [s.x / 100, 1 - s.y / 100]), published, duration);
    }

    // The word positions in a Whip comp read back from Resolve (ExportFusionComp), where the editor
    // may have dragged them: each word's text and its Text+ Center at rest, in Fusion's units, after
    // the caption's own Position and Size (Place). Null when the comp isn't a Whip caption.
    function readWhip(text) {
        const blocks = toolBlocks(text);
        const own = (name) => {
            const bl = blocks.find((x) => x.name === name);
            return bl ? text.slice(bl.at, bl.end) : null;
        };
        const point = (src, key) => {
            const m = new RegExp(`\\n\\t*${key}\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*\\{\\s*(-?[\\d.e-]+),\\s*(-?[\\d.e-]+)\\s*\\}`).exec(src || '');
            return m ? [Number(m[1]), Number(m[2])] : null;
        };
        const number = (src, key, dflt) => {
            const m = new RegExp(`\\n\\t*${key}\\s*=\\s*Input\\s*\\{\\s*Value\\s*=\\s*(-?[\\d.e-]+)`).exec(src || '');
            return m ? Number(m[1]) : dflt;
        };
        const place = own('Place');
        const pivot = point(place, 'Pivot') || [0.5, 0.5];
        const center = point(place, 'Center') || [0.5, 0.5];
        const size = number(place, 'Size', 1);
        const words = [];
        for (let i = 1; own(`W${i}`); i++) {
            const t = /\n\t*StyledText\s*=\s*Input\s*\{\s*Value\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(own(`W${i}`));
            const vector = own(`W${i}In`) || own(`W${i}Path`);
            if (!t || !vector) return null;
            // Fusion leaves out an input at its default ({ 0.5, 0.5 }); a keyed one links a spline
            // instead, which isn't a place to keep (center null: left alone).
            const keyed = /\n\t*Origin\s*=\s*Input\s*\{\s*SourceOp/.test(vector);
            const origin = keyed ? null : point(vector, 'Origin') || [0.5, 0.5];
            // The Transform scales about its Pivot and moves the pivot by Center's offset from the middle.
            const at = origin && origin.map((v, k) => pivot[k] + (v - pivot[k]) * size + (center[k] - 0.5));
            words.push({ text: t[1].replace(/\\n/g, '\n').replace(/\\(.)/g, '$1'), center: at });
        }
        return words.length ? words : null;
    }

    // ------------------------------------------------------------ bring-your-own templates

    // Tool headers ("Name = Type {"), at any depth so tools inside macros count too. A tool's
    // block runs until the next header at the same or a shallower indentation.
    const HEADER = /\n(\t*)([A-Za-z_]\w*|\["[^"]+"\])\s*=\s*([A-Z]\w*|ofx\.[\w.]+)\s*\{/g;
    const NOT_TOOLS = new Set(['Input', 'InstanceInput', 'InstanceOutput', 'OperatorInfo', 'FuID', 'Gradient', 'Polyline', 'StyledText', 'Number']);

    function toolBlocks(text) {
        const heads = [];
        let m;
        HEADER.lastIndex = 0;
        while ((m = HEADER.exec(text))) {
            if (!NOT_TOOLS.has(m[3])) heads.push({ indent: m[1].length, name: m[2], type: m[3], at: m.index });
        }
        return heads.map((h, i) => {
            const next = heads.slice(i + 1).find((x) => x.indent <= h.indent);
            return Object.assign(h, { end: next ? next.at : text.length });
        });
    }

    function setInputIn(text, block, key, valueSrc) {
        const region = text.slice(block.at, block.end);
        const re = new RegExp(`(\\n\\t*${key}\\s*=\\s*)Input\\s*\\{[^{}]*(\\{[^{}]*\\}[^{}]*)?\\}`);
        let next;
        if (re.test(region)) next = region.replace(re, `$1${valueSrc}`);
        else next = region.replace(/Inputs\s*=\s*\{/, (m) => `${m}\n\t\t\t\t${key} = ${valueSrc},`);
        return text.slice(0, block.at) + next + text.slice(block.end);
    }

    // Like setInputIn, for an input nested any depth (the CLS styling table). src is the whole
    // "Key = Input { … }," text.
    function setDeepInputIn(text, block, key, src) {
        const region = text.slice(block.at, block.end);
        const m = new RegExp(`\\n\\t*${key}\\s*=\\s*Input\\s*\\{`).exec(region);
        let next;
        if (m) {
            let depth = 0;
            let i = m.index + m[0].length - 1;
            for (; i < region.length; i++) {
                const ch = region[i];
                if (ch === '"') {
                    for (i++; i < region.length && region[i] !== '"'; i++) if (region[i] === '\\') i++;
                } else if (ch === '{') depth++;
                else if (ch === '}' && --depth === 0) break;
            }
            const end = region[i + 1] === ',' ? i + 2 : i + 1;
            next = region.slice(0, m.index) + '\n' + src.replace(/\n$/, '') + region.slice(end);
        } else {
            next = region.replace(/Inputs\s*=\s*\{/, (x) => `${x}\n${src.replace(/\n$/, '')}`);
        }
        return text.slice(0, block.at) + next + text.slice(block.end);
    }

    // Text+ roles a bin template can name (docs/TEMPLATE-CONTRACT.md): the whole caption, the
    // caption revealed word by word, and the spoken word alone. Without any, the template's first
    // Text+ plays CapText.
    const ROLES = ['CapText', 'CapReveal', 'CapActive'];

    // Puts the caption into an exported template comp. Every role Text+ gets the text; emphasis
    // goes in through character-level styling (the node's own CLS modifier if its text has one —
    // its styling is replaced, being tied to the sample text — otherwise a new one); CapReveal and
    // CapActive get stepped write-on keys per word.
    function fromTemplate(templateText, caption, clip, look) {
        const { text, words } = prepare(caption, clip.start, look);
        const N = Math.max(1, text.length);
        const duration = Math.max(1, clip.end - clip.start);
        const emphOf = (w) => (w.emph ? Object.assign({}, w.emph, look.emphOverride || {}) : null);
        const at = (w, k) => (k === 0 ? 0 : w.f);
        let out = templateText;
        const texts = toolBlocks(out).filter((b) => b.type === 'TextPlus');
        let roles = ROLES.filter((role) => texts.some((b) => b.name === role)).map((role) => ({ role, name: role }));
        if (!roles.length) {
            if (!texts.length) throw new Error('This template has no Text+ to put the caption in.');
            roles = [{ role: 'CapText', name: texts[0].name }];
        }
        const find = (name) => toolBlocks(out).find((b) => b.name === name);
        // The layer that draws the glyphs first carries the shadow and the emphasis colors;
        // CapActive sits on top of it and keeps the template's own color for the spoken word.
        const ground = roles.find((r) => r.role !== 'CapActive') || roles[0];
        const splines = [];

        for (const r of roles) {
            const own = out.slice(find(r.name).at, find(r.name).end);
            // Emphasis sizes and the shadow offset count in the Text+ size; a kept template size
            // is read back (0.08 is Text+'s default).
            const keptSize = /\n\t*Size\s*=\s*Input\s*\{\s*Value\s*=\s*([\d.]+)/.exec(own);
            const textSize = look.keepTemplate ? (keptSize ? Number(keptSize[1]) : 0.08) : look.size || 0.075;
            const rows = clsRows(words, { size: textSize, colors: r.role !== 'CapActive' || roles.length === 1, emphOf });
            const linked = /StyledText\s*=\s*Input\s*\{\s*SourceOp\s*=\s*"([^"]+)"/.exec(own);
            const mod = linked && find(linked[1]);
            if (mod) {
                out = setInputIn(out, mod, 'Text', input(text));
                if (mod.type === 'StyledTextCLS') out = setDeepInputIn(out, find(mod.name), 'CharacterLevelStyling', clsInput(rows, 4));
            } else if (rows.length) {
                const modName = `${r.role}CLS`;
                const block = find(r.name);
                out = out.slice(0, block.at) + '\n' + clsTool(modName, text, rows).replace(/\n$/, '') + out.slice(block.at);
                out = setInputIn(out, find(r.name), 'StyledText', input({ mod: modName }));
            } else {
                out = setInputIn(out, find(r.name), 'StyledText', input(text));
            }
            if (!look.keepTemplate) {
                out = setInputIn(out, find(r.name), 'Size', input(look.size || 0.075));
                out = setInputIn(out, find(r.name), 'Center', input([(look.x == null ? 50 : look.x) / 100, 1 - (look.y == null ? 75 : look.y) / 100]));
            }
            // The shadow replaces that Text+'s own shadow element, if the template had one.
            if (look.shadow && r === ground) {
                for (const [k, v] of Object.entries(shadowInputs(look.shadow, textSize))) out = setInputIn(out, find(r.name), k, input(v));
            }
            if (r.role === 'CapReveal' && words.length) {
                // Each word appears when it's spoken and stays.
                splines.push(spline(`${r.name}End`, words.map((w, k) => [at(w, k), endAt(w.e, N)]), true));
                out = setInputIn(out, find(r.name), 'Start', input(0));
                out = setInputIn(out, find(r.name), 'End', input({ spline: `${r.name}End` }));
            }
            if (r.role === 'CapActive' && words.length) {
                splines.push(spline(`${r.name}Start`, words.map((w, k) => [at(w, k), startAt(w.s, N)]), true));
                splines.push(spline(`${r.name}End`, words.map((w, k) => [at(w, k), endAt(w.e, N)]), true));
                out = setInputIn(out, find(r.name), 'Start', input({ spline: `${r.name}Start` }));
                out = setInputIn(out, find(r.name), 'End', input({ spline: `${r.name}End` }));
            }
        }
        if (splines.length) {
            const first = find(roles[0].name);
            out = out.slice(0, first.at) + '\n' + splines.join('').replace(/\n$/, '') + out.slice(first.at);
        }
        out = out.replace(/RenderRange\s*=\s*\{[^}]*\}/, `RenderRange = { 0, ${duration - 1} }`)
            .replace(/GlobalRange\s*=\s*\{[^}]*\}/, `GlobalRange = { 0, ${duration - 1} }`);
        return out;
    }

    // ------------------------------------------------------------ viewer guide

    // The safe-zone mask for 9:16 timelines, drawn in Fusion: coloured zones and labels where the
    // short-form apps put their buttons and text, held for the whole clip and merged at `opacity`
    // over a transparent frame. No image file: a Loader in a comp makes Resolve add the file to the
    // Media Pool every time, so the mask used to leave copies behind. The panel's preview draws the
    // same zones (assets/guide-9x16.svg, written from these by tools/make-brand.js).
    // opts: { width, height, duration, opacity (0–1) }
    // Layout in pixels at 1080×1920 (left, top, right, bottom), scaled to the timeline's width.
    // Colours (docs/BRAND.md section 11, 2026-10-16): blocked areas in the brand's ink, secondary text in
    // Night blue, the centre of attention in paper, the subtitle zone in Cap-o-matic's HUD orange.
    // `opacity` is each zone's share of the mask's own: the blocked areas full (ink at the mask's 70 %
    // darkens the video clearly; at 40 % it vanished on footage, owner 2026-10-16), the others 0.55,
    // about 40 % in the viewer, so the shot shows through them. Labels are drawn at the full mask opacity.
    const MASK_ZONES = [
        { box: [0, 0, 1080, 208], color: '#18181B', opacity: 1 },
        { box: [913, 662, 1080, 1480], color: '#18181B', opacity: 1 },
        { box: [0, 1480, 1080, 1920], color: '#18181B', opacity: 1 },
        { box: [107, 276, 973, 385], color: '#9DB4E0', opacity: 0.55 },
        { box: [246, 429, 834, 1017], color: '#F4F4F5', opacity: 0.55, round: true },
        { box: [257, 1069, 823, 1398], color: '#FF8A1F', opacity: 0.55 }
    ];
    const MASK_LABELS = [
        { text: 'BLOCKED', at: [540, 105], color: '#A1A1AA' },
        { text: 'SECONDARY TEXT', at: [540, 331], color: '#2B3E6B' },
        { text: 'CENTER OF\nATTENTION', at: [540, 723], color: '#52525B' },
        { text: 'SUBTITLES', at: [540, 1230], color: '#18181B' },
        { text: 'BLOCKED', at: [540, 1700], color: '#A1A1AA' }
    ];

    function guide(opts) {
        const last = Math.max(1, opts.duration) - 1;
        const W = opts.width;
        const H = opts.height;
        const k = W / 1080;
        const tools = [];
        const merge = (name, bg, fg, extra) => `\t\t${name} = Merge {\n\t\t\tInputs = {\n` +
            `\t\t\t\tBackground = Input { SourceOp = ${lua(bg)}, Source = "Output", },\n` +
            `\t\t\t\tForeground = Input { SourceOp = ${lua(fg)}, Source = "Output", },\n` +
            Object.entries(extra || {}).map(([key, v]) => `\t\t\t\t${key} = ${input(v)},\n`).join('') +
            `\t\t\t},\n\t\t},\n`;
        tools.push(toolBlock('Frame', 'Background', {
            GlobalOut: last, Width: W, Height: H, UseFrameFormatSettings: 0,
            TopLeftRed: 0, TopLeftGreen: 0, TopLeftBlue: 0, TopLeftAlpha: 0
        }));
        let prev = 'Frame';
        MASK_ZONES.forEach((z, i) => {
            const [x0, y0, x1, y1] = z.box.map((v) => v * k);
            const w = Math.round(x1 - x0);
            const h = Math.round(y1 - y0);
            const [r, g, b] = rgb(z.color);
            const zone = `Zone${i + 1}`;
            const inputs = { GlobalOut: last, Width: w, Height: h, UseFrameFormatSettings: 0, TopLeftRed: r, TopLeftGreen: g, TopLeftBlue: b, TopLeftAlpha: 1 };
            if (z.round) {
                tools.push(toolBlock(`${zone}Shape`, 'EllipseMask', { MaskWidth: w, MaskHeight: h, PixelAspect: [1, 1], UseFrameFormatSettings: 0, Width: 1, Height: 1, Center: [0.5, 0.5] }));
                tools.push(toolBlock(zone, 'Background', inputs).replace(/\n\t\t\t\},\n\t\t\},\n$/, `,\n\t\t\t\tEffectMask = Input { SourceOp = "${zone}Shape", Source = "Mask", }\n\t\t\t},\n\t\t},\n`));
            } else {
                tools.push(toolBlock(zone, 'Background', inputs));
            }
            // Merge centres are fractions of the frame, y up.
            const place = { Center: [(x0 + x1) / 2 / W, 1 - (y0 + y1) / 2 / H] };
            if (z.opacity < 1) place.Blend = z.opacity;
            tools.push(merge(`Place${i + 1}`, prev, zone, place));
            prev = `Place${i + 1}`;
        });
        MASK_LABELS.forEach((l, i) => {
            const [r, g, b] = rgb(l.color);
            const label = `Label${i + 1}`;
            tools.push(textTool(label, {
                GlobalOut: last, Width: W, Height: H, UseFrameFormatSettings: 0, StyledText: l.text.replace(/\\n/g, '\n'),
                Font: 'Montserrat', Style: 'Medium', Size: 0.075, Center: [l.at[0] * k / W, 1 - (l.at[1] * k) / H],
                Red1: r, Green1: g, Blue1: b
            }));
            tools.push(merge(`Write${i + 1}`, prev, label));
            prev = `Write${i + 1}`;
        });
        // The whole mask at its opacity, over a clear frame.
        tools.push(toolBlock('Clear', 'Background', { GlobalOut: last, Width: W, Height: H, UseFrameFormatSettings: 0, TopLeftAlpha: 0 }));
        tools.push(merge('Mask', 'Clear', prev, { Blend: opts.opacity == null ? 0.7 : opts.opacity }));
        tools.push(`\t\tMediaOut1 = Saver {\n\t\t\tInputs = {\n\t\t\t\tIndex = Input { Value = "0", },\n\t\t\t\tInput = Input { SourceOp = "Mask", Source = "Output", },\n\t\t\t},\n\t\t},\n`);
        return `Composition {\n\tCurrentTime = 0,\n\tRenderRange = { 0, ${last} },\n\tGlobalRange = { 0, ${last} },\n\tTools = {\n${tools.join('')}\t},\n}\n`;
    }

    return { STYLES, FUSION, build, fromTemplate, prepare, readWhip, guide, lua, fadeKeys, showFrame, trackingStart, driftKeys, MASK_ZONES, MASK_LABELS };
});
