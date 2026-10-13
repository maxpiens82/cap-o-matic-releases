// SRT parse and write. Times in SRT are relative to the timeline start.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./timecode'), require('./phrases'));
    else (root.CapCore = root.CapCore || {}).srt = factory(root.CapCore.timecode, root.CapCore.phrases);
})(this, function (timecode, phrases) {
    'use strict';

    const TIME = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

    function parseTime(s) {
        const m = TIME.exec(s);
        if (!m) return null;
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
    }

    // Returns cues as absolute timeline frames: [{ start, end, text }].
    function parse(text, fps, timelineStartFrame) {
        const cues = [];
        const blocks = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
        for (const block of blocks) {
            const lines = block.split('\n').filter((l) => l.trim() !== '');
            const timeIdx = lines.findIndex((l) => l.includes('-->'));
            if (timeIdx < 0) continue;
            const [a, b] = lines[timeIdx].split('-->');
            const startS = parseTime(a);
            const endS = parseTime(b);
            if (startS == null || endS == null) continue;
            const body = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
            if (!body) continue;
            cues.push({
                start: timelineStartFrame + timecode.secondsToFrames(startS, fps),
                end: timelineStartFrame + timecode.secondsToFrames(endS, fps),
                text: body
            });
        }
        return cues;
    }

    function formatTime(seconds) {
        const ms = Math.max(0, Math.round(seconds * 1000));
        const h = Math.floor(ms / 3600000);
        const m = Math.floor(ms / 60000) % 60;
        const s = Math.floor(ms / 1000) % 60;
        const rest = ms % 1000;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
    }

    function write(captions, fps, timelineStartFrame) {
        return captions.map((c, i) => {
            const a = timecode.framesToSeconds(phrases.start(c) - timelineStartFrame, fps);
            const b = timecode.framesToSeconds(phrases.end(c) - timelineStartFrame, fps);
            return `${i + 1}\n${formatTime(a)} --> ${formatTime(b)}\n${phrases.text(c)}\n`;
        }).join('\n');
    }

    return { parse, write, formatTime };
});
