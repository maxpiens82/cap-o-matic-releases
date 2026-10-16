'use strict';
// Cap-o-matic walkthrough. A drawn DaVinci Resolve plus the real panel (plugin/index.html in tour
// mode: the browser mock with demo speech), driven step by step with a visible cursor. Every step
// is a script; jumping to a step reloads the panel and replays the earlier steps instantly.
(function () {
    const TEXT = {
        en: {
            tagline: "Animated captions for DaVinci Resolve Studio, from your timeline's speech.",
            downloads: 'Downloads', restarting: 'Restarting Resolve…',
            endTitle: "That's the whole workflow.",
            endText: 'Download Cap-o-matic, drop it on the Console, and caption your next video.',
            download: 'Download the latest version', needs: 'Free · Pro coming soon · Windows · DaVinci Resolve Studio',
            back: 'Previous step', next: 'Next step', play: 'Play', pause: 'Pause', count: 'Step {n} of {total}',
            console: [
                '[Cap-o-matic] Cap-o-matic 0.2.1 is installed.',
                '[Cap-o-matic] Fonts installed: Bebas Neue Regular, Poppins Bold.',
                '[Cap-o-matic] Restart DaVinci Resolve, then open Workspace > Workflow Integrations > Cap-o-matic.'
            ],
            steps: {
                install: ['Install', "Download the .lua file and drop it on Resolve's Console (Workspace → Console). Restart Resolve, then open Cap-o-matic from Workspace → Workflow Integrations."],
                look: ['Pick a look', 'Start from a ready-made preset, or a base style you tune yourself: font, colors, outline, size and position.'],
                transcribe: ['Transcribe', "One click turns your timeline's speech into words with exact timing, split into short captions."],
                edit: ['Edit', 'Fix a word, regroup captions, or paint a word with the emphasis brush so it stands out.'],
                deliver: ['Deliver', 'The captions land on a new track as animated titles, word by word, ready to render. Changed your mind? Restyle them in place.'],
                updates: ['Stay up to date', 'New versions install from Settings → Updates. Your presets and settings stay.']
            }
        },
        // Spanish here is marketing copy: Rioplatense, with vos (docs/BRAND.md section 11). The console
        // lines copy the installer's own messages, which stay in the panel's neutral tú.
        es: {
            tagline: 'Subtítulos animados para DaVinci Resolve Studio, a partir de lo que se dice en tu timeline.',
            downloads: 'Descargas', restarting: 'Reiniciando Resolve…',
            endTitle: 'Ese es todo el flujo.',
            endText: 'Descargá Cap-o-matic, soltalo en la consola y subtitulá tu próximo video.',
            download: 'Descargá la última versión', needs: 'Gratis · Pro muy pronto · Windows · DaVinci Resolve Studio',
            back: 'Paso anterior', next: 'Paso siguiente', play: 'Reproducir', pause: 'Pausa', count: 'Paso {n} de {total}',
            console: [
                '[Cap-o-matic] Cap-o-matic 0.2.1 está instalado.',
                '[Cap-o-matic] Fuentes instaladas: Bebas Neue Regular, Poppins Bold.',
                '[Cap-o-matic] Reinicia DaVinci Resolve y abre Workspace > Workflow Integrations > Cap-o-matic.'
            ],
            steps: {
                install: ['Instalá', 'Descargá el archivo .lua y soltalo en la consola de Resolve (Workspace → Console). Reiniciá Resolve y abrí Cap-o-matic desde Workspace → Workflow Integrations.'],
                look: ['Elegí un estilo', 'Arrancá de un preset armado o de un estilo base que ajustás vos: fuente, colores, contorno, tamaño y posición.'],
                transcribe: ['Transcribí', 'Un clic convierte lo que se dice en tu timeline en palabras con su tiempo exacto, divididas en subtítulos cortos.'],
                edit: ['Editá', 'Corregí una palabra, reagrupá subtítulos o pintá una palabra con el pincel de énfasis para que resalte.'],
                deliver: ['Entregá', 'Los subtítulos caen en una pista nueva como títulos animados, palabra por palabra, listos para renderizar. ¿Cambiaste de idea? Cambiales el estilo ahí mismo.'],
                updates: ['Mantenete al día', 'Las versiones nuevas se instalan desde Ajustes → Actualizaciones. Tus presets y ajustes quedan como están.']
            }
        }
    };

    const W = 1280;
    const PANEL = { x: 890, y: 44, scale: 0.72 };
    const REST = { x: 1090, y: 650 };
    const FPS = 30;
    const T0 = 108000;
    const PRESET = 'gancho-amarillo';
    const EMPH = /^(watching|mirando)/i;

    const $ = (id) => document.getElementById(id);
    const stage = $('stage');
    const frame = $('frame');
    const iframe = $('panel');
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // ?poster: jumps to Deliver and holds on the caption with the painted word (the README image).
    const poster = /[?&]poster\b/.test(location.search);
    if (poster) document.body.classList.add('poster');

    let lang = /[?&]lang=es\b/.test(location.search) ? 'es' : 'en';
    let current = 0;
    let playing = !reduced && !poster;
    let run = null;
    let scale = 1;

    class Abort extends Error {}
    const tx = () => TEXT[lang];
    const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

    // ------------------------------------------------------------ timing

    function check() {
        if (!run || run.dead) throw new Abort();
    }

    async function wait(ms) {
        check();
        if (run.fast) return;
        await new Promise((r) => setTimeout(r, ms));
        check();
    }

    async function waitFor(fn, timeout) {
        const until = Date.now() + (timeout || 10000);
        for (;;) {
            check();
            let v = null;
            try {
                v = fn();
            } catch (e) {
                v = null;
            }
            if (v) return v;
            if (Date.now() > until) throw new Error('walkthrough: timed out waiting for the panel');
            await new Promise((r) => setTimeout(r, 60));
        }
    }

    // ------------------------------------------------------------ cursor

    const cursor = $('cursor');
    function place(x, y, ms) {
        cursor.style.transitionDuration = run && run.fast ? '0ms' : `${ms}ms`;
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
    }

    async function moveTo(p, ms) {
        const d = ms || 650;
        place(p.x, p.y, d);
        await wait(d + 60);
    }

    async function tap() {
        if (run.fast) return;
        const ring = $('ring');
        ring.classList.remove('go');
        void ring.offsetWidth;
        ring.classList.add('go');
        await wait(170);
    }

    // A stage element's centre in stage coordinates.
    function stagePos(el) {
        const r = el.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        return { x: (r.left - s.left + r.width / 2) / scale, y: (r.top - s.top + r.height / 2) / scale };
    }

    // ------------------------------------------------------------ the panel

    const pd = () => iframe.contentDocument;
    const pw = () => iframe.contentWindow;
    const pt = (key, vars) => pw().i18n.t(key, vars);

    function panelPos(el) {
        const r = el.getBoundingClientRect();
        return { x: PANEL.x + (r.left + r.width / 2) * PANEL.scale, y: PANEL.y + (r.top + r.height / 2) * PANEL.scale };
    }

    // Moves to a panel element (scrolling it into view first) and clicks it.
    async function press(find, ms) {
        let el = await waitFor(find);
        const h = pw().innerHeight;
        const r = el.getBoundingClientRect();
        // Scroll the panel's own screen, never with scrollIntoView: that scrolls this page too.
        const screen = pd().getElementById('screen');
        if ((r.top < 50 || r.bottom > h - 70) && screen && screen.contains(el)) {
            screen.scrollTo({ top: screen.scrollTop + r.top - h / 2, behavior: run.fast ? 'auto' : 'smooth' });
            await wait(450);
        }
        await moveTo(panelPos(el), ms);
        await tap();
        // The panel redraws often; click what is there now, not a copy it just replaced.
        if (!el.isConnected) el = await waitFor(find);
        el.click();
        await wait(250);
    }

    const nav = (i) => () => pd().querySelectorAll('.rail .nav')[i];
    const footerButton = () => {
        const b = pd().querySelector('.bottom .btn.primary');
        return b && !b.disabled ? b : null;
    };
    const buttonWithText = (text) => () => [...pd().querySelectorAll('button')].find((b) => b.textContent.trim() === text);

    function loadPanel() {
        for (const k of Object.keys(localStorage)) if (k.startsWith('cap-tour:')) localStorage.removeItem(k);
        // A clean start: Pop with three-word lines, no viewer guide in the preview.
        localStorage.setItem('cap-tour:settings', JSON.stringify({
            language: lang, style: { source: 'pack', id: 'pop' },
            rules: { maxWords: 3, maxChars: 18, lines: 1, sentenceBreak: true, pauseBreak: true, pauseSeconds: 0.4 },
            look: { guide: false }
        }));
        return new Promise((resolve) => {
            iframe.onload = resolve;
            iframe.src = `../plugin/index.html?tour=${lang}&v=${Date.now()}`;
        });
    }

    // ------------------------------------------------------------ the drawn Resolve

    function drawRuler(span) {
        const ruler = $('ruler');
        ruler.replaceChildren();
        for (let s = 0; s * FPS < span; s += 2) {
            const m = document.createElement('span');
            m.style.left = `${((s * FPS) / span) * 100}%`;
            m.textContent = `01:00:${String(s).padStart(2, '0')}:00`;
            ruler.appendChild(m);
        }
    }

    function drawWave() {
        const wave = $('wave');
        wave.replaceChildren();
        let seed = 7;
        for (let x = 4; x < 680; x += 4) {
            seed = (seed * 9301 + 49297) % 233280;
            const bar = document.createElement('i');
            bar.style.left = `${x}px`;
            bar.style.height = `${4 + (seed / 233280) * 30 * (0.4 + 0.6 * Math.abs(Math.sin(x / 37)))}px`;
            wave.appendChild(bar);
        }
    }

    const SPAN = 16 * FPS;
    const laneX = (f) => `${((f - T0) / SPAN) * 100}%`;

    function setPlayhead(f) {
        const lane = 780 - 48;
        $('playhead').style.left = `${48 + ((f - T0) / SPAN) * lane}px`;
        const s = Math.floor((f - T0) / FPS);
        $('tcode').textContent = `01:00:${String(s).padStart(2, '0')}:${String((f - T0) % FPS).padStart(2, '0')}`;
    }

    function resetStage() {
        for (const id of ['console', 'downloads', 'menu', 'submenu', 'restart', 'end', 'panelBox']) $(id).classList.remove('show', 'drop');
        $('mWorkspace').classList.remove('open');
        $('consoleText').textContent = '> ';
        $('file').style.visibility = '';
        stage.querySelectorAll('.file.drag').forEach((n) => n.remove());
        $('capLane').replaceChildren();
        $('viewerCap').replaceChildren();
        setPlayhead(T0);
        place(REST.x, REST.y, 0);
    }

    // Plays delivered captions in the viewer the way Pop draws them: words appear as spoken, the
    // spoken one in the accent colour, emphasized words in their own.
    async function playCaptions(opts) {
        if (run.fast) return;
        const caps = opts.captions;
        const clips = opts.clips;
        const accent = (opts.look && opts.look.accent) || '#FFD93B';
        const start = clips[0].start - 10;
        const end = clips[clips.length - 1].end + 10;
        const box = $('viewerCap');
        const t0 = performance.now();
        let shown = '';
        for (;;) {
            check();
            const f = Math.round(start + ((performance.now() - t0) / 1000) * FPS * 1.15);
            if (f > end) break;
            setPlayhead(f);
            const i = clips.findIndex((c) => f >= c.start && f < c.end);
            let key = 'none';
            let words = [];
            let active = -1;
            if (i >= 0) {
                words = caps[i].words;
                words.forEach((w, k) => {
                    if (w.start <= f) active = k;
                });
                key = `${i}:${active}`;
            }
            if (key !== shown) {
                shown = key;
                const hold = poster && words.some((w, k) => w.emph && k <= active);
                box.replaceChildren(...words.map((w, k) => {
                    const s = document.createElement('span');
                    s.textContent = w.text.replace(/[.,]+$/, '').toLocaleUpperCase(lang);
                    if (k > active) s.style.visibility = 'hidden';
                    if (k === active) {
                        s.className = 'on';
                        s.style.color = accent;
                    }
                    if (w.emph && w.emph.color) s.style.color = w.emph.color;
                    return s;
                }));
                if (hold) {
                    document.body.classList.add('posed');
                    await new Promise(() => {});
                }
            }
            await new Promise((r) => setTimeout(r, 1000 / FPS));
        }
        box.replaceChildren();
    }

    // ------------------------------------------------------------ the steps

    const STEPS = [
        {
            id: 'install',
            async run() {
                $('downloads').classList.add('show');
                $('console').classList.add('show');
                await wait(600);
                const file = $('file');
                const from = stagePos(file);
                await moveTo({ x: from.x - 60, y: from.y + 6 }, 700);
                await tap();
                // Drag a copy of the file onto the Console.
                const ghost = file.cloneNode(true);
                ghost.removeAttribute('id');
                ghost.classList.add('drag');
                const fr = file.getBoundingClientRect();
                const sr = stage.getBoundingClientRect();
                const gx = (fr.left - sr.left) / scale;
                const gy = (fr.top - sr.top) / scale;
                ghost.style.left = `${gx}px`;
                ghost.style.top = `${gy}px`;
                ghost.style.transition = run.fast ? 'none' : 'left .9s cubic-bezier(.45,.05,.25,1), top .9s cubic-bezier(.45,.05,.25,1)';
                stage.appendChild(ghost);
                file.style.visibility = 'hidden';
                const target = { x: 300, y: 470 };
                await wait(30);
                ghost.style.left = `${gx + target.x - (from.x - 60)}px`;
                ghost.style.top = `${gy + target.y - (from.y + 6)}px`;
                $('console').classList.add('drop');
                await moveTo(target, 900);
                await tap();
                ghost.remove();
                $('console').classList.remove('drop');
                const out = $('consoleText');
                out.textContent = '> ';
                for (const line of tx().console) {
                    if (run.fast) {
                        out.textContent += line + '\n';
                        continue;
                    }
                    for (let k = 0; k < line.length; k += 3) {
                        out.textContent = out.textContent.replace(/[^\n]*$/, '') + line.slice(0, k + 3);
                        await wait(12);
                    }
                    out.textContent += '\n';
                    await wait(180);
                }
                await wait(1300);
                $('downloads').classList.remove('show');
                $('restart').classList.add('show');
                await wait(900);
                $('console').classList.remove('show');
                $('restart').classList.remove('show');
                await wait(300);
                await moveTo(stagePos($('mWorkspace')), 700);
                await tap();
                $('mWorkspace').classList.add('open');
                $('menu').classList.add('show');
                await wait(300);
                await moveTo(stagePos($('mWI')), 450);
                $('mWI').classList.add('on');
                $('submenu').classList.add('show');
                await wait(250);
                await moveTo(stagePos($('mCap')), 450);
                $('mCap').classList.add('on');
                await tap();
                $('menu').classList.remove('show');
                $('submenu').classList.remove('show');
                $('mWI').classList.remove('on');
                $('mCap').classList.remove('on');
                $('mWorkspace').classList.remove('open');
                $('panelBox').classList.add('show');
                await waitFor(() => pd().querySelectorAll('.rail .nav').length >= 5 && pd().querySelector('.tile'));
                await wait(700);
            }
        },
        {
            id: 'look',
            async run() {
                await press(() => pd().querySelector(`.tile[data-preset="${PRESET}"]`), 800);
                await wait(1400);
            }
        },
        {
            id: 'transcribe',
            async run() {
                await press(nav(1));
                await press(() => {
                    const b = pd().querySelector('#screen .btn.block');
                    return b && !b.disabled ? b : null;
                });
                await waitFor(() => !pd().querySelector('#screen .busy') && footerButton());
                await wait(500);
                await press(footerButton);
                await waitFor(() => pd().querySelector('#capList .word'));
                await wait(900);
            }
        },
        {
            id: 'edit',
            async run() {
                if (!pd().querySelector('#capList')) await press(nav(2));
                await press(buttonWithText(pt('ed.emph')));
                // Green, so the painted word stands apart from Pop's yellow spoken word.
                await press(() => [...pd().querySelectorAll('.brush .swatch')].find((s) => getComputedStyle(s).backgroundColor === 'rgb(124, 242, 154)'), 500);
                await press(() => [...pd().querySelectorAll('#capList .word')].find((w) => EMPH.test(w.textContent)));
                await wait(1400);
            }
        },
        {
            id: 'deliver',
            async run() {
                await press(nav(3));
                // Applying a preset turns the safe-zone guide back on; the preview reads better without it.
                const guide = await waitFor(() => pd().querySelector('.pv-zone-pick input'));
                if (guide.checked) guide.click();
                await wait(1800);
                await press(footerButton);
                const opts = await waitFor(() => pw().__mockLastDeliver);
                const lane = $('capLane');
                for (let i = 0; i < opts.clips.length; i++) {
                    const c = opts.clips[i];
                    const clip = document.createElement('div');
                    clip.className = 'clip capclip';
                    clip.style.left = laneX(c.start);
                    clip.style.width = `calc(${laneX(c.end)} - ${laneX(c.start)} - 2px)`;
                    clip.textContent = opts.captions[i].words.map((w) => w.text).join(' ');
                    lane.appendChild(clip);
                    await wait(70);
                }
                await wait(500);
                await moveTo({ x: 520, y: 330 }, 700);
                await playCaptions(opts);
                await wait(300);
            }
        },
        {
            id: 'updates',
            async run() {
                await press(nav(4));
                await press(buttonWithText(pt('up.check')));
                await waitFor(() => buttonWithText(pt('up.install', { v: '0.2.2' }))());
                await wait(1600);
                $('end').classList.add('show');
                await moveTo(REST, 600);
            }
        }
    ];

    // ------------------------------------------------------------ playing

    async function untilPlaying() {
        while (!playing) {
            check();
            await new Promise((r) => setTimeout(r, 120));
        }
    }

    async function goTo(k) {
        if (run) run.dead = true;
        const me = (run = { dead: false, fast: true });
        current = k;
        renderText();
        frame.classList.add('busy');
        try {
            resetStage();
            await loadPanel();
            check();
            for (let i = 0; i < k; i++) await STEPS[i].run();
            me.fast = false;
            frame.classList.remove('busy');
            for (let i = k; i < STEPS.length; i++) {
                current = i;
                renderText();
                await STEPS[i].run();
                if (i === STEPS.length - 1) break;
                await wait(1200);
                await untilPlaying();
            }
            playing = false;
            renderText();
        } catch (e) {
            if (!(e instanceof Abort)) console.error(e);
        } finally {
            if (run === me) frame.classList.remove('busy');
        }
    }

    // ------------------------------------------------------------ text and controls

    function renderText() {
        const t = tx();
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-t]').forEach((el) => {
            el.textContent = t[el.dataset.t];
        });
        document.querySelectorAll('[data-t-label]').forEach((el) => el.setAttribute('aria-label', t[el.dataset.tLabel]));
        document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
        const [title, text] = t.steps[STEPS[current].id];
        $('count').textContent = fill(t.count, { n: current + 1, total: STEPS.length });
        $('title').textContent = title;
        $('text').textContent = text;
        const play = $('play');
        play.textContent = playing ? '❚❚' : '▶';
        play.setAttribute('aria-label', playing ? t.pause : t.play);
        const dots = $('dots');
        dots.replaceChildren(...STEPS.map((s, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = i === current ? 'on' : '';
            b.setAttribute('aria-label', fill(t.count, { n: i + 1, total: STEPS.length }) + ': ' + t.steps[s.id][0]);
            b.onclick = () => {
                playing = false;
                goTo(i);
            };
            return b;
        }));
    }

    function fit() {
        scale = frame.clientWidth / W;
        stage.style.transform = `scale(${scale})`;
    }

    $('prev').onclick = () => {
        playing = false;
        goTo(Math.max(0, current - 1));
    };
    $('next').onclick = () => {
        playing = false;
        goTo(Math.min(STEPS.length - 1, current + 1));
    };
    $('play').onclick = () => {
        if (playing) {
            playing = false;
            renderText();
            return;
        }
        playing = true;
        // At the end, play starts over; otherwise it carries on from here.
        if (current === STEPS.length - 1 && $('end').classList.contains('show')) goTo(0);
        else renderText();
    };
    document.querySelectorAll('.lang button').forEach((b) => {
        b.onclick = () => {
            if (b.dataset.lang === lang) return;
            lang = b.dataset.lang;
            try {
                localStorage.setItem('cap-tour-lang', lang);
            } catch (e) {
                // a private window: the choice just isn't remembered
            }
            goTo(current);
        };
    });
    try {
        if (!/[?&]lang=/.test(location.search) && localStorage.getItem('cap-tour-lang') === 'es') lang = 'es';
    } catch (e) {
        // no storage: English
    }

    window.addEventListener('resize', fit);
    fit();
    drawRuler(SPAN);
    drawWave();
    renderText();
    goTo(poster ? 4 : 0);
})();
