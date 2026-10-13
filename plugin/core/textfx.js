// Case and punctuation clean-up applied when captions are placed (the transcript keeps the
// original text, so sentence-end rules keep working).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).textfx = factory();
})(this, function () {
    'use strict';

    // Each key strips its mark; Spanish opening marks go with their closing partners.
    const MARKS = [
        { key: '.', label: '.', re: /[.…]/g },
        { key: ',', label: ',', re: /,/g },
        { key: '!', label: '! ¡', re: /[!¡]/g },
        { key: '?', label: '? ¿', re: /[?¿]/g },
        { key: '"', label: '“ ”', re: /["“”«»]/g },
        { key: '—', label: '—', re: /[—–]/g },
        { key: ':', label: ':', re: /:/g },
        { key: ';', label: ';', re: /;/g }
    ];

    function apply(text, caseMode, strip) {
        let s = String(text);
        for (const m of MARKS) {
            if (strip && strip[m.key]) s = s.replace(m.re, '');
        }
        s = s.replace(/\s+/g, ' ').trim();
        if (caseMode === 'upper') return s.toLocaleUpperCase();
        if (caseMode === 'lower') return s.toLocaleLowerCase();
        return s;
    }

    return { MARKS, apply };
});
