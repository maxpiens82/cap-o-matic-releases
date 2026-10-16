// The built-in presets: twelve caption looks shipped with Cap-o-matic, read-only in the panel
// (apply or duplicate). Proposed from 2026 short-form caption trends and approved by the user;
// every font is OFL and bundled by the installer (installer/fonts). Pure data.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).builtins = factory();
})(this, function () {
    'use strict';

    // maxWords and maxChars are per line (since 0.2.3; before, maxWords counted the whole caption).
    const rules = (maxWords, maxChars, lines) => ({ maxWords, maxChars, lines, sentenceBreak: true, pauseBreak: true, pauseSeconds: 0.4, perLine: true });
    const shadow = (opacity, distance, softness) => ({ on: opacity > 0, color: '#000000', opacity: opacity || 60, distance, angle: 270, softness });
    const brush = (color, size) => ({ color, size, font: '', fontStyle: '' });
    const outline = (width) => ({ on: true, color: '#000000', width });
    const NO_SHADOW = shadow(0, 6, 8);

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
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', size: 137, y: 64, caseMode: 'upper', accent: '#FFD93B', pop: true, outline: outline(0.09), shadow: shadow(55, 5, 10) } },
        { id: 'negocios', name: 'Negocios', en: 'Business', after: 'Alex Hormozi',
            style: 'pop', rules: rules(2, 15, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Anton', fontStyle: 'Regular', size: 198, y: 62, caseMode: 'upper', accent: '#2EE86B', pop: true, outline: outline(0.07), shadow: shadow(60, 4, 12) } },
        { id: 'una-palabra', name: 'Una palabra', en: 'One Word', after: 'MrBeast, one word at a time',
            style: 'pop', rules: rules(1, 16, 1), brush: brush('#FFD93B', 1.1),
            look: { font: 'Bangers', fontStyle: 'Regular', size: 185, y: 52, caseMode: 'upper', accent: '#FFFFFF', pop: true, outline: outline(0.1), shadow: shadow(100, 6, 0) } },
        { id: 'caja-karaoke', name: 'Caja karaoke', en: 'Karaoke Box', after: 'the bold highlight',
            style: 'highlight', rules: rules(3, 15, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Montserrat', fontStyle: 'ExtraBold', size: 131, y: 64, caseMode: 'upper', accent: '#7CF29A', shadow: shadow(55, 5, 10) } },
        { id: 'foco', name: 'Foco', en: 'Focus', after: 'karaoke fill',
            style: 'spotlight', rules: rules(3, 18, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Poppins', fontStyle: 'Bold', size: 130, y: 64, caseMode: 'as', accent: '#FFFFFF', dim: 42, shadow: shadow(70, 4, 14) } },
        { id: 'sereno', name: 'Sereno', en: 'Calm', after: 'Iman Gadzhi, dim to white',
            style: 'spotlight', rules: rules(3, 22, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Montserrat', fontStyle: 'Medium', size: 107, y: 66, caseMode: 'lower', strip: { '.': true, ',': true }, accent: '#FFFFFF', dim: 50, shadow: shadow(65, 3, 16) } },
        { id: 'subtitulo-clasico', name: 'Subtítulo clásico', en: 'Classic Subtitle', after: "TikTok's classic caption box",
            style: 'plain', rules: rules(3, 24, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Inter', fontStyle: 'SemiBold', size: 97, y: 70, caseMode: 'as', box: { color: '#000000', opacity: 62 }, shadow: NO_SHADOW } },
        { id: 'bloque-de-marca', name: 'Bloque de marca', en: 'Brand Block', after: 'brand color blocks',
            style: 'plain', rules: rules(4, 17, 1), brush: brush('#FFFFFF', 1.15),
            look: { font: 'Archivo Black', fontStyle: 'Regular', size: 101, y: 74, caseMode: 'upper', color: '#111111', box: { color: '#FFD93B', opacity: 100 }, shadow: NO_SHADOW } },
        { id: 'neon', name: 'Neón', en: 'Neon', after: 'neon and gaming captions',
            style: 'glow', rules: rules(3, 19, 1), brush: brush('#FFD93B', 1.15),
            look: { font: 'Bebas Neue', fontStyle: 'Regular', size: 195, y: 62, caseMode: 'upper', color: '#FFFFFF', accent: '#FF3EA5', shadow: NO_SHADOW } },
        { id: 'nativo', name: 'Nativo', en: 'Native', after: "TikTok's own captions",
            style: 'plain', rules: rules(3, 22, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'TikTok Sans', fontStyle: 'SemiBold', size: 110, y: 68, caseMode: 'as', outline: outline(0.045), shadow: shadow(50, 3, 6) } },
        { id: 'maquina-de-escribir', name: 'Máquina de escribir', en: 'Typed Out', after: 'typewriter captions',
            style: 'typewriter', rules: rules(3, 20, 2), brush: brush('#FFD93B', 1.15),
            look: { font: 'Space Mono', fontStyle: 'Bold', size: 115, y: 66, caseMode: 'as', shadow: shadow(75, 4, 12) } }
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
