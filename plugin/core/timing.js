// Final on-screen timing for delivery: fills short gaps, enforces a minimum duration, and never
// lets a caption run into the next one.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./phrases'));
    else (root.CapCore = root.CapCore || {}).timing = factory(root.CapCore.phrases);
})(this, function (phrases) {
    'use strict';

    // opts: { fillGaps, maxGap (frames), minFrames }. Returns [{ start, end }] in timeline frames.
    function finalize(captions, opts) {
        const o = opts || {};
        const out = captions.map((c) => ({ start: phrases.start(c), end: phrases.end(c) }));
        for (let i = 0; i < out.length; i++) {
            const cur = out[i];
            const next = out[i + 1];
            const limit = next ? next.start : Infinity;
            if (o.fillGaps && next) {
                const gap = next.start - cur.end;
                if (gap > 0 && gap <= (o.maxGap || 0)) cur.end = next.start;
            }
            if (o.minFrames && cur.end - cur.start < o.minFrames) {
                cur.end = Math.min(cur.start + o.minFrames, limit);
                // Still short (the next caption starts right after it): start earlier, into the gap
                // before it and, if need be, the previous caption's tail, which keeps its own minimum.
                // Starting early is safe for the words: their timing counts from the clip's start.
                if (cur.end - cur.start < o.minFrames) {
                    const prev = out[i - 1];
                    const floor = prev ? Math.min(prev.end, prev.start + o.minFrames) : 0;
                    cur.start = Math.max(floor, cur.end - o.minFrames);
                    if (prev && prev.end > cur.start) prev.end = cur.start;
                }
            }
            if (cur.end > limit) cur.end = limit;
            if (cur.end <= cur.start) cur.end = cur.start + 1;
        }
        return out;
    }

    // The caption to test with: the worst case for fitting on screen. Longest word when every
    // caption is a single word, otherwise the longest caption text.
    function worstCase(captions) {
        if (!captions.length) return -1;
        const singleWords = captions.every((c) => c.words.length === 1);
        let best = 0;
        let bestLen = -1;
        captions.forEach((c, i) => {
            const len = singleWords ? c.words[0].text.length : Math.max(...phrases.lines(c).map((l) => l.length));
            if (len > bestLen) {
                bestLen = len;
                best = i;
            }
        });
        return best;
    }

    return { finalize, worstCase };
});
