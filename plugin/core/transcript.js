// Turns transcription sources (Resolve AI, subtitle cues, SRT cues) into one word list:
// [{ text, start, end, speaker }] with start/end as absolute timeline frames (end exclusive).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./timecode'));
    else (root.CapCore = root.CapCore || {}).transcript = factory(root.CapCore.timecode);
})(this, function (timecode) {
    'use strict';

    const SILENCE = '(...)';

    // Resolve: { language, segments: [{ start, end, text, speaker, words: [{ start, end, text }] }] }.
    function fromResolve(transcription, fps) {
        const words = [];
        for (const seg of (transcription && transcription.segments) || []) {
            for (const w of seg.words || []) {
                const text = String(w.text || '').trim();
                if (!text || text === SILENCE) continue;
                const start = timecode.toFrames(w.start, fps);
                const end = timecode.toFrames(w.end, fps);
                words.push({ text, start, end, speaker: seg.speaker || null });
            }
        }
        return tidy(words);
    }

    // Cues: [{ start, end, text }] in absolute frames. Word timing inside a cue is spread by
    // character count, since cues only carry timing per line.
    function fromCues(cues) {
        const words = [];
        for (const cue of cues) {
            const parts = String(cue.text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
            if (!parts.length) continue;
            const weights = parts.map((p) => p.length + 1);
            const total = weights.reduce((a, b) => a + b, 0);
            const span = Math.max(cue.end - cue.start, parts.length);
            let acc = 0;
            parts.forEach((text, i) => {
                const start = cue.start + Math.round((acc / total) * span);
                acc += weights[i];
                const end = cue.start + Math.round((acc / total) * span);
                words.push({ text, start, end, speaker: null });
            });
        }
        return tidy(words);
    }

    // Sorted, at least one frame long each.
    function tidy(words) {
        words.sort((a, b) => a.start - b.start);
        for (const w of words) {
            if (w.end <= w.start) w.end = w.start + 1;
        }
        return words;
    }

    // Keeps words that start inside [inFrame, outFrame). Either bound may be null.
    function inRange(words, inFrame, outFrame) {
        return words.filter((w) => (inFrame == null || w.start >= inFrame) && (outFrame == null || w.start < outFrame));
    }

    return { fromResolve, fromCues, inRange };
});
