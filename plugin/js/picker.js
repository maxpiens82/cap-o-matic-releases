// The screen colour picker's overlay (picker.html, opened on every display by src/picker.js): the
// still of the screen at its real pixels, a loupe that magnifies the pixels round the cursor, and the
// colour under it. window.picked settles with '#RRGGBB' on a click, or null on Esc or a right click.
(function () {
    'use strict';
    const params = new URLSearchParams(location.search);
    const shot = document.getElementById('shot');
    const loupe = document.getElementById('loupe');
    const hexBox = document.getElementById('hex');
    document.getElementById('hint').textContent = params.get('hint') || '';
    const ctx = shot.getContext('2d', { willReadFrequently: true });
    const lctx = loupe.getContext('2d');
    const CELLS = 11;            // pixels across the loupe
    const CELL = 132 / CELLS;
    let done;
    window.picked = new Promise((r) => { done = r; });
    let ready = false;

    // Called by src/picker.js with the still as a data URL; settles once it's drawn.
    window.showStill = (url) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            shot.width = img.naturalWidth;
            shot.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);
            ready = true;
            resolve(true);
        };
        img.onerror = () => reject(new Error('The screen still did not load.'));
        img.src = url;
    });

    const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    // The still's pixel under a point of the window (the still is the display's real size).
    const at = (e) => [Math.floor(e.clientX * shot.width / innerWidth), Math.floor(e.clientY * shot.height / innerHeight)];
    function colorAt(e) {
        const [x, y] = at(e);
        const d = ctx.getImageData(x, y, 1, 1).data;
        return hex(d[0], d[1], d[2]);
    }

    addEventListener('mousemove', (e) => {
        if (!ready) return;
        const [x, y] = at(e);
        const half = (CELLS - 1) / 2;
        lctx.imageSmoothingEnabled = false;
        lctx.clearRect(0, 0, 132, 132);
        lctx.drawImage(shot, x - half, y - half, CELLS, CELLS, 0, 0, 132, 132);
        lctx.strokeStyle = '#f4f4f5';
        lctx.lineWidth = 2;
        lctx.strokeRect(half * CELL, half * CELL, CELL, CELL);
        const color = colorAt(e);
        hexBox.innerHTML = '';
        const chip = document.createElement('i');
        chip.style.background = color;
        hexBox.append(chip, color);
        // Beside the cursor, flipped near the right and bottom edges.
        const right = e.clientX + 160 > innerWidth, below = e.clientY + 175 > innerHeight;
        const lx = right ? e.clientX - 152 : e.clientX + 20, ly = below ? e.clientY - 172 : e.clientY + 20;
        loupe.style.left = lx + 'px';
        loupe.style.top = ly + 'px';
        hexBox.style.left = lx + 'px';
        hexBox.style.top = (ly + 138) + 'px';
        loupe.style.display = hexBox.style.display = 'block';
    });
    addEventListener('click', (e) => { if (ready) done(colorAt(e)); });
    addEventListener('contextmenu', (e) => { e.preventDefault(); done(null); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
})();
