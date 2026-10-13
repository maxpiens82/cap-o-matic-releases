// Groups words into captions using the phrase rules.
// Caption: { words: [{ text, start, end, emph: null | { color, size, font } }], lineBreak: index of the first word on line 2 | null,
//            nudgeStart, nudgeEnd } — timing comes from the words; nudges are frame offsets.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).phrases = factory();
})(this, function () {
    'use strict';

    const DEFAULT_RULES = { maxWords: 4, maxChars: 28, lines: 1, sentenceBreak: true, pauseBreak: true, pauseSeconds: 0.4 };
    const SENTENCE_END = /[.!?…]["'»”’)]*$/;

    function textLength(words) {
        return words.reduce((n, w, i) => n + w.text.length + (i ? 1 : 0), 0);
    }

    // Best line break for a two-line caption: both lines within maxChars, as balanced as
    // possible, ties going to a longer first line. Null when it fits on one line or can't split.
    function bestLineBreak(words, maxChars) {
        if (words.length < 2 || textLength(words) <= maxChars) return null;
        let best = null;
        let bestScore = Infinity;
        for (let k = 1; k < words.length; k++) {
            const a = textLength(words.slice(0, k));
            const b = textLength(words.slice(k));
            if (a > maxChars || b > maxChars) continue;
            const score = Math.abs(a - b) + (b > a ? 0.5 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = k;
            }
        }
        return best;
    }

    function fits(words, rules) {
        if (textLength(words) <= rules.maxChars) return true;
        return rules.lines === 2 && bestLineBreak(words, rules.maxChars) !== null;
    }

    function build(words, rulesIn, fps) {
        const rules = Object.assign({}, DEFAULT_RULES, rulesIn);
        const pauseFrames = rules.pauseBreak ? Math.round(rules.pauseSeconds * Number(fps)) : Infinity;
        const groups = [];
        let cur = [];
        for (const w of words) {
            if (cur.length) {
                const prev = cur[cur.length - 1];
                const breakHere =
                    cur.length >= rules.maxWords ||
                    (rules.sentenceBreak && SENTENCE_END.test(prev.text)) ||
                    w.start - prev.end > pauseFrames ||
                    !fits(cur.concat(w), rules);
                if (breakHere) {
                    groups.push(cur);
                    cur = [];
                }
            }
            cur.push(w);
        }
        if (cur.length) groups.push(cur);
        return groups.map((g) => ({
            words: g.map((w) => ({ text: w.text, start: w.start, end: w.end, emph: null })),
            lineBreak: rules.lines === 2 ? bestLineBreak(g, rules.maxChars) : null,
            nudgeStart: 0,
            nudgeEnd: 0
        }));
    }

    function start(caption) {
        return caption.words[0].start + (caption.nudgeStart || 0);
    }

    function end(caption) {
        return caption.words[caption.words.length - 1].end + (caption.nudgeEnd || 0);
    }

    function lines(caption) {
        const t = caption.words.map((w) => w.text);
        if (caption.lineBreak == null) return [t.join(' ')];
        return [t.slice(0, caption.lineBreak).join(' '), t.slice(caption.lineBreak).join(' ')];
    }

    function text(caption) {
        return lines(caption).join('\n');
    }

    return { DEFAULT_RULES, build, bestLineBreak, start, end, lines, text, textLength };
});
