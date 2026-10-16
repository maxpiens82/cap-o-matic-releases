// Spell check for transcripts: Resolve's transcription sometimes mishears ("Fuiimos",
// "alquilarmos"). Words a bundled frequency list doesn't know are compared with the known words
// one edit away. One clear winner is fixed; close calls are flagged with their choices; words with
// nothing close (names, slang, brands) are left alone. Offline, no language model: it can't catch
// a real word in the wrong place. Pure: the dictionary text is passed in.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).spell = factory();
})(this, function () {
    'use strict';

    const ALPHABET = {
        es: 'abcdefghijklmnopqrstuvwxyzáéíóúüñ',
        en: 'abcdefghijklmnopqrstuvwxyz'
    };
    // A fix is applied only for a word that common, and that far ahead of the next choice.
    const MIN_COUNT = 30;
    const LEAD = 20;
    // A word used elsewhere in the same transcript counts this much more.
    const IN_TRANSCRIPT = 10;
    const SENTENCE_END = /[.!?…]["'»”’)]*$/;

    // "word count" lines (assets/words/<lang>.txt.gz, unzipped).
    function dictionary(text) {
        const counts = new Map();
        for (const line of String(text).split('\n')) {
            const sp = line.lastIndexOf(' ');
            if (sp > 0) counts.set(line.slice(0, sp), Number(line.slice(sp + 1)) || 1);
        }
        return { count: (w) => counts.get(w) || 0, size: counts.size };
    }

    // Splits "¿Fuiimos?" into "¿", "Fuiimos", "?".
    function parts(text) {
        const m = /^([^\p{L}\d]*)(.*?)([^\p{L}\d]*)$/u.exec(String(text));
        return { pre: m[1], core: m[2], post: m[3] };
    }

    const keyOf = (core, lang) => core.toLocaleLowerCase(lang).replace(/['’]/g, lang === 'en' ? '' : '$&');

    function edits1(w, letters) {
        const out = new Set();
        for (let i = 0; i <= w.length; i++) {
            const a = w.slice(0, i);
            const b = w.slice(i);
            if (b) out.add(a + b.slice(1));
            if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
            for (const c of letters) {
                if (b) out.add(a + c + b.slice(1));
                out.add(a + c + b);
            }
        }
        out.delete(w);
        return out;
    }

    // The same capitals as the word it replaces: "Fuiimos" → "Fuimos", "FUIIMOS" → "FUIMOS".
    function caseLike(word, model, lang) {
        if (model.length > 1 && model === model.toLocaleUpperCase(lang)) return word.toLocaleUpperCase(lang);
        if (model[0] === model[0].toLocaleUpperCase(lang) && model[0] !== model[0].toLocaleLowerCase(lang)) {
            return word[0].toLocaleUpperCase(lang) + word.slice(1);
        }
        return word;
    }

    // words: [{ text }] in speaking order. Returns one entry per word: null (fine or left alone),
    // { fix: { to, from, choices } } or { unsure: { choices } }. opts: { lang, userWords: [] }.
    function check(words, dict, opts) {
        const lang = opts && opts.lang === 'en' ? 'en' : 'es';
        const letters = ALPHABET[lang];
        const mine = new Set(((opts && opts.userWords) || []).map((w) => keyOf(w, lang)));
        const used = new Map();
        for (const w of words) {
            const k = keyOf(parts(w.text).core, lang);
            used.set(k, (used.get(k) || 0) + 1);
        }
        const known = (k) => dict.count(k) > 0 || mine.has(k);
        const score = (k) => dict.count(k) * (used.has(k) ? IN_TRANSCRIPT : 1);
        return words.map((w, i) => {
            const { pre, core, post } = parts(w.text);
            if (core.length < 2 || /[\d_]/.test(core) || core.includes('-')) return null;
            const k = keyOf(core, lang);
            if (known(k)) return null;
            // A capital that doesn't start a sentence is a name (Vera, Vicente López): left alone.
            const sentenceStart = i === 0 || SENTENCE_END.test(words[i - 1].text);
            if (!sentenceStart && core[0] !== core[0].toLocaleLowerCase(lang)) return null;
            if (core.length > 1 && core === core.toLocaleUpperCase(lang) && core.length <= 4) return null;
            let near = [...edits1(k, letters)].filter((c) => dict.count(c) > 0);
            let far = false;
            if (!near.length && k.length >= 6) {
                const two = new Set();
                for (const e of edits1(k, letters)) for (const e2 of edits1(e, letters)) if (dict.count(e2) > 0) two.add(e2);
                near = [...two];
                far = true;
            }
            if (!near.length) return null;
            near.sort((a, b) => score(b) - score(a));
            const choices = near.slice(0, 3).map((c) => pre + caseLike(c, core, lang) + post);
            const top = near[0];
            const clear = dict.count(top) >= MIN_COUNT && (near.length === 1 || score(top) >= LEAD * score(near[1]));
            if (clear && !far) return { fix: { to: choices[0], from: w.text, choices } };
            // Two edits away: only worth asking about when the best choice is a common word.
            if (far && dict.count(top) < 100) return null;
            return { unsure: { choices } };
        });
    }

    return { dictionary, check, parts };
});
