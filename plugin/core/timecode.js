// Timecode <-> frame conversion. Works in Node and in the renderer (window.CapCore.timecode).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.CapCore = root.CapCore || {}).timecode = factory();
})(this, function () {
    'use strict';

    const TC = /^(\d+):(\d{1,2}):(\d{1,2})([:;.])(\d{1,3})$/;

    function nominalRate(fps) {
        return Math.round(Number(fps));
    }

    // Frames dropped per minute in drop-frame timecode (2 at 29.97, 4 at 59.94).
    function dropPerMinute(fps) {
        return Math.round(nominalRate(fps) / 15);
    }

    function toFrames(tc, fps) {
        const m = TC.exec(String(tc).trim());
        if (!m) throw new Error(`Not a timecode: ${tc}`);
        const [h, mi, s, f] = [m[1], m[2], m[3], m[5]].map(Number);
        const nominal = nominalRate(fps);
        let frames = ((h * 60 + mi) * 60 + s) * nominal + f;
        if (m[4] === ';') {
            const minutes = h * 60 + mi;
            frames -= dropPerMinute(fps) * (minutes - Math.floor(minutes / 10));
        }
        return frames;
    }

    function pad(n, width) {
        return String(n).padStart(width, '0');
    }

    function fromFrames(frames, fps, dropFrame) {
        const nominal = nominalRate(fps);
        let f = Math.max(0, Math.round(frames));
        if (dropFrame) {
            const drop = dropPerMinute(fps);
            const perTenMin = nominal * 600 - drop * 9;
            const perMin = nominal * 60 - drop;
            const tens = Math.floor(f / perTenMin);
            const rem = f % perTenMin;
            f += drop * 9 * tens + (rem > drop ? drop * Math.floor((rem - drop) / perMin) : 0);
        }
        const ff = f % nominal;
        const totalSeconds = Math.floor(f / nominal);
        const sep = dropFrame ? ';' : ':';
        return `${pad(Math.floor(totalSeconds / 3600), 2)}:${pad(Math.floor(totalSeconds / 60) % 60, 2)}:${pad(totalSeconds % 60, 2)}${sep}${pad(ff, 2)}`;
    }

    // Real time in seconds for a frame count (29.97 fps is slower than its nominal 30).
    function framesToSeconds(frames, fps) {
        return frames / Number(fps);
    }

    function secondsToFrames(seconds, fps) {
        return Math.round(seconds * Number(fps));
    }

    return { toFrames, fromFrames, framesToSeconds, secondsToFrames, nominalRate };
});
