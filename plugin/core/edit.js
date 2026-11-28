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
        return rules && rules.lines === 2 ? phrases.bestLineBreak(words, rules.maxChars, rules.maxWords) : null;
    }

    // Splits caption ci so word wi starts a new caption. Pruned words go with the half they were
    // spoken in.
    function split(caps, ci, wi) {
        const c = caps[ci];
        if (!c || wi <= 0 || wi >= c.words.length) return caps;
        const lb = c.lineBreak;
        const at = c.words[wi].start;
        const a = Object.assign({}, c, { words: c.words.slice(0, wi), lineBreak: lb != null && lb < wi ? lb : null, nudgeEnd: 0 });
        const b = Object.assign({}, c, { words: c.words.slice(wi), lineBreak: lb != null && lb > wi ? lb - wi : null, nudgeStart: 0 });
        if (c.pruned) {
            a.pruned = c.pruned.filter((w) => w.start < at);
            b.pruned = c.pruned.filter((w) => w.start >= at);
        }
        return replaceAt(caps, ci, a, b);
    }

    // Joins caption ci with the one after it.
    function merge(caps, ci, rules) {
        const a = caps[ci];
        const b = caps[ci + 1];
        if (!a || !b) return caps;
        const words = a.words.concat(b.words);
        const joined = { words, lineBreak: lineBreakFor(words, rules), nudgeStart: a.nudgeStart || 0, nudgeEnd: b.nudgeEnd || 0 };
        const pruned = (a.pruned || []).concat(b.pruned || []);
        if (pruned.length) joined.pruned = pruned;
        return caps.slice(0, ci).concat([joined], caps.slice(ci + 2));
    }

    // ------------------------------------------------------------ pruning
    // A pruned word leaves its caption's words (so nothing that shows or delivers captions sees it)
    // for the caption's `pruned` list, sorted by start, where it can be kept again. regroup then
    // builds the captions afresh from the words that are left.

    const byStart = (a, b) => a.start - b.start;

    // A caption's kept and pruned words in spoken order: [{ word, kept, index }] (index into words
    // or pruned).
    function prunedView(c) {
        return c.words.map((word, index) => ({ word, kept: true, index }))
            .concat((c.pruned || []).map((word, index) => ({ word, kept: false, index })))
            .sort((x, y) => byStart(x.word, y.word));
    }

    function prunedCount(caps) {
        return caps.reduce((n, c) => n + (c.pruned ? c.pruned.length : 0), 0);
    }

    // Prunes word wi of caption ci. When it was the caption's last kept word, the caption goes and
    // its pruned words join the caption before it (or after it, for the first).
    function prune(caps, ci, wi, rules) {
        const c = caps[ci];
        const w = c && c.words[wi];
        if (!w) return caps;
        const pruned = (c.pruned || []).concat([w]).sort(byStart);
        const words = c.words.filter((x, k) => k !== wi);
        if (words.length) {
            const lineBreak = c.lineBreak == null ? null : lineBreakFor(words, rules);
            return replaceAt(caps, ci, Object.assign({}, c, { words, pruned, lineBreak }));
        }
        const to = ci > 0 ? ci - 1 : ci + 1;
        const host = caps[to];
        if (!host) return caps;
        const moved = Object.assign({}, host, { pruned: (host.pruned || []).concat(pruned).sort(byStart) });
        const out = caps.slice();
        out[to] = moved;
        out.splice(ci, 1);
        return out;
    }

    // Keeps pruned word pi of caption ci again, back among its caption's words in spoken order.
    function unprune(caps, ci, pi, rules) {
        const c = caps[ci];
        const w = c && c.pruned && c.pruned[pi];
        if (!w) return caps;
        const words = c.words.concat([w]).sort(byStart);
        const pruned = c.pruned.filter((x, k) => k !== pi);
        const next = Object.assign({}, c, { words, lineBreak: c.lineBreak == null ? null : lineBreakFor(words, rules) });
        if (pruned.length) next.pruned = pruned;
        else delete next.pruned;
        return replaceAt(caps, ci, next);
    }

    // Every pruned word kept again, in place.
    function unpruneAll(caps, rules) {
        if (!prunedCount(caps)) return caps;
        return caps.map((c) => {
            if (!c.pruned || !c.pruned.length) return c;
            const words = c.words.concat(c.pruned).sort(byStart);
            const next = Object.assign({}, c, { words, lineBreak: c.lineBreak == null ? null : lineBreakFor(words, rules) });
            delete next.pruned;
            return next;
        });
    }

    // The captions built afresh by the phrase rules from the words that are kept, which keep their
    // spelling and emphasis (groups, line breaks and nudges are the rules' again). A pruned word
    // counts as speech, so the time it took isn't read as a pause, and a sentence it ends still
    // ends there; it stays with the caption it was spoken in or after.
    function regroup(caps, rules, fps) {
        const kept = [];
        const pruned = [];
        for (const c of caps) {
            kept.push(...c.words);
            if (c.pruned) pruned.push(...c.pruned);
        }
        kept.sort(byStart);
        pruned.sort(byStart);
        if (!kept.length) return caps;
        // Each kept word's end stretched over the pruned words spoken before the next kept one.
        let p = 0;
        const proxies = kept.map((w, i) => {
            const nextStart = i + 1 < kept.length ? kept[i + 1].start : Infinity;
            let end = w.end;
            let sentenceEnd = false;
            while (p < pruned.length && pruned[p].start < nextStart) {
                if (pruned[p].start >= w.start) {
                    end = Math.max(end, pruned[p].end);
                    sentenceEnd = sentenceEnd || phrases.SENTENCE_END.test(pruned[p].text);
                }
                p++;
            }
            return { text: w.text, start: w.start, end, sentenceEnd };
        });
        let n = 0;
        const out = phrases.build(proxies, rules, fps).map((g) => {
            const words = kept.slice(n, n + g.words.length);
            n += g.words.length;
            return { words, lineBreak: g.lineBreak, nudgeStart: 0, nudgeEnd: 0 };
        });
        // Pruned words: with the last caption that starts at or before them (else the first).
        let k = 0;
        for (const w of pruned) {
            while (k + 1 < out.length && out[k + 1].words[0].start <= w.start) k++;
            (out[k].pruned = out[k].pruned || []).push(w);
        }
        return out;
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

    // Spell check marks on a word: fixedFrom (the text before an automatic fix) and spell (choices
    // for a close call). Replacing a word keeps its timing and emphasis and drops the marks. Several
    // words typed for one (the transcription ran two together) share its time by length, the way
    // setText fills retyped words; a line break after the word moves with it.
    function replaceWord(caps, ci, wi, text) {
        const c = caps[ci];
        const w = c && c.words[wi];
        const texts = String(text || '').trim().split(/\s+/).filter(Boolean);
        if (!w || !texts.length) return caps;
        const span = Math.max(w.end - w.start, texts.length);
        const total = texts.reduce((n, t) => n + t.length + 1, 0);
        let acc = 0;
        const pieces = texts.map((t) => {
            const start = w.start + Math.round((acc / total) * span);
            acc += t.length + 1;
            const next = Object.assign({}, w, { text: t, start, end: Math.max(start + 1, w.start + Math.round((acc / total) * span)) });
            delete next.fixedFrom;
            delete next.spell;
            return next;
        });
        const words = c.words.slice(0, wi).concat(pieces, c.words.slice(wi + 1));
        const lineBreak = c.lineBreak != null && c.lineBreak > wi ? c.lineBreak + pieces.length - 1 : c.lineBreak;
        return replaceAt(caps, ci, Object.assign({}, c, { words, lineBreak }));
    }

    // Keeps the word as it is and drops its marks.
    function clearSpell(caps, ci, wi) {
        const c = caps[ci];
        const w = c && c.words[wi];
        if (!w || (w.fixedFrom == null && !w.spell)) return caps;
        const next = Object.assign({}, w);
        delete next.fixedFrom;
        delete next.spell;
        return replaceAt(caps, ci, Object.assign({}, c, { words: c.words.map((x, k) => (k === wi ? next : x)) }));
    }

    // Applies spell.check results (one per word, in caption order): fixes go in, close calls get
    // their choices. Returns { caps, fixed, unsure }.
    function applySpell(caps, results) {
        let n = 0;
        let fixed = 0;
        let unsure = 0;
        const out = caps.map((c) => Object.assign({}, c, {
            words: c.words.map((w) => {
                const r = results[n++];
                if (!r) return w;
                if (r.fix) {
                    fixed++;
                    return Object.assign({}, w, { text: r.fix.to, fixedFrom: r.fix.from });
                }
                unsure++;
                return Object.assign({}, w, { spell: r.unsure.choices });
            })
        }));
        return { caps: out, fixed, unsure };
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

    // The transcript with the captions' words (kept and pruned) in place of what it had over the time
    // the captions cover: the words as fixed in Edit, so captions built from it again (other phrase
    // rules) keep the fixes (owner, 2026-11-28). Spelling marks and emphasis stay with the captions;
    // a word keeps the speaker of the transcript word that started there. Words outside the
    // captions' time (another In/Out range) stay as they were. Unchanged: the same list.
    function toTranscript(words, caps) {
        const fixed = [];
        for (const c of caps) fixed.push(...c.words, ...(c.pruned || []));
        if (!fixed.length || !Array.isArray(words)) return words;
        fixed.sort(byStart);
        const from = fixed[0].start;
        const to = Math.max(...fixed.map((w) => w.end));
        const speaker = new Map(words.map((w) => [w.start, w.speaker || null]));
        const inside = words.filter((w) => w.start >= from && w.start < to);
        const same = inside.length === fixed.length && inside.every((w, k) => w.text === fixed[k].text && w.start === fixed[k].start && w.end === fixed[k].end);
        if (same) return words;
        return words.filter((w) => w.start < from || w.start >= to)
            .concat(fixed.map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: speaker.get(w.start) || null })))
            .sort(byStart);
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

    return {
        split, merge, setText, paint, setLineBreak, nudge, resetNudge, captionAt, sameEmph, replaceWord, clearSpell, applySpell,
        prunedView, prunedCount, prune, unprune, unpruneAll, regroup, toTranscript
    };
});
