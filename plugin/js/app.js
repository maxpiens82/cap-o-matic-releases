// Cap-o-matic panel. Renders look A and drives the Style and Transcribe steps.
(function () {
    'use strict';

    const { h, icon } = window.dom;
    const { t } = window.i18n;
    const Core = window.CapCore;
    const api = window.cap;

    const STEPS = ['style', 'transcribe', 'edit', 'deliver'];
    const EMPTY_DATA = () => ({ transcript: null, captions: [] });

    const S = {
        screen: 'style',
        connected: null,
        error: null,
        ctx: null,
        key: null,
        settings: null,
        appInfo: { version: '', dataDir: '' },
        data: EMPTY_DATA(),
        existing: null,
        source: 'audio',
        audioTracks: null,
        subTrack: 1,
        busy: null,
        bin: null,
        binLoading: false,
        filter: 'All',
        query: '',
        message: null,
        editMode: 'group',
        sel: -1,
        playIdx: -1,
        hist: { past: [], future: [] },
        confirmRebuild: false,
        deliverMode: 'create',
        pvIdx: null,
        tracks: undefined,
        families: undefined,
        modTrack: null,
        modStyle: null,
        progress: null,
        guideArmed: false,
        renderWarn: false
    };

    const $ = (id) => document.getElementById(id);

    // Errors with a code show their translated message ("err.<code>"), others the English text.
    async function call(name, ...args) {
        const res = await api[name](...args);
        if (!res || !res.ok) {
            const key = res && res.code ? `err.${res.code}` : null;
            throw new Error(key && window.i18n.has(key) ? t(key, res.vars || undefined) : res ? res.error : t('err.noAnswer'));
        }
        return res.data;
    }

    function flash(text, err) {
        S.message = text ? { text, err: !!err } : null;
        renderFooter();
    }

    function timeline() {
        return S.ctx && S.ctx.timeline;
    }

    function fps() {
        return timeline() ? timeline().fps : 30;
    }

    function tc(frame) {
        return Core.timecode.fromFrames(frame, fps(), timeline() && timeline().dropFrame);
    }

    function duration(frames) {
        const s = Math.max(0, Math.round(frames / fps()));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    // ------------------------------------------------------------ persistence

    function saveSettings() {
        call('saveSettings', S.settings).catch((e) => flash(e.message, true));
    }

    function saveData() {
        if (!S.key) return;
        const [pid, tid] = S.key.split('|');
        call('saveTimelineData', pid, tid, S.data).catch((e) => flash(e.message, true));
    }

    async function loadTimelineData() {
        S.data = EMPTY_DATA();
        S.existing = null;
        S.audioTracks = null;
        S.hist = { past: [], future: [] };
        S.sel = -1;
        S.playIdx = -1;
        S.tracks = undefined;
        S.pvIdx = null;
        S.modStyle = null;
        if (!S.key) return;
        const [pid, tid] = S.key.split('|');
        try {
            const saved = await call('timelineData', pid, tid);
            if (saved) S.data = Object.assign(EMPTY_DATA(), saved);
        } catch (e) {
            flash(e.message, true);
        }
        if (!S.data.transcript) {
            try {
                S.existing = await call('existingTranscription');
            } catch (e) {
                S.existing = null;
            }
        }
    }

    async function refresh(quiet) {
        if (S.busy) return;
        if (!quiet) {
            S.connected = null;
            renderHeader();
        }
        try {
            S.ctx = await call('context');
            S.connected = true;
            S.error = null;
            const tl = S.ctx.timeline;
            const key = tl && S.ctx.project ? `${S.ctx.project.id}|${tl.id}` : null;
            if (key !== S.key) {
                S.key = key;
                S.bin = null;
                await loadTimelineData();
            }
        } catch (e) {
            S.connected = false;
            S.error = e.message;
        }
        render();
        // Follows timeline switches and keeps the guide as long as the timeline.
        syncGuide(false);
    }

    // ------------------------------------------------------------ small widgets

    // options: [value, text, disabled, title] (the last two optional).
    function seg(options, value, onPick, label) {
        return h('div', { class: 'seg', role: 'group', 'aria-label': label || null },
            options.map(([v, text, disabled, title]) => h('button', {
                type: 'button',
                class: v === value ? 'on' : '',
                'aria-pressed': String(v === value),
                disabled: !!disabled,
                title: title || null,
                onclick: () => onPick(v)
            }, text)));
    }

    // options: [value, text] pairs, or { group, options } for a labelled group of them.
    function select(id, options, value, onChange) {
        const opt = ([v, text]) => h('option', { value: String(v) }, text);
        const el = h('select', { id, class: 'field', onchange: (e) => onChange(e.target.value) },
            options.map((o) => (Array.isArray(o) ? opt(o) : h('optgroup', { label: o.group }, o.options.map(opt)))));
        el.value = String(value);
        return el;
    }

    function slider(id, label, min, max, step, value, onInput, onCommit) {
        const out = h('span', { class: 'val' }, String(value));
        const input = h('input', {
            id, type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
            oninput: (e) => {
                out.textContent = e.target.value;
                onInput(Number(e.target.value));
            },
            onchange: () => {
                lookDragging = false;
                if (onCommit) onCommit();
            }
        });
        return h('div', { class: 'row slider' }, h('label', { class: 'lbl', for: id }, label), input, out);
    }

    // An angle on a compass, as Fusion counts them: 0° right, 90° up. Drag the needle round (Shift
    // snaps to 15°) or use the arrow keys (1°, Shift 15°); like a slider, onInput follows and
    // onCommit runs on release. inward: the arrow points at the centre (where a word comes from)
    // rather than out to the rim (where it goes).
    function angleDial(id, label, value, onInput, onCommit, inward) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = (tag, attrs) => {
            const el = document.createElementNS(NS, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
            return el;
        };
        const ticks = [0, 90, 180, 270].map((a) => {
            const c = Math.cos((a * Math.PI) / 180);
            const s = Math.sin((a * Math.PI) / 180);
            return svg('line', { class: 'tick', x1: 24 + 17 * c, y1: 24 - 17 * s, x2: 24 + 20 * c, y2: 24 - 20 * s });
        });
        const needle = svg('line', { class: 'needle', x1: 24, y1: 24, x2: 24, y2: 24 });
        const head = svg('path', { class: 'head', d: '' });
        const pic = svg('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true' });
        pic.append(svg('circle', { class: 'ring', cx: 24, cy: 24, r: 20 }), ...ticks, needle, head, svg('circle', { class: 'hub', cx: 24, cy: 24, r: 2.2 }));
        const out = h('span', { class: 'val' }, `${value}°`);
        let v = value;
        const draw = () => {
            const r = (v * Math.PI) / 180;
            const c = Math.cos(r);
            const s = Math.sin(r);
            const rim = [24 + 18 * c, 24 - 18 * s];
            const tip = inward ? [24 + 5 * c, 24 - 5 * s] : rim;
            const d = inward ? -1 : 1;
            needle.setAttribute('x1', inward ? rim[0] : 24);
            needle.setAttribute('y1', inward ? rim[1] : 24);
            needle.setAttribute('x2', tip[0]);
            needle.setAttribute('y2', tip[1]);
            // The arrowhead: back along the needle, spread either side of it.
            const back = [tip[0] - 6 * d * c, tip[1] + 6 * d * s];
            head.setAttribute('d', `M${tip[0]} ${tip[1]}L${back[0] - 3.5 * s} ${back[1] - 3.5 * c}L${back[0] + 3.5 * s} ${back[1] + 3.5 * c}Z`);
            out.textContent = `${v}°`;
            dial.setAttribute('aria-valuenow', String(v));
            dial.setAttribute('aria-valuetext', `${v}°`);
        };
        const set = (next) => {
            const a = ((Math.round(next) % 360) + 360) % 360;
            if (a === v) return;
            v = a;
            draw();
            onInput(v);
        };
        const angleAt = (e) => {
            const b = pic.getBoundingClientRect();
            const a = (Math.atan2(b.top + b.height / 2 - e.clientY, e.clientX - b.left - b.width / 2) * 180) / Math.PI;
            return e.shiftKey ? Math.round(a / 15) * 15 : a;
        };
        let held = false;
        const release = () => {
            if (!held) return;
            held = false;
            dial.classList.remove('held');
            lookDragging = false;
            if (onCommit) onCommit();
        };
        const dial = h('div', {
            id, class: 'dial', role: 'slider', tabindex: '0', title: t('whip.dialTitle'), 'aria-label': label,
            'aria-valuemin': '0', 'aria-valuemax': '359',
            onpointerdown: (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                dial.focus();
                dial.setPointerCapture(e.pointerId);
                held = true;
                dial.classList.add('held');
                set(angleAt(e));
            },
            onpointermove: (e) => {
                if (held) set(angleAt(e));
            },
            onpointerup: release,
            onpointercancel: release,
            onkeydown: (e) => {
                const step = e.shiftKey ? 15 : 1;
                const by = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 15, PageDown: -15 }[e.key];
                if (by == null) return;
                e.preventDefault();
                set(e.shiftKey ? Math.round((v + by) / 15) * 15 : v + by);
                lookDragging = false;
                if (onCommit) onCommit();
            }
        }, pic);
        draw();
        return h('div', { class: 'row slider' }, h('span', { class: 'lbl' }, label), h('div', { class: 'dial-cell' }, dial), out);
    }

    function checkbox(id, label, checked, onChange, extra) {
        return h('div', { class: 'check' },
            h('input', { id, type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) }),
            h('label', { for: id }, label),
            extra || null);
    }

    function section(text) {
        return h('h2', { class: 'section' }, text);
    }

    function note(content, kind) {
        return h('div', { class: 'note' + (kind ? ' ' + kind : '') }, content);
    }

    // ------------------------------------------------------------ header, rail, footer

    function renderHeader() {
        const tl = timeline();
        $('tlInfo').textContent = tl ? `${tl.name} · ${Number(tl.fps.toFixed(3))} fps` : '';
        $('tlInfo').title = $('tlInfo').textContent; // the full name when it's cut short
        $('connDot').className = 'dot' + (S.connected === true ? ' ok' : S.connected === false ? ' bad' : '');
        // Connected is the normal state, so it's just the green dot; problems get words.
        $('connText').textContent = S.connected === true ? '' : S.connected === false ? t('conn.bad') : t('conn.loading');
        $('connBtn').title = S.connected === false ? `${S.error || t('conn.bad')} · ${t('conn.reload')}` : `${t('conn.ok')} · ${t('conn.reload')}`;
        $('connBtn').setAttribute('aria-label', $('connBtn').title);
        const onTop = S.settings.onTop !== false;
        const pin = $('pinBtn');
        pin.className = 'pin' + (onTop ? ' on' : '');
        pin.title = onTop ? t('pin.on') : t('pin.off');
        pin.setAttribute('aria-label', pin.title);
        pin.setAttribute('aria-pressed', String(onTop));
        if (!pin.firstChild) pin.appendChild(icon('pin', 16));
        // A newer version (found when the panel opened, or by Check for updates), until it's installed.
        const u = S.upd || {};
        const newer = u.state === 'checked' && u.info && u.info.newer ? u.info.latest : null;
        const upd = $('updBtn');
        upd.hidden = !newer;
        if (newer) {
            upd.textContent = t('up.pill', { v: newer });
            upd.title = t('up.pillTitle', { v: newer });
            upd.onclick = () => {
                go('settings');
                const block = $('updAvail');
                if (block) block.scrollIntoView({ block: 'center' });
            };
        }
    }

    function renderRail() {
        const item = (key) => h('button', {
            type: 'button',
            class: 'nav' + (S.screen === key ? ' on' : ''),
            'aria-current': S.screen === key ? 'page' : null,
            onclick: () => go(key)
        }, icon(key), h('span', null, t('nav.' + key)));
        $('rail').setAttribute('aria-label', t('nav.steps'));
        $('rail').replaceChildren(...STEPS.map(item), h('div', { class: 'spacer' }), item('presets'), item('settings'));
    }

    function primary(text, onclick, disabled) {
        return h('button', { type: 'button', class: 'btn primary', disabled: !!disabled, onclick }, text);
    }

    function renderFooter() {
        let msg = '';
        let actions = [];
        const caps = S.data.captions.length;
        if (S.screen === 'style') {
            msg = t('style.selected', { name: currentStyleName() });
            actions = [primary(`${t('ed.next')}: ${t('nav.transcribe')}`, () => go('transcribe'))];
        } else if (S.screen === 'transcribe') {
            const words = rangeWords();
            msg = words.length ? `${t('tr.words', { n: words.length })} · ${t('tr.captions', { n: buildCaptions(words).length })}` : t('tr.needWords');
            actions = [primary(S.confirmRebuild ? t('tr.replace') : t('tr.build'), buildNow, !words.length || !!S.busy)];
        } else if (S.screen === 'edit') {
            msg = t('tr.captions', { n: caps });
            actions = [
                h('button', { type: 'button', class: 'btn ghost', disabled: !caps, title: t('ed.exportTitle'), onclick: exportSrt }, t('ed.export')),
                primary(t('ed.next'), () => go('deliver'), !caps)
            ];
        } else if (S.screen === 'deliver') {
            const f = deliverFooter(caps);
            if (f.msg == null) {
                $('footer').replaceChildren(h('div', { class: 'bar' }, f.actions));
                return;
            }
            msg = f.msg;
            actions = f.actions;
        } else {
            msg = t('se.saved');
        }
        if (S.message) msg = S.message.text;
        $('footer').replaceChildren(h('div', { class: 'bar' },
            h('span', { class: 'msg' + (S.message && S.message.err ? ' err' : ''), title: msg }, msg),
            actions));
    }

    function go(screen) {
        S.screen = screen;
        S.message = null;
        S.confirmRebuild = false;
        if (screen === 'deliver') S.tracks = undefined;
        render();
        $('screen').scrollTop = 0;
        if (screen === 'deliver' && !S.guideArmed) {
            S.guideArmed = true;
            syncGuide(true);
        }
    }

    function render() {
        renderHeader();
        renderRail();
        renderScreen();
        renderFooter();
    }

    function renderScreen() {
        const views = { style: viewStyle, transcribe: viewTranscribe, edit: viewEdit, deliver: viewDeliver, presets: () => h('div', null, viewPresets()), settings: viewSettings };
        pvTimers.forEach(clearInterval);
        pvTimers = [];
        const screen = $('screen');
        const top = screen.scrollTop;
        screen.replaceChildren(views[S.screen]());
        screen.scrollTop = top;
        screen.classList.toggle('scrolled', screen.scrollTop > 0);
    }

    // ------------------------------------------------------------ Style

    // A preset's name as shown: built-ins in the panel's language.
    function presetName(p) {
        return Core.builtins.nameOf(p, S.settings.language);
    }

    function currentStyleName() {
        const st = S.settings.style;
        if (st.source === 'bin') return st.name || '—';
        const found = window.STARTER_STYLES.find((s) => s.id === st.id);
        const preset = S.settings.preset && Core.builtins.BUILTINS.find((p) => p.id === S.settings.preset);
        if (preset && found) return `${presetName(preset)} (${found.name})`;
        // Whip without a preset: which of its patterns.
        if (found && found.whip) return `${found.name} · ${t('whip.' + Core.whip.settings(look().whip).pattern)}`;
        return found ? found.name : '—';
    }

    function setStyle(style) {
        S.settings.style = style;
        delete S.settings.preset;
        saveSettings();
        renderScreen();
        renderFooter();
    }

    function viewStyle() {
        const st = S.settings.style;
        const source = S.styleSource || st.source;
        return h('div', null,
            h('div', { class: 'section-row' },
                section(t('style.title')),
                seg([['pack', t('style.pack')], ['bin', t('style.bin')]], source, (v) => {
                    S.styleSource = v;
                    renderScreen();
                })),
            source === 'pack' ? viewPack() : viewBin());
    }

    function viewPack() {
        ensureFamilies();
        const presetGrid = h('div', { class: 'tiles' });
        const whipGrid = h('div', { class: 'tiles' });
        const grid = h('div', { class: 'tiles' });
        const presetHead = h('p', { class: 'sub-head' }, t('style.presets'));
        // Whip's presets after the others, under their own heading: twelve patterns of one style.
        const whipHead = h('p', { class: 'sub-head' }, t('style.whipPresets'));
        const baseHead = h('p', { class: 'sub-head' }, t('style.bases'));
        const empty = h('p', { class: 'hint', hidden: true }, t('style.none'));
        const fill = () => {
            const q = S.query.trim().toLowerCase();
            const match = (styleId, name) => {
                const s = window.STARTER_STYLES.find((x) => x.id === styleId);
                return !!s && (S.filter === 'All' || s.tags.includes(S.filter)) && (!q || name.toLowerCase().includes(q));
            };
            const found = Core.builtins.BUILTINS.filter((p) => match(p.style.id, presetName(p)));
            const presets = found.filter((p) => p.style.id !== 'whip');
            const whips = found.filter((p) => p.style.id === 'whip');
            const list = window.STARTER_STYLES.filter((s) => match(s.id, s.name));
            presetGrid.replaceChildren(...presets.map(presetTile));
            whipGrid.replaceChildren(...whips.map(presetTile));
            grid.replaceChildren(...list.map(tile));
            requestAnimationFrame(() => fitTiles(presetGrid));
            presetHead.hidden = presetGrid.hidden = !presets.length;
            whipHead.hidden = whipGrid.hidden = !whips.length;
            baseHead.hidden = grid.hidden = !list.length;
            empty.hidden = found.length + list.length > 0;
        };
        const chips = h('div', { class: 'chips' }, window.STYLE_FILTERS.map((f) => h('button', {
            type: 'button',
            class: 'chip' + (S.filter === f ? ' on' : ''),
            'aria-pressed': String(S.filter === f),
            onclick: () => {
                S.filter = f;
                renderScreen();
            }
        }, t('tag.' + f))));
        fill();
        return h('div', null,
            h('div', { class: 'pad stack', style: 'padding-bottom:4px' },
                h('label', { class: 'search' }, icon('search', 14),
                    h('input', {
                        type: 'search', value: S.query, placeholder: t('style.search'), 'aria-label': t('style.search'),
                        oninput: (e) => {
                            S.query = e.target.value;
                            fill();
                        }
                    })),
                chips),
            presetHead, presetGrid, whipHead, whipGrid, baseHead, grid, empty);
    }

    // Shrinks a card's sample line that is wider than its stage (Whip's stills fit themselves).
    function fitTiles(root) {
        for (const stage of root.querySelectorAll('.stage')) {
            const line = stage.firstElementChild;
            const room = stage.clientWidth - 12;
            if (line && line.tagName !== 'CANVAS' && line.offsetWidth > room) line.style.fontSize = `${((parseFloat(line.style.fontSize) * room) / line.offsetWidth).toFixed(2)}px`;
        }
    }

    // The sample line in a case mode: "MIRA ESTA PARTE", "mira esta parte" or "Mira esta parte".
    function sampleWords(caseMode) {
        const words = t('style.sample').split('|').map((w) => w.toLocaleLowerCase());
        if (caseMode === 'upper') return words.map((w) => w.toLocaleUpperCase());
        if (caseMode !== 'lower') words[0] = words[0].charAt(0).toLocaleUpperCase() + words[0].slice(1);
        return words;
    }

    // A built-in preset as a gallery card, painted like the Deliver preview: its font, colours,
    // outline, box and shadow on its base style. Choosing it applies the whole preset.
    function presetTile(p) {
        const st = window.STARTER_STYLES.find((x) => x.id === p.style.id);
        const L = Object.assign({}, DEFAULT_LOOK, p.look);
        if (st.whip) return whipPresetTile(p, st, L);
        const has = installed(L.font);
        const fStyle = fontStyleFor(L.font, L.fontStyle);
        // Sized as the preset sits in the frame, relative to the starter cards (Montserrat at 137);
        // fitTiles shrinks a line too wide for its card. Shadows scaled to match.
        const ms = lineOf('Montserrat', 'ExtraBold');
        const line = lineOf(L.font, fStyle);
        const px = (14 * ms * Math.max(0.95, Math.min(1.4, L.size / 137))) / line;
        const paintLook = lookPaint(L, st, false, (px * line) / (Core.fonts.LINE_PER_SIZE * (L.size / 1000) * 1080), line, true);
        const one = p.rules.maxWords === 1;
        const all = sampleWords(L.caseMode);
        // Typewriter: the line caught mid-word, as on its starter card.
        const words = one ? [all[1]] : st.typing ? [all[0], all[1].slice(0, Math.ceil(all[1].length / 2))] : all;
        const active = one ? 0 : 1;
        const on = S.settings.preset === p.id;
        const spans = words.map((w) => h('span', null, w));
        // Moving (cardMotion): the spoken word walks the line, painted as the Deliver preview paints it.
        const moving = lookPaint(L, st, false, (px * line) / (Core.fonts.LINE_PER_SIZE * (L.size / 1000) * 1080), line, false);
        const paint = (a) => spans.forEach((sp, i) => {
            const P = a < 0 ? paintLook : moving;
            const now = a < 0 ? active : a;
            sp.style.cssText = P.shade(P.word(i, now) + fontDecl(L.font, fStyle), i === now);
        });
        paint(-1);
        const btn = h('button', {
            type: 'button', class: 'tile' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-preset': p.id,
            title: has ? '' : t('de.fontNotInstalled', { font: L.font }),
            onclick: () => applyPreset(p)
        },
        h('span', { class: 'stage', style: `background:${st.stage}` },
            h('span', { style: paintLook.line + `font-size:${px.toFixed(2)}px;` }, ...spans)),
        h('span', { class: 'tile-meta' }, h('span', { class: 'n' }, presetName(p)),
            h('span', { class: 't' + (has ? '' : ' missing') }, has ? `${st.name} · ${L.font}` : t('de.fontNotInstalled', { font: L.font }))));
        // Typewriter's card shows a line caught mid-word; it stays a still.
        return st.typing ? btn : wordCycle(btn, words.length, paint);
    }

    // A Whip preset's card: a still of its pattern placing the sample words in its font, colours
    // and finish, the middle word painted with its brush (one word for a pattern that holds one).
    function whipPresetTile(p, st, L) {
        const font = L.font || 'Montserrat';
        const has = installed(font);
        const pattern = Core.whip.settings(L.whip).pattern;
        const all = sampleWords(L.caseMode);
        const b = p.brush || {};
        const emph = b.color ? { color: b.color, size: b.size || 1, font: b.font || '', fontStyle: b.fontStyle || '' } : null;
        const words = Core.whip.PATTERNS[pattern].maxWords < 3
            ? [{ text: all[1], emph }]
            : all.map((text, i) => ({ text, emph: i === 1 ? emph : null }));
        const on = S.settings.preset === p.id;
        const still = whipStill(L, words);
        return cardMotion(h('button', {
            type: 'button', class: 'tile' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-preset': p.id,
            title: has ? '' : t('de.fontNotInstalled', { font }),
            onclick: () => applyPreset(p)
        },
        h('span', { class: 'stage', style: `background:${st.stage}` }, still),
        h('span', { class: 'tile-meta' }, h('span', { class: 'n' }, presetName(p)),
            h('span', { class: 't' + (has ? '' : ' missing') }, has ? `${st.name} · ${font}` : t('de.fontNotInstalled', { font })))), still.play, still.pause);
    }

    function tile(s) {
        const st = S.settings.style;
        const on = st.source === 'pack' && st.id === s.id && !S.settings.preset;
        const word = (text, css) => h('span', { style: css }, text);
        // Whip: the sample words scattered at different sizes, as its Constellation pattern has them.
        const whipLook = () => Object.assign({}, DEFAULT_LOOK, { whip: Object.assign({}, Core.whip.DEFAULTS, { pattern: 'constellation' }) });
        const sample = t('style.sample').split('|');
        const still = s.whip ? whipStill(whipLook(), sampleWords('upper').map((text, i) => ({ text, emph: i === 1 ? { color: '#FFD93B', size: 1 } : null }))) : null;
        const spans = s.whip ? [] : sample.map((w, i) => (s.typing
            // Typewriter: the line caught mid-word.
            ? word(i === 1 ? w.slice(0, Math.ceil(w.length / 2)) : w, s.base + (i === 2 ? 'visibility:hidden;' : ''))
            : word(w, i === 1 ? s.act : s.base)));
        const btn = h('button', {
            type: 'button', class: 'tile' + (on ? ' on' : ''), 'aria-pressed': String(on),
            onclick: () => setStyle({ source: 'pack', id: s.id })
        },
        h('span', { class: 'stage', style: `background:${s.stage}` }, still || h('span', { style: 'display:inline-block;' + (s.line || '') }, ...spans)),
        h('span', { class: 'tile-meta' }, h('span', { class: 'n' }, s.name), h('span', { class: 't' }, s.tags.map((tag) => t('tag.' + tag)).join(' · '))));
        if (still) return cardMotion(btn, still.play, still.pause);
        if (s.typing) return btn;
        // The spoken word walks the line; Pop hides the words not yet spoken.
        return wordCycle(btn, sample.length, (a) => spans.forEach((sp, i) => {
            const now = a < 0 ? 1 : a;
            sp.style.cssText = (i === now ? s.act : s.base) + (a >= 0 && s.id === 'pop' && i > a ? 'visibility:hidden;' : '');
        }));
    }

    async function scanBin() {
        S.binLoading = true;
        renderScreen();
        try {
            S.bin = await call('scanBin');
        } catch (e) {
            S.bin = null;
            flash(e.message, true);
        }
        S.binLoading = false;
        renderScreen();
    }

    // Bin templates for the lists. Copies of one template (same name, length and resolution) show
    // once with a count, unless Settings turns that off; ids keeps every copy.
    function binTemplates() {
        const items = (S.bin && S.bin.items) || [];
        const groups = new Map();
        for (const i of items) {
            const key = S.settings.dedupeTemplates === false ? i.id : i.key || i.id;
            const g = groups.get(key);
            if (g) g.ids.push(i.id);
            else groups.set(key, Object.assign({}, i, { ids: [i.id] }));
        }
        return [...groups.values()];
    }

    function viewBin() {
        if (!S.bin && !S.binLoading && S.connected) setTimeout(scanBin, 0);
        const st = S.settings.style;
        const head = h('div', { class: 'list-item', style: 'cursor:default' },
            h('span', { style: 'flex:1' }, S.bin && S.bin.found ? t('style.binFound', { name: 'Cap-o-matic', count: binTemplates().length }) : 'Cap-o-matic'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('style.rescan'), title: t('style.rescan'), onclick: scanBin }, icon('refresh', 15)));
        let body;
        if (S.binLoading || !S.bin) body = h('div', { class: 'busy pad' }, h('span', { class: 'spinner' }));
        else if (!S.bin.found) body = note(t('style.binMissing', { name: 'Cap-o-matic' }));
        else if (!S.bin.items.length) body = note(t('style.binEmpty', { name: 'Cap-o-matic' }));
        else {
            const list = binTemplates();
            const byId = list.some((g) => g.ids.includes(st.id));
            body = h('div', { class: 'stack' }, list.map((g) => {
                const on = st.source === 'bin' && (byId ? g.ids.includes(st.id) : st.name === g.name);
                return h('button', {
                    type: 'button', class: 'list-item' + (on ? ' on' : ''), 'aria-pressed': String(on),
                    onclick: () => setStyle({ source: 'bin', name: g.name, id: g.id })
                }, h('span', { class: 'radio' }), h('span', { style: 'flex:1' }, g.name),
                g.ids.length > 1 ? h('span', { class: 'hint', title: t('style.copies', { n: g.ids.length }) }, '×' + g.ids.length) : null);
            }));
        }
        return h('div', { class: 'pad stack' }, head, body, h('p', { class: 'hint', style: 'margin:4px 0 0' }, t('style.binHelp')));
    }

    // ------------------------------------------------------------ Transcribe

    function words() {
        return (S.data.transcript && S.data.transcript.words) || [];
    }

    function rangeWords() {
        const tl = timeline();
        if (!tl) return words();
        return Core.transcript.inRange(words(), tl.markIn, tl.markOut);
    }

    function buildCaptions(list) {
        return Core.phrases.build(list, S.settings.rules, fps());
    }

    function selectedTracks() {
        const tl = timeline();
        if (!S.audioTracks) S.audioTracks = new Set((tl ? tl.audio : []).map((a) => a.index));
        return S.audioTracks;
    }

    function setTranscript(tr) {
        S.data.transcript = Object.assign({}, tr, { at: new Date().toISOString() });
        S.existing = null;
        saveData();
        render();
    }

    async function doTranscribe() {
        const tracks = [...selectedTracks()].sort((a, b) => a - b);
        S.busy = { since: Date.now() };
        S.message = null;
        render();
        const timer = setInterval(() => {
            const el = $('busyText');
            if (el) el.textContent = t('tr.busy', { s: Math.round((Date.now() - S.busy.since) / 1000) });
        }, 1000);
        try {
            setTranscript(await call('transcribe', { audioTracks: tracks }));
        } catch (e) {
            flash(e.message, true);
        } finally {
            clearInterval(timer);
            S.busy = null;
            render();
        }
    }

    async function readSubtitleTrack() {
        S.busy = { since: Date.now() };
        render();
        try {
            setTranscript(await call('readSubtitles', S.subTrack));
        } catch (e) {
            flash(e.message, true);
        } finally {
            S.busy = null;
            render();
        }
    }

    function loadSrt(file) {
        const tl = timeline();
        if (!file || !tl) return;
        const reader = new FileReader();
        reader.onload = () => {
            const cues = Core.srt.parse(String(reader.result), tl.fps, tl.start);
            if (!cues.length) {
                flash(`${file.name}: no subtitles found`, true);
                return;
            }
            setTranscript({ source: 'srt', language: null, file: file.name, words: Core.transcript.fromCues(cues) });
        };
        reader.readAsText(file);
    }

    function transcriptSummary() {
        const tr = S.data.transcript;
        if (!tr) return null;
        const when = tr.at ? new Date(tr.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
        const from = tr.source === 'srt' ? tr.file : tr.source === 'subtitle' ? t('tr.track') : (tr.language || '').toUpperCase();
        return note([icon('check', 14), ' ', t('tr.done', { words: tr.words.length, lang: from || '—', when })], 'ok');
    }

    function viewTranscribe() {
        const tl = timeline();
        if (!tl) return h('div', { class: 'empty' }, h('strong', null, S.connected === false ? t('conn.bad') : ''), t('err.noTimeline'));
        const parts = [
            section(t('tr.source')),
            h('div', { class: 'pad' }, seg([['audio', t('tr.audio')], ['track', t('tr.track')], ['srt', t('tr.srt')]], S.source, (v) => {
                S.source = v;
                renderScreen();
            }, t('tr.source')))
        ];

        if (S.source === 'audio') parts.push(viewAudioSource(tl));
        else if (S.source === 'track') parts.push(viewTrackSource(tl));
        else parts.push(viewSrtSource());

        parts.push(viewRules());
        return h('div', null, parts);
    }

    function viewAudioSource(tl) {
        const chosen = selectedTracks();
        const tracks = tl.audio.length
            ? h('div', { class: 'check-list' }, tl.audio.map((a) => h('label', null,
                h('input', {
                    type: 'checkbox', checked: chosen.has(a.index), disabled: !!S.busy,
                    onchange: (e) => {
                        if (e.target.checked) chosen.add(a.index);
                        else chosen.delete(a.index);
                        renderScreen();
                    }
                }),
                h('span', null, `A${a.index} · ${a.name}`),
                h('span', { class: 'meta' }, a.items ? '' : t('tr.trackEmpty')))))
            : h('span', { class: 'lbl' }, t('tr.noAudio'));
        const range = tl.markIn != null && tl.markOut != null
            ? t('tr.rangeMarks', { a: tc(tl.markIn), b: tc(tl.markOut) })
            : t('tr.rangeAll', { dur: duration(tl.end - tl.start) });

        let action;
        if (S.busy) {
            action = h('div', null,
                h('div', { class: 'busy' }, h('span', { class: 'spinner' }), h('span', { id: 'busyText' }, t('tr.busy', { s: 0 }))),
                h('p', { class: 'hint', style: 'margin:8px 0 0' }, t('tr.busyHint')));
        } else {
            action = h('button', { type: 'button', class: 'btn block', disabled: !chosen.size, onclick: doTranscribe },
                S.data.transcript ? t('tr.again') : t('tr.go'));
        }

        return h('div', null,
            h('div', { class: 'row top-align', style: 'margin-top:8px' }, h('span', { class: 'lbl', style: 'padding-top:1px' }, t('tr.tracks')), tracks),
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('tr.range')), h('span', null, range)),
            note(t('tr.engineNote')),
            S.existing && !S.data.transcript ? note([
                t('tr.useExisting', { words: S.existing.words.length }), ' ',
                h('button', { type: 'button', class: 'linklike', onclick: () => setTranscript(S.existing) }, t('tr.useIt'))
            ]) : null,
            h('div', { class: 'pad', style: 'margin-top:10px' }, action),
            transcriptSummary());
    }

    function viewTrackSource(tl) {
        if (!tl.subtitle.length) return note(t('tr.noSubs'));
        return h('div', null,
            h('div', { class: 'row', style: 'margin-top:8px' },
                h('label', { class: 'lbl', for: 'subTrack' }, t('tr.subTrack')),
                select('subTrack', tl.subtitle.map((s) => [s.index, `ST${s.index} · ${s.name} · ${t('tr.cues', { n: s.items })}`]), S.subTrack, (v) => {
                    S.subTrack = Number(v);
                })),
            note(t('tr.estimated')),
            h('div', { class: 'pad', style: 'margin-top:10px' },
                S.busy ? h('div', { class: 'busy' }, h('span', { class: 'spinner' })) : h('button', { type: 'button', class: 'btn block', onclick: readSubtitleTrack }, t('tr.readTrack'))),
            transcriptSummary());
    }

    function viewSrtSource() {
        const input = h('input', { type: 'file', accept: '.srt', hidden: true, onchange: (e) => loadSrt(e.target.files[0]) });
        const zone = h('div', {
            class: 'dropzone',
            ondragover: (e) => {
                e.preventDefault();
                zone.classList.add('over');
            },
            ondragleave: () => zone.classList.remove('over'),
            ondrop: (e) => {
                e.preventDefault();
                zone.classList.remove('over');
                loadSrt(e.dataTransfer.files[0]);
            }
        }, icon('upload', 22), h('span', null, t('tr.drop')),
        h('button', { type: 'button', class: 'btn small', onclick: () => input.click() }, t('tr.browse')), input);
        return h('div', { style: 'margin-top:10px' }, zone, note(t('tr.estimated')), transcriptSummary());
    }

    function viewRules() {
        const r = S.settings.rules;
        const preview = h('div', { class: 'preview' });
        const fillPreview = () => {
            const list = rangeWords();
            if (!list.length) {
                preview.hidden = true;
                return;
            }
            preview.hidden = false;
            const caps = buildCaptions(list);
            preview.replaceChildren(
                h('div', { class: 'head' }, h('span', null, t('tr.preview').toUpperCase()), h('span', null, t('tr.captions', { n: caps.length }).toUpperCase())),
                ...caps.slice(0, 6).map((c, i) => h('div', { class: 'item' },
                    h('span', { class: 'num' }, String(i + 1)), h('span', null, Core.phrases.text(c)))));
            renderFooter();
        };
        const change = (key, value) => {
            r[key] = value;
            fillPreview();
        };
        fillPreview();
        const pauseInput = h('input', {
            type: 'number', class: 'field small', min: '0.1', max: '3', step: '0.1', value: String(r.pauseSeconds),
            'aria-label': t('tr.pause'), disabled: !r.pauseBreak,
            oninput: (e) => change('pauseSeconds', Math.max(0.1, Number(e.target.value) || 0.4)),
            onchange: saveSettings
        });
        return h('div', null,
            section(t('tr.rules')),
            slider('maxWords', t('tr.maxWords'), 1, 8, 1, r.maxWords, (v) => change('maxWords', v), saveSettings),
            slider('maxChars', t('tr.maxChars'), 6, 50, 1, r.maxChars, (v) => change('maxChars', v), saveSettings),
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('tr.lines')), seg([[1, '1'], [2, '2']], r.lines, (v) => {
                r.lines = v;
                saveSettings();
                renderScreen();
            }, t('tr.lines'))),
            checkbox('sentence', t('tr.sentence'), r.sentenceBreak, (v) => {
                change('sentenceBreak', v);
                saveSettings();
            }),
            checkbox('pause', t('tr.pause'), r.pauseBreak, (v) => {
                change('pauseBreak', v);
                pauseInput.disabled = !v;
                saveSettings();
            }, [pauseInput, h('span', null, t('tr.seconds'))]),
            preview);
    }

    function buildNow() {
        const list = rangeWords();
        if (!list.length) return;
        if (S.data.edited && S.data.captions.length && !S.confirmRebuild) {
            S.confirmRebuild = true;
            flash(t('tr.replaceWarn'), true);
            return;
        }
        S.confirmRebuild = false;
        S.data.edited = false;
        S.hist = { past: [], future: [] };
        S.sel = -1;
        S.playIdx = -1;
        S.data.captions = buildCaptions(list);
        S.data.rules = Object.assign({}, S.settings.rules);
        S.data.builtAt = new Date().toISOString();
        saveData();
        go('edit');
        spellPass();
    }

    // ------------------------------------------------------------ spell check

    // After captions are built: clear misspellings fixed, close calls marked for review in Edit.
    // Spanish and English (the bundled word lists); the transcript's language, else the panel's.
    async function spellPass() {
        if (!api.spellcheck || S.settings.spellCheck === false || !S.data.captions.length) return;
        const lang = ((S.data.transcript && S.data.transcript.language) || S.settings.language || '').slice(0, 2);
        if (!['es', 'en'].includes(lang)) return;
        let res;
        try {
            res = await call('spellcheck', S.data.captions.flatMap((c) => c.words.map((w) => w.text)), lang, S.settings.userWords || []);
        } catch (e) {
            return;
        }
        if (!res) return;
        const out = Core.edit.applySpell(S.data.captions, res);
        if (!out.fixed && !out.unsure) return;
        S.data.captions = out.caps;
        syncTranscript();
        S.spellIdx = 0;
        saveData();
        if (S.screen === 'edit') renderScreen();
        flash(t('sp.summary', { fixed: out.fixed, unsure: out.unsure }));
    }

    function spellItems() {
        const items = [];
        S.data.captions.forEach((c, ci) => c.words.forEach((w, wi) => {
            if (w.spell || w.fixedFrom != null) items.push({ ci, wi, w });
        }));
        return items;
    }

    // Adds a word to your own dictionary: it's never flagged again, here or in later checks.
    function addToDictionary(word) {
        const core = Core.spell.parts(word).core;
        const key = core.toLocaleLowerCase();
        const list = S.settings.userWords || (S.settings.userWords = []);
        if (!list.includes(key)) list.push(key);
        saveSettings();
        const caps = S.data.captions.map((c) => Object.assign({}, c, {
            words: c.words.map((w) => {
                if (!w.spell || Core.spell.parts(w.text).core.toLocaleLowerCase() !== key) return w;
                const next = Object.assign({}, w);
                delete next.spell;
                return next;
            })
        }));
        commit(caps);
    }

    // The review bar in Edit: one marked word at a time, with what can be done about it.
    function spellBar() {
        const items = spellItems();
        if (!items.length) return null;
        const unsure = items.filter((x) => x.w.spell).length;
        S.spellIdx = Math.min(Math.max(0, S.spellIdx || 0), items.length - 1);
        const it = items[S.spellIdx];
        const E = Core.edit;
        const go = (d) => {
            S.spellIdx = (S.spellIdx + d + items.length) % items.length;
            renderScreen();
        };
        // None of the choices is right: type it. Two words for one split its time (edit.replaceWord).
        const typed = h('input', {
            class: 'field sp-typed', type: 'text', placeholder: t('sp.typeHint'), 'aria-label': t('sp.type'),
            onkeydown: (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    useTyped();
                }
            }
        });
        const useTyped = () => {
            if (typed.value.trim()) commit(E.replaceWord(S.data.captions, it.ci, it.wi, typed.value));
        };
        const typeRow = h('div', { class: 'sp-type' },
            h('span', { class: 'lbl' }, t('sp.type')), typed,
            h('button', { type: 'button', class: 'btn small', onclick: useTyped }, t('sp.use')));
        const body = it.w.spell
            ? [h('p', { class: 'sp-q' }, t('sp.unsure', { word: it.w.text })),
                h('div', { class: 'sp-choices' },
                    it.w.spell.map((c) => h('button', { type: 'button', class: 'btn small primary', onclick: () => commit(E.replaceWord(S.data.captions, it.ci, it.wi, c)) }, c)),
                    h('button', { type: 'button', class: 'btn small', onclick: () => commit(E.clearSpell(S.data.captions, it.ci, it.wi)) }, t('sp.keep', { word: it.w.text })),
                    h('button', { type: 'button', class: 'linklike', onclick: () => addToDictionary(it.w.text) }, t('sp.add'))),
                typeRow]
            : [h('p', { class: 'sp-q' }, t('sp.fixed', { from: it.w.fixedFrom, to: it.w.text })),
                h('div', { class: 'sp-choices' },
                    h('button', { type: 'button', class: 'btn small', onclick: () => commit(E.clearSpell(S.data.captions, it.ci, it.wi)) }, t('sp.ok')),
                    h('button', { type: 'button', class: 'btn small', onclick: () => commit(E.replaceWord(S.data.captions, it.ci, it.wi, it.w.fixedFrom)) }, t('sp.revert', { from: it.w.fixedFrom }))),
                typeRow];
        // Bring the word into view once drawn.
        setTimeout(() => {
            const row = document.querySelector(`#capList .cap[data-i="${it.ci}"]`);
            if (row) row.scrollIntoView({ block: 'nearest' });
        }, 0);
        return h('div', { class: 'spell-bar' },
            h('div', { class: 'sp-head' },
                h('span', null, t('sp.title', { unsure, fixed: items.length - unsure })),
                h('div', { class: 'stepper' },
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('de.prev'), onclick: () => go(-1) }, '‹'),
                    h('span', { class: 'mono' }, `${S.spellIdx + 1} / ${items.length}`),
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('de.next'), onclick: () => go(1) }, '›'))),
            body);
    }

    // ------------------------------------------------------------ Edit

    const EMPH_COLORS = ['#FFD93B', '#7CF29A', '#FF6B3D', '#6FB7FF', '#FFFFFF'];

    function brush() {
        if (!S.settings.brush) S.settings.brush = { color: '#FFD93B', size: 1.15, font: '' };
        return S.settings.brush;
    }

    // Every caption change goes through here: it records undo history and saves.
    function commit(next, quiet) {
        if (next === S.data.captions) return;
        S.hist.past.push(S.data.captions);
        if (S.hist.past.length > 200) S.hist.past.shift();
        S.hist.future = [];
        applyCaptions(next, quiet);
    }

    // Words fixed in Edit (spelling, retyped, split) go back into the transcript, so captions built
    // again from it, with other phrase rules, keep them (edit.toTranscript).
    function syncTranscript() {
        const tr = S.data.transcript;
        if (!tr || !Array.isArray(tr.words)) return;
        const words = Core.edit.toTranscript(tr.words, S.data.captions);
        if (words !== tr.words) S.data.transcript = Object.assign({}, tr, { words, fixed: true });
    }

    function applyCaptions(next, quiet) {
        S.data.captions = next;
        syncTranscript();
        S.data.edited = true;
        if (S.sel >= next.length) S.sel = next.length - 1;
        saveDataSoon();
        if (!quiet) renderScreen();
        renderFooter();
    }

    function undo() {
        if (!S.hist.past.length) return;
        S.hist.future.push(S.data.captions);
        applyCaptions(S.hist.past.pop());
    }

    function redo() {
        if (!S.hist.future.length) return;
        S.hist.past.push(S.data.captions);
        applyCaptions(S.hist.future.pop());
    }

    let saveTimer = null;
    function saveDataSoon() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveData, 400);
    }

    function selectCaption(i) {
        S.sel = i;
        renderScreen();
        call('setPlayhead', Core.phrases.start(S.data.captions[i])).catch((e) => flash(e.message, true));
    }

    function wordClick(ev, ci, wi) {
        const E = Core.edit;
        const caps = S.data.captions;
        if (S.editMode === 'emph') commit(E.paint(caps, ci, wi, brush()));
        // Line break mode (or Shift+click in Group): line 2 starts at this word; again for one line.
        else if (S.editMode === 'break' || ev.shiftKey) commit(E.setLineBreak(caps, ci, wi));
        else commit(E.split(caps, ci, wi));
    }

    function commitText(ci, input) {
        const before = S.data.captions;
        const next = Core.edit.setText(before, ci, input.value, S.settings.rules);
        commit(next, next.length === before.length);
        return next.length === before.length;
    }

    function wordChip(w, ci, wi) {
        const e = w.emph;
        const style = e
            ? `color:${e.color};border-color:${e.color}99;background:${e.color}1f;font-weight:600;font-size:${Math.round(13 * (e.size || 1))}px;` +
              (e.font ? `font-family:'${e.font}',var(--sans);` : '')
            : null;
        const items = (w.spell || w.fixedFrom != null) ? spellItems() : null;
        const current = items && items[S.spellIdx || 0];
        const cls = 'word' + (w.spell ? ' sp-unsure' : '') + (w.fixedFrom != null ? ' sp-fixed' : '') + (current && current.ci === ci && current.wi === wi ? ' sp-on' : '');
        const title = w.spell ? t('sp.markUnsure', { choices: w.spell.join(', ') }) : w.fixedFrom != null ? t('sp.markFixed', { from: w.fixedFrom }) : null;
        return h('button', { type: 'button', class: cls, style, title, onclick: (ev) => wordClick(ev, ci, wi) }, w.text);
    }

    // Prune: every word the caption was spoken with, in order; a click prunes a kept word or keeps
    // a pruned one again (struck through, dimmed).
    function pruneBody(c, i) {
        const E = Core.edit;
        const rules = S.settings.rules;
        return h('div', { class: 'line' }, E.prunedView(c).map(({ word, kept, index }) => h('button', {
            type: 'button', class: 'word' + (kept ? '' : ' pruned'), title: kept ? t('ed.pruneWord') : t('ed.keepWord'),
            'aria-pressed': String(!kept),
            onclick: () => commit(kept ? E.prune(S.data.captions, i, index, rules) : E.unprune(S.data.captions, i, index, rules))
        }, word.text)));
    }

    function prunePanel(caps) {
        const E = Core.edit;
        const n = E.prunedCount(caps);
        return h('div', { class: 'brush' },
            h('p', { class: 'hint', style: 'margin:0' }, t('ed.hintPrune')),
            h('div', { class: 'prune-actions' },
                h('button', { type: 'button', class: 'btn small primary', onclick: () => commit(E.regroup(S.data.captions, S.settings.rules, fps())) }, t('ed.regroup')),
                h('span', { class: 'lbl' }, t('ed.prunedCount', { n })),
                n ? h('button', { type: 'button', class: 'linklike', onclick: () => commit(E.unpruneAll(S.data.captions, S.settings.rules)) }, t('ed.keepAll')) : null));
    }

    function captionBody(c, i) {
        if (S.editMode === 'prune') return pruneBody(c, i);
        if (S.editMode === 'spell') {
            const input = h('input', {
                class: 'field spell', value: c.words.map((w) => w.text).join(' '), 'data-i': String(i),
                'aria-label': t('ed.textOf', { n: i + 1 }),
                onkeydown: (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const kept = commitText(i, input);
                        const nextIndex = kept ? i + 1 : i;
                        const target = document.querySelector(`.spell[data-i="${nextIndex}"]`);
                        if (target) target.focus();
                    } else if (e.key === 'Escape') {
                        input.value = c.words.map((w) => w.text).join(' ');
                        input.blur();
                    }
                },
                onblur: () => commitText(i, input)
            });
            return input;
        }
        const chips = c.words.map((w, k) => wordChip(w, i, k));
        if (c.lineBreak == null) return h('div', { class: 'line' }, chips);
        return h('div', null,
            h('div', { class: 'line' }, chips.slice(0, c.lineBreak), h('span', { class: 'lb-mark', title: t('ed.lineBreak') }, '↵')),
            h('div', { class: 'line' }, chips.slice(c.lineBreak)));
    }

    function nudgeBar(c, i) {
        const E = Core.edit;
        const step = (edge, delta, label) => h('button', {
            type: 'button', class: 'icon-btn step', 'aria-label': label, title: label,
            onclick: () => commit(E.nudge(S.data.captions, i, edge, delta))
        }, delta < 0 ? '−' : '+');
        const nudged = c.nudgeStart || c.nudgeEnd;
        return h('div', { class: 'nudge' },
            h('span', { class: 'lbl' }, t('ed.start')),
            step('start', -1, t('ed.earlier')), h('span', { class: 'tcv' }, tc(Core.phrases.start(c))), step('start', 1, t('ed.later')),
            h('span', { class: 'lbl', style: 'margin-left:6px' }, t('ed.end')),
            step('end', -1, t('ed.earlier')), h('span', { class: 'tcv' }, tc(Core.phrases.end(c))), step('end', 1, t('ed.later')),
            nudged ? h('button', { type: 'button', class: 'linklike', style: 'margin-left:6px', onclick: () => commit(E.resetNudge(S.data.captions, i)) }, t('ed.reset')) : null);
    }

    function captionRow(c, i, count) {
        const start = Core.phrases.start(c);
        const end = Core.phrases.end(c);
        return h('div', { class: 'cap' + (i === S.sel ? ' sel' : '') + (i === S.playIdx ? ' play' : ''), 'data-i': String(i) },
            h('button', { type: 'button', class: 'tc', title: t('ed.jump'), onclick: () => selectCaption(i) },
                h('span', null, tc(start)), h('span', null, `${((end - start) / fps()).toFixed(1)} s`)),
            captionBody(c, i),
            S.editMode === 'group' && i < count - 1
                ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ed.merge'), title: t('ed.merge'), onclick: () => commit(Core.edit.merge(S.data.captions, i, S.settings.rules)) },
                    icon('merge', 14))
                : h('span'),
            i === S.sel ? nudgeBar(c, i) : null);
    }

    function brushPanel() {
        ensureFamilies();
        const b = brush();
        const set = (patch) => {
            Object.assign(b, patch);
            saveSettings();
            renderScreen();
        };
        const custom = h('input', { type: 'color', class: 'swatch-custom', value: b.color.length === 7 ? b.color : '#ffd93b', 'aria-label': t('ed.customColor'), title: t('ed.customColor'), onchange: (e) => set({ color: e.target.value.toUpperCase() }) });
        return h('div', { class: 'brush' },
            h('p', { class: 'hint', style: 'margin:0' }, t('ed.hintEmph')),
            h('div', { class: 'row', style: 'padding:0' }, h('span', { class: 'lbl' }, t('ed.color')),
                h('div', { class: 'swatches', role: 'group', 'aria-label': t('ed.color') },
                    EMPH_COLORS.map((c) => h('button', {
                        type: 'button', class: 'swatch' + (b.color === c ? ' on' : ''), style: `background:${c}`,
                        'aria-label': c, 'aria-pressed': String(b.color === c), onclick: () => set({ color: c })
                    })), custom)),
            h('div', { class: 'row', style: 'padding:0' }, h('span', { class: 'lbl' }, t('ed.size')),
                seg([[1, '100%'], [1.15, '115%'], [1.3, '130%']], b.size, (v) => set({ size: v }), t('ed.size'))),
            h('div', { class: 'row', style: 'padding:0' }, h('label', { class: 'lbl', for: 'brushFont' }, t('ed.font')),
                select('brushFont', fontChoices(b.font, t('ed.sameFont')), b.font || '', (v) => set({ font: v, fontStyle: v ? fontStyleFor(v) : '' }))));
    }

    function viewEdit() {
        const caps = S.data.captions;
        if (!caps.length) return h('div', { class: 'empty' }, h('strong', null, t('ed.empty')), t('ed.emptyHint'));
        const mode = S.editMode;
        let panel;
        if (mode === 'emph') panel = brushPanel();
        else if (mode === 'spell') {
            // Words fixed, split or joined change the counts: the phrase rules group them again.
            panel = h('div', { class: 'brush' },
                h('p', { class: 'hint', style: 'margin:0' }, t('ed.hintSpell')),
                h('div', { class: 'prune-actions' },
                    h('button', { type: 'button', class: 'btn small primary', title: t('ed.regroupAllTitle'), onclick: () => commit(Core.edit.regroup(S.data.captions, S.settings.rules, fps())) }, t('ed.regroupAll'))));
        }
        else if (mode === 'break') panel = h('p', { class: 'hint' }, t('ed.hintBreakMode'));
        else if (mode === 'prune') panel = prunePanel(caps);
        else {
            panel = h('p', { class: 'hint' }, t('ed.hintGroup'),
                S.settings.rules.lines === 2 || caps.some((c) => c.lineBreak != null) ? [' ', t('ed.hintBreak')] : null);
        }
        // Everything above the captions stays put (every mode); only the caption list scrolls.
        const top = h('div', { class: 'ed-sticky' },
            h('div', { class: 'section-row' }, section(t('ed.title', { n: caps.length })),
                h('div', { class: 'tools' },
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ed.undo'), title: t('ed.undo'), disabled: !S.hist.past.length, onclick: undo }, icon('undo', 15)),
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('ed.redo'), title: t('ed.redo'), disabled: !S.hist.future.length, onclick: redo }, icon('redo', 15)))),
            h('div', { class: 'pad', style: 'margin-bottom:10px' }, seg([['group', t('ed.group')], ['prune', t('ed.prune')], ['spell', t('ed.spell')], ['emph', t('ed.emph')], ['break', t('ed.breakMode')]], mode, (v) => {
                S.editMode = v;
                renderScreen();
            }, t('ed.mode'))),
            panel,
            spellBar());
        // Rows scrolled into view (playhead, spelling review) stop below the pinned part.
        queueMicrotask(() => {
            if (top.isConnected) $('screen').style.setProperty('--ed-sticky-h', `${top.offsetHeight + 6}px`);
        });
        return h('div', null, top,
            h('div', { class: 'caps', id: 'capList' }, caps.map((c, i) => captionRow(c, i, caps.length))));
    }

    // Follows Resolve's playhead while the Edit screen is open: the caption on screen gets marked.
    let polling = false;
    async function pollPlayhead() {
        if (S.screen !== 'edit' || document.hidden || S.busy || polling || !S.data.captions.length || !S.connected) return;
        polling = true;
        try {
            const frame = await call('playhead');
            const idx = Core.edit.captionAt(S.data.captions, frame);
            if (idx !== S.playIdx) {
                S.playIdx = idx;
                document.querySelectorAll('#capList .cap.play').forEach((el) => el.classList.remove('play'));
                const row = idx >= 0 ? document.querySelector(`#capList .cap[data-i="${idx}"]`) : null;
                if (row) {
                    row.classList.add('play');
                    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
                    if (!typing) row.scrollIntoView({ block: 'nearest' });
                }
            }
        } catch (e) {
            // The next poll tries again; connection problems show in the header.
        } finally {
            polling = false;
        }
    }

    async function exportSrt() {
        const tl = timeline();
        if (!tl) return;
        try {
            const saved = await call('exportSrt', Core.srt.write(S.data.captions, tl.fps, tl.start), tl.name);
            if (saved) flash(t('ed.exported', { path: saved }));
        } catch (e) {
            flash(e.message, true);
        }
    }

    // ------------------------------------------------------------ Deliver, Settings

    // ------------------------------------------------------------ Deliver

    // The fonts the panel recommends, listed first when installed.
    const FAVORITE_FONTS = Object.keys(Core.fonts.FONT_STYLES);

    // The installed families with their styles (main reads the font files). undefined: not asked
    // yet; null: unavailable, so the lists fall back to the favourites.
    function ensureFamilies() {
        if (S.families !== undefined || !api.fontFamilies) return;
        S.families = null;
        call('fontFamilies').then((list) => {
            S.families = Array.isArray(list) && list.length ? list : null;
            if (S.families) {
                renderScreen();
                renderFooter();
            }
        }, () => {});
    }

    function stylesOf(family) {
        const f = family && Array.isArray(S.families) ? S.families.find((x) => x.family === family) : null;
        return f ? f.styles : null;
    }

    // The style Text+ gets with a font: the one chosen, if the family has it, else its caption style.
    function fontStyleFor(family, chosen) {
        const styles = stylesOf(family);
        if (chosen && (!styles || styles.includes(chosen))) return chosen;
        return Core.fonts.styleFor(family, styles);
    }

    const installed = (family) => !Array.isArray(S.families) || S.families.some((f) => f.family === family);

    // A message about one font or several ("…Many" key), the names joined the language's way.
    function fontsMessage(key, list, vars) {
        return t(list.length > 1 ? `${key}Many` : key, Object.assign({ fonts: window.i18n.list(list) }, vars));
    }

    // Font list: only fonts on this computer, the favourites first, then every other installed
    // family. A saved font that isn't installed stays listed, marked, so the setting is visible.
    function fontChoices(current, defaultLabel) {
        if (!Array.isArray(S.families)) return [['', defaultLabel]].concat(FAVORITE_FONTS.map((f) => [f, f]));
        const names = S.families.map((f) => f.family);
        const out = [['', defaultLabel]];
        if (current && !names.includes(current)) out.push([current, t('de.fontNotInstalled', { font: current })]);
        const favs = FAVORITE_FONTS.filter((f) => names.includes(f));
        const others = names.filter((f) => !FAVORITE_FONTS.includes(f));
        if (favs.length) out.push({ group: t('de.fontFavorites'), options: favs.map((f) => [f, f]) });
        if (others.length) out.push({ group: t('de.fontOthers'), options: others.map((f) => [f, f]) });
        return out;
    }
    const TEXT_COLORS = ['', '#FFFFFF', '#FFD93B', '#7CF29A', '#6FB7FF', '#FF6B3D'];
    const CLIP_COLORS = ['', 'Orange', 'Apricot', 'Yellow', 'Lime', 'Teal', 'Blue', 'Purple', 'Pink'];
    const SHADOW_COLORS = ['#000000', '#1B1B1D', '#3A2A1E', '#0B1F3A'];
    const DEFAULT_LOOK = {
        // y 64 centres the caption in the guide's SUBTITLES area.
        size: 75, x: 50, y: 64, font: '', color: '', caseMode: 'as', strip: { '.': true, ',': true },
        fillGaps: true, maxGap: 12, minFrames: 15, clipColor: 'Orange', keepTemplate: true, guide: true,
        emphOn: false, emphColor: '#FFD93B', emphSize: 1.15,
        // Style settings (comp.js tuned): '' / null keep the style's own.
        accent: '', box: null, pop: true, dim: 45, outline: { on: false, color: '#000000', width: 0.08 },
        // Drop shadow through Text+'s shadow element. Distance and softness in pixels at 1080 wide.
        shadow: { on: true, color: '#000000', opacity: 60, distance: 6, angle: 315, softness: 8 },
        // Motion (starter styles): fade in/out in frames to a rest opacity (%); letters drifting
        // apart at `speed`% a second from `from`% (comp.js driftKeys; 12, the owner's pick, 2026-10-17),
        // starting that much tight so they pass normal spacing about a second in.
        fade: { on: false, in: 4, out: 4, rest: 100 },
        tracking: { on: false, from: 88, speed: 12 },
        // Whip (core/whip.js): its pattern, which way the words whip, how far and fast, motion
        // blur, the pattern's size and place, letter spacing, glow and underline.
        whip: Object.assign({}, Core.whip.DEFAULTS)
    };
    let pvTimers = [];

    // Always the same object, so code holding it across an await keeps writing to the live settings.
    function look() {
        const L = S.settings.look || (S.settings.look = {});
        delete L.track; // older versions kept the Deliver track here; it's per timeline now
        for (const [k, v] of Object.entries(DEFAULT_LOOK)) {
            if (!(k in L)) L[k] = JSON.parse(JSON.stringify(v));
        }
        // Tracking before 0.2.8 opened up over part of the caption (from, over); it drifts now.
        if (L.tracking && L.tracking.speed == null) L.tracking = Object.assign({}, DEFAULT_LOOK.tracking, { on: !!L.tracking.on });
        // Looks saved before a Whip setting existed, and presets that set only some of them.
        if (!L.whip || typeof L.whip !== 'object') L.whip = Object.assign({}, Core.whip.DEFAULTS);
        for (const [k, v] of Object.entries(Core.whip.DEFAULTS)) {
            if (!(k in L.whip)) L.whip[k] = v;
        }
        return L;
    }

    function styleRef() {
        return S.deliverMode === 'modify' && S.modStyle ? S.modStyle : S.settings.style;
    }

    // The style Deliver works with is Whip (its own preview, settings and per-word payload).
    function isWhip() {
        const ref = styleRef();
        return ref.source === 'pack' && ref.id === 'whip';
    }

    function compLook() {
        const L = look();
        const ref = styleRef();
        const whip = isWhip();
        return {
            style: ref.source === 'pack' ? ref.id : null,
            size: L.size / 1000, x: L.x, y: L.y, caseMode: L.caseMode, strip: L.strip,
            font: L.font || undefined, fontStyle: L.font ? fontStyleFor(L.font, L.fontStyle) : undefined,
            color: L.color || undefined, keepTemplate: L.keepTemplate,
            shadow: L.shadow.on ? Object.assign({}, L.shadow) : null,
            accent: L.accent || undefined, box: L.box || undefined, pop: L.pop, dim: L.dim,
            outline: L.outline && L.outline.on ? Object.assign({}, L.outline) : undefined,
            fade: L.fade.on ? Object.assign({}, L.fade) : undefined,
            // Whip's words don't track; its fade is per word.
            tracking: L.tracking.on && !whip ? Object.assign({}, L.tracking) : undefined, fps: fps(),
            emphOverride: S.deliverMode === 'modify' && L.emphOn ? { color: L.emphColor, size: L.emphSize } : undefined,
            whip: whip ? Core.whip.settings(L.whip) : undefined
        };
    }

    // Drift's limit (comp.js driftKeys): the most letter spacing each caption's widest line takes and
    // stays inside 94 % of the frame, measured with the caption's font and size the way the preview
    // sizes it. Text+ moves each letter about 1.43 em per unit of spacing (render check, 2026-10-15).
    const DRIFT_ROOM = 0.94;
    let measureCtx = null;
    function withDrift(captions) {
        const L = look();
        if (!(L.tracking.on && L.tracking.speed > 0) || styleRef().source !== 'pack' || isWhip()) return captions;
        const family = L.font || 'Montserrat';
        const style = L.font ? fontStyleFor(L.font, L.fontStyle) : 'ExtraBold';
        const em = (Core.fonts.LINE_PER_SIZE * L.size / 1000) / lineOf(family, style);   // font size, in frame widths
        const ctx = measureCtx || (measureCtx = document.createElement('canvas').getContext('2d'));
        ctx.font = `${Core.fonts.isItalic(style) ? 'italic ' : ''}${Core.fonts.cssWeight(style)} 100px '${family}', sans-serif`;
        return captions.map((c) => {
            let max = Infinity;
            for (const line of Core.phrases.lines(c)) {
                const text = Core.textfx.apply(line, L.caseMode, L.strip);
                if (text) max = Math.min(max, 1 + (DRIFT_ROOM - (ctx.measureText(text).width / 100) * em) / (1.43 * em * text.length));
            }
            return Number.isFinite(max) ? Object.assign({}, c, { driftMax: +max.toFixed(4) }) : c;
        });
    }

    // Whip's clips run on after the last word, while there's room, for the words to whip out.
    function finalClips() {
        const L = look();
        const tail = isWhip() ? (c) => Core.whip.tail(c.words.length, L.whip, c.words.length ? c.words[c.words.length - 1].end - c.words[c.words.length - 1].start : 0) : undefined;
        return Core.timing.finalize(S.data.captions, { fillGaps: L.fillGaps, maxGap: L.maxGap, minFrames: L.minFrames, tail });
    }

    // The Deliver track belongs to the timeline (saved with its captions): a track number means
    // nothing on another timeline. One that's gone from this timeline falls back to a new track.
    function deliverTrack() {
        const tr = S.data.track;
        if (!Number.isInteger(tr)) return 'new';
        return S.tracks && !S.tracks.some((x) => x.index === tr) ? 'new' : tr;
    }

    // A test made a new track: Deliver's track becomes it right away. The track list from Resolve
    // (loadTracks) can take seconds on a long timeline, and until it shows the new track
    // deliverTrack() answers "new" again. Live in viewer retries every 0.4 s while an update is
    // out, so the retry went out first, made another track, and so on (2026-11-28: V3 to V13).
    function useMadeTrack(index) {
        S.data.track = index;
        saveData();
        if (Array.isArray(S.tracks) && !S.tracks.some((x) => x.index === index)) {
            S.tracks = S.tracks.concat({ index, name: 'Cap-o-matic', ours: 0, others: 0 }).sort((a, b) => a.index - b.index);
        }
        loadTracks();
    }

    function setDeliverTrack(tr) {
        S.data.track = tr;
        saveData();
        renderScreen();
        renderFooter();
    }

    // Deliver's own undo. Resolve doesn't record changes made through its scripting API, so its
    // Ctrl+Z can't take back a look; the panel keeps the history (Ctrl+Z / Ctrl+Y on Deliver, and
    // the buttons by Look). A step is everything a look is made of, as JSON; Live in viewer follows.
    // Whip words moved (dragged in the preview, taken from Resolve) are steps too, kept as
    // { captions, when }: the captions list to go back to, if the list is still `when`.
    const lookHist = { past: [], future: [] };
    let lookDragging = false;

    function lookSnapshot() {
        const L = Object.assign({}, look());
        delete L.guide;
        return JSON.stringify({ look: L, style: S.settings.style, rules: S.settings.rules, brush: S.settings.brush, preset: S.settings.preset || null });
    }

    function markLook() {
        const snap = lookSnapshot();
        if (lookHist.past[lookHist.past.length - 1] === snap) return;
        lookHist.past.push(snap);
        if (lookHist.past.length > 100) lookHist.past.shift();
        lookHist.future = [];
    }

    function restoreLook(snap) {
        const d = JSON.parse(snap);
        const L = look();
        const guide = L.guide;
        for (const k of Object.keys(L)) delete L[k];
        Object.assign(L, d.look, { guide });
        Object.assign(S.settings, { style: d.style, rules: d.rules, brush: d.brush });
        if (d.preset) S.settings.preset = d.preset;
        else delete S.settings.preset;
        saveSettings();
        renderScreen();
        renderFooter();
    }

    // Takes one step from `from` and records its opposite in `to`. A words step whose captions
    // were changed since (in Edit, or a new build) is dropped: going back would undo that too.
    function lookStep(from, to) {
        while (from.length) {
            const step = from.pop();
            if (typeof step === 'string') {
                to.push(lookSnapshot());
                restoreLook(step);
                return;
            }
            if (step.when !== S.data.captions) continue;
            to.push({ captions: S.data.captions, when: step.captions });
            S.data.captions = step.captions;
            saveData();
            renderScreen();
            renderFooter();
            return;
        }
    }

    function lookUndo() {
        lookStep(lookHist.past, lookHist.future);
    }

    function lookRedo() {
        lookStep(lookHist.future, lookHist.past);
    }

    // noUndo: not a look change to take back (the safe-zone mask is in Resolve's viewer too).
    function setLook(patch, noUndo) {
        if (!noUndo) markLook();
        Object.assign(look(), patch);
        saveSettings();
        renderScreen();
        renderFooter();
    }

    // While a slider is dragged: update the value and swap just the preview (saved on release).
    function livePreview(patch) {
        if (!lookDragging) {
            markLook();
            lookDragging = true;
        }
        Object.assign(look(), patch);
        const old = document.querySelector('.pv-wrap');
        if (old) {
            clearInterval(old.pvTimer);
            old.replaceWith(previewFrame());
        }
        // Sliders don't redraw the screen; Live in viewer follows once the drag pauses.
        scheduleLive();
    }

    // Resolve's viewer shows the guide too while Guide is ticked, from the first visit to Deliver
    // until the panel closes (9:16 timelines only). Before that, a guide left behind is taken off.
    // `announce` marks the user's own change: unticking then clears every timeline, not just this one.
    async function syncGuide(announce) {
        if (!api.guide || !S.connected || !timeline()) return;
        const want = S.guideArmed && !!look().guide;
        try {
            const res = await call('guide', want, !!announce);
            if (announce && want && res.reason === 'aspect') flash(t('de.guideAspect'));
            else if (announce && want && res.reason === 'empty') flash(t('de.guideEmpty'));
        } catch (e) {
            if (want) flash(e.message, true);
        }
    }

    async function loadTracks() {
        S.tracksError = null;
        try {
            S.tracks = await call('captionTracks');
        } catch (e) {
            S.tracks = null;
            S.tracksError = e.message;
        }
        if (S.screen === 'deliver') {
            renderScreen();
            renderFooter();
        }
    }

    // A font as Resolve will draw it: the family in the style Text+ gets.
    function fontDecl(family, style) {
        return `font-family:'${family}',sans-serif;font-weight:${Core.fonts.cssWeight(style)};font-style:${Core.fonts.isItalic(style) ? 'italic' : 'normal'};`;
    }

    // A font's line height (ascent + descent) in ems, from the browser's own metrics of it.
    const lineCache = new Map();
    function lineOf(family, style) {
        const w = Core.fonts.cssWeight(style);
        const i = Core.fonts.isItalic(style) ? 'italic ' : '';
        const key = `${family}|${i}${w}`;
        if (!lineCache.has(key)) {
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = `${i}${w} 100px '${family}', sans-serif`;
            const m = ctx.measureText('Hg');
            lineCache.set(key, (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100 || 1.2);
        }
        return lineCache.get(key);
    }

    // How a look paints a starter style's words and line, as comp.js draws them (tuned): shadow,
    // accent, Spotlight's dim, Pop without growing, outline, line box. k: preview pixels per pixel
    // at 1080 wide; baseLine: the caption font's line height in ems. Shared by the Deliver preview
    // and the preset tiles (still: no pop, nothing hidden). word(k, active) gives a word's CSS
    // before shade(); fonts are the caller's.
    function lookPaint(L, st, bin, k, baseLine, still) {
        const baseCss = st ? st.base : 'font-family:Montserrat,"Segoe UI",sans-serif;font-weight:800;color:#fff;display:inline-block;';
        const actCss = st ? st.act : baseCss;
        // Text+'s shadow element, approximated with a CSS text-shadow at preview scale. Boxes cast
        // none, and a box behind the spoken word covers the shadow of the word underneath.
        const sh = L.shadow;
        let drop = '';
        if (sh && sh.on) {
            const rad = (sh.angle * Math.PI) / 180;
            const [r, g, b] = [1, 3, 5].map((i) => parseInt(sh.color.slice(i, i + 2), 16));
            drop = `${(Math.cos(rad) * sh.distance * k).toFixed(1)}px ${(-Math.sin(rad) * sh.distance * k).toFixed(1)}px ${(sh.softness * k).toFixed(1)}px rgba(${r},${g},${b},${sh.opacity / 100})`;
        }
        const shade = (css, isActive) => {
            if (!drop || (isActive && /background:/.test(css))) return css;
            const own = /text-shadow:([^;]+);/.exec(css);
            return css + `text-shadow:${own ? own[1] + ',' : ''}${drop};`;
        };
        // Accent where the style shows the spoken word; an outline converted from Text+ Thickness
        // (counted in text sizes; CSS strokes straddle the edge, so twice as wide).
        const id = st ? st.id : null;
        const accentCss = (isActive) => {
            const a = L.accent;
            if (!a || !id) return '';
            if (id === 'highlight') return isActive ? `background:${a};` : '';
            if (id === 'underline') return isActive ? `text-decoration-color:${a};` : '';
            if (id === 'glow') return `text-shadow:0 0 ${isActive ? '.5em' : '.4em'} ${a}${isActive ? `,0 0 1em ${a}` : ''};`;
            return isActive && !['plain', 'typewriter'].includes(id) ? `color:${a};` : '';
        };
        const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${alpha})`;
        const o = L.outline;
        const strokeCss = !bin && o && o.on && id !== 'glow'
            ? `-webkit-text-stroke:${((2 * o.width * baseLine) / Core.fonts.LINE_PER_SIZE).toFixed(3)}em ${o.color};paint-order:stroke fill;` : '';
        const hideLater = !still && (id === 'pop' || id === 'typewriter');
        const word = (n, active) => {
            let css = (n === active ? actCss : baseCss) + accentCss(n === active) + strokeCss;
            // Plain and Typewriter draw no spoken word, so the text colour reaches every word.
            if (L.color && !bin && (n !== active || id === 'plain' || id === 'typewriter')) css += `color:${L.color};`;
            if (id === 'spotlight' && n !== active) css += `color:${rgba(L.color || '#FFFFFF', L.dim / 100)};`;
            if (id === 'pop' && (L.pop === false || still)) css += 'animation:none;';
            if (hideLater && n > active) css += 'visibility:hidden;';
            return css;
        };
        // A line box (Ribbon's, or Plain's when it has one) sits behind each line, like Text+'s.
        const boxed = L.box && (id === 'ribbon' || id === 'plain');
        const line = boxed
            ? `display:inline;background:${rgba(L.box.color, L.box.opacity / 100)};padding:.16em .4em;border-radius:.1em;line-height:1.5;-webkit-box-decoration-break:clone;box-decoration-break:clone;`
            : 'display:inline-block;' + (st && st.line ? st.line : '');
        return { word, shade, line };
    }

    // Fade and tracking on the preview caption, looping with its words (ms): the fades in the
    // timeline's frames, the rest opacity held between them, and the letters drifting apart at their
    // speed from `from`% (comp.js driftKeys: Text+ spacing 1 − (1 − from) × 0.25, which moves each
    // letter about 1.43em per unit; the preview drifts in a straight line, without the limit).
    function motionPreview(el, L, ms) {
        if (!el.animate) return;
        const f = L.fade;
        if (f && f.on) {
            const frame = 1000 / fps();
            let fin = f.in * frame;
            let fout = f.out * frame;
            if (fin + fout > ms) {
                const k = ms / (fin + fout);
                fin *= k;
                fout *= k;
            }
            const rest = f.rest / 100;
            el.animate([
                { opacity: fin ? 0 : rest, offset: 0 }, { opacity: rest, offset: fin / ms },
                { opacity: rest, offset: 1 - fout / ms }, { opacity: fout ? 0 : rest, offset: 1 }
            ], { duration: ms, iterations: Infinity });
        }
        const tr = L.tracking;
        if (tr && tr.on && tr.speed > 0) {
            const em = (pct) => `${((pct / 100 - 1) * 0.25 * 1.43).toFixed(4)}em`;
            el.animate([{ letterSpacing: em(tr.from) }, { letterSpacing: em(tr.from + tr.speed * ms / 1000) }], { duration: ms, iterations: Infinity });
        }
    }

    // ------------------------------------------------------------ Whip

    const rgbaOf = (hex, alpha) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${alpha})`;
    const round4 = (v) => Math.round(v * 10000) / 10000;

    // The font a Whip word is drawn in: its emphasis font, else the caption's, else the style's.
    function whipFont(w, L) {
        const e = w.emph;
        if (e && e.font) return { family: e.font, style: e.fontStyle || fontStyleFor(e.font) };
        if (L.font) return { family: L.font, style: fontStyleFor(L.font, L.fontStyle) };
        return { family: 'Montserrat', style: 'ExtraBold' };
    }

    // A canvas font: `px` pixels of the family, in the weight and slant of its Text+ style.
    function canvasFont(f, px) {
        return `${Core.fonts.isItalic(f.style) ? 'italic ' : ''}${Core.fonts.cssWeight(f.style)} ${px}px '${f.family}', sans-serif`;
    }

    // Fonts load as they're first used, and what's measured before then is the fallback font: a
    // drawing waits for its fonts (fontsPending), and the measures go whenever fonts arrive.
    const whipMeasures = new Map();
    const fontLoads = new Map();
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => whipMeasures.clear());

    // A promise for those of the fonts (canvas font strings) still to load, or null: each loads
    // once, and one that fails isn't waited for again.
    function fontsPending(specs) {
        if (!document.fonts || !document.fonts.load) return null;
        const waits = [];
        for (const spec of new Set(specs)) {
            let load = fontLoads.get(spec);
            if (load === true) continue;
            if (!load) {
                let ready = true;
                try {
                    ready = document.fonts.check(spec);
                } catch (e) {
                    // Not something the browser can look up: nothing to wait for.
                }
                if (ready) continue;
                load = document.fonts.load(spec).catch(() => null).then(() => {
                    fontLoads.set(spec, true);
                    whipMeasures.clear();
                });
                fontLoads.set(spec, load);
            }
            waits.push(load);
        }
        return waits.length ? Promise.all(waits) : null;
    }

    // A word's metrics per pixel of font size, as Core.whip.layout takes them, in the font Text+
    // draws it in with Whip's letter spacing: ink width and left overhang, ink above and below the
    // baseline, the font's own line above and below it.
    let whipCtx = null;
    function whipMetrics(w, L) {
        const f = whipFont(w, L);
        const spacing = Core.whip.settings(L.whip).spacing;
        const font = canvasFont(f, 100);
        const key = `${font}|${spacing}|${w.text}`;
        let m = whipMeasures.get(key);
        if (!m) {
            if (!whipCtx) whipCtx = document.createElement('canvas').getContext('2d');
            const g = whipCtx;
            g.font = font;
            if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`; // % of an em, at 100 px
            const r = g.measureText(w.text);
            const left = r.actualBoundingBoxLeft || 0;
            m = {
                w1: Math.max(0.05, (left + (r.actualBoundingBoxRight || r.width)) / 100), l1: left / 100,
                asc1: r.actualBoundingBoxAscent / 100, desc1: r.actualBoundingBoxDescent / 100,
                fasc1: (r.fontBoundingBoxAscent || r.actualBoundingBoxAscent * 1.25) / 100, fdesc1: (r.fontBoundingBoxDescent || 25) / 100
            };
            if (!Object.values(m).every(isFinite)) m = Core.whip.estimate(w.text, f.family);
            whipMeasures.set(key, m);
        }
        return m;
    }

    // A caption's words as Whip places them: case and punctuation applied and empty ones dropped
    // (as comp.js prepare does), each with its start, its index in the caption and where it was
    // moved to (at). In Modify, Recolor emphasized words applies.
    function whipWords(c, L) {
        const over = S.deliverMode === 'modify' && L.emphOn ? { color: L.emphColor, size: L.emphSize } : null;
        const out = [];
        (c ? c.words : []).forEach((w, index) => {
            const text = Core.textfx.apply(w.text, L.caseMode, L.strip);
            if (text) out.push({ text, emph: w.emph ? Object.assign({}, w.emph, over) : null, at: w.at || null, start: w.start, index });
        });
        return out;
    }

    function whipLayout(words, index, L, W, H) {
        return Core.whip.layout(words, { whip: L.whip, width: W, height: H, index, measure: (w) => whipMetrics(w, L) });
    }

    // A caption as Deliver sends it with Whip: with its index (some patterns change from caption to
    // caption) and the metrics of its kept words, so the comp places them where the preview does.
    function whipCaption(c, index) {
        if (!isWhip()) return c;
        const L = look();
        return Object.assign({}, c, { whip: { index, metrics: whipWords(c, L).map((w) => whipMetrics(w, L)) } });
    }

    // A placed word drawn once, finished as the comp finishes it: box, glow, drop shadow, underline,
    // outline and fill, at k canvas pixels per frame pixel (W: the frame's width, which outline and
    // shadow sizes count in). Its ink centre is at (ox, oy). As in the comp, a glow takes the
    // outline's place and an underline the box's (one Text+ shading element each).
    function whipSprite(p, L, W, k) {
        const w = Core.whip.settings(L.whip);
        const px = p.px;
        const unit = W / 1080; // shadow distance and softness: pixels at 1080 wide
        const o = L.outline && L.outline.on && !w.glow ? L.outline : null;
        // Text+ Thickness counts in text sizes; a canvas stroke straddles the edge, so twice as wide.
        const stroke = o ? 2 * o.width * Core.whip.textPlus(p, W, W).size * W : 0;
        const sh = L.shadow && L.shadow.on ? L.shadow : null;
        const reach = Math.max(stroke, w.glow ? 0.5 * px : 0, sh ? (sh.distance + 2 * sh.softness) * unit : 0) + 0.45 * px + 2;
        const hw = p.width / 2 + reach;
        const hh = Math.max(p.fasc, p.fdesc, p.asc, p.desc) + reach;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(2 * hw * k));
        c.height = Math.max(1, Math.ceil(2 * hh * k));
        const g = c.getContext('2d');
        g.setTransform(k, 0, 0, k, hw * k, hh * k);
        const x = -p.width / 2 + p.l;
        const base = (p.asc - p.desc) / 2;
        g.font = canvasFont(whipFont(p, L), px);
        if ('letterSpacing' in g) g.letterSpacing = `${(w.spacing / 100) * px}px`;
        g.textBaseline = 'alphabetic';
        g.textAlign = 'left';
        g.lineJoin = 'round';
        // A box behind the word, over the font's line like Text+'s; it casts no shadow.
        if (L.box && !w.bar) {
            const bw = p.width / 2 + 0.15 * px;
            const top = base - p.fasc - 0.05 * px;
            const bh = p.fasc + p.fdesc + 0.1 * px;
            g.fillStyle = rgbaOf(L.box.color, L.box.opacity / 100);
            g.beginPath();
            if (g.roundRect) g.roundRect(-bw, top, 2 * bw, bh, 0.1 * px);
            else g.rect(-bw, top, 2 * bw, bh);
            g.fill();
        }
        if (w.glow) {
            g.save();
            g.shadowColor = rgbaOf(w.glow, 0.9);
            g.shadowBlur = 0.3 * px * k;
            g.fillStyle = w.glow;
            g.fillText(p.text, x, base);
            g.fillText(p.text, x, base);
            g.restore();
        }
        // Canvas shadows ignore the transform, so their offsets and blur are in canvas pixels.
        if (sh) {
            const a = (sh.angle * Math.PI) / 180;
            g.save();
            g.shadowColor = rgbaOf(sh.color, sh.opacity / 100);
            g.shadowBlur = sh.softness * unit * k;
            g.shadowOffsetX = Math.cos(a) * sh.distance * unit * k;
            g.shadowOffsetY = -Math.sin(a) * sh.distance * unit * k;
            g.fillStyle = g.strokeStyle = g.shadowColor;
            if (stroke) {
                g.lineWidth = stroke;
                g.strokeText(p.text, x, base);
            }
            g.fillText(p.text, x, base);
            g.restore();
        }
        if (w.bar) {
            g.fillStyle = w.bar;
            g.fillRect(-p.width / 2, base + 0.2 * px, p.width, 0.08 * px);
        }
        if (stroke) {
            g.lineWidth = stroke;
            g.strokeStyle = o.color;
            g.strokeText(p.text, x, base);
        }
        g.fillStyle = (p.emph && p.emph.color) || L.color || '#FFFFFF';
        g.fillText(p.text, x, base);
        return { c, ox: hw * k, oy: hh * k };
    }

    // A sprite with its ink centre at canvas pixel (x, y), tilted (degrees, counter-clockwise).
    function blit(g, spr, x, y, tilt, alpha) {
        const r = (-(tilt || 0) * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        g.globalAlpha = Math.max(0, Math.min(1, alpha));
        g.setTransform(cos, sin, -sin, cos, x, y);
        g.drawImage(spr.c, -spr.ox, -spr.oy);
    }

    // A still of Whip words at rest for a gallery card, each with a short streak back the way it
    // whipped in. Laid out by the look's pattern on a 9:16 frame and fitted into the card's stage,
    // which is wider than the frame: the words are drawn closer together vertically as long as no
    // two touch. words: [{ text, emph }]. Drawn once on screen, again when its fonts arrive.
    // canvas.play() / canvas.pause() run its words' whips in a loop (cardMotion) and back to the still.
    function whipStill(L, words) {
        const canvas = h('canvas', { class: 'whip-still', 'aria-hidden': 'true' });
        const W = Core.whip.DESIGN.width;
        const H = Core.whip.DESIGN.height;
        const PAD = 8;
        let scene = null; // what draw() worked out, for the loop
        const draw = () => {
            const cw = canvas.clientWidth;
            const ch = canvas.clientHeight;
            if (!canvas.isConnected || !cw || !ch) return;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
            const placed = whipLayout(words, 0, L, W, H);
            if (!placed.length) return;
            const boxes = placed.map((p) => [p.cx - p.width / 2, p.cy - (p.asc + p.desc) / 2, p.cx + p.width / 2, p.cy + (p.asc + p.desc) / 2]);
            const mid = (Math.min(...boxes.map((b) => b[1])) + Math.max(...boxes.map((b) => b[3]))) / 2;
            const gap = (0.12 * placed.reduce((a, p) => a + p.px, 0)) / placed.length;
            // No word bigger than the other cards' (Punch's one word would fill the stage).
            const most = 46 / Math.max(...placed.map((p) => p.px));
            let fit = null;
            for (const q of [1, 0.85, 0.7, 0.55, 0.4]) {
                const bs = boxes.map(([x0, y0, x1, y1]) => {
                    const c = mid + ((y0 + y1) / 2 - mid) * q;
                    return [x0, c - (y1 - y0) / 2, x1, c + (y1 - y0) / 2];
                });
                const touch = bs.some((a, i) => bs.some((b, j) => j > i && a[0] < b[2] && b[0] < a[2] && a[1] - gap < b[3] && b[1] - gap < a[3]));
                if (q < 1 && touch) break;
                const x0 = Math.min(...bs.map((b) => b[0]));
                const x1 = Math.max(...bs.map((b) => b[2]));
                const y0 = Math.min(...bs.map((b) => b[1]));
                const y1 = Math.max(...bs.map((b) => b[3]));
                const s = Math.min(most, (cw - 2 * PAD) / (x1 - x0), (ch - 2 * PAD) / (y1 - y0));
                if (!fit || s > fit.s) fit = { s, q, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
            }
            const g = canvas.getContext('2d');
            const k = fit.s * dpr;
            const sprites = placed.map((p) => whipSprite(p, L, W, k));
            // Frame pixels to card pixels, rows drawn closer as above.
            const at = (x, y) => [(cw / 2 + (x - fit.x) * fit.s) * dpr, (ch / 2 + (mid + (y - mid) * fit.q - fit.y) * fit.s) * dpr];
            scene = { g, placed, sprites, at };
            if (timer) return; // playing: the loop draws
            placed.forEach((p, i) => {
                const [x, y] = at(p.cx, p.cy);
                const dx = Math.cos((p.in * Math.PI) / 180) * p.px * fit.s * dpr;
                const dy = -Math.sin((p.in * Math.PI) / 180) * p.px * fit.s * dpr;
                [0.07, 0.13, 0.22].forEach((alpha, j) => blit(g, sprites[i], x + dx * 0.16 * (3 - j), y + dy * 0.16 * (3 - j), p.tilt, alpha));
                blit(g, sprites[i], x, y, p.tilt, 1);
            });
        };
        requestAnimationFrame(draw);
        const wait = fontsPending(words.map((w) => canvasFont(whipFont(w, L), 100)));
        if (wait) wait.then(() => requestAnimationFrame(draw));

        // The loop: the words spoken 7 frames apart, resting, whipping out, a short gap, again; at
        // 30 fps and drawn only when the frame changes, with a 4-sample blur (enough at this size).
        let timer = null;
        let keys = null;
        let len = 0;
        const frame = (f) => {
            const { g, placed, sprites, at } = scene;
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalAlpha = 1;
            g.clearRect(0, 0, canvas.width, canvas.height);
            const shutter = Core.whip.settings(L.whip).shutter / 360;
            placed.forEach((p, i) => {
                const now = Core.whip.wordAt(p, f, keys[i]);
                if (!now) return;
                const n = shutter && now.moving ? 4 : 1;
                for (let j = 0; j < n; j++) {
                    const q = n === 1 ? now : Core.whip.wordAt(p, f + (j / (n - 1) - 0.5) * shutter, keys[i]);
                    if (q) blit(g, sprites[i], ...at(q.x, q.y), p.tilt, q.opacity / n);
                }
            });
        };
        canvas.play = () => {
            if (timer || !scene) return;
            const starts = scene.placed.map((p, i) => i * 7);
            len = starts[starts.length - 1] + Core.whip.tail(starts.length, L.whip, 0) + 24;
            keys = Core.whip.animate(scene.placed, starts, len, L.whip, L.fade && L.fade.on ? L.fade : null);
            const t0 = performance.now();
            let last = -1;
            const tick = (now) => {
                if (!timer) return;
                if (!canvas.isConnected) {
                    timer = null;
                    return;
                }
                const f = Math.floor(((now - t0) / 1000) * 30) % (len + 8);
                if (f !== last) frame((last = f));
                timer = requestAnimationFrame(tick);
            };
            timer = requestAnimationFrame(tick);
        };
        canvas.pause = () => {
            if (!timer) return;
            cancelAnimationFrame(timer);
            timer = null;
            draw();
        };
        return canvas;
    }

    // Gallery cards move while the pointer (or keyboard focus) is on them, and the chosen one keeps
    // playing while the panel has focus. Stills otherwise, and always with reduced motion: nothing
    // runs while you work in Resolve. start/stop: the card's own animation.
    const cards = new Set();
    const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function cardMotion(btn, start, stop) {
        const card = { btn, start, stop, over: false, running: false };
        card.sync = () => {
            const want = btn.isConnected && !reducedMotion() && !document.hidden &&
                (card.over || (btn.classList.contains('on') && document.hasFocus()));
            if (want !== card.running) {
                card.running = want;
                if (want) start();
                else stop();
            }
        };
        const set = (over) => () => {
            card.over = over;
            card.sync();
        };
        btn.addEventListener('pointerenter', set(true));
        btn.addEventListener('pointerleave', set(false));
        btn.addEventListener('focus', set(true));
        btn.addEventListener('blur', set(false));
        syncCards();
        cards.add(card);
        requestAnimationFrame(card.sync);
        return btn;
    }
    function syncCards() {
        for (const c of cards) {
            if (c.btn.isConnected) c.sync();
            else {
                if (c.running) c.stop();
                cards.delete(c);
            }
        }
    }
    window.addEventListener('focus', syncCards);
    window.addEventListener('blur', syncCards);
    document.addEventListener('visibilitychange', syncCards);

    // A classic card's motion: the spoken word moves along the sample line (Pop pops it), as the
    // Deliver preview does. paint(active) repaints the words; -1 puts the still back.
    function wordCycle(btn, n, paint) {
        let timer = null;
        let active = 0;
        return cardMotion(btn, () => {
            active = 0;
            paint(active);
            timer = setInterval(() => paint((active = (active + 1) % n)), 450);
        }, () => {
            clearInterval(timer);
            timer = null;
            paint(-1);
        });
    }

    // Whip's preview clock: frames count from t0, kept outside the preview so that a redraw (every
    // slider step) plays on instead of starting the caption over. Another caption starts it again.
    const whipClock = { t0: 0, idx: null };
    const BLUR_SAMPLES = 9;
    const WHIP_GAP = 12; // empty frames between loops

    // Whip's preview: the caption shown, its words whipping in and out on a canvas over the
    // stand-in speaker in their real timing, looped, with the motion blur the comp gives them.
    // Drag a word to give it a place of its own (word.at); the loop holds on the frame where every
    // word is in while it's dragged. With reduced motion, that frame only.
    function whipPreview(W, H, fw, fh, portrait, L) {
        const i = S.pvIdx;
        const c = S.data.captions[i];
        const clip = finalClips()[i] || { start: 0, end: 1 };
        const words = whipWords(c, L);
        const placed = whipLayout(words, i, L, W, H);
        const starts = words.map((w) => Math.max(0, w.start - clip.start));
        const len = Math.max(1, clip.end - clip.start);
        const keys = Core.whip.animate(placed, starts, len, L.whip, L.fade.on ? L.fade : null);
        const rest = Core.whip.restFrame(starts, len, L.whip);
        const shutter = Core.whip.settings(L.whip).shutter / 360;
        const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const rate = fps();
        if (whipClock.idx !== i) {
            whipClock.idx = i;
            whipClock.t0 = performance.now();
        }
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const K = (fw / W) * dpr; // canvas pixels per frame pixel
        const canvas = h('canvas', { class: 'pv-canvas', width: String(Math.round(fw * dpr)), height: String(Math.round(fh * dpr)), role: 'img', 'aria-label': t('whip.dragHint') });
        const ctx = canvas.getContext('2d');
        const sprites = [];
        const sprite = (k) => sprites[k] || (sprites[k] = whipSprite(placed[k], L, W, K));
        let layer = null;
        const draw = (f) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let acc = null;
            placed.forEach((p, k) => {
                const now = Core.whip.wordAt(p, f, keys[k]);
                if (!now) return;
                if (!shutter || !now.moving) {
                    blit(ctx, sprite(k), now.x * K, now.y * K, p.tilt, now.opacity);
                    return;
                }
                if (!acc) {
                    if (!layer) {
                        layer = document.createElement('canvas');
                        layer.width = canvas.width;
                        layer.height = canvas.height;
                    }
                    acc = layer.getContext('2d');
                    acc.setTransform(1, 0, 0, 1, 0, 0);
                    acc.globalAlpha = 1;
                    acc.globalCompositeOperation = 'source-over';
                    acc.clearRect(0, 0, layer.width, layer.height);
                    acc.globalCompositeOperation = 'lighter';
                }
                // Box-filter motion blur: the average of the word's places while the shutter is open.
                for (let j = 0; j < BLUR_SAMPLES; j++) {
                    const q = Core.whip.wordAt(p, f + (j / (BLUR_SAMPLES - 1) - 0.5) * shutter, keys[k]);
                    if (q) blit(acc, sprite(k), q.x * K, q.y * K, p.tilt, q.opacity / BLUR_SAMPLES);
                }
            });
            if (acc) {
                acc.globalCompositeOperation = 'source-over';
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalAlpha = 1;
                ctx.drawImage(layer, 0, 0);
            }
        };

        // Dragging: a word is picked by its box at rest (tilt aside), 6 screen pixels of slack.
        let drag = null;
        let last = null;
        const slack = (6 * W) / fw;
        const toFrame = (e) => {
            const b = canvas.getBoundingClientRect();
            return [((e.clientX - b.left) * W) / b.width, ((e.clientY - b.top) * H) / b.height];
        };
        const hit = (x, y) => {
            for (let k = placed.length - 1; k >= 0; k--) {
                const p = placed[k];
                if (Math.abs(x - p.cx) <= p.width / 2 + slack && Math.abs(y - p.cy) <= (p.asc + p.desc) / 2 + slack) return k;
            }
            return -1;
        };
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const [x, y] = toFrame(e);
            const k = hit(x, y);
            if (k < 0) return;
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            const p = placed[k];
            drag = { k, dx: x - p.cx, dy: y - p.cy, x0: p.cx, y0: p.cy, moved: false };
            canvas.classList.add('dragging');
            draw(rest);
        });
        // Redraws only the canvas while dragging: the rest of the screen stays as it is until the drop.
        canvas.addEventListener('pointermove', (e) => {
            const [x, y] = toFrame(e);
            if (!drag) {
                canvas.classList.toggle('over', hit(x, y) >= 0);
                return;
            }
            const p = placed[drag.k];
            p.cx = Math.min(W, Math.max(0, x - drag.dx));
            p.cy = Math.min(H, Math.max(0, y - drag.dy));
            drag.moved = drag.moved || Math.hypot(p.cx - drag.x0, p.cy - drag.y0) > 1;
            draw(rest);
        });
        const drop = (keep) => {
            if (!drag) return;
            const d = drag;
            const p = placed[d.k];
            drag = null;
            canvas.classList.remove('dragging');
            if (keep && d.moved) {
                const at = { x: round4(p.cx / W), y: round4(p.cy / H) };
                commitPlaces(withPlaces((ci, wi) => (ci === i && wi === words[d.k].index ? at : undefined)));
                return;
            }
            p.cx = d.x0;
            p.cy = d.y0;
            last = null;
            if (still) draw(rest);
        };
        canvas.addEventListener('pointerup', () => drop(true));
        canvas.addEventListener('pointercancel', () => drop(false));

        // The loop runs while the canvas is on screen: it isn't yet when built, and stops once replaced.
        let seen = false;
        let waits = 0;
        const tick = (now) => {
            if (!canvas.isConnected) {
                if (!seen && ++waits < 30) requestAnimationFrame(tick);
                return;
            }
            seen = true;
            if (!drag) {
                const f = still ? rest : Math.floor(((Math.max(0, now - whipClock.t0) / 1000) * rate) % (len + WHIP_GAP));
                if (f !== last) {
                    last = f;
                    draw(f);
                }
            }
            if (!still) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        const guide = portrait && L.guide ? h('img', { class: 'pv-guide', src: 'assets/guide-9x16.svg', alt: '' }) : null;
        const frame = h('div', { class: 'pv-frame', style: `width:${fw}px;height:${fh}px` },
            h('img', { class: 'pv-figure', src: 'assets/silhouette.svg', alt: '' }), guide, canvas);
        const wrap = h('div', { class: 'pv-wrap' }, frame, words.length ? h('p', { class: 'hint', style: 'margin:0;text-align:center' }, t('whip.dragHint')) : null);
        // Measured in a fallback font until its own arrives: then laid out again.
        const wait = fontsPending(words.map((w) => canvasFont(whipFont(w, L), 100)));
        if (wait) {
            wait.then(() => {
                if (wrap.isConnected && !drag) wrap.replaceWith(previewFrame());
            });
        }
        return wrap;
    }

    // A new captions list with `at` changed on some words, copied on write so the list before
    // stays whole for undo. place(ci, wi, word) → the word's new `at`, null to clear it, undefined
    // to leave it. The same list when nothing changes.
    function withPlaces(place) {
        let any = false;
        const next = S.data.captions.map((c, ci) => {
            let changed = false;
            const words = c.words.map((w, wi) => {
                const at = place(ci, wi, w);
                if (at === undefined || (at === null && !w.at)) return w;
                changed = true;
                const nw = Object.assign({}, w);
                if (at) nw.at = at;
                else delete nw.at;
                return nw;
            });
            if (!changed) return c;
            any = true;
            return Object.assign({}, c, { words });
        });
        return any ? next : S.data.captions;
    }

    // Whip words moved by hand: saved with the captions, one step of Deliver's undo (lookHist), and
    // Live in viewer shows them in Resolve.
    function commitPlaces(next) {
        if (next === S.data.captions) return;
        lookHist.past.push({ captions: S.data.captions, when: next });
        if (lookHist.past.length > 100) lookHist.past.shift();
        lookHist.future = [];
        S.data.captions = next;
        S.data.edited = true;
        saveData();
        renderScreen();
        renderFooter();
        scheduleLive();
    }

    // Words moved in Resolve's viewer: reads the Text+ Centers of the Whip caption at Resolve's
    // playhead (a delivered one, or the test one) and keeps every word that moved as a place of its
    // own. A delivered caption is matched by its place on its track, like Modify existing; the test
    // caption is the one shown here.
    async function whipFromResolve() {
        const tl = timeline();
        if (!tl || !S.data.captions[S.pvIdx]) return;
        const before = S.data.captions;
        try {
            const track = S.deliverMode === 'modify' ? S.modTrack : S.data.track;
            const got = (await call('whipPositions', { track: Number.isInteger(track) ? track : null })) || {};
            if (S.data.captions !== before) return; // the captions changed meanwhile
            const delivered = Number.isInteger(got.index);
            if (delivered && (got.count !== before.length || got.index < 0)) {
                flash(t('err.countMismatch', { track: got.track, have: got.count, want: before.length }), true);
                return;
            }
            const i = delivered ? got.index : S.pvIdx;
            const c = before[i];
            const L = look();
            const words = whipWords(c, L);
            const texts = Array.isArray(got.texts) ? got.texts : [];
            const origins = Array.isArray(got.origins) ? got.origins : [];
            if (texts.length !== words.length || texts.some((x, k) => x !== words[k].text)) {
                flash(delivered ? t('whip.notDelivered', { n: i + 1, track: got.track }) : t('whip.notThis', { n: i + 1 }), true);
                return;
            }
            // The preview shows the caption the positions are for.
            if (S.pvIdx !== i) {
                S.pvIdx = i;
                renderScreen();
            }
            // A word whose position was keyed in Resolve comes back null and is left alone.
            if (origins.length !== words.length || !origins.every((o) => o === null || (Array.isArray(o) && isFinite(o[0]) && isFinite(o[1])))) {
                flash(t('err.positionsRead'), true);
                return;
            }
            const placed = whipLayout(words, i, L, tl.width, tl.height);
            const moved = new Map();
            origins.forEach((o, k) => {
                if (!o) return;
                const at = Core.whip.fromTextPlus(o, placed[k], tl.width, tl.height);
                // Words left where the comp put them stay with the pattern.
                if (Math.abs(at.x - placed[k].cx / tl.width) > 0.0015 || Math.abs(at.y - placed[k].cy / tl.height) > 0.0015) {
                    moved.set(words[k].index, { x: round4(at.x), y: round4(at.y) });
                }
            });
            if (!moved.size) {
                flash(t('whip.takenNone'));
                return;
            }
            commitPlaces(withPlaces((ci, wi) => (ci === i && moved.has(wi) ? moved.get(wi) : undefined)));
            flash(t(moved.size === 1 ? 'whip.takenOne' : 'whip.taken', { n: moved.size, c: i + 1 }));
        } catch (e) {
            flash(e.message, true);
        }
    }

    // Every moved word, in every caption, back in its pattern.
    function whipResetPlaces() {
        commitPlaces(withPlaces((ci, wi, w) => (w.at ? null : undefined)));
        flash(t('whip.resetDone'));
    }

    // The preview: the caption as it will sit in the frame, cycling through its words.
    function previewFrame() {
        const tl = timeline();
        const W = tl ? tl.width : 1920;
        const H = tl ? tl.height : 1080;
        const portrait = H > W;
        const fw = portrait ? 210 : 380;
        const fh = Math.round((fw * H) / W);
        const L = look();
        const ref = styleRef();
        const st = ref.source === 'pack' ? window.STARTER_STYLES.find((s) => s.id === ref.id) : null;
        if (st && st.whip) return whipPreview(W, H, fw, fh, portrait, L);
        // A bin template keeps its own font and colour; with "keep size and position" its own size too,
        // which the preview can't know, so the overflow check would measure the wrong thing.
        const bin = ref.source === 'bin';
        const kept = bin && L.keepTemplate;
        const own = L.font && !bin;
        const ownStyle = own ? fontStyleFor(L.font, L.fontStyle) : null;
        const fontCss = own ? fontDecl(L.font, ownStyle) : '';
        // Sized like Text+: by the font's line height, so fonts with tall metrics come out smaller.
        const baseLine = own ? lineOf(L.font, ownStyle) : lineOf('Montserrat', 'ExtraBold');
        const capPx = (Core.fonts.LINE_PER_SIZE * (L.size / 1000) * fw) / baseLine;
        const c = S.data.captions[S.pvIdx];
        const words = [];
        let lineBreak = null;
        (c ? c.words : []).forEach((w, i) => {
            const text = Core.textfx.apply(w.text, L.caseMode, L.strip);
            if (!text) return;
            if (c.lineBreak != null && i >= c.lineBreak && lineBreak == null && words.length) lineBreak = words.length;
            words.push({ text, emph: w.emph });
        });
        const paintLook = lookPaint(L, st, bin, fw / 1080, baseLine);
        const shade = paintLook.shade;
        const spans = words.map((w) => h('span', { class: 'pv-word' }, w.text));
        const paint = (active) => spans.forEach((sp, k) => {
            const w = words[k];
            const e = w.emph ? Object.assign({}, w.emph, S.deliverMode === 'modify' && L.emphOn ? { color: L.emphColor, size: L.emphSize } : {}) : null;
            let css = paintLook.word(k, active) + fontCss;
            if (e) {
                const eStyle = e.font ? e.fontStyle || fontStyleFor(e.font) : null;
                const size = (e.size || 1) * (e.font ? baseLine / lineOf(e.font, eStyle) : 1);
                css += `color:${k === active && st && st.id === 'highlight' ? '#111' : e.color};font-size:${size.toFixed(3)}em;` + (e.font ? fontDecl(e.font, eStyle) : '');
            }
            sp.style.cssText = shade(css, k === active) + 'margin:0 .12em;';
        });
        let active = 0;
        paint(active);
        let timer = null;
        if (spans.length > 1) {
            timer = setInterval(() => {
                active = (active + 1) % spans.length;
                paint(active);
            }, 550);
            pvTimers.push(timer);
        }
        const content = [];
        spans.forEach((sp, k) => {
            if (k === lineBreak) content.push(h('br'));
            content.push(sp);
        });
        const lineCss = paintLook.line;
        const cap = h('div', {
            class: 'pv-cap',
            style: `left:${L.x}%;top:${L.y}%;font-size:${capPx.toFixed(1)}px;`
        }, h('span', { style: lineCss }, content));
        if (st) motionPreview(cap.firstChild, L, Math.max(1200, spans.length * 550));
        const guide = portrait && L.guide ? h('img', { class: 'pv-guide', src: 'assets/guide-9x16.svg', alt: '' }) : null;
        const warn = h('div', { class: 'pv-warn', role: 'alert', hidden: true }, t('de.overflow'));
        const frame = h('div', { class: 'pv-frame', style: `width:${fw}px;height:${fh}px` },
            h('img', { class: 'pv-figure', src: 'assets/silhouette.svg', alt: '' }), guide, cap, warn);
        // Emphasized words keep their own colour, so a caption made only of them won't change.
        const allEmph = words.length && words.every((w) => w.emph);
        const emphNote = L.color && !bin && allEmph ? h('p', { class: 'hint', style: 'margin:0;text-align:center' }, t('de.emphKeepsColor')) : null;
        // Once laid out, flag a caption that runs past the frame edges.
        setTimeout(() => {
            if (!frame.isConnected || kept) return;
            const f = frame.getBoundingClientRect();
            const c = cap.getBoundingClientRect();
            const over = c.left < f.left - 1 || c.right > f.right + 1;
            warn.hidden = !over;
            frame.classList.toggle('over', over);
        }, 30);
        const wrap = h('div', { class: 'pv-wrap' }, frame, emphNote);
        wrap.pvTimer = timer;
        return wrap;
    }

    // The track list once loaded; until then a spinner, or why it failed and a retry.
    function trackSlot(make) {
        if (S.tracks) return make();
        if (!S.tracksError) return h('span', { class: 'spinner' });
        return h('div', { class: 'track-err', title: S.tracksError },
            h('span', null, t('de.tracksFailed')),
            h('button', { type: 'button', class: 'linklike', onclick: () => {
                S.tracksError = null;
                renderScreen();
                loadTracks();
            } }, t('de.tracksRetry')));
    }

    function trackOptions(onlyOurs) {
        const list = (S.tracks || []).filter((tr) => !onlyOurs || tr.ours > 0);
        const opts = list.map((tr) => [tr.index, `V${tr.index} · ${tr.name}${tr.ours ? ' · ' + t('de.ours', { n: tr.ours }) : ''}`]);
        return onlyOurs ? opts : [['new', t('de.newTrack')]].concat(opts);
    }

    // A Deliver section heading with a reset button that puts just that section's settings back
    // to DEFAULT_LOOK (one undo step); greyed out while they already are. sub: { key, keys } puts
    // back some keys inside one nested setting too (Whip's, split between Look and Whip).
    const LOOK_KEYS = ['keepTemplate', 'font', 'fontStyle', 'color', 'size', 'x', 'y', 'caseMode', 'strip'];
    function resetSection(title, keys, sub) {
        const L = look();
        const defaults = Object.fromEntries(keys.map((k) => [k, k in DEFAULT_LOOK ? JSON.parse(JSON.stringify(DEFAULT_LOOK[k])) : '']));
        let same = keys.every((k) => JSON.stringify(L[k] == null ? '' : L[k]) === JSON.stringify(defaults[k]));
        if (sub) {
            const D = DEFAULT_LOOK[sub.key];
            same = same && sub.keys.every((k) => L[sub.key][k] === D[k]);
            defaults[sub.key] = Object.assign({}, L[sub.key], Object.fromEntries(sub.keys.map((k) => [k, D[k]])));
        }
        return h('div', { class: 'section-row' }, section(title),
            // A reset arrow like the one on Resolve's Inspector sections.
            h('button', { type: 'button', class: 'icon-btn reset', disabled: same, title: t('de.resetTitle', { section: title }), 'aria-label': t('de.resetTitle', { section: title }), onclick: () => setLook(defaults) }, icon('reset', 16)));
    }

    function lookControls() {
        const L = look();
        const ref = styleRef();
        const saved = presetList();
        // What a bin template takes from here: text, emphasis, shadow, and size/position unless kept.
        const bin = ref.source === 'bin';
        const kept = bin && L.keepTemplate;
        // Whip's Size and Position size and place its whole pattern (look.whip), so they reset there.
        const whip = isWhip();
        const whipLive = (key) => (v) => livePreview({ whip: Object.assign({}, look().whip, { [key]: v }) });
        return [
            whip ? resetSection(t('de.look'), LOOK_KEYS.filter((k) => !['size', 'x', 'y'].includes(k)), { key: 'whip', keys: ['scale', 'x', 'y'] })
                : resetSection(t('de.look'), LOOK_KEYS),
            h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'lkPreset' }, t('de.preset')),
                select('lkPreset', [['', t('de.presetPick')]]
                    .concat(saved.length ? [{ group: t('se.yourPresets'), options: saved.map((p, i) => [`u${i}`, p.name]) }] : [])
                    .concat([{ group: t('se.builtins'), options: Core.builtins.BUILTINS.map((p, i) => [`b${i}`, presetName(p)]) }]), '', (v) => {
                    if (v) applyPreset(v[0] === 'b' ? Core.builtins.BUILTINS[Number(v.slice(1))] : saved[Number(v.slice(1))]);
                })),
            bin ? checkbox('keepTpl', t('de.keepTemplate'), L.keepTemplate, (v) => setLook({ keepTemplate: v })) : null,
            bin ? h('p', { class: 'hint', style: 'margin-top:4px' }, t(kept ? 'de.fromTemplateKept' : 'de.fromTemplate')) : null,
            bin ? null : h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'lkFont' }, t('ed.font')),
                select('lkFont', fontChoices(L.font, t('de.styleDefault')), L.font, (v) => setLook({ font: v, fontStyle: '' }))),
            !bin && L.font && (stylesOf(L.font) || []).length > 1
                ? h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'lkFontStyle' }, t('de.fontStyle')),
                    select('lkFontStyle', stylesOf(L.font).map((s) => [s, s]), fontStyleFor(L.font, L.fontStyle), (v) => setLook({ fontStyle: v })))
                : null,
            bin ? null : h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('de.textColor')),
                colorSwatches(TEXT_COLORS, L.color, (col) => setLook({ color: col }), t('de.textColor'), true)),
            kept ? null : whip ? [
                slider('lkSize', t('ed.size'), 30, 200, 1, L.whip.scale, whipLive('scale'), saveSettings),
                slider('lkX', t('de.posX'), 0, 100, 1, L.whip.x, whipLive('x'), saveSettings),
                slider('lkY', t('de.posY'), 0, 100, 1, L.whip.y, whipLive('y'), saveSettings)
            ] : [
                slider('lkSize', t('ed.size'), 30, 200, 1, L.size, (v) => livePreview({ size: v }), saveSettings),
                slider('lkX', t('de.posX'), 0, 100, 1, L.x, (v) => livePreview({ x: v }), saveSettings),
                slider('lkY', t('de.posY'), 0, 100, 1, L.y, (v) => livePreview({ y: v }), saveSettings)
            ],
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('de.case')),
                seg([['as', t('de.caseAs')], ['upper', t('de.caseUpper')], ['lower', t('de.caseLower')]], L.caseMode, (v) => setLook({ caseMode: v }), t('de.case'))),
            h('div', { class: 'row top-align' }, h('span', { class: 'lbl', style: 'padding-top:6px' }, t('de.strip')),
                h('div', { class: 'chips', role: 'group', 'aria-label': t('de.strip') }, stripChips(L))),
            styleSettings(L, ref),
            resetSection(t('de.shadow'), ['shadow']),
            checkbox('shadowOn', t('de.shadowOn'), L.shadow.on, (v) => setLook({ shadow: Object.assign({}, L.shadow, { on: v }) })),
            L.shadow.on ? [
                h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('ed.color')),
                    colorSwatches(SHADOW_COLORS, L.shadow.color, (col) => setLook({ shadow: Object.assign({}, L.shadow, { color: col }) }), t('de.shadowColor'), false)),
                slider('shOpacity', t('de.opacity'), 0, 100, 1, L.shadow.opacity, (v) => livePreview({ shadow: Object.assign(L.shadow, { opacity: v }) }), saveSettings),
                slider('shDistance', t('de.distance'), 0, 40, 1, L.shadow.distance, (v) => livePreview({ shadow: Object.assign(L.shadow, { distance: v }) }), saveSettings),
                slider('shAngle', t('de.angle'), 0, 359, 1, L.shadow.angle, (v) => livePreview({ shadow: Object.assign(L.shadow, { angle: v }) }), saveSettings),
                slider('shSoftness', t('de.softness'), 0, 40, 1, L.shadow.softness, (v) => livePreview({ shadow: Object.assign(L.shadow, { softness: v }) }), saveSettings)
            ] : null,
            motionSettings(L, ref)
        ];
    }

    // Fade and tracking, built into the starter styles' comps (a bin template keeps its own motion).
    // Whip fades each word on its own and has no tracking.
    function motionSettings(L, ref) {
        if (ref.source !== 'pack') return null;
        const f = L.fade;
        const tr = L.tracking;
        const whip = ref.id === 'whip';
        return [
            resetSection(t('de.motion'), whip ? ['fade'] : ['fade', 'tracking']),
            checkbox('fadeOn', t('de.fadeOn'), f.on, (v) => setLook({ fade: Object.assign({}, f, { on: v }) })),
            whip ? h('p', { class: 'hint', style: 'margin-top:2px' }, t('whip.fadeHint')) : null,
            f.on ? [
                slider('lkFadeIn', t('de.fadeIn'), 0, 30, 1, f.in, (v) => livePreview({ fade: Object.assign(f, { in: v }) }), saveSettings),
                slider('lkFadeOut', t('de.fadeOut'), 0, 30, 1, f.out, (v) => livePreview({ fade: Object.assign(f, { out: v }) }), saveSettings),
                slider('lkRest', t('de.rest'), 10, 100, 1, f.rest, (v) => livePreview({ fade: Object.assign(f, { rest: v }) }), saveSettings)
            ] : null,
            whip ? null : checkbox('trackOn', t('de.trackOn'), tr.on, (v) => setLook({ tracking: Object.assign({}, tr, { on: v }) })),
            // One speed: the drift starts that much tight, so it passes normal spacing about a second in.
            tr.on && !whip ? slider('lkTrackSpeed', t('de.trackSpeed'), 1, 25, 1, tr.speed, (v) => livePreview({ tracking: Object.assign(tr, { speed: v, from: 100 - v }) }), saveSettings) : null
        ];
    }

    // Five, like the text colours, so the row fits on one line with the custom colour and the pipette.
    const ACCENT_COLORS = ['', '#FFFFFF', '#FFD93B', '#2EE86B', '#FF3EA5', '#6FB7FF'];
    const OUTLINE_COLORS = ['#000000', '#1B1B1D', '#FFFFFF', '#FFD93B'];
    const BOX_COLORS = ['#000000', '#1B1B1D', '#FFFFFF', '#FFD93B', '#FF6B3D'];

    // The starter style's own settings, only those the chosen style uses. A bin template keeps
    // its own design, so it gets none.
    // Whip's emphasis colour comes from the brush, so it has no accent; its box is per word.
    function styleSettings(L, ref) {
        if (ref.source !== 'pack') return null;
        const id = ref.id;
        const accent = !['plain', 'typewriter', 'whip'].includes(id);
        const boxOn = id === 'plain' || id === 'whip';
        const box = id === 'ribbon' || boxOn;
        const o = L.outline;
        const setBox = (patch) => setLook({ box: Object.assign({ color: id === 'ribbon' ? '#111111' : '#000000', opacity: 100 }, L.box || {}, patch) });
        return [
            id === 'whip' ? whipSettings(L) : null,
            resetSection(t('de.styleSettings'), ['accent', 'box', 'pop', 'dim', 'outline']),
            accent ? h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('de.accent')),
                colorSwatches(ACCENT_COLORS, L.accent, (col) => setLook({ accent: col }), t('de.accent'), true)) : null,
            id === 'pop' ? checkbox('popOn', t('de.popOn'), L.pop !== false, (v) => setLook({ pop: v })) : null,
            id === 'spotlight' ? slider('lkDim', t('de.dim'), 0, 100, 1, L.dim, (v) => livePreview({ dim: v }), saveSettings) : null,
            boxOn ? checkbox('boxOn', t('de.boxOn'), !!L.box, (v) => setLook({ box: v ? { color: '#000000', opacity: 62 } : null })) : null,
            box && (L.box || id === 'ribbon') ? [
                h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('de.boxColor')),
                    colorSwatches(BOX_COLORS, L.box ? L.box.color : '#111111', (col) => setBox({ color: col }), t('de.boxColor'), false)),
                slider('lkBoxOpacity', t('de.boxOpacity'), 0, 100, 1, L.box ? L.box.opacity : 100, (v) => {
                    L.box = Object.assign({ color: '#111111' }, L.box || {}, { opacity: v });
                    livePreview({});
                }, saveSettings)
            ] : null,
            checkbox('outlineOn', t('de.outlineOn'), o.on, (v) => setLook({ outline: Object.assign({}, o, { on: v }) })),
            o.on ? [
                h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('ed.color')),
                    colorSwatches(OUTLINE_COLORS, o.color, (col) => setLook({ outline: Object.assign({}, o, { color: col }) }), t('de.outlineOn'), false)),
                // Thickness in hundredths of the text size (Text+ Thickness × 100).
                slider('lkOutline', t('de.outlineWidth'), 1, 20, 1, Math.round(o.width * 100), (v) => livePreview({ outline: Object.assign(o, { width: v / 100 }) }), saveSettings)
            ] : null
        ];
    }

    const GLOW_COLORS = ['', '#6FB7FF', '#FF3EA5', '#FFD93B', '#2EE86B', '#FFFFFF'];
    const BAR_COLORS = ['', '#FF8A1F', '#FFD93B', '#2EE86B', '#FF3EA5', '#FFFFFF'];
    // Whip's own section resets these; its size and position belong to Look.
    const WHIP_KEYS = Object.keys(Core.whip.DEFAULTS).filter((k) => !['scale', 'x', 'y'].includes(k));

    // The pictures on Whip's Comes in / Goes out buttons: dots are words where they rest, arrows their
    // whips, a dashed line the way a word came in. Named by the button's title on hover.
    function whipIcon(kind, name) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = (tag, attrs) => {
            const el = document.createElementNS(NS, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
            return el;
        };
        const arrow = (x1, y1, x2, y2) => {
            const len = Math.hypot(x2 - x1, y2 - y1);
            const dx = (x2 - x1) / len;
            const dy = (y2 - y1) / len;
            const back = (s) => `${x2 - 3.6 * dx + s * 2.6 * dy},${y2 - 3.6 * dy - s * 2.6 * dx}`;
            return [svg('line', { x1, y1, x2, y2 }), svg('polyline', { points: `${back(1)} ${x2},${y2} ${back(-1)}` })];
        };
        const came = (x1, y1, x2, y2) => svg('line', { class: 'came', x1, y1, x2, y2 });
        const word = (cx, cy) => svg('circle', { class: 'word', cx, cy, r: 2.2 });
        const parts = {
            inPattern: [...arrow(3, 8, 12, 8), ...arrow(28, 2, 19.5, 5.8), ...arrow(27, 15, 19.3, 10.6), word(16, 8)],
            inFixed: [...arrow(4, 4.5, 20.5, 4.5), ...arrow(4, 11.5, 20.5, 11.5), word(25, 4.5), word(25, 11.5)],
            outPattern: [...arrow(12, 8, 3, 8), ...arrow(19.5, 5.8, 28, 2), ...arrow(19.3, 10.6, 27, 15), word(16, 8)],
            outFixed: [...arrow(11.5, 4.5, 28, 4.5), ...arrow(11.5, 11.5, 28, 11.5), word(7, 4.5), word(7, 11.5)],
            back: [came(3, 5, 19, 5), ...arrow(19, 11, 4, 11), word(24, 8)],
            through: [came(2, 8, 12, 8), ...arrow(20, 8, 30, 8), word(16, 8)]
        }[kind];
        const pic = svg('svg', { class: 'whip-icon', viewBox: '0 0 32 16', role: 'img', 'aria-label': name });
        pic.append(...parts);
        return pic;
    }

    // Whip: where the words go, which way they whip in and out, how far and fast, the motion blur,
    // letter spacing, glow and underline; and words moved by hand (the preview, Resolve's viewer).
    function whipSettings(L) {
        const w = L.whip;
        const set = (patch) => setLook({ whip: Object.assign({}, look().whip, patch) });
        const live = (key) => (v) => livePreview({ whip: Object.assign({}, look().whip, { [key]: v }) });
        const pattern = Core.whip.PATTERNS[w.pattern] || Core.whip.PATTERNS[Core.whip.DEFAULTS.pattern];
        const r = S.settings.rules;
        const moved = S.data.captions.some((c) => c.words.some((x) => x.at));
        // [value, icon, name, what it does]: the name and what it does show on hover.
        const mode = ([v, icon, name, what]) => [v, whipIcon(icon, name), false, `${name}: ${what}`];
        return [
            resetSection(t('whip.title'), [], { key: 'whip', keys: WHIP_KEYS }),
            h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'whPattern' }, t('whip.pattern')),
                select('whPattern', Core.whip.PATTERN_IDS.map((id) => [id, t('whip.' + id)]), w.pattern, (v) => set({ pattern: v }))),
            r.maxWords * (r.lines || 1) > pattern.maxWords ? h('p', { class: 'hint', style: 'margin:2px 14px 6px' }, t('whip.patternHint', { n: pattern.maxWords })) : null,
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('whip.in')),
                seg([['pattern', 'inPattern', t('whip.byPattern'), t('whip.byPatternTitle')], ['fixed', 'inFixed', t('whip.fixed'), t('whip.fixedTitle')]].map(mode),
                    w.inMode, (v) => set({ inMode: v }), t('whip.in'))),
            w.inMode === 'fixed' ? angleDial('whInAngle', t('whip.inAngle'), Math.round(w.inAngle), live('inAngle'), saveSettings, true) : null,
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('whip.out')),
                seg([['pattern', 'outPattern', t('whip.byPattern'), t('whip.byPatternOutTitle')], ['fixed', 'outFixed', t('whip.fixed'), t('whip.fixedOutTitle')],
                    ['back', 'back', t('whip.back'), t('whip.backTitle')], ['through', 'through', t('whip.through'), t('whip.throughTitle')]].map(mode),
                w.outMode, (v) => set({ outMode: v }), t('whip.out'))),
            w.outMode === 'fixed' ? angleDial('whOutAngle', t('whip.outAngle'), Math.round(w.outAngle), live('outAngle'), saveSettings) : null,
            slider('whDistance', t('whip.distance'), 0, 150, 1, w.distance, live('distance'), saveSettings),
            slider('whInFrames', t('whip.inFrames'), 1, 20, 1, w.inFrames, live('inFrames'), saveSettings),
            slider('whOutFrames', t('whip.outFrames'), 1, 20, 1, w.outFrames, live('outFrames'), saveSettings),
            slider('whOvershoot', t('whip.overshoot'), 0, 30, 1, w.overshoot, live('overshoot'), saveSettings),
            slider('whStagger', t('whip.stagger'), 0, 6, 1, w.stagger, live('stagger'), saveSettings),
            slider('whShutter', t('whip.shutter'), 0, 360, 1, w.shutter, live('shutter'), saveSettings),
            slider('whSpacing', t('whip.spacing'), -15, 30, 1, w.spacing, live('spacing'), saveSettings),
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('whip.glow')),
                colorSwatches(GLOW_COLORS, w.glow, (col) => set({ glow: col }), t('whip.glow'), true, t('whip.none'))),
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('whip.bar')),
                colorSwatches(BAR_COLORS, w.bar, (col) => set({ bar: col }), t('whip.bar'), true, t('whip.none'))),
            api.whipPositions ? [
                h('p', { class: 'hint', style: 'margin:10px 14px 6px' }, t('whip.moveHint')),
                h('div', { class: 'pad stack' },
                    h('button', { type: 'button', class: 'btn block', disabled: !!S.busy || !S.connected, title: t('whip.fromResolveTitle'), onclick: whipFromResolve }, t('whip.fromResolve')),
                    moved ? h('button', { type: 'button', class: 'btn block', onclick: whipResetPlaces }, t('whip.resetMoved')) : null)
            ] : moved ? h('div', { class: 'pad', style: 'margin-top:8px' },
                h('button', { type: 'button', class: 'btn block', onclick: whipResetPlaces }, t('whip.resetMoved'))) : null
        ];
    }

    // Preset swatches plus a custom colour picker. withDefault adds a "style default" swatch (''),
    // named noneLabel instead where '' means no colour at all (Whip's glow and underline).
    function colorSwatches(colors, value, onPick, label, withDefault, noneLabel) {
        const list = withDefault ? colors : colors.filter(Boolean);
        const custom = value && !list.includes(value);
        const empty = noneLabel || t('de.styleDefault');
        return h('div', { class: 'swatches', role: 'group', 'aria-label': label },
            list.map((col) => h('button', {
                type: 'button', class: 'swatch' + (value === col ? ' on' : '') + (col ? '' : ' none'),
                style: col ? `background:${col}` : null, title: col || empty, 'aria-label': col || empty,
                'aria-pressed': String(value === col), onclick: () => onPick(col)
            })),
            h('input', {
                type: 'color', class: 'swatch-custom' + (custom ? ' on' : ''), value: /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#ffffff',
                title: t('ed.customColor'), 'aria-label': t('ed.customColor'), onchange: (e) => onPick(e.target.value.toUpperCase())
            }),
            // Anywhere on screen (Resolve's viewer included): the colour input's eyedropper only
            // reaches the panel's own window.
            api.pickColor ? h('button', {
                type: 'button', class: 'swatch-pick', title: t('ed.pickScreen'), 'aria-label': t('ed.pickScreen'),
                onclick: async () => {
                    try {
                        const color = await call('pickColor', t('ed.pickHint'));
                        if (color) onPick(color);
                    } catch (e) {
                        flash(e.message, true);
                    }
                }
            }, icon('pipette', 15)) : null);
    }

    // Punctuation toggles, with "All" switching every mark on (or off when all are on).
    function stripChips(L) {
        const keys = Core.textfx.MARKS.map((m) => m.key);
        const all = keys.every((k) => L.strip[k]);
        const allChip = h('button', {
            type: 'button', class: 'chip' + (all ? ' on' : ''), 'aria-pressed': String(all), title: t('de.stripAllTitle'),
            onclick: () => setLook({ strip: Object.fromEntries(keys.map((k) => [k, !all])) })
        }, t('de.stripAll'));
        return [allChip].concat(Core.textfx.MARKS.map((m) => h('button', {
            type: 'button', class: 'chip punct' + (L.strip[m.key] ? ' on' : ''), 'aria-pressed': String(!!L.strip[m.key]),
            title: t('de.stripOne', { m: m.label }),
            onclick: () => setLook({ strip: Object.assign({}, L.strip, { [m.key]: !L.strip[m.key] }) })
        }, m.label)));
    }

    function viewDeliver() {
        ensureFamilies();
        const caps = S.data.captions;
        if (!caps.length) return h('div', { class: 'empty' }, h('strong', null, t('ed.empty')), t('ed.emptyHint'));
        if (S.tracks === undefined) {
            S.tracks = null;
            S.tracksError = null;
            setTimeout(loadTracks, 0);
        }
        if (S.pvIdx == null || S.pvIdx >= caps.length) S.pvIdx = Core.timing.worstCase(caps);
        const L = look();
        const modify = S.deliverMode === 'modify';
        const tl = timeline();
        const portrait = tl && tl.height > tl.width;

        // The preview keeps its place in the page (slot); once scrolled past, it moves into a band
        // stuck to the top of the screen, smaller, so it stays in sight while you change settings.
        const head = [
            h('div', { class: 'pad', style: 'margin:14px 0 10px' }, seg([['create', t('de.create')], ['modify', t('de.modify')]], S.deliverMode, (v) => {
                S.deliverMode = v;
                S.message = null;
                renderScreen();
                renderFooter();
            }, t('de.mode'))),
            // The preview section stays at the top while the settings scroll underneath it.
            h('div', { class: 'pv-sticky' }, h('div', { class: 'pv-tools' },
                portrait
                    ? h('label', { class: 'pv-zone-pick', title: t('de.guideTitle') },
                        h('input', { type: 'checkbox', checked: !!L.guide, onchange: (e) => {
                            if (!e.target.checked) S.renderWarn = false;
                            setLook({ guide: e.target.checked }, true);
                            syncGuide(true);
                        } }), t('de.guide'))
                    : h('span'),
                h('div', { class: 'stepper' },
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('de.prev'), onclick: () => { S.pvIdx = Math.max(0, S.pvIdx - 1); renderScreen(); } }, '‹'),
                    h('span', { class: 'mono' }, `${S.pvIdx + 1} / ${caps.length}`),
                    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('de.next'), onclick: () => { S.pvIdx = Math.min(caps.length - 1, S.pvIdx + 1); renderScreen(); } }, '›'),
                    h('button', { type: 'button', class: 'linklike', style: 'margin-left:6px', onclick: () => { S.pvIdx = Core.timing.worstCase(caps); renderScreen(); } }, t('de.longest')))),
            S.renderWarn && L.guide ? note(t('de.guideRender'), 'err') : null,
            previewFrame(),
            // Test and Live belong with the preview: what you see here, in Resolve's viewer.
            modify ? null : h('div', { class: 'pad', style: 'margin-top:8px' },
                h('button', { type: 'button', class: 'btn block', disabled: !!S.busy, onclick: testCaption, title: t('de.testTitle') }, t('de.test'))),
            modify ? null : h('div', { title: t('de.liveTitle') }, checkbox('liveView', t('de.live'), !!S.live, (v) => toggleLive(v)))),
            styleRef().source === 'bin' ? h('p', { class: 'hint', style: 'margin-top:6px' }, t('de.binPreview')) : null
        ];

        if (modify) {
            if (!S.bin && !S.binLoading && S.connected) setTimeout(scanBin, 0);
            const tracks = trackOptions(true);
            if (S.tracks && !tracks.length) return h('div', null, head, note(t('de.noneToModify')));
            if (tracks.length && !tracks.some(([i]) => i === S.modTrack)) S.modTrack = tracks[0][0];
            const styles = window.STARTER_STYLES.map((s) => [`pack:${s.id}`, s.name])
                .concat(binTemplates().map((b) => [`bin:${b.id}`, `${b.name} (${t('style.binShort')})`]));
            const ref = styleRef();
            return h('div', null, head,
                section(t('de.target')),
                renderCacheNote(),
                h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'modTrack' }, t('de.track')),
                    trackSlot(() => select('modTrack', tracks, S.modTrack, (v) => { S.modTrack = Number(v); renderFooter(); }))),
                h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'modStyle' }, t('de.style')),
                    select('modStyle', styles, ref.source === 'pack' ? `pack:${ref.id}` : `bin:${ref.id}`, (v) => {
                        const [src, id] = v.split(':');
                        const item = src === 'bin' ? binTemplates().find((b) => b.id === id) : null;
                        S.modStyle = src === 'pack' ? { source: 'pack', id } : { source: 'bin', id, name: item ? item.name : '' };
                        renderScreen();
                    })),
                lookControls(),
                resetSection(t('ed.emph'), ['emphOn', 'emphColor', 'emphSize']),
                checkbox('emphOn', t('de.recolor'), L.emphOn, (v) => setLook({ emphOn: v })),
                L.emphOn ? h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('ed.color')),
                    h('div', { class: 'swatches' }, EMPH_COLORS.map((col) => h('button', {
                        type: 'button', class: 'swatch' + (L.emphColor === col ? ' on' : ''), style: `background:${col}`,
                        'aria-label': col, 'aria-pressed': String(L.emphColor === col), onclick: () => setLook({ emphColor: col })
                    })))) : null,
                L.emphOn ? h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('ed.size')),
                    seg([[1, '100%'], [1.15, '115%'], [1.3, '130%']], L.emphSize, (v) => setLook({ emphSize: v }), t('ed.size'))) : null,
                h('p', { class: 'hint', style: 'margin-top:10px' }, t('de.modifyHint')));
        }

        scheduleLive();
        return h('div', null, head,
            section(t('de.placement')),
            renderCacheNote(),
            lastDeliveryRow(),
            h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'track' }, t('de.track')),
                trackSlot(() => select('track', trackOptions(false), deliverTrack(), (v) => setDeliverTrack(v === 'new' ? 'new' : Number(v))))),
            lookControls(),
            resetSection(t('de.timing'), ['fillGaps', 'maxGap', 'minFrames']),
            checkbox('fillGaps', t('de.fillGaps'), L.fillGaps, (v) => setLook({ fillGaps: v }), [
                h('input', { type: 'number', class: 'field small', min: '0', max: '120', value: String(L.maxGap), 'aria-label': t('de.fillGapsFrames'), onchange: (e) => setLook({ maxGap: Math.max(0, Number(e.target.value) || 0) }) }),
                h('span', null, t('de.frames'))]),
            h('div', { class: 'check' }, h('label', { for: 'minFrames' }, t('de.minDur')),
                h('input', { id: 'minFrames', type: 'number', class: 'field small', min: '1', max: '120', value: String(L.minFrames), onchange: (e) => setLook({ minFrames: Math.max(1, Number(e.target.value) || 1) }) }),
                h('span', null, t('de.frames'))),
            resetSection(t('de.finish'), ['clipColor']),
            h('div', { class: 'row' }, h('label', { class: 'lbl', for: 'clipColor' }, t('de.clipColor')),
                select('clipColor', CLIP_COLORS.map((c) => [c, c ? t('color.' + c) : t('de.noColor')]), L.clipColor, (v) => setLook({ clipColor: v }))));
    }

    function startProgress(total) {
        S.busy = { since: Date.now() };
        S.progress = { done: 0, total };
        S.message = null;
        renderScreen();
        renderFooter();
    }

    function endProgress() {
        S.busy = null;
        S.progress = null;
        renderScreen();
        renderFooter();
    }

    // Warns once about caption fonts this computer doesn't have; a second click goes ahead.
    async function fontsOk() {
        if (S.settings.fontCheck === false || !api.fonts) return true;
        const need = Core.fonts.needed(S.data.captions, { starter: styleRef().source === 'pack', font: look().font });
        let missing;
        if (Array.isArray(S.families)) {
            // Exact family names, as Fusion lists them.
            missing = need.filter((f) => !installed(f));
        } else {
            // Families not read: registry display names ("Montserrat ExtraBold") are close enough.
            try {
                missing = Core.fonts.missing(need, await call('fonts'));
            } catch (e) {
                return true;
            }
        }
        const key = missing.join('|');
        if (!missing.length || S.fontsWarned === key) return true;
        S.fontsWarned = key;
        flash(fontsMessage('de.fontMissing', missing), true);
        return false;
    }

    async function deliverNow() {
        if (!(await fontsOk())) return;
        const L = look();
        const clips = finalClips();
        startProgress(clips.length);
        try {
            const res = await call('deliver', {
                captions: withDrift(S.data.captions).map(whipCaption), clips, look: compLook(), styleRef: S.settings.style, track: deliverTrack(), clipColor: L.clipColor || null
            });
            if (res.cancelled) flash(t('de.cancelled'));
            else {
                S.data.track = res.track;
                // What Undo last delivery takes back: exactly these clips (Resolve's undo can't).
                S.data.delivered = {
                    track: res.track, count: res.placed, at: new Date().toISOString(), style: S.settings.style,
                    ids: res.ids || [], newTrack: !!res.newTrack, replaced: res.replaced || 0, timelineId: S.key ? S.key.split('|')[1] : null
                };
                S.undoAsk = false;
                saveData();
                noteRenderCache(res);
                flash(t('de.done', { n: res.placed, track: res.track }));
            }
        } catch (e) {
            flash(e.message, true);
        } finally {
            endProgress();
            loadTracks();
        }
    }

    // Whip captions are set to cache in the background, which needs the project's render cache on.
    // Deliver and Modify report it; while it's off, this says so and turns it on (User).
    function renderCacheNote() {
        if (!S.cacheOff) return null;
        return h('div', { class: 'pad stack', style: 'margin-bottom:8px' },
            note(t('de.cacheOff')),
            h('button', { type: 'button', class: 'btn block', disabled: !!S.busy || !S.connected, title: t('de.cacheOnTitle'), onclick: renderCacheOn }, t('de.cacheOn')));
    }

    function noteRenderCache(res) {
        if (!res || res.cancelled || !('renderCache' in res)) return;
        S.cacheOff = res.renderCache === 'none';
    }

    async function renderCacheOn() {
        try {
            const mode = await call('renderCacheOn');
            S.cacheOff = mode === 'none';
            flash(S.cacheOff ? t('de.cacheStillOff') : t('de.cacheTurnedOn'), S.cacheOff);
        } catch (e) {
            flash(e.message, true);
        }
        renderScreen();
    }

    // The last delivery on this timeline, with Undo (asks first, in place).
    function lastDeliveryRow() {
        const d = S.data.delivered;
        if (!d || !d.ids || !d.ids.length) return null;
        let time = '';
        try {
            time = new Date(d.at).toLocaleTimeString(S.settings.language === 'es' ? 'es' : 'en', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            // no time then
        }
        if (!S.undoAsk) {
            return h('div', { class: 'row' },
                h('span', { class: 'lbl', style: 'flex:1;width:auto' }, t('de.lastDelivery', { n: d.ids.length, track: d.track, time })),
                h('button', { type: 'button', class: 'btn small', title: t('de.undoDeliveryTitle'), disabled: !!S.busy, onclick: () => {
                    S.undoAsk = true;
                    renderScreen();
                } }, t('de.undoDelivery')));
        }
        return h('div', { class: 'pad stack', style: 'margin-bottom:8px' },
            note(t('de.undoAsk', { n: d.ids.length, track: d.track }) + (d.replaced ? ' ' + t('de.undoReplaced', { n: d.replaced }) : '')),
            h('div', { style: 'display:flex;gap:8px' },
                h('button', { type: 'button', class: 'btn danger', disabled: !!S.busy, onclick: undoDelivery }, t('de.undoYes')),
                h('button', { type: 'button', class: 'btn', onclick: () => {
                    S.undoAsk = false;
                    renderScreen();
                } }, t('de.cancel'))));
    }

    async function undoDelivery() {
        const d = S.data.delivered;
        S.undoAsk = false;
        S.busy = { since: Date.now() };
        renderFooter();
        try {
            const res = await call('undoDelivery', { track: d.track, ids: d.ids, newTrack: d.newTrack, timelineId: d.timelineId });
            delete S.data.delivered;
            if (res.trackRemoved && S.data.track === d.track) S.data.track = null;
            saveData();
            flash(t(res.trackRemoved ? 'de.undoneTrack' : 'de.undone', { n: res.removed, track: d.track }));
        } catch (e) {
            // Gone already (deleted by hand): nothing left to take back.
            if (e.message === t('err.undoGone')) {
                delete S.data.delivered;
                saveData();
            }
            flash(e.message, true);
        } finally {
            S.busy = null;
            renderScreen();
            renderFooter();
            loadTracks();
        }
    }

    async function modifyNow() {
        if (!(await fontsOk())) return;
        startProgress(S.data.captions.length);
        try {
            const res = await call('modify', { track: S.modTrack, captions: withDrift(S.data.captions).map(whipCaption), clips: finalClips(), look: compLook(), styleRef: styleRef() });
            noteRenderCache(res);
            flash(res.cancelled ? t('de.cancelledModify') : t('de.updated', { n: res.updated, track: res.track }));
        } catch (e) {
            flash(e.message, true);
        } finally {
            endProgress();
        }
    }

    function deliverFooter(caps) {
        if (S.progress) {
            const { done, total } = S.progress;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return {
                msg: null,
                actions: [
                    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) },
                        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${pct}%` })),
                        h('span', null, t('de.placing', { done, total }))),
                    h('button', { type: 'button', class: 'btn ghost', onclick: () => call('cancel') }, t('de.cancel'))
                ]
            };
        }
        if (S.deliverMode === 'modify') {
            const tr = (S.tracks || []).find((x) => x.index === S.modTrack);
            return {
                msg: tr ? t('de.onTrack', { n: tr.ours, track: tr.index }) : '',
                actions: [primary(t('de.apply', { n: caps }), modifyNow, !caps || !tr || !!S.busy)]
            };
        }
        const track = deliverTrack();
        return {
            msg: t('tr.captions', { n: caps }),
            actions: [primary(track === 'new' ? t('de.addNew', { n: caps }) : t('de.addTo', { n: caps, track }), deliverNow, !caps || !!S.busy)]
        };
    }

    async function testCaption() {
        if (!(await fontsOk())) return;
        const track = deliverTrack();
        const i = S.pvIdx;
        S.busy = { since: Date.now() };
        renderFooter();
        try {
            const res = await call('deliverTest', { caption: whipCaption(withDrift([S.data.captions[i]])[0], i), clip: finalClips()[i], look: compLook(), styleRef: S.settings.style, track });
            if (track === 'new') useMadeTrack(res.track);
            else loadTracks();
            flash(t('de.tested', { n: i + 1, track: res.track }));
        } catch (e) {
            flash(e.message, true);
        } finally {
            S.busy = null;
            renderScreen();
            renderFooter();
        }
    }

    // Live in viewer: the caption at Resolve's playhead follows the look. Every Deliver redraw asks
    // for an update; it goes out 0.4 s after the last one, only if something it shows changed
    // (liveKey), and never two at once. Off whenever the panel opens.
    let liveTimer = null;
    let liveBusy = false;
    let liveKey = null;

    async function toggleLive(on) {
        if (on && !(await fontsOk())) {
            renderScreen();
            return;
        }
        S.live = on;
        liveKey = null;
        if (on) {
            flash(t('de.liveOn'));
            scheduleLive(0);
        } else {
            clearTimeout(liveTimer);
            flash(t('de.liveOff'));
        }
    }

    function scheduleLive(delay) {
        if (!S.live) return;
        clearTimeout(liveTimer);
        liveTimer = setTimeout(runLive, delay == null ? 400 : delay);
    }

    async function runLive() {
        if (!S.live || S.screen !== 'deliver' || S.deliverMode === 'modify' || !S.data.captions.length || !S.connected) return;
        if (liveBusy || S.busy) {
            scheduleLive();
            return;
        }
        const i = Math.min(S.pvIdx || 0, S.data.captions.length - 1);
        const track = deliverTrack();
        const opts = { caption: whipCaption(withDrift([S.data.captions[i]])[0], i), clip: finalClips()[i], look: compLook(), styleRef: S.settings.style, track };
        const key = JSON.stringify(opts);
        if (key === liveKey) return;
        liveBusy = true;
        try {
            const res = await call('deliverTest', opts);
            liveKey = key;
            if (track === 'new') {
                // Later updates go to the track it made, not a new one each time.
                useMadeTrack(res.track);
                liveKey = null;
            }
        } catch (e) {
            // Something Resolve won't do (clips at the playhead, a template gone): stop, and say why.
            S.live = false;
            flash(e.message, true);
            if (S.screen === 'deliver') renderScreen();
        } finally {
            liveBusy = false;
        }
    }

    // ------------------------------------------------------------ Settings, presets

    function presetList() {
        if (S.presets === undefined) {
            S.presets = null;
            setTimeout(async () => {
                try {
                    S.presets = await call('presets');
                    // Your saved presets from before 0.2.3: same one-time conversion as the settings.
                    const migrated = S.presets.map((p) => {
                        const rules = Core.presets.migrateRules(p.rules);
                        return rules === p.rules ? p : Object.assign({}, p, { rules });
                    });
                    if (migrated.some((p, i) => p !== S.presets[i])) savePresetList(migrated);
                } catch (e) {
                    S.presets = [];
                    flash(e.message, true);
                }
                if (S.screen === 'presets' || S.screen === 'deliver') renderScreen();
            }, 0);
        }
        return S.presets || [];
    }

    function savePresetList(list) {
        S.presets = list;
        call('savePresets', list).catch((e) => flash(e.message, true));
    }

    // Applied in place, so code holding the look object keeps writing to the live settings.
    // A preset's fonts that aren't on this computer fall back to the style default (caption font)
    // or the caption's own font (brush), with a warning; a style the family lacks goes back to auto.
    async function applyPreset(p) {
        markLook();
        ensureFamilies();
        if (S.families === null && api.fontFamilies) {
            try {
                S.families = (await call('fontFamilies')) || null;
            } catch (e) {
                S.families = null;
            }
        }
        const next = Core.presets.apply(S.settings, p);
        const dropped = [];
        for (const part of [next.look, next.brush]) {
            if (!part || !part.font) continue;
            if (!installed(part.font)) {
                dropped.push(part.font);
                part.font = '';
                part.fontStyle = '';
            } else if (part.fontStyle && stylesOf(part.font) && !stylesOf(part.font).includes(part.fontStyle)) {
                part.fontStyle = '';
            }
        }
        const L = look();
        for (const k of Object.keys(L)) delete L[k];
        Object.assign(L, next.look);
        Object.assign(S.settings, { style: next.style, rules: next.rules, brush: next.brush });
        // Which built-in the Style screen shows as chosen; a saved preset or a style pick clears it.
        if (p.builtin) S.settings.preset = p.id;
        else delete S.settings.preset;
        saveSettings();
        renderScreen();
        flash(dropped.length ? fontsMessage('se.appliedNoFonts', [...new Set(dropped)], { name: presetName(p) }) : t('se.applied', { name: presetName(p) }), dropped.length > 0);
    }

    function viewPresets() {
        const list = presetList();
        const exists = (name) => list.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        const nameInput = h('input', {
            type: 'text', class: 'field', maxlength: '60', value: S.presetName || '', placeholder: t('se.presetName'), 'aria-label': t('se.presetName'),
            oninput: (e) => {
                S.presetName = e.target.value;
                update();
            },
            onkeydown: (e) => {
                if (e.key === 'Enter' && !saveBtn.disabled) save();
            }
        });
        const saveBtn = h('button', { type: 'button', class: 'btn', onclick: () => save() });
        const update = () => {
            const name = Core.presets.cleanName(nameInput.value);
            saveBtn.disabled = !name;
            saveBtn.textContent = name && exists(name) ? t('se.presetReplace') : t('se.presetSave');
        };
        const save = () => {
            const name = Core.presets.cleanName(nameInput.value);
            if (!name) return;
            savePresetList(Core.presets.upsert(list, Core.presets.capture(S.settings, name)));
            S.presetName = '';
            renderScreen();
            flash(t('se.presetSaved', { name }));
        };
        update();
        const row = (p) => h('div', { class: 'list-item', style: 'cursor:default' },
            h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: p.pack ? `${p.name} · ${p.pack}` : p.name },
                p.name, p.pack ? h('span', { class: 'from-pack' }, p.pack) : null),
            h('button', { type: 'button', class: 'btn small', onclick: () => applyPreset(p) }, t('se.apply')),
            h('button', {
                type: 'button', class: 'icon-btn', title: t('se.export'), 'aria-label': `${t('se.export')}: ${p.name}`,
                onclick: async () => {
                    try {
                        const saved = await call('exportPreset', p);
                        if (saved) flash(t('ed.exported', { path: saved }));
                    } catch (e) {
                        flash(e.message, true);
                    }
                }
            }, icon('download', 15)),
            S.confirmDelete === p.name
                ? h('button', {
                    type: 'button', class: 'btn small', onclick: () => {
                        S.confirmDelete = null;
                        savePresetList(list.filter((x) => x !== p));
                        renderScreen();
                    }
                }, t('se.deleteConfirm'))
                : h('button', {
                    type: 'button', class: 'icon-btn', title: t('se.delete'), 'aria-label': `${t('se.delete')}: ${p.name}`,
                    onclick: () => {
                        S.confirmDelete = p.name;
                        renderScreen();
                    }
                }, icon('trash', 15)));
        const importBtn = h('button', {
            type: 'button', class: 'btn', onclick: async () => {
                try {
                    const got = await call('importPreset');
                    if (!got) return;
                    if (got.pack) {
                        // A pack: its presets go in together; a newer edition replaces the old one's.
                        savePresetList(Core.presets.addPack(list, got.presets));
                        renderScreen();
                        flash(t('se.importedPack', { n: got.presets.length, pack: got.pack.name }) + (got.skipped ? ' ' + t('se.packSkipped', { n: got.skipped }) : ''));
                        return;
                    }
                    const p = got.presets[0];
                    const named = Object.assign({}, p, { name: Core.presets.freeName(list, p.name) });
                    savePresetList(Core.presets.upsert(list, named));
                    renderScreen();
                    flash(t('se.imported', { name: named.name }));
                } catch (e) {
                    flash(e.message, true);
                }
            }
        }, icon('upload', 14), ' ', t('se.import'));
        const packBtn = h('button', {
            type: 'button', class: 'btn', disabled: !list.length, title: t('se.exportPackTitle'), onclick: async () => {
                try {
                    const saved = await call('exportPack', list);
                    if (saved) flash(t('ed.exported', { path: saved }));
                } catch (e) {
                    flash(e.message, true);
                }
            }
        }, icon('download', 14), ' ', t('se.exportPack'));
        // Built-ins can be applied or copied into your own presets, not changed or deleted.
        const builtinRow = (p) => h('div', { class: 'list-item', style: 'cursor:default' },
            h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: presetName(p) }, presetName(p)),
            h('button', { type: 'button', class: 'btn small', onclick: () => applyPreset(p) }, t('se.apply')),
            h('button', {
                type: 'button', class: 'icon-btn', title: t('se.duplicate'), 'aria-label': `${t('se.duplicate')}: ${presetName(p)}`,
                onclick: () => {
                    const copy = Core.presets.parse(Core.presets.stringify(p));
                    copy.name = Core.presets.freeName(list, presetName(p));
                    savePresetList(Core.presets.upsert(list, copy));
                    renderScreen();
                    flash(t('se.duplicated', { name: copy.name }));
                }
            }, icon('copy', 15)));
        return [
            section(t('se.presets')),
            h('p', { class: 'hint', style: 'margin:0 14px 8px' }, t('se.presetsHint')),
            h('div', { class: 'sub-head' }, t('se.yourPresets')),
            S.presets === null ? h('div', { class: 'busy pad' }, h('span', { class: 'spinner' }))
                : h('div', { class: 'pad stack' }, list.length ? list.map(row) : h('p', { class: 'hint', style: 'margin:0' }, t('se.noPresets'))),
            h('div', { class: 'pad', style: 'display:flex;gap:8px;margin-top:10px' }, nameInput, saveBtn),
            h('div', { class: 'pad', style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:8px' }, importBtn, packBtn),
            h('div', { class: 'sub-head' }, t('se.builtins')),
            h('div', { class: 'pad stack' }, Core.builtins.BUILTINS.map(builtinRow))
        ];
    }

    // Updates: check GitHub for a newer release, install it next to this version (it runs the
    // next time the panel opens), uninstall. S.upd: { state, info, done, error, ask }.
    async function loadUpdateState() {
        if (!api.updateState) return;
        try {
            S.updState = await call('updateState');
        } catch (e) {
            S.updState = null;
        }
        if (S.screen === 'settings') renderScreen();
    }

    async function checkForUpdate(quiet) {
        S.upd = Object.assign({}, S.upd, { state: 'checking', error: null });
        if (!quiet) renderScreen();
        try {
            const info = await call('checkUpdate');
            S.upd = { state: 'checked', info };
            if (quiet && info.newer) flash(t('up.availableFlash', { v: info.latest }));
        } catch (e) {
            S.upd = { state: 'checked', error: quiet ? null : e.message };
        }
        renderHeader();
        if (S.screen === 'settings') renderScreen();
    }

    async function installUpdate() {
        S.upd = Object.assign({}, S.upd, { state: 'installing', error: null });
        renderScreen();
        try {
            S.upd = { state: 'done', done: await call('installUpdate') };
            await loadUpdateState();
        } catch (e) {
            S.upd = Object.assign({}, S.upd, { state: 'checked', error: e.message });
        }
        renderHeader();
        renderScreen();
    }

    function viewUpdates() {
        if (S.updState === undefined) {
            S.updState = null;
            setTimeout(loadUpdateState, 0);
        }
        const st = S.updState;
        const u = S.upd || {};
        const installed = !!(st && st.installed);
        const lang = S.settings.language === 'es' ? 'es' : 'en';
        const busy = u.state === 'checking' || u.state === 'installing';
        const out = [section(t('up.title')),
            h('p', { class: 'hint', style: 'margin:0 14px 8px' }, t('up.version', { v: (st && st.version) || S.appInfo.version || '' }))];
        if (st && !installed) out.push(h('p', { class: 'hint', style: 'margin:0 14px 8px' }, t('up.dev')));
        const pending = u.state === 'done' ? u.done.version : st && st.pending;
        if (pending) out.push(note(t('up.ready', { v: pending })));
        if (u.state === 'done' && u.done.fonts && u.done.fonts.length) out.push(note(t('up.fonts', { fonts: window.i18n.list(u.done.fonts) })));
        if (u.error) out.push(note(u.error, 'err'));
        if (u.state === 'checked' && u.info) {
            if (u.info.newer) {
                const notes = u.info.notes ? u.info.notes[lang] || u.info.notes.en : '';
                out.push(h('div', { class: 'pad stack', id: 'updAvail' },
                    h('strong', null, t('up.available', { v: u.info.latest })),
                    notes ? h('p', { class: 'hint', style: 'margin:0' }, notes) : null,
                    h('button', { type: 'button', class: 'btn primary block', disabled: !installed, onclick: installUpdate }, t('up.install', { v: u.info.latest }))));
            } else if (!pending) {
                out.push(h('p', { class: 'hint', style: 'margin:0 14px 8px' }, t('up.latest')));
            }
        }
        out.push(h('div', { class: 'pad' }, busy
            ? h('div', { class: 'busy' }, h('span', { class: 'spinner' }), h('span', null, u.state === 'installing' ? t('up.installing') : t('up.check')))
            : h('button', { type: 'button', class: 'btn', onclick: () => checkForUpdate(false) }, t('up.check'))));
        out.push(checkbox('updAuto', t('up.auto'), S.settings.updateCheck !== false, (v) => {
            S.settings.updateCheck = v;
            saveSettings();
        }));
        out.push(h('p', { class: 'hint', style: 'margin:0 14px 8px' }, t('up.autoHint')));
        if (installed) {
            out.push(h('div', { class: 'pad', style: 'margin-top:6px' }, u.ask
                ? h('div', { class: 'stack' },
                    note(t('up.uninstallAsk')),
                    h('div', { style: 'display:flex;gap:8px' },
                        h('button', { type: 'button', class: 'btn danger', onclick: async () => {
                            try {
                                await call('uninstall');
                                S.upd = Object.assign({}, u, { ask: false });
                                flash(t('up.uninstalling'));
                            } catch (e) {
                                S.upd = Object.assign({}, u, { ask: false, error: e.message });
                                renderScreen();
                            }
                        } }, t('up.uninstallYes')),
                        h('button', { type: 'button', class: 'btn', onclick: () => {
                            S.upd = Object.assign({}, u, { ask: false });
                            renderScreen();
                        } }, t('de.cancel'))))
                : h('button', { type: 'button', class: 'btn', onclick: () => {
                    S.upd = Object.assign({}, u, { ask: true });
                    renderScreen();
                } }, t('up.uninstall'))));
        }
        return out;
    }

    function viewSettings() {
        return h('div', null,
            section(t('se.panel')),
            h('div', { class: 'row' }, h('span', { class: 'lbl' }, t('se.language')),
                seg([['en', 'English'], ['es', 'Español']], S.settings.language === 'es' ? 'es' : 'en', (v) => {
                    S.settings.language = v;
                    window.i18n.setLanguage(v);
                    saveSettings();
                    render();
                }, t('se.language'))),
            checkbox('fontCheck', t('se.fontCheck'), S.settings.fontCheck !== false, (v) => {
                S.settings.fontCheck = v;
                saveSettings();
            }),
            checkbox('dedupe', t('se.dedupe'), S.settings.dedupeTemplates !== false, (v) => {
                S.settings.dedupeTemplates = v;
                saveSettings();
            }),
            checkbox('spellCheck', t('se.spellCheck'), S.settings.spellCheck !== false, (v) => {
                S.settings.spellCheck = v;
                saveSettings();
            }),
            section(t('se.guide')),
            h('p', { class: 'hint', style: 'margin:0 14px 8px' }, t('se.guideHint')),
            h('div', { class: 'pad' }, h('button', { type: 'button', class: 'btn', onclick: () => call('openGuide').catch((e) => flash(e.message, true)) }, t('se.guide'))),
            section(t('se.data')),
            h('div', { class: 'pad' }, h('code', { style: 'font-family:var(--mono);font-size:11.5px;color:#c4c4cc;word-break:break-all' }, S.appInfo.dataDir || '')),
            h('div', { class: 'pad', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn', onclick: () => call('openLogs') }, t('se.logs'))),
            viewUpdates(),
            section(t('se.aboutTitle')),
            h('p', { class: 'hint', style: 'margin:0 14px' }, t('se.about', { v: S.appInfo.version })));
    }

    // ------------------------------------------------------------ start

    async function init() {
        try {
            S.settings = await call('settings');
        } catch (e) {
            S.settings = { language: 'en', style: { source: 'pack', id: 'highlight' }, rules: Object.assign({}, Core.phrases.DEFAULT_RULES) };
        }
        window.i18n.setLanguage(S.settings.language);
        // Saved phrase rules from before 0.2.3: max words becomes per line (presets.migrateRules).
        const rules = Core.presets.migrateRules(S.settings.rules);
        if (rules && rules !== S.settings.rules) {
            S.settings.rules = rules;
            saveSettings();
        }
        try {
            S.appInfo = await call('appInfo');
        } catch (e) {
            // Optional.
        }
        // Off unless asked: the panel otherwise never goes online.
        // On unless turned off in Settings → Updates (owner, 2026-11-28: it was opt-in until 0.2.16).
        if (S.settings.updateCheck !== false && api.checkUpdate) setTimeout(() => checkForUpdate(true), 3000);
        // If Windows still draws its own title bar (overlay unsupported), don't repeat logo and name.
        const wco = navigator.windowControlsOverlay;
        if (!api.isMock && !(wco && wco.visible)) document.body.classList.add('native-titlebar');
        $('connBtn').addEventListener('click', () => refresh(false));
        // Deliver's sticky preview gets its shadow once settings scroll under it.
        $('screen').addEventListener('scroll', () => $('screen').classList.toggle('scrolled', $('screen').scrollTop > 0), { passive: true });
        $('pinBtn').addEventListener('click', () => {
            S.settings.onTop = S.settings.onTop === false;
            saveSettings();
            if (api.setOnTop) call('setOnTop', S.settings.onTop).catch(() => {});
            renderHeader();
        });
        window.addEventListener('focus', () => refresh(true));
        document.addEventListener('keydown', (e) => {
            if (!e.ctrlKey || (S.screen !== 'edit' && S.screen !== 'deliver')) return;
            const tg = e.target;
            const typing = /^(SELECT|TEXTAREA)$/.test(tg.tagName) || (tg.tagName === 'INPUT' && !/^(range|checkbox|radio|button|color)$/.test(tg.type));
            if (typing) return;
            const key = e.key.toLowerCase();
            const deliver = S.screen === 'deliver';
            if (key === 'z' && !e.shiftKey) (deliver ? lookUndo : undo)();
            else if (key === 'y' || (key === 'z' && e.shiftKey)) (deliver ? lookRedo : redo)();
            else return;
            e.preventDefault();
        });
        setInterval(pollPlayhead, 300);
        if (api.onRender) {
            api.onRender((p) => {
                if (p.state !== 'start' || !p.guide) return;
                S.renderWarn = true;
                if (S.screen === 'deliver') renderScreen();
                flash(t('de.guideRenderShort'), true);
            });
        }
        if (api.onProgress) {
            api.onProgress((p) => {
                if (!S.progress) return;
                S.progress = p;
                renderFooter();
            });
        }
        render();
        await refresh(false);
    }

    init();
})();
