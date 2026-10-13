// Tiny DOM builder: h('div', { class: 'x', onclick: fn }, child, 'text', [more]).
(function (root) {
    function h(tag, props, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'style') el.style.cssText = v;
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k in el && typeof v !== 'string') el[k] = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        append(el, children);
        return el;
    }

    function append(el, children) {
        for (const c of children) {
            if (c == null || c === false) continue;
            if (Array.isArray(c)) append(el, c);
            else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
        }
    }

    // Inline stroke icons used across the panel.
    const ICONS = {
        style: 'M5 7V5h14v2M12 5v14M9 19h6',
        transcribe: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
        edit: 'M4 6h16M4 11h10M4 16h6M14 20l1-3.5 5-5 2.5 2.5-5 5z',
        deliver: 'M3 15.5a1.5 1.5 0 0 1 1.5-1.5h15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM12 3v8M8.5 7.5 12 11l3.5-3.5',
        settings: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
        search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5',
        refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
        upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v4h14v-4',
        download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 15v4h14v-4',
        trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
        copy: 'M9 9h10v11H9zM5 15V4h10',
        check: 'm5 12.5 4.5 4.5L19 7.5',
        merge: 'M12 3v7M8.5 6.5 12 10l3.5-3.5M12 21v-7M8.5 17.5 12 14l3.5 3.5',
        undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
        pin: 'M12 16v6M8 3h8l-1.5 6 3.5 4H6l3.5-4z',
        redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'
    };

    function icon(name, size) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        const s = String(size || 20);
        svg.setAttribute('width', s);
        svg.setAttribute('height', s);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', ICONS[name]);
        svg.appendChild(path);
        return svg;
    }

    root.dom = { h, icon };
})(this);
