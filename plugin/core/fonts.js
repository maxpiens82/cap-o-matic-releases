// Fonts: which caption fonts aren't installed, and the installed families with their styles.
// Installed fonts come from the Windows font registry (`reg query …\Fonts`, machine and user),
// whose value names look like "Montserrat ExtraBold (TrueType)" or "Cambria & Cambria Math
// (TrueType)", and whose data points at the font file. Pure: no I/O (files are read through a
// callback).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).fonts = factory();
})(this, function () {
    'use strict';

    // Font names from `reg query` output.
    function parseRegistry(text) {
        const names = new Set();
        for (const line of String(text).split(/\r?\n/)) {
            const m = /^\s+(.+?)\s{2,}REG_(?:SZ|EXPAND_SZ)\s/.exec(line);
            if (!m) continue;
            const value = m[1].replace(/\s*\([^)]*\)\s*$/, '');
            for (const part of value.split(/\s+&\s+/)) if (part.trim()) names.add(part.trim());
        }
        return [...names];
    }

    // A family counts as installed if a font is named exactly that, or that plus a style
    // ("Montserrat ExtraBold"). Returns the families that aren't, without duplicates.
    function missing(families, installed) {
        const have = installed.map((n) => n.toLocaleLowerCase());
        const out = [];
        for (const f of families) {
            if (!f || out.includes(f)) continue;
            const key = f.toLocaleLowerCase();
            if (!have.some((n) => n === key || n.startsWith(key + ' '))) out.push(f);
        }
        return out;
    }

    // The fonts a delivery writes: the caption font (starter styles only; templates keep their
    // own) and every emphasis font in the captions.
    function needed(captions, opts) {
        const list = [];
        if (opts.starter) list.push(opts.font || 'Montserrat');
        for (const c of captions || []) {
            for (const w of c.words || []) if (w.emph && w.emph.font) list.push(w.emph.font);
        }
        return [...new Set(list)];
    }

    // ------------------------------------------------------------ installed families

    // Font files from `reg query` output. Machine fonts give a file name (in %WINDIR%\Fonts),
    // per-user fonts a full path. Only outline fonts Text+ can use.
    function parseRegistryFiles(text) {
        const files = new Set();
        for (const line of String(text).split(/\r?\n/)) {
            const m = /^\s+.+?\s{2,}REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/.exec(line);
            if (m && /\.(ttf|otf|ttc|otc)$/i.test(m[1])) files.add(m[1]);
        }
        return [...files];
    }

    // Family and style of each font in an sfnt file (TrueType/OpenType, or every font of a .ttc
    // collection), from its name table, the way Fusion lists them: the typographic family and
    // subfamily (name IDs 16/17) when present, else the legacy pair (1/2). read(offset, length)
    // returns those bytes as a Uint8Array (shorter at the end of the file).
    function sfntNames(read) {
        const u16 = (b, o) => (b[o] << 8) | b[o + 1];
        const u32 = (b, o) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
        const head = read(0, 12);
        if (head.length < 12) return [];
        let offsets = [0];
        if (String.fromCharCode(head[0], head[1], head[2], head[3]) === 'ttcf') {
            const n = Math.min(u32(head, 8), 64);
            const list = read(12, 4 * n);
            offsets = [];
            for (let i = 0; i + 4 <= list.length; i += 4) offsets.push(u32(list, i));
        }
        const out = [];
        for (const base of offsets) {
            const dir = read(base, 12);
            if (dir.length < 12) continue;
            const numTables = Math.min(u16(dir, 4), 200);
            const recs = read(base + 12, 16 * numTables);
            let name = null;
            for (let i = 0; i + 16 <= recs.length; i += 16) {
                if (String.fromCharCode(recs[i], recs[i + 1], recs[i + 2], recs[i + 3]) === 'name') name = { at: u32(recs, i + 8), len: u32(recs, i + 12) };
            }
            if (!name || name.len < 6 || name.len > 1 << 20) continue;
            const t = read(name.at, name.len);
            const count = u16(t, 2);
            const strings = u16(t, 4);
            const best = {}; // nameID -> { rank, text }
            for (let i = 0; i < count && 6 + 12 * i + 12 <= t.length; i++) {
                const r = 6 + 12 * i;
                const [platform, encoding, lang, id, len, off] = [u16(t, r), u16(t, r + 2), u16(t, r + 4), u16(t, r + 6), u16(t, r + 8), u16(t, r + 10)];
                if (![1, 2, 16, 17].includes(id)) continue;
                const win = platform === 3 && (encoding === 1 || encoding === 10);
                const rank = win ? (lang === 0x409 ? 3 : 2) : platform === 1 && encoding === 0 && lang === 0 ? 1 : 0;
                if (!rank || (best[id] && best[id].rank >= rank)) continue;
                const bytes = t.subarray(strings + off, strings + off + len);
                let text = '';
                if (win) for (let k = 0; k + 1 < bytes.length; k += 2) text += String.fromCharCode(u16(bytes, k));
                else text = String.fromCharCode(...bytes);
                if (text.trim()) best[id] = { rank, text: text.trim() };
            }
            const family = (best[16] || best[1] || {}).text;
            const style = (best[17] || best[2] || {}).text || 'Regular';
            if (family) out.push({ family, style });
        }
        return out;
    }

    // [{ family, style }] → [{ family, styles }], families A–Z, styles light to heavy.
    function groupFamilies(fonts) {
        const map = new Map();
        for (const f of fonts) {
            if (!f || !f.family || f.family.startsWith('.')) continue;
            if (!map.has(f.family)) map.set(f.family, new Set());
            map.get(f.family).add(f.style || 'Regular');
        }
        const order = (s) => cssWeight(s) + (/italic|oblique/i.test(s) ? 1 : 0);
        return [...map.entries()]
            .map(([family, styles]) => ({ family, styles: [...styles].sort((a, b) => order(a) - order(b) || a.localeCompare(b)) }))
            .sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
    }

    // Text+ needs a style with each font. The panel's favourites have a designed pairing; any other
    // family gets its boldest upright style up to ExtraBold (captions read best bold), else Regular.
    const FONT_STYLES = { Montserrat: 'ExtraBold', Anton: 'Regular', 'Archivo Black': 'Regular', 'Bebas Neue': 'Regular', Poppins: 'Bold' };
    const CAPTION_STYLES = ['ExtraBold', 'Extra Bold', 'Bold', 'Black', 'Heavy', 'SemiBold', 'Semibold', 'Semi Bold', 'Medium', 'Regular', 'Book', 'Normal'];
    function styleFor(font, styles) {
        if (!styles) return FONT_STYLES[font] || 'Regular';
        if (FONT_STYLES[font] && styles.includes(FONT_STYLES[font])) return FONT_STYLES[font];
        return CAPTION_STYLES.find((s) => styles.includes(s)) || styles.find((s) => !/italic|oblique/i.test(s)) || styles[0] || 'Regular';
    }
    // The CSS weight of a style name, for previews ("Extra Bold", "SemiBold Italic", "Heavy"…).
    const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, semilight: 350, regular: 400, normal: 400, book: 400, roman: 400,
        medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900, extrablack: 950, ultrablack: 950 };
    function cssWeight(style) {
        const key = String(style || '').toLowerCase().replace(/italic|oblique|[\s_-]/g, '');
        return WEIGHTS[key] || 400;
    }
    const isItalic = (style) => /italic|oblique/i.test(String(style || ''));

    // Text+ sizes a font by its line height (ascent + descent), not its em: the line is about
    // LINE_PER_SIZE × Size × frame width, in both orientations. Measured on renders: Montserrat
    // ExtraBold (line 1.219 em) at 0.651 em per Size×width, Poppins Bold (1.400 em) at 0.580.
    const LINE_PER_SIZE = 0.8;

    return { parseRegistry, parseRegistryFiles, sfntNames, groupFamilies, missing, needed, FONT_STYLES, styleFor, cssWeight, isItalic, LINE_PER_SIZE };
});
