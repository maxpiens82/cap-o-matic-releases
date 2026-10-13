// Starter-pack styles as the panel previews them. The real look comes from the Fusion comp
// generated for each style; these CSS approximations drive the gallery cards and the Deliver
// preview. Every starter style is Montserrat ExtraBold (800) in Resolve.
(function (root) {
    const MS = 'font-family:Montserrat,"Segoe UI",sans-serif;font-weight:800;';
    root.STARTER_STYLES = [
        {
            id: 'pop', name: 'Pop', tags: ['Word', 'Bold'], stage: '#2C3A4B',
            base: MS + 'color:#fff;display:inline-block;',
            // As in the comp: the spoken word pops past full size and settles at 100 % within
            // 5 frames, scaling in place without moving its neighbours (cap-pop in app.css).
            act: MS + 'color:#FFD93B;display:inline-block;animation:cap-pop .167s linear;'
        },
        {
            id: 'highlight', name: 'Highlight', tags: ['Karaoke', 'Box'], stage: '#3A2F45',
            base: MS + 'color:#fff;display:inline-block;padding:0 .12em;',
            act: MS + 'color:#111;background:#7CF29A;display:inline-block;padding:0 .12em;border-radius:.12em;'
        },
        {
            id: 'underline', name: 'Underline', tags: ['Karaoke', 'Minimal'], stage: '#22323B',
            base: MS + 'color:#fff;display:inline-block;',
            act: MS + 'color:#fff;display:inline-block;text-decoration:underline;text-decoration-color:#FF6B3D;text-decoration-thickness:.14em;text-underline-offset:.14em;'
        },
        {
            id: 'ribbon', name: 'Ribbon', tags: ['Box'], stage: '#2F3C2D', line: 'background:#111;padding:.18em .4em;border-radius:.1em;',
            base: MS + 'color:#fff;display:inline-block;',
            act: MS + 'color:#FFB547;display:inline-block;'
        },
        {
            id: 'glow', name: 'Glow', tags: ['Minimal'], stage: '#1F2C36',
            base: MS + 'color:#DDEBF7;display:inline-block;text-shadow:0 0 .4em rgba(110,190,255,.75);',
            act: MS + 'color:#fff;display:inline-block;text-shadow:0 0 .5em rgba(140,210,255,1),0 0 1em rgba(110,190,255,.7);'
        },
        {
            id: 'spotlight', name: 'Spotlight', tags: ['Karaoke', 'Minimal'], stage: '#2A2833',
            base: MS + 'color:rgba(255,255,255,.45);display:inline-block;',
            act: MS + 'color:#fff;display:inline-block;'
        },
        {
            id: 'plain', name: 'Plain', tags: ['Minimal', 'Box'], stage: '#2B2F38',
            base: MS + 'color:#fff;display:inline-block;',
            act: MS + 'color:#fff;display:inline-block;'
        },
        {
            // Letters type in as each word is spoken; the gallery shows the line half typed.
            id: 'typewriter', name: 'Typewriter', tags: ['Word', 'Minimal'], stage: '#262A2E', typing: true,
            base: MS + 'color:#fff;display:inline-block;',
            act: MS + 'color:#fff;display:inline-block;'
        }
    ];
    root.STYLE_FILTERS = ['All', 'Word', 'Karaoke', 'Box', 'Bold', 'Minimal'];
})(this);
