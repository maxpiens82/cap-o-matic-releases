// Stand-in for the Resolve bridge when the panel is opened in a plain browser (development only).
// Inside Resolve, preload.js defines window.cap first and this file does nothing.
(function (root) {
    if (root.cap) return;
    const ok = (data) => Promise.resolve({ ok: true, data });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // ?tour=en|es: the walkthrough (tour/) drives this panel. Its own saved state, demo speech in
    // that language, every bundled font "installed" and loaded as web fonts.
    const tour = (/[?&]tour=(en|es)\b/.exec(root.location ? root.location.search : '') || [])[1] || null;
    const prefix = tour ? 'cap-tour:' : 'cap-mock:';
    if (tour && root.document) {
        const link = root.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '../tour/fonts.css';
        root.document.head.appendChild(link);
    }
    const store = {
        get: (k, d) => {
            try {
                return JSON.parse(localStorage.getItem(prefix + k)) || d;
            } catch (e) {
                return d;
            }
        },
        set: (k, v) => {
            try {
                localStorage.setItem(prefix + k, JSON.stringify(v));
            } catch (e) {
                // Preview only.
            }
        }
    };
    const context = {
        product: 'DaVinci Resolve Studio (mock)',
        version: '21.1.0.17',
        project: { name: 'cap-o-matic test', id: 'mock-project' },
        timeline: {
            name: tour ? 'Interview' : 'Timeline 1', id: 'mock-timeline', fps: 30, dropFrame: false, start: 108000, end: 108932, width: 1080, height: 1920,
            markIn: null, markOut: null,
            video: [{ index: 1, name: 'Video 1', enabled: true, items: 1 }],
            audio: [{ index: 1, name: 'Dialogue', enabled: true, items: 1 }, { index: 2, name: 'Music', enabled: true, items: 1 }],
            subtitle: [{ index: 1, name: 'Subtitle 1', enabled: true, items: 3 }]
        }
    };
    async function fixtureWords() {
        if (tour) {
            const demo = await (await fetch(`../tour/words-${tour}.json`)).json();
            return { source: 'resolve', language: demo.language, words: demo.words };
        }
        const res = await fetch('../tests/fixtures/resolve-transcription-es.json');
        const data = await res.json();
        return { source: 'resolve', language: data.language, words: root.CapCore.transcript.fromResolve(data, 30) };
    }
    root.cap = {
        isMock: true,
        context: () => wait(250).then(() => ({ ok: true, data: context })),
        transcribe: async () => {
            await wait(tour ? 1400 : 2500);
            return { ok: true, data: await fixtureWords() };
        },
        existingTranscription: () => ok(null),
        readSubtitles: () => ok({
            source: 'subtitle', language: null,
            words: root.CapCore.transcript.fromCues([
                { start: 108011, end: 108126, text: 'No hay palabras para describir esta casa' },
                { start: 108126, end: 108196, text: 'un cuarto de manzana en Vicente López.' }
            ])
        }),
        // "Brand Caption Bold" is in the bin twice, as after importing the same template again.
        scanBin: () => wait(300).then(() => ({ ok: true, data: { found: true, items: [
            { name: 'Text+', id: 'a', key: 'Text+|00:00:05:00|1920x1080' },
            { name: 'Brand Caption Bold', id: 'b', key: 'Brand Caption Bold|00:00:05:00|1080x1920' },
            { name: 'Brand Caption Bold', id: 'c', key: 'Brand Caption Bold|00:00:05:00|1080x1920' }
        ] } })),
        settings: () => ok(store.get('settings', {
            language: tour || 'en', style: { source: 'pack', id: 'highlight' },
            rules: { maxWords: 4, maxChars: 28, lines: 1, sentenceBreak: true, pauseBreak: true, pauseSeconds: 0.4 }
        })),
        saveSettings: (s) => ok(store.set('settings', s)),
        // Montserrat and Poppins are "installed"; Anton isn't, to show the font warning.
        fonts: () => ok(['Arial', 'Montserrat ExtraBold', 'Montserrat Regular', 'Poppins Bold', 'Bebas Neue Regular', 'Archivo Black Regular']),
        // Anton is left out to show the "not installed" path; the rest of the bundled fonts are in.
        fontFamilies: () => ok(tour ? [
            { family: 'Anton', styles: ['Regular'] },
            { family: 'Archivo Black', styles: ['Regular'] },
            { family: 'Bangers', styles: ['Regular'] },
            { family: 'Bebas Neue', styles: ['Regular'] },
            { family: 'Inter', styles: ['SemiBold'] },
            { family: 'Montserrat', styles: ['Medium', 'ExtraBold'] },
            { family: 'Poppins', styles: ['Bold'] },
            { family: 'Space Mono', styles: ['Bold'] },
            { family: 'TikTok Sans', styles: ['SemiBold'] }
        ] : [
            { family: 'Archivo Black', styles: ['Regular'] },
            { family: 'Bangers', styles: ['Regular'] },
            { family: 'Inter', styles: ['Regular', 'SemiBold', 'Bold'] },
            { family: 'Space Mono', styles: ['Regular', 'Bold'] },
            { family: 'TikTok Sans', styles: ['Regular', 'SemiBold', 'Bold'] },
            { family: 'Arial', styles: ['Regular', 'Italic', 'Bold', 'Bold Italic', 'Black'] },
            { family: 'Bebas Neue', styles: ['Regular'] },
            { family: 'Georgia', styles: ['Regular', 'Italic', 'Bold', 'Bold Italic'] },
            { family: 'Impact', styles: ['Regular'] },
            { family: 'Montserrat', styles: ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'] },
            { family: 'Poppins', styles: ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'] },
            { family: 'Segoe UI', styles: ['Light', 'Regular', 'Semibold', 'Bold', 'Black'] }
        ]),
        presets: () => ok(store.get('presets', [])),
        savePresets: (list) => ok(store.set('presets', list)),
        exportPreset: (p) => {
            root.__mockPresetExport = root.CapCore.presets.stringify(p);
            return ok(`Documents\\${p.name}.json`);
        },
        exportPack: (list) => {
            root.__mockPackExport = root.CapCore.presets.stringify(root.CapCore.presets.makePack('My presets', list));
            return ok('Documents\\My presets.json');
        },
        // Imports whatever __mockPresetFile holds (text: a preset or a pack), or a sample preset.
        importPreset: () => {
            try {
                const text = root.__mockPresetFile || JSON.stringify({ kind: 'cap-o-matic/preset', version: 1, name: 'Sample import', style: { source: 'pack', id: 'ribbon' }, look: { size: 110, caseMode: 'upper' } });
                return ok(root.CapCore.presets.parseFile(text));
            } catch (e) {
                return Promise.resolve({ ok: false, error: 'That file is not a Cap-o-matic preset.', code: 'presetNotPreset' });
            }
        },
        timelineData: () => ok(store.get('timeline', null)),
        saveTimelineData: (p, t, d) => ok(store.set('timeline', d)),
        // Pretends Resolve is playing: the playhead creeps forward from wherever it was set.
        playhead: () => {
            root.__mockPlayhead = (root.__mockPlayhead || 108000) + 6;
            if (root.__mockPlayhead > context.timeline.end) root.__mockPlayhead = context.timeline.start;
            return ok(root.__mockPlayhead);
        },
        setPlayhead: (frame) => {
            root.__mockPlayhead = frame;
            return ok(true);
        },
        exportSrt: (text, name) => {
            root.__mockSrt = text;
            return ok(`Documents\\${name}.srt`);
        },
        captionTracks: () => ok([
            { index: 1, name: 'Video 1', ours: 0, others: 1 },
            { index: 2, name: 'Cap-o-matic', ours: root.__mockPlaced || 0, others: 0 }
        ]),
        deliver: async (opts) => {
            root.__mockCancel = false;
            const n = opts.clips.length;
            for (let i = 1; i <= n; i++) {
                if (root.__mockCancel) return { ok: true, data: { cancelled: true, track: 2 } };
                await wait(60);
                if (root.__mockProgress) root.__mockProgress({ done: i, total: n });
            }
            root.__mockPlaced = n;
            root.__mockLastDeliver = opts;
            return { ok: true, data: { placed: n, track: 2, ids: opts.clips.map((c, i) => `mock-${i}`), newTrack: opts.track === 'new', replaced: 0 } };
        },
        deliverTest: (opts) => wait(300).then(() => {
            root.__mockLastTest = opts;
            return { ok: true, data: { track: 2 } };
        }),
        // A tiny dictionary: the demo speech plus the words a real check would offer.
        spellcheck: (texts, lang, userWords) => {
            const base = 'fuimos 25657\nalquilamos 577\nalquilaremos 162\nalquilarlos 90\nwatching 73700\ncaptions 1057';
            const dict = root.CapCore.spell.dictionary(base + '\n' + texts.map((x) => root.CapCore.spell.parts(x).core.toLowerCase() + ' 1000').filter((x) => !/fuiimos|alquilarmos|watchng/.test(x)).join('\n'));
            return ok(root.CapCore.spell.check(texts.map((text) => ({ text })), dict, { lang, userWords }));
        },
        undoDelivery: (opts) => wait(300).then(() => {
            root.__mockPlaced = 0;
            return ok({ removed: opts.ids.length, missing: 0, trackRemoved: !!opts.newTrack });
        }),
        modify: async (opts) => {
            const n = opts.captions.length;
            for (let i = 1; i <= n; i++) {
                await wait(30);
                if (root.__mockProgress) root.__mockProgress({ done: i, total: n });
            }
            return { ok: true, data: { updated: n, track: opts.track } };
        },
        // __mockRender({ state: 'start', guide: true }) from the console shows the render warning.
        guide: (want) => {
            root.__mockGuide = !!want;
            return ok({ shown: !!want });
        },
        onRender: (cb) => {
            root.__mockRender = cb;
        },
        setOnTop: () => ok(true),
        cancel: () => {
            root.__mockCancel = true;
            return ok(true);
        },
        onProgress: (cb) => {
            root.__mockProgress = cb;
        },
        openLogs: () => ok(true),
        openGuide: () => ok(true),
        // The browser's own EyeDropper stands in for the panel's screen picker (src/picker.js).
        pickColor: async () => {
            if (!root.EyeDropper) return ok(null);
            try {
                return ok((await new root.EyeDropper().open()).sRGBHex.toUpperCase());
            } catch (e) {
                return ok(null);
            }
        },
        appInfo: () => ok({ version: tour ? '0.2.1' : '0.1.0', dataDir: '%APPDATA%\\Cap-o-matic' }),
        // Updates as an installed copy sees them; 0.2.0 is "available".
        updateState: () => ok({ version: tour ? '0.2.1' : '0.1.0', installed: true, pending: root.__mockPending || null, uninstalling: false }),
        checkUpdate: () => wait(600).then(() => ok({ current: tour ? '0.2.1' : '0.1.0', latest: tour ? '0.2.2' : '0.2.0', newer: !root.__mockPending, date: '2026-10-14',
            notes: { en: '12 built-in presets with their fonts, updates from the panel.', es: '12 presets incluidos con sus fuentes, actualizaciones desde el panel.' } })),
        installUpdate: () => wait(1200).then(() => {
            root.__mockPending = '0.2.0';
            return ok({ version: '0.2.0', fonts: ['Anton Regular'] });
        }),
        uninstall: () => ok(true)
    };
})(this);
