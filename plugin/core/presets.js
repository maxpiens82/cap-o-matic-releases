// Presets: a named snapshot of everything that shapes captions — style, phrase rules, emphasis
// brush and the Deliver look — kept globally and shareable as a file. Pure: no I/O.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./textfx'));
    else (root.CapCore = root.CapCore || {}).presets = factory(root.CapCore.textfx);
})(this, function (textfx) {
    'use strict';

    const KIND = 'cap-o-matic/preset';
    // A pack: many presets in one file, to share a set or publish one without an app update.
    const PACK_KIND = 'cap-o-matic/pack';
    const VERSION = 1;
    const MAX_PACK = 200;
    // Deliver settings that belong to one timeline rather than to a look.
    const LOCAL_LOOK = ['track'];

    const clone = (v) => JSON.parse(JSON.stringify(v));

    // ------------------------------------------------------------ validation

    const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    const isNum = (lo, hi, int) => (v) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v));
    const isBool = (v) => typeof v === 'boolean';
    const isStr = (max) => (v) => typeof v === 'string' && v.length <= max;
    const oneOf = (...xs) => (v) => xs.includes(v);
    const marks = new Set(textfx.MARKS.map((m) => m.key));

    // A schema maps each key to a test, or to a nested schema that must pass whole.
    const SHADOW = { on: isBool, color: isHex, opacity: isNum(0, 100), distance: isNum(0, 40), angle: isNum(0, 359), softness: isNum(0, 40) };
    const SCHEMA = {
        rules: { maxWords: isNum(1, 8, true), maxChars: isNum(6, 50, true), lines: oneOf(1, 2), sentenceBreak: isBool, pauseBreak: isBool, pauseSeconds: isNum(0.1, 3), perLine: isBool },
        brush: { color: isHex, size: isNum(0.5, 3), font: isStr(100), fontStyle: isStr(100) },
        look: {
            size: isNum(30, 200), x: isNum(0, 100), y: isNum(0, 100), font: isStr(100), fontStyle: isStr(100), color: (v) => v === '' || isHex(v),
            caseMode: oneOf('as', 'upper', 'lower'),
            strip: (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([k, b]) => marks.has(k) && isBool(b)),
            fillGaps: isBool, maxGap: isNum(0, 120, true), minFrames: isNum(1, 120, true), clipColor: isStr(30), keepTemplate: isBool,
            guide: isBool, emphOn: isBool, emphColor: isHex, emphSize: isNum(0.5, 3), shadow: SHADOW,
            // Style settings (comp.js tuned): accent color, line box, Pop's growing, Spotlight dim, outline.
            accent: (v) => v === '' || isHex(v), box: { color: isHex, opacity: isNum(0, 100) }, pop: isBool, dim: isNum(0, 100),
            outline: { on: isBool, color: isHex, width: isNum(0, 0.5) },
            // Motion: fade (frames, rest opacity %) and tracking that opens up.
            fade: { on: isBool, in: isNum(0, 60, true), out: isNum(0, 60, true), rest: isNum(10, 100) },
            tracking: { on: isBool, from: isNum(50, 100), over: isNum(10, 100) }
        }
    };

    // Keeps only the keys that pass; a nested object is kept only if all its keys are present and valid.
    function pick(value, schema) {
        const out = {};
        if (!value || typeof value !== 'object') return out;
        for (const [key, test] of Object.entries(schema)) {
            if (!(key in value)) continue;
            if (typeof test === 'function') {
                if (test(value[key])) out[key] = clone(value[key]);
            } else {
                const nested = pick(value[key], test);
                if (Object.keys(nested).length === Object.keys(test).length) out[key] = nested;
            }
        }
        return out;
    }

    function pickStyle(s) {
        if (!s || typeof s !== 'object') return null;
        if (s.source === 'pack' && isStr(40)(s.id)) return { source: 'pack', id: s.id };
        if (s.source === 'bin' && isStr(200)(s.name)) return { source: 'bin', name: s.name, id: isStr(200)(s.id) ? s.id : '' };
        return null;
    }

    // Before 0.2.3, maxWords counted the whole caption; now it counts per line. Older two-line
    // rules get half the words per line (rounded up), so their captions stay the same size. Marked
    // perLine, so it happens once. One-line rules mean the same either way.
    function migrateRules(rules) {
        if (!rules || typeof rules !== 'object' || rules.perLine === true) return rules;
        const out = Object.assign({}, rules, { perLine: true });
        if (out.lines === 2 && Number.isInteger(out.maxWords)) out.maxWords = Math.max(1, Math.ceil(out.maxWords / 2));
        return out;
    }

    function cleanName(name) {
        return String(name == null ? '' : name).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
    }

    // ------------------------------------------------------------ model

    function capture(settings, name) {
        const look = clone(settings.look || {});
        for (const k of LOCAL_LOOK) delete look[k];
        return {
            kind: KIND, version: VERSION, name: cleanName(name), savedAt: new Date().toISOString(),
            style: pickStyle(settings.style), rules: pick(settings.rules, SCHEMA.rules), brush: pick(settings.brush, SCHEMA.brush), look: pick(look, SCHEMA.look)
        };
    }

    // New settings with the preset applied. App preferences (language, pin) and the track stay;
    // look keys the preset doesn't have fall back to the panel's defaults.
    function apply(settings, preset) {
        const next = clone(settings);
        if (preset.style) next.style = clone(preset.style);
        next.rules = Object.assign({}, next.rules, clone(preset.rules || {}));
        next.brush = Object.assign({}, next.brush, clone(preset.brush || {}));
        const kept = {};
        for (const k of LOCAL_LOOK) if (next.look && k in next.look) kept[k] = next.look[k];
        next.look = Object.assign(clone(preset.look || {}), kept);
        return next;
    }

    function readJson(text) {
        try {
            return JSON.parse(String(text).replace(/^\uFEFF/, ''));
        } catch (e) {
            throw new Error('not-json');
        }
    }

    function checkVersion(data) {
        if (!(typeof data.version === 'number' && data.version >= 1)) throw new Error('not-preset');
        if (data.version > VERSION) throw new Error('newer');
    }

    // A preset from parsed data. Throws on anything that isn't a Cap-o-matic preset; drops values
    // that are out of range or unknown. `pack` names the pack it came in, if any.
    function fromData(data) {
        if (!data || data.kind !== KIND) throw new Error('not-preset');
        checkVersion(data);
        const out = {
            kind: KIND, version: VERSION, name: cleanName(data.name) || 'Preset',
            savedAt: typeof data.savedAt === 'string' ? data.savedAt.slice(0, 40) : '',
            style: pickStyle(data.style), rules: migrateRules(pick(data.rules, SCHEMA.rules)), brush: pick(data.brush, SCHEMA.brush), look: pick(data.look, SCHEMA.look)
        };
        const pack = cleanName(data.pack);
        if (pack) {
            out.pack = pack;
            // Its name inside the pack, when a clash renamed it here: how a newer edition finds it.
            const item = cleanName(data.packItem);
            if (item && item !== out.name) out.packItem = item;
        }
        return out;
    }

    // Reads a preset file's text (one preset).
    function parse(text) {
        return fromData(readJson(text));
    }

    // Reads a file that holds one preset or a pack: { pack: { name, author } | null, presets,
    // skipped }. A pack's presets carry its name; entries that aren't presets are skipped.
    function parseFile(text) {
        const data = readJson(text);
        if (!data || data.kind !== PACK_KIND) return { pack: null, presets: [fromData(data)], skipped: 0 };
        checkVersion(data);
        if (!Array.isArray(data.presets)) throw new Error('not-preset');
        const name = cleanName(data.name) || 'Pack';
        const presets = [];
        let skipped = 0;
        for (const item of data.presets.slice(0, MAX_PACK)) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                skipped++;
                continue;
            }
            try {
                presets.push(Object.assign(fromData(Object.assign({ kind: KIND, version: data.version }, item)), { pack: name }));
            } catch (e) {
                if (e.message === 'newer') throw e;
                skipped++;
            }
        }
        if (!presets.length) throw new Error('not-preset');
        return { pack: { name, author: cleanName(data.author) }, presets, skipped: skipped + Math.max(0, data.presets.length - MAX_PACK) };
    }

    // A pack file's content from presets (built-ins lose their read-only marks).
    function makePack(name, presets, author) {
        return {
            kind: PACK_KIND, version: VERSION, name: cleanName(name) || 'Pack', author: cleanName(author), savedAt: new Date().toISOString(),
            presets: presets.map((p) => {
                const q = fromData(Object.assign({}, p, { kind: KIND, version: VERSION }));
                delete q.kind;
                delete q.version;
                delete q.pack;
                delete q.packItem;
                return q;
            })
        };
    }

    // Adds a pack's presets to a list. A preset already there from the same pack under the same name
    // in the pack is replaced (a newer edition), keeping the name it has here; any other clash gets a
    // free name.
    function addPack(list, presets) {
        let out = list.slice();
        const key = (x) => (x.packItem || x.name).toLocaleLowerCase();
        for (const p of presets) {
            const same = out.find((x) => x.pack && x.pack === p.pack && key(x) === key(p));
            if (same) {
                out = upsert(out.filter((x) => x !== same), Object.assign({}, p, same.name !== p.name ? { name: same.name, packItem: p.name } : {}));
                continue;
            }
            const name = freeName(out, p.name);
            out = upsert(out, Object.assign({}, p, name !== p.name ? { name, packItem: p.name } : {}));
        }
        return out;
    }

    function stringify(preset) {
        return JSON.stringify(preset, null, 1) + '\n';
    }

    // Adds or replaces by name (case-insensitive); returns a new list sorted by name.
    function upsert(list, preset) {
        const key = preset.name.toLocaleLowerCase();
        return list.filter((p) => p.name.toLocaleLowerCase() !== key).concat([preset])
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // A name not yet in the list: "Name", then "Name (2)", "Name (3)"…
    function freeName(list, name) {
        const taken = new Set(list.map((p) => p.name.toLocaleLowerCase()));
        if (!taken.has(name.toLocaleLowerCase())) return name;
        for (let n = 2; ; n++) {
            const next = `${name} (${n})`;
            if (!taken.has(next.toLocaleLowerCase())) return next;
        }
    }

    return { KIND, PACK_KIND, VERSION, MAX_PACK, capture, apply, parse, parseFile, makePack, addPack, stringify, upsert, freeName, cleanName, migrateRules };
});
