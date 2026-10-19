// The built-in presets: twenty-four caption looks shipped with Cap-o-matic, read-only in the panel
// (apply or duplicate). Twelve on the first base styles, proposed from 2026 short-form caption
// trends, and the twelve Whip studies (design/styles/whip.html), one per pattern; all approved by
// the user. Every font is OFL and bundled by the installer (installer/fonts). Pure data.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).builtins = factory();
})(this, function () {
    'use strict';

    // maxWords and maxChars are per line (since 0.2.3; before, maxWords counted the whole caption).
    const rules = (maxWords, maxChars, lines) => ({ maxWords, maxChars, lines, sentenceBreak: true, pauseBreak: true, pauseSeconds: 0.4, perLine: true });
    const shadow = (opacity, distance, softness, angle = 270) => ({ on: opacity > 0, color: '#000000', opacity: opacity || 60, distance, angle, softness });
    const brush = (color, size) => ({ color, size, font: '', fontStyle: '' });
    const outline = (width) => ({ on: true, color: '#000000', width });
    const NO_SHADOW = shadow(0, 6, 8);
    // Motion (comp.js fadeKeys, trackingStart): only on the eight Pro presets (MONETIZATION.md, the
    // free/Pro split), each to suit its look (owner, 2026-10-16). Fades in frames, rest opacity in %.
    // The Whip looks use the same fade, per word, resting fully opaque.
    const fade = (fin, fout, rest) => ({ on: true, in: fin, out: fout, rest: rest || 100 });
    // Letters drifting apart at `speed` % a second, starting that much tight (comp.js driftKeys).
    const track = (speed) => ({ on: true, from: 100 - speed, speed });
    // Whip studies: every mark stripped, and the motion (whip.js settings): in [frames, overshoot %],
    // out [frames, stagger], the pattern's own angles, a half-open shutter (180°).
    const ALL_MARKS = { '.': true, ',': true, '!': true, '?': true, '"': true, '—': true, ':': true, ';': true };
    const whip = (pattern, distance, [inFrames, overshoot], [outFrames, stagger], extra) => Object.assign({
        pattern, inMode: 'pattern', inAngle: 0, outMode: 'pattern', outAngle: 0, distance, inFrames, outFrames, overshoot, stagger,
        shutter: 180, scale: 100, x: 50, y: 50, spacing: 0, glow: '', bar: ''
    }, extra);

    // id: stable key; name: Spanish (also the name a copy or a pack gets), en: English; after: what
    // it's modelled on (for the docs, not shown).
    // Sizes reproduce the approved preview page through the Text+ rule (line = 0.8 x Size x width,
    // fonts.LINE_PER_SIZE); maxChars is lowered where the widest line wouldn't fit 86 % of a 9:16
    // frame at that size, measured with each bundled font (Una palabra is capped at 185 so a
    // 16-letter word still fits).
    const LIST = [
        { id: 'limpio', name: 'Limpio', en: 'Clean', after: 'the 2026 default: white, heavy outline',
            style: 'pop', rules: rules(3, 15, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', size: 137, y: 64, caseMode: 'upper', accent: '#FFFFFF', pop: false, outline: outline(0.09), shadow: shadow(55, 5, 10) } },
        { id: 'gancho-amarillo', name: 'Gancho amarillo', en: 'Yellow Hook', after: 'yellow spoken word on a black outline',
            style: 'pop', rules: rules(3, 15, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', size: 137, y: 64, caseMode: 'upper', accent: '#FFD93B', pop: true, outline: outline(0.09), shadow: shadow(55, 5, 10),
                fade: fade(3, 3), tracking: track(12) } },
        { id: 'negocios', name: 'Negocios', en: 'Business', after: 'Alex Hormozi',
            style: 'pop', rules: rules(2, 15, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Anton', fontStyle: 'Regular', size: 198, y: 62, caseMode: 'upper', accent: '#2EE86B', pop: true, outline: outline(0.07), shadow: shadow(60, 4, 12),
                fade: fade(3, 3) } },
        { id: 'una-palabra', name: 'Una palabra', en: 'One Word', after: 'MrBeast, one word at a time',
            style: 'pop', rules: rules(1, 16, 1), brush: brush('#FFD93B', 1.1),
            look: { font: 'Bangers', fontStyle: 'Regular', size: 185, y: 52, caseMode: 'upper', accent: '#FFFFFF', pop: true, outline: outline(0.1), shadow: shadow(100, 6, 0),
                fade: fade(2, 2), tracking: track(12) } },
        { id: 'caja-karaoke', name: 'Caja karaoke', en: 'Karaoke Box', after: 'the bold highlight',
            style: 'highlight', rules: rules(3, 15, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', size: 131, y: 64, caseMode: 'upper', accent: '#7CF29A', shadow: shadow(55, 5, 10) } },
        { id: 'foco', name: 'Foco', en: 'Focus', after: 'karaoke fill',
            style: 'spotlight', rules: rules(3, 18, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Poppins', fontStyle: 'Bold', size: 130, y: 64, caseMode: 'as', accent: '#FFFFFF', dim: 42, shadow: shadow(70, 4, 14),
                fade: fade(5, 5), tracking: track(12) } },
        { id: 'sereno', name: 'Sereno', en: 'Calm', after: 'Iman Gadzhi, dim to white',
            style: 'spotlight', rules: rules(3, 22, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Montserrat', fontStyle: 'Medium', size: 107, y: 66, caseMode: 'lower', strip: { '.': true, ',': true }, accent: '#FFFFFF', dim: 50, shadow: shadow(65, 3, 16),
                fade: fade(8, 8, 92), tracking: track(12) } },
        { id: 'subtitulo-clasico', name: 'Subtítulo clásico', en: 'Classic Subtitle', after: "TikTok's classic caption box",
            style: 'plain', rules: rules(3, 24, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Inter', fontStyle: 'SemiBold', size: 97, y: 70, caseMode: 'as', box: { color: '#000000', opacity: 62 }, shadow: NO_SHADOW } },
        { id: 'bloque-de-marca', name: 'Bloque de marca', en: 'Brand Block', after: 'brand color blocks',
            style: 'plain', rules: rules(4, 17, 1), brush: brush('#FFFFFF', 1.15),
            look: { font: 'Archivo Black', fontStyle: 'Regular', size: 101, y: 74, caseMode: 'upper', color: '#111111', box: { color: '#FFD93B', opacity: 100 }, shadow: NO_SHADOW,
                fade: fade(4, 4) } },
        { id: 'neon', name: 'Neón', en: 'Neon', after: 'neon and gaming captions',
            style: 'glow', rules: rules(3, 19, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Bebas Neue', fontStyle: 'Regular', size: 195, y: 62, caseMode: 'upper', color: '#FFFFFF', accent: '#FF3EA5', shadow: NO_SHADOW,
                fade: fade(6, 6), tracking: track(12) } },
        { id: 'nativo', name: 'Nativo', en: 'Native', after: "TikTok's own captions",
            style: 'plain', rules: rules(3, 22, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'TikTok Sans', fontStyle: 'SemiBold', size: 110, y: 68, caseMode: 'as', outline: outline(0.045), shadow: shadow(50, 3, 6) } },
        { id: 'maquina-de-escribir', name: 'Máquina de escribir', en: 'Typed Out', after: 'typewriter captions',
            style: 'typewriter', rules: rules(3, 20, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Space Mono', fontStyle: 'Bold', size: 115, y: 66, caseMode: 'as', shadow: shadow(75, 4, 12),
                fade: fade(0, 4) } },

        // The Whip studies, one per pattern. No size or position of their own: the pattern sizes and
        // places every word (whip.js), so maxChars only caps the line; maxWords is what the pattern
        // holds (whip.PATTERNS; a longer caption would fall back to two lines).
        { id: 'constelacion', name: 'Constelación', en: 'Constellation', after: 'Whip study 1: big words around the head, flying in at the speaker',
            style: 'whip', rules: rules(5, 50, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Anton', fontStyle: 'Regular', caseMode: 'upper', strip: ALL_MARKS, shadow: shadow(60, 6, 22), fade: fade(3, 4), whip: whip('constellation', 70, [7, 6], [6, 1]) } },
        { id: 'reticula', name: 'Retícula', en: 'Grid', after: 'Whip study 2: boxed words in a grid above the head, run straight through',
            style: 'whip', rules: rules(6, 50, 1), brush: brush('#2EE86B', 1),
            look: { font: 'Inter', fontStyle: 'SemiBold', caseMode: 'upper', strip: ALL_MARKS, box: { color: '#18181B', opacity: 90 }, shadow: NO_SHADOW, fade: fade(2, 3), whip: whip('grid', 100, [6, 0], [5, 1]) } },
        { id: 'escalera', name: 'Escalera', en: 'Staircase', after: 'Whip study 3: steps down across the chest, in and out along the stair',
            style: 'whip', rules: rules(4, 50, 1), brush: brush('#FF3EA5', 1.1),
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', caseMode: 'as', strip: ALL_MARKS, outline: outline(0.06), shadow: NO_SHADOW, fade: fade(3, 3), whip: whip('stairs', 55, [8, 8], [6, 2]) } },
        { id: 'impacto', name: 'Impacto', en: 'Impact', after: 'Whip study 4: a poster block slammed in from alternating sides',
            style: 'whip', rules: rules(3, 50, 1), brush: brush('#FF4D3D', 1),
            look: { font: 'Bebas Neue', fontStyle: 'Regular', caseMode: 'upper', strip: ALL_MARKS, shadow: shadow(45, 13, 0, 315), fade: fade(2, 4), whip: whip('impact', 85, [5, 10], [6, 0]) } },
        { id: 'prensa', name: 'Prensa', en: 'Press', after: 'Whip study 5: two rows meeting in the middle, then shearing apart',
            style: 'whip', rules: rules(5, 50, 1), brush: brush('#2EE86B', 1),
            look: { font: 'Poppins', fontStyle: 'Bold', caseMode: 'lower', strip: ALL_MARKS, shadow: shadow(55, 5, 16), fade: fade(3, 3), whip: whip('press', 55, [7, 5], [6, 1]) } },
        { id: 'halo', name: 'Halo', en: 'Halo', after: 'Whip study 6: an arc over the head swept clockwise, the calm one',
            style: 'whip', rules: rules(3, 50, 1), brush: brush('#9FD0FF', 1),
            look: { font: 'Montserrat', fontStyle: 'Medium', caseMode: 'upper', strip: ALL_MARKS, shadow: NO_SHADOW, fade: fade(5, 6), whip: whip('halo', 45, [10, 0], [8, 2], { spacing: 8, glow: '#6FB7FF' }) } },
        { id: 'zigzag', name: 'Zigzag', en: 'Zigzag', after: 'Whip study 7: left and right of the face in turn, each from its own side',
            style: 'whip', rules: rules(5, 50, 1), brush: brush('#FFD93B', 1.1),
            look: { font: 'TikTok Sans', fontStyle: 'SemiBold', caseMode: 'as', strip: ALL_MARKS, outline: outline(0.05), shadow: NO_SHADOW, fade: fade(2, 4), whip: whip('zigzag', 60, [6, 7], [6, 1]) } },
        { id: 'embudo', name: 'Embudo', en: 'Funnel', after: 'Whip study 8: an upside-down pyramid above the head, converging on its tip',
            style: 'whip', rules: rules(6, 50, 1), brush: brush('#FF8A1F', 1),
            look: { font: 'Archivo Black', fontStyle: 'Regular', caseMode: 'upper', strip: ALL_MARKS, shadow: shadow(55, 6, 14), fade: fade(3, 3), whip: whip('funnel', 60, [7, 5], [6, 1]) } },
        { id: 'mosaico', name: 'Mosaico', en: 'Collage', after: 'Whip study 9: a loud collage of tilted words, an angle per word',
            style: 'whip', rules: rules(5, 50, 1), brush: brush('#FFD93B', 1.1),
            look: { font: 'Bangers', fontStyle: 'Regular', caseMode: 'upper', strip: ALL_MARKS, outline: outline(0.07), shadow: shadow(100, 11, 0, 308), fade: fade(2, 3), whip: whip('collage', 75, [6, 12], [5, 1]) } },
        { id: 'marco', name: 'Marco', en: 'Frame', after: 'Whip study 10: underlined words in the corners of the safe area, framing the speaker',
            style: 'whip', rules: rules(4, 50, 1), brush: brush('#FF8A1F', 1),
            look: { font: 'Space Mono', fontStyle: 'Bold', caseMode: 'upper', strip: ALL_MARKS, color: '#F4F4F5', shadow: shadow(50, 4, 12), fade: fade(3, 3), whip: whip('frame', 50, [6, 0], [6, 0], { bar: '#FF8A1F' }) } },
        { id: 'renglon', name: 'Renglón', en: 'Line', after: 'Whip study 11: the everyday one, a caption line flicking up into place',
            style: 'whip', rules: rules(6, 50, 1), brush: brush('#FFD93B', 1),
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', caseMode: 'upper', strip: ALL_MARKS, shadow: shadow(60, 5, 14), fade: fade(3, 3), whip: whip('line', 22, [6, 4], [5, 1]) } },
        { id: 'golpe', name: 'Golpe', en: 'Punch', after: 'Whip study 12: one huge word at a time, punching straight through',
            style: 'whip', rules: rules(1, 50, 1), brush: brush('#FFD93B', 1),
            look: { font: 'Anton', fontStyle: 'Regular', caseMode: 'upper', strip: ALL_MARKS, outline: outline(0.03), shadow: NO_SHADOW, fade: fade(2, 2), whip: whip('punch', 80, [5, 12], [4, 0]) } }
    ];

    // As presets: the same shape a saved or imported preset has, plus builtin/id.
    const BUILTINS = LIST.map((b) => ({
        kind: 'cap-o-matic/preset', version: 1, builtin: true, id: b.id, name: b.name, names: { es: b.name, en: b.en },
        style: { source: 'pack', id: b.style }, rules: b.rules, brush: b.brush,
        look: Object.assign({ x: 50, color: '', strip: {} }, b.look)
    }));

    // Everything a built-in needs installed, family → styles (for the installer and the font check).
    function fonts() {
        const out = {};
        for (const p of BUILTINS) (out[p.look.font] = out[p.look.font] || new Set()).add(p.look.fontStyle);
        return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
    }

    // A preset's name in the panel's language: built-ins have one per language, others keep theirs.
    function nameOf(preset, lang) {
        return (preset && preset.names && preset.names[lang === 'es' ? 'es' : 'en']) || (preset ? preset.name : '');
    }

    return { BUILTINS, fonts, nameOf };
});
