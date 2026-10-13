// Caption edits. Every function takes the caption list and returns a new one (the input is never
// mutated), so the panel can keep earlier lists for undo. Unchanged edits return the same list.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./phrases'));
    else (root.CapCore = root.CapCore || {}).edit = factory(root.CapCore.phrases);
})(this, function (phrases) {
    'use strict';

    function replaceAt(caps, ci, ...items) {
        return caps.slice(0, ci).concat(items, caps.slice(ci + 1));
    }

    function lineBreakFor(words, rules) {
        return rules && rules.lines === 2 ? phrases.bestLineBreak(words, rules.maxChars) : null;
    }

    // Splits caption ci so word wi starts a new caption.
    function split(caps, ci, wi) {
        const c = caps[ci];
        if (!c || wi <= 0 || wi >= c.words.length) return caps;
        const lb = c.lineBreak;
        const a = Object.assign({}, c, { words: c.words.slice(0, wi), lineBreak: lb != null && lb < wi ? lb : null, nudgeEnd: 0 });
        const b = Object.assign({}, c, { words: c.words.slice(wi), lineBreak: lb != null && lb > wi ? lb - wi : null, nudgeStart: 0 });
        return replaceAt(caps, ci, a, b);
    }

    // Joins caption ci with the one after it.
    function merge(caps, ci, rules) {
        const a = caps[ci];
        const b = caps[ci + 1];
        if (!a || !b) return caps;
        const words = a.words.concat(b.words);
        const joined = { words, lineBreak: lineBreakFor(words, rules), nudgeStart: a.nudgeStart || 0, nudgeEnd: b.nudgeEnd || 0 };
        return caps.slice(0, ci).concat([joined], caps.slice(ci + 2));
    }

    const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

    // Longest common subsequence of word texts: pairs [oldIndex, newIndex] that stay the same word.
    function anchors(oldWords, newTexts) {
        const a = oldWords.map((w) => norm(w.text));
        const b = newTexts.map(norm);
        const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
        for (let i = a.length - 1; i >= 0; i--) {
            for (let j = b.length - 1; j >= 0; j--) {
                dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const pairs = [];
        let i = 0;
        let j = 0;
        while (i < a.length && j < b.length) {
            if (a[i] && a[i] === b[j]) {
                pairs.push([i, j]);
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
            else j++;
        }
        return pairs;
    }

    // Retyped caption text. Words that survive keep their timing and emphasis; new or changed
    // words share the time between their surviving neighbours by length. Empty text deletes it.
    function setText(caps, ci, text, rules) {
        const c = caps[ci];
        if (!c) return caps;
        const texts = String(text).trim().split(/\s+/).filter(Boolean);
        if (!texts.length) return caps.slice(0, ci).concat(caps.slice(ci + 1));
        if (texts.join(' ') === c.words.map((w) => w.text).join(' ')) return caps;

        const old = c.words;
        const pairs = anchors(old, texts);
        const out = new Array(texts.length);
        for (const [i, j] of pairs) out[j] = Object.assign({}, old[i], { text: texts[j] });

        // Fill each run of unmatched new words between anchors.
        const bounds = [[-1, -1]].concat(pairs, [[old.length, texts.length]]);
        for (let k = 0; k < bounds.length - 1; k++) {
            const [oi, nj] = bounds[k];
            const [oi2, nj2] = bounds[k + 1];
            const run = texts.slice(nj + 1, nj2);
            if (!run.length) continue;
            const from = oi >= 0 ? old[oi].end : old[0].start;
            const to = oi2 < old.length ? old[oi2].start : old[old.length - 1].end;
            const replaced = old.slice(oi + 1, oi2);
            const span = Math.max(to - from, run.length);
            const total = run.reduce((n, t) => n + t.length + 1, 0);
            let acc = 0;
            run.forEach((t, r) => {
                const start = from + Math.round((acc / total) * span);
                acc += t.length + 1;
                const end = Math.max(start + 1, from + Math.round((acc / total) * span));
                const emph = replaced.length === run.length ? replaced[r].emph || null : null;
                out[nj + 1 + r] = { text: t, start, end, emph };
            });
        }
        const lineBreak = texts.length === old.length ? c.lineBreak : lineBreakFor(out, rules);
        return replaceAt(caps, ci, Object.assign({}, c, { words: out, lineBreak }));
    }

    function sameEmph(a, b) {
        return !!a && !!b && a.color === b.color && a.size === b.size && (a.font || '') === (b.font || '');
    }

    // Paints word wi with the brush, or clears it when it already has exactly that look.
    function paint(caps, ci, wi, brush) {
        const c = caps[ci];
        if (!c || !c.words[wi]) return caps;
        const w = c.words[wi];
        const emph = sameEmph(w.emph, brush) ? null : Object.assign({}, brush);
        const words = c.words.map((x, k) => (k === wi ? Object.assign({}, x, { emph }) : x));
        return replaceAt(caps, ci, Object.assign({}, c, { words }));
    }

    // Moves the line break to sit before word k; the same k again (or null) removes it.
    function setLineBreak(caps, ci, k) {
        const c = caps[ci];
        if (!c) return caps;
        const next = k == null || k === c.lineBreak || k <= 0 || k >= c.words.length ? null : k;
        if (next === c.lineBreak) return caps;
        return replaceAt(caps, ci, Object.assign({}, c, { lineBreak: next }));
    }

    // Moves a caption's start or end by delta frames, never overlapping its neighbours and
    // never shorter than one frame.
    function nudge(caps, ci, edge, delta) {
        const c = caps[ci];
        if (!c || !delta) return caps;
        const prevEnd = ci > 0 ? phrases.end(caps[ci - 1]) : -Infinity;
        const nextStart = ci < caps.length - 1 ? phrases.start(caps[ci + 1]) : Infinity;
        const s = phrases.start(c);
        const e = phrases.end(c);
        if (edge === 'start') {
            const target = Math.min(Math.max(s + delta, prevEnd), e - 1);
            if (target === s) return caps;
            return replaceAt(caps, ci, Object.assign({}, c, { nudgeStart: target - c.words[0].start }));
        }
        const target = Math.max(Math.min(e + delta, nextStart), s + 1);
        if (target === e) return caps;
        return replaceAt(caps, ci, Object.assign({}, c, { nudgeEnd: target - c.words[c.words.length - 1].end }));
    }

    function resetNudge(caps, ci) {
        const c = caps[ci];
        if (!c || (!c.nudgeStart && !c.nudgeEnd)) return caps;
        return replaceAt(caps, ci, Object.assign({}, c, { nudgeStart: 0, nudgeEnd: 0 }));
    }

    // Index of the caption showing at frame, or -1.
    function captionAt(caps, frame) {
        let lo = 0;
        let hi = caps.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (frame < phrases.start(caps[mid])) hi = mid - 1;
            else if (frame >= phrases.end(caps[mid])) lo = mid + 1;
            else return mid;
        }
        return -1;
    }

    return { split, merge, setText, paint, setLineBreak, nudge, resetNudge, captionAt, sameEmph };
});
