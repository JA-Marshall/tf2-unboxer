// The unboxing screen: ten case animations unbox at once, then the items are laid out. A full-screen layer the main
// page opens when "Open" is pressed, and that also plays replays and the demo. Up to ten crates stand in ten shafts of light; each is primed as the bot reports that case opened; when
// every result is in they open together in rounds, lowest grade first, so the crates still sealed hold the best items,
// and an Unusual gets the screen to itself. Then every item is laid out with its grade, quality and price.
// A three-beat countdown before they open, "You unboxed" and
// the item's name in its quality's colour one beat after its picture, and Steam's own item icons. The feel of the
// game's crate opening, not its interface: no art, font or sound of the game's is used.
//
// What it shows is what the bot reported, nothing else: the items come from a `source` (liveSource: the one POST to the
// server's open action and its log; playback: a logged batch or a marked sample) and this file only decides the order and the
// look. It never opens a case by itself.
//
// Everything that moves is driven from one clock (no CSS animation), so step(dt) can render it frame by frame.
// Layers: a WebGL background (shafts, haze, shockwave), a 2D canvas (crates and particles), DOM (cards and text).
// Nothing here is taken from a game or another site: the crates, light and sounds are drawn and synthesised below.
(() => {
    'use strict';
    const TAU = Math.PI * 2;
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
    const E = {
        lin: t => t,
        out: t => 1 - Math.pow(1 - t, 3),
        out5: t => 1 - Math.pow(1 - t, 5),
        in: t => t * t * t,
        in2: t => t * t,
        io: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        back: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
        spring: t => 1 - Math.cos(t * 9.5) * Math.exp(-t * 5.5)
    };
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // money, in the currency the server prices in (setCurrency); USD until told otherwise
    let money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const usd = v => money.format(v);
    let VENUE = { short: 'steam', long: 'the Steam Market' };

    // the game's own colours for a case item's grade and for the Unique, Strange and Unusual qualities
    const TIER_RGB = { 1: [75, 105, 255], 2: [136, 71, 255], 3: [211, 44, 230], 4: [235, 75, 75] };
    const UNIQUE = [255, 215, 0];
    const STRANGE = [207, 106, 50];
    const UNUSUAL = [170, 108, 255];
    const GOLD = [255, 214, 130];
    const WARM = [255, 196, 120];
    const BLANK = [150, 142, 130];
    // the colour an item's NAME takes, by its quality, as players know them from the game's backpack; Unusual is lifted a little so it still reads on the dark screen
    const QUALITY_RGB = { Unique: [255, 215, 0], Strange: [207, 106, 50], Unusual: [160, 108, 214], Vintage: [71, 98, 145], Genuine: [77, 116, 85], Haunted: [56, 243, 171], "Collector's": [170, 0, 0], 'Decorated Weapon': [250, 250, 250] };
    const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
    const nameRgb = it => (!it ? BLANK : it.unusual ? QUALITY_RGB.Unusual : it.strange ? QUALITY_RGB.Strange : QUALITY_RGB[it.quality] || QUALITY_RGB.Unique);
    // the name as the game shows it: the quality first, except for a plain (Unique) item
    const fullName = it => `${it.strange && it.unusual ? 'Strange ' : ''}${it.unusual ? 'Unusual ' : it.strange ? 'Strange ' : it.quality && !['Unique', 'Strange'].includes(it.quality) ? `${it.quality} ` : ''}${it.title}`;
    const tone = it => (!it ? BLANK : it.unusual ? UNUSUAL : it.grade ? TIER_RGB[it.grade.tier] || UNIQUE : it.strange ? STRANGE : UNIQUE);
    // how big a moment an item gets: 0 nothing seen, 1-4 the grades, 5 an Unusual
    const tierOf = it => (!it ? 0 : it.unusual ? 5 : it.grade ? it.grade.tier : 1);

    // the crate, in units of its own width
    const BW = 1, BH = 0.62, BD = 0.74, LW = 1.07, LH = 0.2, LD = 0.81;
    const PITCH = 0.42, CP = Math.cos(PITCH), SP = Math.sin(PITCH);
    const LIGHT = (() => { const v = [-0.42, 0.78, 0.46], l = Math.hypot(...v); return v.map(x => x / l); })();

    // ---------------------------------------------------------------- sound (synthesised, off until switched on)
    function makeSound() {
        let ctx = null, master = null, noise = null, drone = null, on = false;
        const ensure = () => {
            if (ctx) return true;
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.55;
            const comp = ctx.createDynamicsCompressor();
            master.connect(comp);
            comp.connect(ctx.destination);
            noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            return true;
        };
        const env = (g, t, peak, attack, decay) => {
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
            g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        };
        const tone = (type, f0, f1, peak, attack, decay, at = 0) => {
            const t = ctx.currentTime + at;
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f0, t);
            if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
            env(g, t, peak, attack, decay);
            o.connect(g); g.connect(master);
            o.start(t); o.stop(t + attack + decay + 0.05);
        };
        const hiss = (type, f0, f1, q, peak, attack, decay, at = 0) => {
            const t = ctx.currentTime + at;
            const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            s.buffer = noise; s.loop = true;
            f.type = type; f.Q.value = q;
            f.frequency.setValueAtTime(f0, t);
            f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + attack + decay);
            env(g, t, peak, attack, decay);
            s.connect(f); f.connect(g); g.connect(master);
            s.start(t, Math.random()); s.stop(t + attack + decay + 0.05);
        };
        const chord = (root, steps, peak, decay, at = 0) => steps.forEach((st, i) => {
            tone('triangle', root * Math.pow(2, st / 12), root * Math.pow(2, st / 12), peak / (1 + i * 0.35), 0.01, decay, at + i * 0.045);
            tone('sine', root * Math.pow(2, (st + 12) / 12), root * Math.pow(2, (st + 12) / 12), peak * 0.35, 0.01, decay * 0.7, at + i * 0.045);
        });
        const api = {
            get on() { return on; },
            set(v) {
                on = !!v && ensure();
                if (ctx) (on ? ctx.resume() : ctx.suspend()).catch(() => {});
                if (!on && drone) api.charge(0);
                return on;
            },
            thud(v = 1) { if (!on) return; tone('sine', 120, 42, 0.5 * v, 0.004, 0.22); hiss('lowpass', 900, 120, 0.7, 0.22 * v, 0.003, 0.14); },
            tick(n) { if (!on) return; tone('triangle', 620 * Math.pow(2, n / 12), 620 * Math.pow(2, n / 12), 0.16, 0.003, 0.11); tone('sine', 1240 * Math.pow(2, n / 12), 1240 * Math.pow(2, n / 12), 0.06, 0.003, 0.18); },
            riser(d) { if (!on) return; hiss('bandpass', 260, 5200, 2.2, 0.2, d * 0.96, d * 0.04); tone('sawtooth', 70, 300, 0.05, d * 0.96, d * 0.04); },
            burst(tier) {
                if (!on) return;
                tone('sine', 150, 38, 0.6, 0.004, 0.3);
                hiss('highpass', 1800, 5200, 0.6, 0.2, 0.002, 0.22);
                hiss('lowpass', 2400, 240, 0.8, 0.26, 0.004, 0.42);
                const roots = { 0: 196, 1: 261.6, 2: 311.1, 3: 370, 4: 440, 5: 523.3 };
                chord(roots[tier] || 261.6, tier >= 4 ? [0, 4, 7, 11, 14] : tier >= 2 ? [0, 4, 7, 12] : [0, 7, 12], 0.1 + tier * 0.03, 0.7 + tier * 0.25, 0.03);
            },
            stamp() { if (!on) return; tone('square', 210, 120, 0.1, 0.002, 0.07); hiss('bandpass', 3200, 1800, 5, 0.2, 0.002, 0.09); },
            heart(v = 1) { if (!on) return; tone('sine', 78, 34, 0.75 * v, 0.006, 0.26); tone('sine', 68, 32, 0.5 * v, 0.006, 0.22, 0.16); },
            unusual() {
                if (!on) return;
                tone('sine', 110, 26, 0.95, 0.006, 1.6);
                hiss('lowpass', 9000, 160, 0.6, 0.55, 0.004, 1.9);
                hiss('highpass', 5000, 9000, 0.8, 0.16, 0.01, 2.6);
                [0, 4, 7, 11, 14, 16, 19, 23].forEach((st, i) => {
                    tone('triangle', 261.6 * Math.pow(2, st / 12), 261.6 * Math.pow(2, st / 12), 0.12, 0.02, 2.8, 0.1 + i * 0.085);
                    tone('sine', 523.2 * Math.pow(2, st / 12), 523.2 * Math.pow(2, st / 12), 0.06, 0.02, 3.2, 0.14 + i * 0.085);
                });
            },
            // the hum under the wait: louder and higher as more cases are in
            charge(v) {
                if (!ctx) return;
                if (!drone) {
                    if (!on || v <= 0) return;
                    const g = ctx.createGain(), f = ctx.createBiquadFilter();
                    g.gain.value = 0.0001; f.type = 'lowpass'; f.frequency.value = 160;
                    const os = [55, 55.6, 82.6].map(fr => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); return o; });
                    f.connect(g); g.connect(master);
                    drone = { g, f, os };
                }
                const t = ctx.currentTime;
                drone.g.gain.setTargetAtTime(on ? 0.0001 + 0.085 * v : 0.0001, t, 0.12);
                drone.f.frequency.setTargetAtTime(140 + 520 * v * v, t, 0.15);
                drone.os.forEach((o, i) => o.frequency.setTargetAtTime([55, 55.6, 82.6][i] * (1 + 0.5 * v), t, 0.2));
            },
            close() { if (ctx) ctx.close().catch(() => {}); ctx = null; drone = null; on = false; }
        };
        return api;
    }

    // ---------------------------------------------------------------- the background shader
    const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
    const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uFloor, uLaneW, uCharge, uFlash, uDim; uniform vec4 uWave;
uniform vec4 uLane[10]; uniform vec3 uCol[10];
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; float asp = uRes.x / uRes.y;
  // the shockwave bends what is behind it
  vec2 d = (uv - uWave.xy) * vec2(asp, 1.); float r = length(d);
  float ring = exp(-pow((r - uWave.z) / .07, 2.)) * uWave.w;
  uv += normalize(d + 1e-5) / vec2(asp, 1.) * ring * .035;
  float above = uv.y - uFloor;
  vec3 col = mix(vec3(.034, .027, .022), vec3(.008, .007, .007), smoothstep(-.1, .8, above));
  float haze = fbm(vec2(uv.x * asp * 1.5, uv.y * 2.4) + vec2(uTime * .025, -uTime * .05));
  float haze2 = fbm(vec2(uv.x * asp * 3.1, uv.y * 1.3) - vec2(uTime * .04, uTime * .09));
  col += vec3(.050, .034, .022) * haze * (.25 + .85 * uCharge) * smoothstep(-.25, .5, above);
  // the floor: a faint horizon line and a sheen that falls away toward the viewer
  float fl = smoothstep(0., -.5, above);
  col += vec3(.035, .028, .022) * exp(-abs(above) * 90.) * (1. + 2. * uCharge);
  for (int i = 0; i < 10; i++) {
    vec4 L = uLane[i]; if (L.y <= .001) continue;
    float dx = (uv.x - L.x) * asp; float w = uLaneW * asp * L.z;
    float core = exp(-dx * dx / (w * w * .040)); float halo = exp(-dx * dx / (w * w * .55));
    float streak = .62 + .38 * noise(vec2(dx * 26. / L.z + float(i) * 9.7, uv.y * 2.6 - uTime * (1.1 + L.w)));
    float rise = smoothstep(-.006, .05, above) * mix(1., .34, clamp(above / (1. - uFloor), 0., 1.));
    float mote = pow(haze2, 2.) * halo * 1.4;
    vec3 c = uCol[i];
    col += c * L.y * (core * (.8 + .5 * L.w) + halo * (.12 + .16 * L.w) + mote * .45) * rise * streak;
    col += mix(c, vec3(1.), .55) * L.y * core * core * rise * .35 * L.w;
    // the pool of light on the floor and its reflection
    vec2 fd = vec2(dx, above * 4.2);
    col += c * L.y * .55 * exp(-dot(fd, fd) / (w * w * 1.5));
    col += c * L.y * .16 * halo * fl * exp(above * 5.);
  }
  col += ring * vec3(.9, .8, 1.) * .22;
  col *= uDim;
  col += uFlash * vec3(1., .96, .9);
  vec2 q = gl_FragCoord.xy / uRes - .5;
  col *= 1. - dot(q, q) * 1.15;
  col = 1. - exp(-col * 1.75);
  col = pow(col, vec3(.92));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.) - .5) / 160.;
  gl_FragColor = vec4(col, 1.);
}`;

    function makeBackground(canvas) {
        let gl = null;
        try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch { gl = null; }
        if (!gl) return null;
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
        const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const u = {};
        for (const n of ['uRes', 'uTime', 'uFloor', 'uLaneW', 'uCharge', 'uFlash', 'uDim', 'uWave', 'uLane', 'uCol']) u[n] = gl.getUniformLocation(prog, n);
        const lane = new Float32Array(40), col = new Float32Array(30);
        return {
            draw(S) {
                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.uniform2f(u.uRes, canvas.width, canvas.height);
                gl.uniform1f(u.uTime, S.t);
                gl.uniform1f(u.uFloor, 1 - S.floorY / S.H);
                gl.uniform1f(u.uLaneW, S.laneW / S.W);
                gl.uniform1f(u.uCharge, S.charge);
                gl.uniform1f(u.uFlash, S.flash);
                gl.uniform1f(u.uDim, S.dim);
                gl.uniform4f(u.uWave, S.wave.x / S.W, 1 - S.wave.y / S.H, S.wave.r, S.wave.a);
                lane.fill(0);
                S.lanes.forEach((L, i) => {
                    lane[i * 4] = L.x / S.W; lane[i * 4 + 1] = L.shaft * L.lit; lane[i * 4 + 2] = L.shaftW; lane[i * 4 + 3] = L.hot;
                    col[i * 3] = L.col[0] / 255; col[i * 3 + 1] = L.col[1] / 255; col[i * 3 + 2] = L.col[2] / 255;
                });
                gl.uniform4fv(u.uLane, lane);
                gl.uniform3fv(u.uCol, col);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
        };
    }

    // ---------------------------------------------------------------- drawn parts: crate faces, glows, rays
    function sheet(w, h, draw) {
        const c = document.createElement('canvas');
        c.width = Math.max(4, Math.round(w)); c.height = Math.max(4, Math.round(h));
        draw(c.getContext('2d'), c.width, c.height);
        return c;
    }
    const tintCache = new Map();
    /** A white sprite in a colour (kept: a handful of colours are ever used). */
    function tinted(key, base, rgb) {
        const id = `${key}:${rgb.join(',')}`;
        let c = tintCache.get(id);
        if (!c) {
            c = sheet(base.width, base.height, (g, w, h) => {
                g.drawImage(base, 0, 0);
                g.globalCompositeOperation = 'source-in';
                g.fillStyle = css(rgb);
                g.fillRect(0, 0, w, h);
            });
            tintCache.set(id, c);
        }
        return c;
    }
    const GLOW = sheet(128, 128, (g, w) => {
        const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,255,255,.62)'); r.addColorStop(0.45, 'rgba(255,255,255,.16)'); r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r; g.fillRect(0, 0, w, w);
    });
    const RAYS = sheet(512, 512, (g, w) => {
        g.translate(w / 2, w / 2);
        const n = 18;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU, wd = (i % 2 ? 0.05 : 0.085);
            const gr = g.createRadialGradient(0, 0, w * 0.06, 0, 0, w / 2);
            gr.addColorStop(0, 'rgba(255,255,255,.0)'); gr.addColorStop(0.16, `rgba(255,255,255,${i % 2 ? 0.34 : 0.6})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr;
            g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, w / 2, a - wd, a + wd); g.closePath(); g.fill();
        }
    });
    const RAMP = sheet(8, 64, (g, w, h) => {
        const v = g.createLinearGradient(0, 0, 0, h);
        v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.45, 'rgba(255,255,255,.22)'); v.addColorStop(1, 'rgba(255,255,255,.95)');
        g.fillStyle = v; g.fillRect(0, 0, w, h);
    });
    const SEAM = sheet(64, 24, (g, w, h) => {
        const v = g.createLinearGradient(0, 0, 0, h);
        v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.42, 'rgba(255,255,255,.55)'); v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(0.58, 'rgba(255,255,255,.55)'); v.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = v; g.fillRect(0, 0, w, h);
    });

    const BRASS = ['#b98a4e', '#8a5a2c', '#5a3a1c'];
    function metal(g, x, y, w, h, c0, c1) {
        const v = g.createLinearGradient(0, y, 0, y + h);
        v.addColorStop(0, c0); v.addColorStop(1, c1);
        g.fillStyle = v; g.fillRect(x, y, w, h);
    }
    function strap(g, x, w, h, u) {
        const v = g.createLinearGradient(x, 0, x + w, 0);
        v.addColorStop(0, BRASS[2]); v.addColorStop(0.3, BRASS[0]); v.addColorStop(0.7, BRASS[1]); v.addColorStop(1, BRASS[2]);
        g.fillStyle = v; g.fillRect(x, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,.45)';
        for (const yy of [0.14, 0.86]) { g.beginPath(); g.arc(x + w / 2, h * yy, w * 0.2, 0, TAU); g.fill(); }
        g.fillStyle = 'rgba(255,225,170,.5)';
        for (const yy of [0.14, 0.86]) { g.beginPath(); g.arc(x + w / 2 - u * 0.004, h * yy - u * 0.004, w * 0.09, 0, TAU); g.fill(); }
    }
    function panel(g, w, h, u, { straps = [], ribs = 3, corners = true } = {}) {
        metal(g, 0, 0, w, h, '#57504a', '#2c2723');
        // brushed streaks
        g.globalAlpha = 0.05;
        for (let i = 0; i < 70; i++) { g.fillStyle = i % 2 ? '#fff' : '#000'; g.fillRect(Math.random() * w, Math.random() * h, w * (0.1 + Math.random() * 0.4), Math.max(1, u * 0.004)); }
        g.globalAlpha = 1;
        for (let i = 1; i <= ribs; i++) {
            const y = (h * i) / (ribs + 1);
            g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y, w, Math.max(1, u * 0.012));
            g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, y + Math.max(1, u * 0.012), w, Math.max(1, u * 0.006));
        }
        for (const x of straps) strap(g, x * w - u * 0.045, u * 0.09, h, u);
        if (corners) {
            const k = u * 0.15;
            g.fillStyle = BRASS[1];
            for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]]) {
                g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + sx * k, cy); g.lineTo(cx, cy + sy * k); g.closePath(); g.fill();
            }
        }
        g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = Math.max(1.5, u * 0.03); g.strokeRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = Math.max(1, u * 0.008); g.strokeRect(u * 0.022, u * 0.022, w - u * 0.044, h - u * 0.044);
    }
    /** The crate's faces at `u` pixels a unit; `label` is stencilled on the front. */
    function crateTextures(u, label) {
        const front = sheet(BW * u, BH * u, (g, w, h) => {
            panel(g, w, h, u, { straps: [0.2, 0.8] });
            // lock plate with a keyhole
            const pw = u * 0.2, ph = u * 0.26, px = w / 2 - pw / 2, py = h * 0.5 - ph / 2;
            metal(g, px, py, pw, ph, BRASS[0], BRASS[2]);
            g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = Math.max(1, u * 0.012); g.strokeRect(px, py, pw, ph);
            g.fillStyle = '#0b0908';
            g.beginPath(); g.arc(w / 2, py + ph * 0.4, pw * 0.17, 0, TAU); g.fill();
            g.beginPath(); g.moveTo(w / 2 - pw * 0.08, py + ph * 0.45); g.lineTo(w / 2 + pw * 0.08, py + ph * 0.45); g.lineTo(w / 2 + pw * 0.14, py + ph * 0.82); g.lineTo(w / 2 - pw * 0.14, py + ph * 0.82); g.closePath(); g.fill();
            // lane number, stencilled
            g.fillStyle = 'rgba(232,145,79,.82)';
            g.font = `700 ${u * 0.15}px Bahnschrift, "Inter Display", Inter, "Segoe UI", sans-serif`;
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(label, w * 0.5, h * 0.86);
        });
        const side = sheet(BD * u, BH * u, (g, w, h) => {
            panel(g, w, h, u);
            // a carry handle
            g.strokeStyle = BRASS[1]; g.lineWidth = u * 0.035; g.lineCap = 'round';
            g.beginPath(); g.moveTo(w * 0.3, h * 0.42); g.lineTo(w * 0.3, h * 0.56); g.lineTo(w * 0.7, h * 0.56); g.lineTo(w * 0.7, h * 0.42); g.stroke();
        });
        const band = (g, w, h) => {
            metal(g, 0, 0, w, h, '#37322d', '#1d1a17');
            metal(g, 0, h * 0.62, w, h * 0.38, BRASS[1], BRASS[2]);
            g.fillStyle = 'rgba(255,225,170,.35)'; g.fillRect(0, h * 0.62, w, Math.max(1, u * 0.008));
            g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = Math.max(1.5, u * 0.026); g.strokeRect(0, 0, w, h);
        };
        const lidFront = sheet(LW * u, LH * u, band);
        const lidSide = sheet(LD * u, LH * u, band);
        const lidTop = sheet(LW * u, LD * u, (g, w, h) => {
            panel(g, w, h, u, { ribs: 0 });
            for (const x of [0.2, 0.8]) strap(g, (x * BW + (LW - BW) / 2) / LW * w - u * 0.045, u * 0.09, h, u);
            // a ring of ten ticks: one for each crate on the screen
            g.translate(w / 2, h / 2);
            g.strokeStyle = 'rgba(232,145,79,.75)'; g.lineWidth = u * 0.018;
            g.beginPath(); g.arc(0, 0, u * 0.17, 0, TAU); g.stroke();
            for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; g.beginPath(); g.moveTo(Math.cos(a) * u * 0.2, Math.sin(a) * u * 0.2); g.lineTo(Math.cos(a) * u * 0.245, Math.sin(a) * u * 0.245); g.stroke(); }
        });
        const inner = sheet(u, u, (g, w, h) => {
            const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.75);
            r.addColorStop(0, '#2c2621'); r.addColorStop(1, '#0d0b0a');
            g.fillStyle = r; g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = Math.max(1.5, u * 0.03); g.strokeRect(0, 0, w, h);
        });
        return { front, side, lidFront, lidSide, lidTop, inner };
    }

    // ---------------------------------------------------------------- the show
    function open(opts = {}) {
        const source = opts.source;
        const count = clamp(Math.floor(Number(opts.count) || 1), 1, 10);
        const sound = makeSound();
        let soundPref = false;
        try { soundPref = localStorage.getItem('ubxSound') === 'on'; } catch { /* private mode: stays off */ }

        // ---- DOM
        const root = document.createElement('div');
        root.className = 'ubx';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'Unboxing');
        root.innerHTML = `
<div class="ubx-cam"><canvas class="ubx-bg"></canvas><div class="ubx-big"><div class="ubx-big-n"><b>0</b><i>/${count}</i></div><div class="ubx-big-c"></div></div><canvas class="ubx-fx"></canvas><div class="ubx-cards"></div></div>
<div class="ubx-spot"><div class="ubx-spot-k">You unboxed</div><div class="ubx-spot-e"></div><div class="ubx-spot-n"></div></div>
<div class="ubx-sum"><div class="ubx-sum-head"><h2></h2><div class="ubx-chips"></div></div>
  <div class="ubx-sum-foot"><div class="ubx-total"></div><div class="ubx-note"></div><div class="ubx-note warn"></div><div class="ubx-btns"><button class="ubx-btn" data-a="again">Watch again</button><button class="ubx-btn primary" data-a="close">Close</button></div></div></div>
<div class="ubx-hud"><div><div class="ubx-title"></div><div class="ubx-status"></div><div class="ubx-track"></div></div><span class="ubx-sp"></span>
  <div class="ubx-btns"><button class="ubx-btn" data-a="sound"></button><button class="ubx-btn" data-a="full">Full screen</button><button class="ubx-btn" data-a="skip">Skip</button><button class="ubx-btn" data-a="close" title="Close (the bot finishes what it started)">✕</button></div></div>
<div class="ubx-fail"><h3>Nothing to show</h3><p></p><button class="ubx-btn primary" data-a="close">Close</button></div>
${opts.label ? `<div class="ubx-badge${opts.labelKind === 'replay' ? ' replay' : ''}">${esc(opts.label)}</div>` : ''}`;
        const $ = sel => root.querySelector(sel);
        const cam = $('.ubx-cam'), bgCanvas = $('.ubx-bg'), fx = $('.ubx-fx'), cardsEl = $('.ubx-cards');
        const hud = $('.ubx-hud'), statusEl = $('.ubx-status'), trackEl = $('.ubx-track'), sumEl = $('.ubx-sum'), failEl = $('.ubx-fail');
        const bigEl = $('.ubx-big'), bigN = $('.ubx-big-n b'), bigI = $('.ubx-big-n i'), bigC = $('.ubx-big-c');
        const spotK = $('.ubx-spot-k'), spotE = $('.ubx-spot-e'), spotN = $('.ubx-spot-n');
        $('.ubx-title').innerHTML = `<b>${count}</b> × ${esc(opts.caseName || 'case')}`;
        trackEl.innerHTML = '<i></i>'.repeat(count);
        document.body.append(root);
        const prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        const ctx = fx.getContext('2d');
        const bg = makeBackground(bgCanvas);

        // ---- state: plain numbers the renderer reads; the timeline below is the only thing that changes them
        const S = {
            t: 0, speed: 1, speedHold: 0, W: 0, H: 0, dpr: 1, laneW: 0, floorY: 0, cw: 0, cardS: 1, cardY: 0, k: 1,
            phase: 'enter', charge: 0, flash: 0, dim: 1, shake: 0, wave: { x: 0, y: 0, r: 0, a: 0 },
            camS: 1, camX: 0, camY: 0, hudA: 1, sumA: 0, spot: null, bigA: 0, bigS: 1,
            lanes: [], complete: false, failed: null, message: '', stopped: false, skipWhenDone: false,
            queue: [], nextPrime: 0, chargeFrom: 0, lastEvent: 0, sealed: 0, prices: null, closed: false, source: opts.sourceName || ''
        };
        for (let i = 0; i < count; i++)
            S.lanes.push({
                i, x: 0, state: 'wait', entry: null, item: null, key: null,
                drop: 1, sq: 1, landed: false, bob: rand(TAU), yaw: rand(-0.5, 0.5) + 0.6, spin: 0.35 * (i % 2 ? -1 : 1) * rand(0.8, 1.2), lift: 0,
                prime: 0, vib: 0, bloom: 0, core: 0, lidY: 0, lidX: 0, lidVy: 0, lidVx: 0, lidRx: 0, lidRz: 0, lidSx: 0, lidSz: 0, lidA: 1, lidFree: false, blown: 0,
                shaft: 0, shaftW: 1, hot: 0, lit: 1, col: WARM, seam: WARM, crateA: 1, sink: 0, dead: 0, hop: 0, rays: 0, raysR: 1,
                card: null, tex: null, deadEl: null
            });

        // ---- timeline: tasks at a time, and tweens of one number
        let tasks = [], tweens = [];
        const after = (delay, fn) => { tasks.push({ at: S.t + delay, fn }); };
        function tw(o, k, to, d, e = E.out, delay = 0, done) {
            tweens = tweens.filter(x => !(x.o === o && x.k === k && x.t0 >= S.t + delay));
            tweens.push({ o, k, to, d: Math.max(0.0001, d), e, t0: S.t + delay, from: null, done });
        }
        function runTimeline() {
            if (tasks.length) {
                const due = tasks.filter(x => x.at <= S.t).sort((a, b) => a.at - b.at);
                if (due.length) { tasks = tasks.filter(x => x.at > S.t); for (const x of due) x.fn(); }
            }
            for (const x of tweens) {
                if (S.t < x.t0) continue;
                if (x.from === null) {
                    x.from = x.o[x.k];
                    // a later tween of the same number takes over from an earlier one still running
                    for (const y of tweens) if (y !== x && y.o === x.o && y.k === x.k && y.from !== null && y.t0 < x.t0) y.dead = true;
                }
                if (x.dead) continue;
                const p = clamp((S.t - x.t0) / x.d);
                x.o[x.k] = lerp(x.from, x.to, x.e(p));
                if (p >= 1) { x.dead = true; if (x.done) x.done(); }
            }
            tweens = tweens.filter(x => !x.dead);
        }

        // ---- particles
        let parts = [];
        const sparks = (x, y, rgb, n, { speed = 620, spread = 1.15, up = 1, life = 1, size = 2 } = {}) => {
            for (let i = 0; i < n; i++) {
                const a = -Math.PI / 2 + rand(-spread, spread), v = speed * S.k * rand(0.25, 1) * (0.6 + 0.4 * Math.random());
                parts.push({ kind: 0, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * up, life: 0, max: life * rand(0.45, 1.25), size: size * S.k * rand(0.6, 1.5), rgb: Math.random() < 0.22 ? [255, 255, 255] : rgb });
            }
        };
        const embers = (x, y, rgb, n, { w = 60, rise = 120, life = 2.4 } = {}) => {
            for (let i = 0; i < n; i++) parts.push({ kind: 1, x: x + rand(-w, w) * S.k, y: y + rand(-10, 10) * S.k, vx: rand(-18, 18) * S.k, vy: -rise * S.k * rand(0.4, 1.3), life: 0, max: life * rand(0.5, 1.2), size: rand(5, 15) * S.k, rgb, ph: rand(TAU) });
        };
        const ring = (x, y, rgb, { r0 = 0.4, r1 = 2.4, life = 0.75, width = 3 } = {}) => parts.push({ kind: 2, x, y, r0: r0 * S.cw, r1: r1 * S.cw, life: 0, max: life, size: width * S.k, rgb });
        const dust = (x, y, n) => { for (let i = 0; i < n; i++) parts.push({ kind: 3, x: x + rand(-0.5, 0.5) * S.cw, y, vx: rand(-90, 90) * S.k, vy: -rand(8, 40) * S.k, life: 0, max: rand(0.5, 1), size: rand(18, 40) * S.k, rgb: [120, 108, 96] }); };
        const shards = (x, y, n) => {
            for (let i = 0; i < n; i++) {
                const a = -Math.PI / 2 + rand(-1.5, 1.5), v = rand(380, 1250) * S.k;
                parts.push({ kind: 4, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(1, 1.9), size: rand(5, 15) * S.k, rot: rand(TAU), vr: rand(-12, 12), rgb: Math.random() < 0.3 ? [138, 90, 44] : [58, 53, 48] });
            }
        };
        function stepParts(dt) {
            const g = 1250 * S.k;
            for (const p of parts) {
                p.life += dt;
                if (p.kind === 0) { p.vy += g * dt; p.vx *= Math.pow(0.22, dt); p.vy *= Math.pow(0.5, dt); p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > S.floorY + S.cw * 0.2 && p.vy > 0) { p.vy *= -0.35; p.vx *= 0.6; p.y = S.floorY + S.cw * 0.2; } }
                else if (p.kind === 1) { p.x += (p.vx + Math.sin(S.t * 2.2 + p.ph) * 14 * S.k) * dt; p.y += p.vy * dt; }
                else if (p.kind === 3) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.08, dt); }
                else if (p.kind === 4) { p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
            }
            parts = parts.filter(p => p.life < p.max);
        }
        function drawParts() {
            const d = S.dpr;
            ctx.setTransform(d, 0, 0, d, 0, 0);
            for (const p of parts) {
                if (p.kind !== 4) continue;
                ctx.globalAlpha = clamp(1 - p.life / p.max) ;
                ctx.fillStyle = css(p.rgb);
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6); ctx.restore();
            }
            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            for (const p of parts) {
                const f = clamp(1 - p.life / p.max);
                if (p.kind === 0) {
                    ctx.globalAlpha = f * f;
                    ctx.strokeStyle = css(p.rgb);
                    ctx.lineWidth = p.size;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028); ctx.stroke();
                } else if (p.kind === 1) {
                    ctx.globalAlpha = Math.sin(f * Math.PI) * 0.85;
                    const s = p.size * (0.6 + 0.4 * f);
                    ctx.drawImage(tinted('glow', GLOW, p.rgb), p.x - s, p.y - s, s * 2, s * 2);
                } else if (p.kind === 2) {
                    const q = E.out(p.life / p.max), r = lerp(p.r0, p.r1, q);
                    ctx.globalAlpha = f * 0.9;
                    ctx.strokeStyle = css(p.rgb);
                    ctx.lineWidth = p.size * (0.4 + f);
                    ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.3, 0, 0, TAU); ctx.stroke();
                } else if (p.kind === 3) {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.globalAlpha = f * 0.16;
                    const s = p.size * (1 + (1 - f) * 1.6);
                    ctx.drawImage(tinted('glow', GLOW, p.rgb), p.x - s, p.y - s * 0.6, s * 2, s * 1.2);
                    ctx.globalCompositeOperation = 'lighter';
                }
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }

        // ---- layout
        function layout() {
            S.W = root.clientWidth; S.H = root.clientHeight;
            let dpr = Math.min(window.devicePixelRatio || 1, 2);
            while (S.W * S.H * dpr * dpr > 5.2e6 && dpr > 1) dpr -= 0.25;
            S.dpr = dpr;
            fx.width = Math.round(S.W * dpr); fx.height = Math.round(S.H * dpr);
            const bs = S.W * S.H > 2.4e6 ? 0.5 : 0.62;
            bgCanvas.width = Math.round(S.W * bs); bgCanvas.height = Math.round(S.H * bs);
            S.k = S.H / 1080;
            S.laneW = Math.min((S.W - 2 * Math.min(48, S.W * 0.03)) / count, S.H * 0.3, 340 * Math.max(1, S.k));
            S.floorY = S.H * 0.79;
            S.cw = Math.min(S.laneW * 0.66, S.H * 0.18);
            S.cardS = Math.min((S.laneW * 0.92) / 240, (S.H * 0.42) / 330, 1.2 * Math.max(1, S.k));
            S.cardY = S.H * 0.42;
            const u = Math.max(24, Math.round(S.cw * dpr * 1.1));
            S.lanes.forEach((L, i) => {
                L.x = S.W / 2 + (i - (count - 1) / 2) * S.laneW;
                L.tex = crateTextures(u, String(i + 1).padStart(2, '0'));
                if (L.deadEl) L.deadEl.style.transform = `translate(${L.x}px, ${S.floorY + S.cw * 0.42}px) translate(-50%,0)`;
            });
            placeSpot();
            if (S.phase === 'summary') placeSummary(0);
        }
        // the Unusual's words: as large as the effect's name allows across the screen
        function placeSpot() {
            const effectSize = Math.min(S.H * 0.16, (S.W * 0.86) / Math.max(6, (spotE.textContent || '').length * 0.62));
            spotE.style.fontSize = `${effectSize}px`;
            spotK.style.top = `${S.H * 0.115}px`;
            spotE.style.top = `${S.H * 0.16}px`;
            spotN.style.top = `${S.H * 0.16 + effectSize * 1.12}px`;
        }

        // ---- crates
        function drawCrate(L) {
            if (L.crateA <= 0.003 || L.blown >= 1) return;
            const d = S.dpr, sc = S.cw, T = L.tex;
            const vib = L.vib * S.cw * 0.03;
            const cx = L.x + (vib ? rand(-vib, vib) : 0);
            const bob = L.landed && L.state !== 'dead' ? Math.sin(S.t * 1.7 + L.bob) * sc * 0.03 * (1 - L.bloom) : 0;
            const base = S.floorY - sc * 0.1 + bob + (vib ? rand(-vib, vib) : 0) - L.drop * (S.floorY + sc) - L.lift * sc - L.hop * sc + L.sink * sc;
            const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
            // model (x right, y up, z toward the viewer at yaw 0) -> screen x, screen y, depth
            const P = (x, y, z) => { const X = x * cy + z * sy, Z = -x * sy + z * cy, Y = y * L.sq; return [cx + X * sc / Math.sqrt(L.sq), base - (Y * CP - Z * SP) * sc, Y * SP + Z * CP]; };
            const faces = [];
            const face = (O, U, V, tex, inner, a = 1, glow = 0) => {
                const p0 = P(O[0], O[1], O[2]), pu = P(O[0] + U[0], O[1] + U[1], O[2] + U[2]), pv = P(O[0] + V[0], O[1] + V[1], O[2] + V[2]);
                const ux = pu[0] - p0[0], uy = pu[1] - p0[1], vx = pv[0] - p0[0], vy = pv[1] - p0[1];
                const outer = ux * vy - uy * vx > 0;
                if (!outer && !inner) return;
                // the outward normal (V x U), turned like the model, lit from the upper left
                let nx = V[1] * U[2] - V[2] * U[1], ny = V[2] * U[0] - V[0] * U[2], nz = V[0] * U[1] - V[1] * U[0];
                const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
                const NX = nx * cy + nz * sy, NZ = -nx * sy + nz * cy;
                const lit = clamp(0.42 + 0.72 * Math.max(0, NX * LIGHT[0] + (ny * CP - NZ * SP) * LIGHT[1] + (ny * SP + NZ * CP) * LIGHT[2]));
                faces.push({ p0, ux, uy, vx, vy, tex: outer ? tex : inner, shade: outer ? 1 - lit : 0.3, depth: p0[2] + (pu[2] - p0[2] + pv[2] - p0[2]) / 2, a, glow: outer ? glow : 0, inside: !outer, floor: glow === -1 });
            };
            const h = BH, w = BW, dd = BD, b = L.bloom * 1.02, cb = Math.cos(b), sb = Math.sin(b);
            const open = L.bloom > 0.001 || L.lidFree;
            // the four sides, each hinged along its bottom edge
            face([-w / 2, h * cb, dd / 2 + h * sb], [w, 0, 0], [0, -h * cb, -h * sb], T.front, open && T.inner, 1, 1);
            face([w / 2, h * cb, -dd / 2 - h * sb], [-w, 0, 0], [0, -h * cb, h * sb], T.front, open && T.inner, 1, 2);
            face([w / 2 + h * sb, h * cb, dd / 2], [0, 0, -dd], [-h * sb, -h * cb, 0], T.side, open && T.inner, 1, 2);
            face([-w / 2 - h * sb, h * cb, -dd / 2], [0, 0, dd], [h * sb, -h * cb, 0], T.side, open && T.inner, 1, 2);
            if (open) face([-w / 2, 0.015, dd / 2], [w, 0, 0], [0, 0, -dd], null, T.inner, 1, -1);
            // the lid: on the crate, or thrown clear and tumbling
            if (L.lidA > 0.003) {
                const cxr = Math.cos(L.lidRx), sxr = Math.sin(L.lidRx), czr = Math.cos(L.lidRz), szr = Math.sin(L.lidRz);
                const C = [L.lidX, h + LH / 2 + L.lidY, 0];
                const R = v => { const y1 = v[1] * cxr - v[2] * sxr, z1 = v[1] * sxr + v[2] * cxr; return [v[0] * czr - y1 * szr, v[0] * szr + y1 * czr, z1]; };
                const lf = (O, U, V, tex, inner) => { const o = R(O), uu = R(U), vv = R(V); face([o[0] + C[0], o[1] + C[1], o[2] + C[2]], uu, vv, tex, inner, L.lidA, 0); };
                const lw = LW / 2, lh = LH / 2, ld = LD / 2, inn = L.lidFree && T.inner;
                lf([-lw, lh, ld], [LW, 0, 0], [0, -LH, 0], T.lidFront, inn);
                lf([lw, lh, -ld], [-LW, 0, 0], [0, -LH, 0], T.lidFront, inn);
                lf([lw, lh, ld], [0, 0, -LD], [0, -LH, 0], T.lidSide, inn);
                lf([-lw, lh, -ld], [0, 0, LD], [0, -LH, 0], T.lidSide, inn);
                lf([-lw, lh, -ld], [LW, 0, 0], [0, 0, LD], T.lidTop, inn);
                if (L.lidFree) lf([-lw, -lh, ld], [LW, 0, 0], [0, 0, -LD], T.inner, T.inner);
            }
            faces.sort((a, b2) => a.depth - b2.depth);
            // contact shadow and the plate the crate stands on
            ctx.setTransform(d, 0, 0, d, 0, 0);
            const A = L.crateA * (1 - L.dead * 0.45);
            ctx.globalAlpha = 0.55 * A * (1 - clamp(L.drop * 3));
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.ellipse(L.x, S.floorY + sc * 0.2, sc * (0.78 + L.bloom * 0.5), sc * 0.2, 0, 0, TAU); ctx.fill();
            const dark = 0.75 * L.dead;
            for (const f of faces) {
                if (!f.tex) continue;
                ctx.setTransform((d * f.ux) / f.tex.width, (d * f.uy) / f.tex.width, (d * f.vx) / f.tex.height, (d * f.vy) / f.tex.height, d * f.p0[0], d * f.p0[1]);
                ctx.globalAlpha = A * f.a;
                ctx.drawImage(f.tex, 0, 0);
                ctx.globalAlpha = A * f.a * clamp(f.shade * 0.82 + dark);
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, f.tex.width, f.tex.height);
                if (f.inside && L.core > 0.01) {
                    // the inside catches the light that is coming out: brightest at the hinge, gone by the rim
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.globalAlpha = A * f.a * clamp(L.core * 0.9);
                    ctx.drawImage(tinted(f.floor ? 'glow' : 'ramp', f.floor ? GLOW : RAMP, L.col), 0, 0, f.tex.width, f.tex.height);
                    ctx.globalCompositeOperation = 'source-over';
                }
                if (f.glow && L.prime > 0.01 && L.bloom < 0.6) {
                    // light leaking along the lid's seam, and the lamp in the lock on the front
                    ctx.globalCompositeOperation = 'lighter';
                    const fl = 0.72 + 0.28 * Math.sin(S.t * 23 + L.i * 2.1) * Math.sin(S.t * 7.3 + L.i);
                    ctx.globalAlpha = A * L.prime * fl * (1 - L.bloom / 0.6);
                    const sh = f.tex.height * (0.2 + 0.2 * L.vib);
                    ctx.drawImage(tinted('seam', SEAM, L.seam), 0, -sh * 0.42, f.tex.width, sh);
                    if (f.glow === 1) { const r = f.tex.height * 0.42; ctx.drawImage(tinted('glow', GLOW, L.seam), f.tex.width / 2 - r, f.tex.height * 0.44 - r, r * 2, r * 2); }
                    ctx.globalCompositeOperation = 'source-over';
                }
            }
            ctx.setTransform(d, 0, 0, d, 0, 0);
            ctx.globalAlpha = 1;
            // light spilling out of the open crate
            if (L.core > 0.01) {
                ctx.globalCompositeOperation = 'lighter';
                const r = sc * (0.9 + 0.8 * L.core);
                ctx.globalAlpha = clamp(L.core) * L.crateA;
                ctx.drawImage(tinted('glow', GLOW, L.col), L.x - r, base - sc * 0.35 - r * 0.8, r * 2, r * 1.6);
                ctx.globalAlpha = clamp(L.core * 0.8) * L.crateA;
                ctx.drawImage(GLOW, L.x - r * 0.45, base - sc * 0.3 - r * 0.4, r * 0.9, r * 0.8);
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1;
            }
        }
        function drawRays(x, y, r, rot, rgb, a) {
            if (a <= 0.003) return;
            ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = a;
            const t = tinted('rays', RAYS, rgb);
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(t, -r, -r, r * 2, r * 2); ctx.restore();
            ctx.save(); ctx.translate(x, y); ctx.rotate(-rot * 0.6 + 0.3); ctx.globalAlpha = a * 0.5; ctx.drawImage(t, -r * 0.72, -r * 0.72, r * 1.44, r * 1.44); ctx.restore();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }

        // ---- cards
        function cardHtml(it, entry) {
            if (!it) return `<div class="ubx-art"><div class="ubx-token"><b>?</b></div></div><div class="ubx-kick">You unboxed</div><div class="ubx-name"><span>The bot did not see what came out</span></div><div class="ubx-grade">Check its backpack</div><div class="ubx-foot"></div>`;
            const initials = it.title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
            const art = it.image ? `<img src="${esc(it.image)}" alt="" referrerpolicy="no-referrer" draggable="false">` : `<div class="ubx-token"><b>${esc(initials)}</b></div>`;
            const tier = it.grade ? it.grade.tier : 0;
            const grade = it.grade ? `<span class="ubx-pips">${[1, 2, 3, 4].map(n => `<i class="${n <= tier ? '' : 'off'}"></i>`).join('')}</span>${esc(it.grade.name)} grade` : esc(it.quality);
            const extra = entry.items.length > 1 ? `+ ${entry.items.slice(1).map(x => x.title).join(', ')}` : !it.named ? 'name still being read' : '';
            return `${it.unusual ? `<div class="ubx-tag unusual">${it.strange ? 'Strange ' : ''}Unusual</div>` : it.strange ? '<div class="ubx-tag strange">Strange</div>' : ''}
<div class="ubx-art">${art}</div><div class="ubx-kick">You unboxed</div><div class="ubx-name" style="--q:${css(nameRgb(it))}"><span>${esc(fullName(it))}</span></div><div class="ubx-grade">${grade}</div>
${it.effect ? `<div class="ubx-effect">★ ${esc(it.effect.name || `Effect #${it.effect.id}`)}</div>` : ''}
<div class="ubx-foot"><span class="ubx-extra" title="${esc(extra)}">${esc(extra)}</span><span class="ubx-value"></span></div>`;
        }
        function makeCard(L) {
            if (L.card) return L.card;
            const el = document.createElement('div');
            const it = L.item;
            el.className = `ubx-card${it ? (it.unusual ? ' unusual' : '') : ' blank'}`;
            el.style.setProperty('--c', css(tone(it)));
            el.innerHTML = cardHtml(it, L.entry);
            const img = el.querySelector('img');
            // a picture that will not load gives way to the drawn token
            const parts = () => ({ tag: el.querySelector('.ubx-tag'), nameEl: el.querySelector('.ubx-name'), kickEl: el.querySelector('.ubx-kick') });
            if (img) img.addEventListener('error', () => { it.image = null; el.innerHTML = cardHtml(it, L.entry); Object.assign(L.card, parts()); paintValue(L); }, { once: true });
            cardsEl.append(el);
            // nameA: the name comes one beat after the picture, the way a crate's result is read out in the game
            L.card = { el, x: L.x, y: S.floorY - S.cw * 0.5, s: S.cardS * 0.2, a: 0, ry: 70, tagA: 0, tagS: 2.4, float: 1, nameA: 0, z: 0, ...parts() };
            paintValue(L);
            return L.card;
        }
        // an item's price, or null when the price source does not list it (or it is an Unusual, never priced)
        function worth(it) {
            const p = it && !it.unusual && S.prices && it.marketName ? S.prices[it.marketName] : null;
            return p && p.net > 0 ? p : null;
        }
        function paintValue(L) {
            if (!L.card || !L.item) return;
            const v = L.card.el.querySelector('.ubx-value');
            // what selling it pays, after the market's fee
            const p = worth(L.item);
            if (v) v.innerHTML = p ? `${usd(p.net)}<small>${esc(VENUE.short)}</small>` : '';
            if (v) v.title = p ? `lowest listing on ${VENUE.long} ${usd(p.price)}, ${usd(p.net)} after its fee` : '';
        }
        function renderCards() {
            for (const L of S.lanes) {
                const c = L.card;
                if (!c) continue;
                const fy = c.float ? Math.sin(S.t * 1.3 + L.bob) * 4 * S.k * c.float : 0;
                c.el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${(c.y + fy).toFixed(2)}px, 0) scale(${c.s.toFixed(4)}) rotateY(${c.ry.toFixed(2)}deg)`;
                c.el.style.opacity = (c.a * (L.spot ? 1 : S.cardDim ?? 1)).toFixed(3);
                c.el.style.zIndex = L.spot ? 5 : c.z;
                if (c.nameEl) {
                    c.nameEl.style.opacity = c.nameA.toFixed(3);
                    c.nameEl.style.transform = `translateY(${((1 - c.nameA) * 10).toFixed(2)}px)`;
                    // "You unboxed" belongs to the reveal; the summary shows the items alone
                    c.kickEl.style.opacity = (c.nameA * (1 - S.sumA)).toFixed(3);
                }
                if (c.tag) { c.tag.style.opacity = c.tagA.toFixed(3); c.tag.style.transform = `scale(${c.tagS.toFixed(3)}) rotate(${((c.tagS - 1) * -8).toFixed(2)}deg)`; }
            }
        }
        S.cardDim = 1;

        // ---- status line
        const live = !!(source && source.live);
        function status(text) { statusEl.textContent = text; }
        function chargeStatus() {
            const got = S.lanes.filter(L => L.state !== 'wait' && L.entry).length;
            const m = Math.floor(S.t / 60), s = String(Math.floor(S.t % 60)).padStart(2, '0');
            const slow = live && S.t - S.lastEvent > 25 ? ' · the bot is slow to answer, still working' : '';
            if (S.skipWhenDone) return status(`Animation skipped: the items show as soon as the bot has finished · ${got} of ${count} · ${m}:${s}`);
            status(live ? `The bot is opening them · ${got} of ${count} opened · ${m}:${s}${slow}` : `${got} of ${count} in`);
        }

        // ---- results coming in
        function take(entry) {
            if (!entry || S.closed) return;
            let L = S.lanes.find(x => x.key === entry.key);
            if (!L) {
                L = S.lanes.find(x => !x.entry);
                if (!L) return;
                L.key = entry.key;
                S.queue.push(L);
                S.lastEvent = S.t;
            }
            L.entry = entry;
            L.item = entry.items[0] || null;
            if (L.item && L.item.image) { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.src = L.item.image; }
        }
        const api = {
            after,
            opened: take,
            done({ entries, message, stopped } = {}) {
                if (S.closed || S.complete) return;
                for (const e of entries || []) take(e);
                S.message = message || '';
                S.stopped = !!stopped || S.lanes.some(L => !L.entry);
                S.complete = true;
                if (!S.lanes.some(L => L.entry)) return fail(S.message || 'Nothing was opened.');
                for (const L of S.lanes) if (!L.entry) kill(L);
                const names = [...new Set(S.lanes.flatMap(L => (L.entry ? L.entry.items : [])).map(it => it.marketName).filter(Boolean))];
                // the summary always learns how the prices went: none to ask for, the answer, or a failure
                const priced = p => { if (S.closed) return; S.prices = p || {}; S.lanes.forEach(paintValue); if (S.phase === 'summary') fillSummary(); };
                if (opts.prices && names.length) Promise.resolve(opts.prices(names)).then(priced, () => { S.priceError = true; priced({}); });
                else priced({});
                if (opts.onResults) opts.onResults(S.lanes.filter(L => L.entry).map(L => L.entry));
            },
            fail: msg => fail(msg)
        };
        function kill(L) {
            L.state = 'dead';
            tw(L, 'dead', 1, 0.8); tw(L, 'prime', 0, 0.4); tw(L, 'sink', 0.06, 0.8); tw(L, 'vib', 0, 0.3);
            L.spin *= 0.15;
            trackEl.children[L.i].className = 'dead';
            if (!L.deadEl) {
                L.deadEl = document.createElement('div');
                L.deadEl.className = 'ubx-dead';
                L.deadEl.textContent = 'Not opened';
                L.deadEl.style.transform = `translate(${L.x}px, ${S.floorY + S.cw * 0.42}px) translate(-50%,0)`;
                cam.append(L.deadEl);
            }
            L.deadA = 0; tw(L, 'deadA', 1, 0.6, E.out, 0.3);
        }
        function fail(msg) {
            if (S.closed || S.phase === 'fail') return;
            S.failed = msg || 'Nothing was opened.';
            S.phase = 'fail'; S.complete = true;
            tasks = [];
            for (const L of S.lanes) { tw(L, 'prime', 0, 0.5); tw(L, 'vib', 0, 0.3); tw(L, 'dead', 1, 0.9); tw(L, 'shaft', 0, 0.6); tw(L, 'sink', 0.06, 0.9); L.spin *= 0.1; }
            tw(S, 'charge', 0, 0.8); tw(S, 'dim', 1, 0.4); tw(S, 'bigA', 0, 0.3);
            failEl.querySelector('p').textContent = S.failed;
            failEl.style.display = 'block';
            status('');
            sound.charge(0);
        }

        // ---- the phases
        function enter() {
            S.lanes.forEach((L, i) => {
                const at = 0.25 + i * 0.075;
                tw(L, 'drop', 0, 0.46, E.in2, at, () => {
                    L.landed = true;
                    L.sq = 0.72; tw(L, 'sq', 1, 0.5, E.spring);
                    dust(L.x, S.floorY + S.cw * 0.16, 7);
                    S.shake = Math.max(S.shake, 2.5);
                    sound.thud(0.55);
                });
                tw(L, 'shaft', 0.11, 0.9, E.out, at + 0.5);
            });
            after(0.25 + count * 0.075 + 0.75, () => { S.phase = 'charge'; S.chargeFrom = S.t; S.nextPrime = S.t; });
            bigC.textContent = live ? 'opened by the bot' : 'in';
            tw(S, 'bigA', 1, 0.9, E.out, 0.5 + count * 0.075);
            chargeStatus();
        }
        function prime(L) {
            if (L.state !== 'wait') return;
            L.state = 'primed';
            tw(L, 'prime', 1, 0.3); tw(L, 'vib', 0.22, 0.4); tw(L, 'shaft', 0.3, 0.5);
            L.hop = 0.001; tw(L, 'hop', 0.14, 0.12, E.out); tw(L, 'hop', 0, 0.3, E.in2, 0.12);
            ring(L.x, S.floorY + S.cw * 0.18, WARM, { r1: 1.5, life: 0.55, width: 2.5 });
            sparks(L.x, S.floorY - S.cw * 0.42, WARM, 9, { speed: 300, spread: 1.5, life: 0.6, size: 1.6 });
            trackEl.children[L.i].className = 'on';
            const got = S.lanes.filter(x => x.state === 'primed').length;
            tw(S, 'charge', got / count, 0.5);
            bigN.textContent = got; S.bigS = 1.1; tw(S, 'bigS', 1, 0.35, E.out);
            chargeStatus();
            sound.tick(L.i);
            sound.charge(got / count);
        }
        // every result is in: a three-beat countdown, each beat rattling the crates harder, then they open
        const BEAT = 0.62, COUNT_LEN = BEAT * 3 + 0.12;
        function hold() {
            S.phase = 'hold';
            status(S.stopped ? `${S.lanes.filter(L => L.entry).length} of ${count} opened` : `All ${count} are in`);
            const primed = S.lanes.filter(L => L.state === 'primed');
            for (const L of primed) {
                tw(L, 'lift', 0.16, COUNT_LEN, E.io); tw(L, 'vib', 0.7, COUNT_LEN, E.in); tw(L, 'spin', Math.sign(L.spin) * 5.5, COUNT_LEN, E.in); tw(L, 'shaft', 0.5, COUNT_LEN, E.in);
            }
            tw(S, 'dim', 0.62, COUNT_LEN * 0.8); tw(S, 'charge', 1, COUNT_LEN * 0.8);
            tw(S, 'bigA', 0, 0.25, E.in);
            bigC.textContent = S.stopped ? 'the bot stopped · opening what it opened' : 'opening';
            [3, 2, 1].forEach((n, k) => after(0.2 + k * BEAT, () => {
                bigEl.classList.add('count');
                bigI.style.display = 'none';
                bigN.textContent = n;
                S.bigA = 1; S.bigS = 1.45; tw(S, 'bigS', 1, BEAT * 0.9, E.out5);
                tw(S, 'bigA', 0.35, BEAT * 0.9, E.in2, BEAT * 0.15);
                // each beat knocks every crate off the floor and turns it a little
                for (const L of primed) {
                    L.hop = 0.001; tw(L, 'hop', 0.06 + 0.04 * k, 0.09, E.out); tw(L, 'hop', 0, 0.22, E.in2, 0.09);
                    L.yaw += rand(-0.22, 0.22) * (1 + k * 0.5);
                    L.sq = 0.86 - 0.05 * k; tw(L, 'sq', 1, 0.4, E.spring);
                }
                S.shake = Math.max(S.shake, 3 + k * 2.5);
                ring(S.W / 2, S.floorY + S.cw * 0.18, WARM, { r0: 1, r1: 6 + k * 2, life: 0.55, width: 2 + k });
                sound.thud(0.6 + 0.2 * k); sound.tick(12 + k * 5);
            }));
            after(0.2 + 3 * BEAT - 0.05, () => tw(S, 'bigA', 0, 0.12));
            sound.riser(0.2 + 3 * BEAT);
            after(0.2 + 3 * BEAT, release);
        }
        function release() {
            S.phase = 'release';
            tw(S, 'dim', 1, 0.25);
            const liveLanes = S.lanes.filter(L => L.state === 'primed');
            const normal = liveLanes.filter(L => !(L.item && L.item.unusual));
            const unusual = liveLanes.filter(L => L.item && L.item.unusual);
            S.sealed = liveLanes.length;
            const groups = [...new Set(normal.map(L => tierOf(L.item)))].sort((a, b) => a - b);
            let at = 0;
            groups.forEach((g, gi) => {
                const group = normal.filter(L => tierOf(L.item) === g).sort((a, b) => (a.item && a.item.strange ? 1 : 0) - (b.item && b.item.strange ? 1 : 0) || a.i - b.i);
                const gap = clamp(0.5 / group.length, 0.06, 0.16);
                group.forEach((L, j) => {
                    const strange = !!(L.item && L.item.strange);
                    after(at + j * gap + (strange ? 0.22 : 0), () => burst(L));
                });
                at += (group.length - 1) * gap + (group.some(L => L.item && L.item.strange) ? 0.22 : 0);
                const left = normal.filter(L => tierOf(L.item) > g).length + unusual.length;
                if (left) {
                    // the crates still sealed are the better ones: they wind up while the screen waits on them
                    const pause = 0.95 + 0.2 * gi;
                    after(at + 0.25, () => {
                        status(`Still sealed: ${left}`);
                        for (const L of S.lanes) if (L.state === 'primed') { tw(L, 'vib', Math.min(1, 0.55 + 0.16 * (gi + 1)), pause - 0.3, E.in); tw(L, 'spin', Math.sign(L.spin) * (6.5 + gi * 1.8), pause - 0.3); tw(L, 'shaft', 0.55 + 0.1 * gi, pause - 0.3); tw(L, 'lift', 0.18 + 0.03 * gi, pause - 0.3); }
                        tw(S, 'dim', 0.8 - 0.06 * gi, pause - 0.3);
                    });
                    after(at + pause - 0.02, () => tw(S, 'dim', 1, 0.2));
                    at += pause;
                }
            });
            let next = at + (unusual.length ? 0.35 : 0);
            unusual.forEach(L => { after(next, () => spotlight(L)); next += SPOT_LEN + 0.5; });
            after(next + (unusual.length ? 0.2 : 1.9), settle);
        }
        function throwLid(L, tier) {
            L.lidFree = true;
            L.lidVy = (5.2 + tier * 1.1) * rand(0.9, 1.1); L.lidVx = rand(-1.3, 1.3);
            L.lidSx = rand(-9, 9); L.lidSz = rand(-7, 7);
            tw(L, 'lidA', 0, 0.5, E.in, 0.55 + tier * 0.08);
        }
        function burst(L) {
            if (L.state !== 'primed') return;
            L.state = 'open';
            const it = L.item, tier = tierOf(it), col = tone(it);
            S.sealed--;
            L.col = col; L.seam = col;
            tw(L, 'vib', 0, 0.12); L.spin = 0; tw(L, 'yaw', Math.round((L.yaw - 0.5) / (Math.PI / 2)) * (Math.PI / 2) + 0.5, 0.9, E.out); tw(L, 'lift', 0, 0.5, E.out);
            tw(L, 'bloom', 1, 0.62, E.back);
            throwLid(L, tier);
            L.core = 1.5; tw(L, 'core', 0.5 + tier * 0.08, 1.2);
            L.shaft = 1.5 + tier * 0.3; tw(L, 'shaft', 0.42 + tier * 0.1, 1.1);
            L.hot = 1; tw(L, 'hot', 0.25 + tier * 0.12, 1.4);
            L.shaftW = 1.5 + tier * 0.12; tw(L, 'shaftW', 1, 0.9);
            const fy = S.floorY + S.cw * 0.18, top = S.floorY - S.cw * 0.5;
            ring(L.x, fy, col, { r1: 2 + tier * 0.4, width: 3 + tier });
            if (tier >= 3) ring(L.x, fy, [255, 255, 255], { r1: 3.4, life: 1, width: 2 });
            sparks(L.x, top, col, 26 + tier * 30, { speed: 560 + tier * 150, life: 0.9 + tier * 0.12, size: 1.8 + tier * 0.25 });
            embers(L.x, top, col, 3 + tier * 5, { rise: 150 + tier * 30 });
            S.flash = Math.max(S.flash, [0, 0.015, 0.03, 0.07, 0.16][tier] || 0);
            S.shake = Math.max(S.shake, [0, 1, 2.5, 6, 12][tier] || 0);
            if (tier >= 4) { S.speed = 0.16; S.speedHold = 0.1; }
            sound.burst(tier);
            after(0.09, () => showCard(L));
            if (S.sealed > 0 && S.phase === 'release') status(`Still sealed: ${S.sealed}`);
        }
        function showCard(L) {
            const c = makeCard(L), it = L.item, tier = tierOf(it);
            c.z = Math.round(tier);
            tw(c, 'a', 1, 0.16);
            tw(c, 'y', S.cardY, 0.7, E.back); tw(c, 's', S.cardS, 0.6, E.back); tw(c, 'ry', 0, 0.55, E.out);
            tw(c, 'nameA', 1, 0.32, E.out, 0.42);
            if (tier >= 3) { L.raysR = 1 + (tier - 3) * 0.3; tw(L, 'rays', tier >= 4 ? 0.8 : 0.5, 0.5); }
            if (it && it.strange && !it.unusual) after(0.52, () => stamp(L));
        }
        function stamp(L) {
            const c = L.card;
            if (!c) return;
            tw(c, 'tagA', 1, 0.08); tw(c, 'tagS', 1, 0.2, E.in2);
            after(0.2, () => {
                ring(c.x, S.floorY + S.cw * 0.18, STRANGE, { r1: 1.9, life: 0.6, width: 3 });
                sparks(c.x - 80 * c.s, c.y - 140 * c.s, STRANGE, 16, { speed: 320, spread: 3.1, life: 0.55, size: 1.6 });
                c.s = S.cardS * 1.06; tw(c, 's', S.cardS, 0.3, E.out);
                sound.stamp();
            });
        }

        // the Unusual: everything else steps back, three heartbeats, then the crate goes up and the item takes the screen
        const SPOT_LEN = 7.4;
        function spotlight(L) {
            S.phase = 'unusual';
            const it = L.item, others = S.lanes.filter(x => x !== L);
            status('');
            tw(S, 'hudA', 0, 0.4); tw(S, 'cardDim', 0.22, 0.6); tw(S, 'dim', 0.5, 0.7);
            for (const o of others) tw(o, 'lit', 0.25, 0.7);
            L.seam = UNUSUAL; L.col = UNUSUAL;
            tw(L, 'vib', 1, 1.9, E.in); tw(L, 'spin', Math.sign(L.spin || 1) * 13, 1.9, E.in); tw(L, 'lift', 0.3, 1.9, E.io); tw(L, 'shaft', 0.35, 0.5);
            const fx0 = (S.W / 2 - L.x) * 0.22;
            tw(S, 'camS', 1.16, 1.9, E.io); tw(S, 'camX', fx0 * 1.16 + (S.W / 2 - L.x) * 0.16 * 0, 1.9, E.io); tw(S, 'camY', -S.H * 0.035, 1.9, E.io);
            [0.45, 1.0, 1.42, 1.72].forEach((at, n) => after(at, () => {
                L.shaft = 0.9 + n * 0.22; tw(L, 'shaft', 0.4, 0.28);
                ring(L.x, S.floorY + S.cw * 0.18, UNUSUAL, { r1: 2.2 + n * 0.5, life: 0.5, width: 3 + n });
                S.shake = Math.max(S.shake, 3 + n * 2);
                S.flash = Math.max(S.flash, 0.02 + n * 0.012);
                sound.heart(0.7 + n * 0.1);
            }));
            after(2.0, () => {
                // the crate does not open: it is gone
                L.state = 'open'; S.sealed--;
                L.blown = 1; L.vib = 0; L.lift = 0;
                const top = S.floorY - S.cw * 0.5, fy = S.floorY + S.cw * 0.18;
                S.flash = 1; tw(S, 'flash', 0, 0.75, E.out);
                S.shake = 26;
                S.wave = { x: L.x, y: top, r: 0, a: 1 }; tw(S.wave, 'r', 2.2, 1.5, E.out); tw(S.wave, 'a', 0, 1.5, E.in2);
                S.speed = 0.1; S.speedHold = 0.16;
                L.shaft = 3.4; tw(L, 'shaft', 1.5, 2.2); L.shaftW = 3.4; tw(L, 'shaftW', 1.7, 2.4, E.out5); L.hot = 1;
                tw(S, 'dim', 0.82, 0.6);
                shards(L.x, top, 46);
                sparks(L.x, top, UNUSUAL, 240, { speed: 1500, spread: 1.7, life: 1.5, size: 2.6 });
                sparks(L.x, top, GOLD, 150, { speed: 1150, spread: 1.4, life: 1.7, size: 2.2 });
                for (let i = 0; i < 4; i++) ring(L.x, fy, i % 2 ? GOLD : UNUSUAL, { r0: 0.3, r1: 3.5 + i * 2.4, life: 0.9 + i * 0.3, width: 7 - i });
                for (const o of others) { o.hop = 0.001; tw(o, 'hop', 0.1 + 0.18 / (1 + Math.abs(o.i - L.i)), 0.12, E.out, Math.abs(o.i - L.i) * 0.035); tw(o, 'hop', 0, 0.4, E.in2, 0.12 + Math.abs(o.i - L.i) * 0.035); }
                sound.unusual();
                // embers keep rising for as long as it has the screen
                for (let i = 0; i < 38; i++) after(0.1 + i * 0.11, () => { if (S.phase === 'unusual') { embers(L.x, S.floorY, i % 3 ? UNUSUAL : GOLD, 4, { w: 90, rise: 260, life: 3 }); embers(S.W / 2 + S.camX * 0, S.H * 0.62, i % 3 ? UNUSUAL : GOLD, 2, { w: 260, rise: 120, life: 2.6 }); } });
                // the card comes out of the light to the middle of the screen
                const c = makeCard(L);
                L.spot = true;
                const bigS = Math.min((S.H * 0.47) / 330, (S.W * 0.3) / 240), midY = S.H * 0.66;
                c.z = 9; c.float = 0.6;
                tw(c, 'a', 1, 0.2, E.out, 0.1);
                tw(c, 'x', S.W / 2, 0.9, E.io, 0.1); tw(c, 'y', midY, 0.9, E.back, 0.1); tw(c, 's', bigS, 0.9, E.back, 0.1); tw(c, 'ry', 0, 0.8, E.out, 0.1);
                tw(S, 'camS', 1, 0.9, E.io, 0.1); tw(S, 'camX', 0, 0.9, E.io, 0.1); tw(S, 'camY', 0, 0.9, E.io, 0.1);
                S.spot = { x: S.W / 2, y: midY, a: 0, r: Math.min(S.H * 0.62, S.W * 0.42), kA: 0, nA: 0, letters: [] };
                tw(S.spot, 'a', 1, 0.8, E.out, 0.5);
                after(1.0, () => { tw(c, 'tagA', 1, 0.1); tw(c, 'tagS', 1, 0.22, E.in2); });
                // the words: UNUSUAL, then the effect's name letter by letter, then the item
                const name = it.effect ? it.effect.name || `Effect #${it.effect.id}` : 'Unusual';
                spotE.innerHTML = [...name].map(ch => (ch === ' ' ? '<span>&nbsp;</span>' : `<span>${esc(ch)}</span>`)).join('');
                spotN.innerHTML = `${it.strange ? '<b>Strange</b> ' : ''}<i>Unusual</i> ${esc(it.title)}`;
                placeSpot();
                S.spot.letters = [...spotE.children].map(el => ({ el, a: 0, s: 3.2, y: -0.25 }));
                tw(S.spot, 'kA', 1, 0.5, E.out, 0.55);
                S.spot.letters.forEach((l, i) => { const at = 0.85 + i * 0.055; tw(l, 'a', 1, 0.1, E.out, at); tw(l, 's', 1, 0.3, E.out5, at); tw(l, 'y', 0, 0.3, E.out5, at); after(at + 0.02, () => { S.shake = Math.max(S.shake, 4); }); });
                tw(S.spot, 'nA', 1, 0.5, E.out, 1.05 + S.spot.letters.length * 0.055);
                tw(c, 'nameA', 1, 0.4, E.out, 1.25 + S.spot.letters.length * 0.055);
            });
            // and back to its place in the row
            after(SPOT_LEN - 0.9, () => {
                const c = L.card, sp = S.spot;
                if (sp) { tw(sp, 'kA', 0, 0.3); tw(sp, 'nA', 0, 0.3); tw(sp, 'a', 0, 0.6); sp.letters.forEach(l => tw(l, 'a', 0, 0.3)); }
                if (c) { tw(c, 'x', L.x, 0.75, E.io, 0.15); tw(c, 'y', S.cardY, 0.75, E.io, 0.15); tw(c, 's', S.cardS, 0.75, E.io, 0.15); c.float = 1; }
                tw(S, 'cardDim', 1, 0.6, E.out, 0.2); tw(S, 'dim', 1, 0.6, E.out, 0.2); tw(S, 'hudA', 1, 0.5, E.out, 0.3);
                for (const o of others) tw(o, 'lit', 1, 0.6, E.out, 0.2);
                tw(L, 'shaft', 0.95, 0.8); tw(L, 'shaftW', 1.15, 0.8); L.raysR = 1.5; tw(L, 'rays', 0.85, 0.6, E.out, 0.5);
                after(0.9, () => { L.spot = false; S.spot = null; S.phase = 'release'; });
            });
        }
        function settle() {
            S.phase = 'settle';
            status(S.stopped ? `${S.lanes.filter(L => L.entry).length} of ${count} opened` : '');
            sound.charge(0);
            after(1.5, () => summary(1));
        }

        // ---- the summary
        function sortedLanes() {
            return S.lanes.filter(L => L.entry).sort((a, b) => (b.item ? b.item.rank : -1) - (a.item ? a.item.rank : -1) || a.i - b.i);
        }
        function placeSummary(d) {
            const list = sortedLanes(), n = list.length;
            const top = S.H * 0.2, bottom = S.H * 0.83, aw = S.W * 0.94, ah = bottom - top, gx = 26, gy = 24;
            let best = { s: 0, cols: n };
            for (let cols = 1; cols <= n; cols++) {
                const rows = Math.ceil(n / cols);
                const s = Math.min(aw / (cols * (240 + gx)), ah / (rows * (330 + gy)), 1.35 * Math.max(1, S.k));
                if (s > best.s + 0.001) best = { s, cols };
            }
            const rows = Math.ceil(n / best.cols);
            list.forEach((L, j) => {
                const r = Math.floor(j / best.cols), inRow = r === rows - 1 ? n - r * best.cols : best.cols, col = j - r * best.cols;
                const x = S.W / 2 + (col - (inRow - 1) / 2) * (240 + gx) * best.s;
                const y = top + ah / 2 + (r - (rows - 1) / 2) * (330 + gy) * best.s;
                const c = makeCard(L);
                c.z = n - j;
                if (d <= 0) { c.x = x; c.y = y; c.s = best.s; c.a = 1; c.ry = 0; c.float = 0; c.tagA = 1; c.tagS = 1; c.nameA = 1; }
                else { const at = j * 0.035 * d; tw(c, 'x', x, 0.85 * d, E.io, at); tw(c, 'y', y, 0.85 * d, E.io, at); tw(c, 's', best.s, 0.85 * d, E.io, at); tw(c, 'a', 1, 0.2); tw(c, 'ry', 0, 0.3); tw(c, 'float', 0, 0.5); tw(c, 'tagA', 1, 0.2); tw(c, 'tagS', 1, 0.2); tw(c, 'nameA', 1, 0.3); }
            });
        }
        function fillSummary() {
            const list = sortedLanes(), items = list.map(L => L.item).filter(Boolean);
            const opened = list.length;
            $('.ubx-sum-head h2').innerHTML = `<b>${opened}</b> opened${opened < count ? ` of ${count}` : ''} · ${esc(opts.caseName || '')}`;
            const chips = [];
            const nUnusual = items.filter(i => i.unusual).length;
            if (nUnusual) chips.push([UNUSUAL, nUnusual, 'Unusual']);
            for (const t of [4, 3, 2, 1]) {
                const g = items.filter(i => i.grade && i.grade.tier === t);
                if (g.length) chips.push([TIER_RGB[t], g.length, g[0].grade.name]);
            }
            // an item with no case grade (a crate's weapons, tools and bonus items) is counted once, by its quality, so
            // the chips add up to the items; Strange is a second chip only for graded case items
            const byQuality = new Map();
            for (const i of items.filter(x => !x.grade && !x.unusual)) byQuality.set(i.quality, (byQuality.get(i.quality) || 0) + 1);
            for (const [q, n] of [...byQuality].sort((a, b) => b[1] - a[1])) chips.push([nameRgb({ quality: q, strange: q === 'Strange' }), n, q]);
            const gradedStrange = items.filter(i => i.grade && i.strange && !i.unusual).length;
            if (gradedStrange) chips.push([STRANGE, gradedStrange, 'Strange']);
            $('.ubx-chips').innerHTML = chips.map(([c, n, l]) => `<span class="ubx-chip" style="--c:${css(c)}"><b>${n}</b>${esc(l)}</span>`).join('');
            const all = list.flatMap(L => L.entry.items);
            const priced = all.filter(i => worth(i));
            const total = priced.reduce((a, i) => a + worth(i).net, 0);
            const notes = $('.ubx-sum-foot').querySelectorAll('.ubx-note');
            if (priced.length) {
                $('.ubx-total').innerHTML = `<b>${usd(total)}</b> on ${esc(VENUE.long)}, after its fee`;
                const left = all.length - priced.length;
                notes[0].textContent = left ? `${priced.length} of ${all.length} items priced. ${all.some(i => i.unusual) ? 'An Unusual is worth what its effect fetches, so it is left out rather than guessed. ' : ''}${left - all.filter(i => i.unusual).length > 0 ? `Items with no price on ${VENUE.long} are left out.` : ''}` : 'Every item priced.';
            } else {
                $('.ubx-total').textContent = '';
                notes[0].textContent = S.priceError ? 'Prices could not be read just now, so no value is shown.' : S.prices ? `No price on ${VENUE.long} for these items, so no value is shown.` : opts.prices ? 'Reading prices…' : '';
            }
            const dead = count - opened;
            notes[1].textContent = [dead > 0 ? `${dead} not opened.` : '', S.message && (dead > 0 || !/^Opened \d+ of \d+\.$/.test(S.message)) ? `The bot said: ${S.message}` : ''].filter(Boolean).join(' ');
        }
        function summary(d) {
            if (S.phase === 'summary') return;
            S.phase = 'summary';
            status('');
            fillSummary();
            for (const L of S.lanes) { tw(L, 'crateA', 0, 0.6 * d); tw(L, 'shaft', 0, 0.9 * d); tw(L, 'rays', 0, 0.5 * d); tw(L, 'core', 0, 0.5 * d); tw(L, 'lidA', 0, 0.2 * d); if (L.deadEl) tw(L, 'deadA', 0, 0.3 * d); }
            tw(S, 'hudA', 0, 0.4 * d); tw(S, 'sumA', 1, 0.7 * d, E.out, 0.45 * d); tw(S, 'charge', 0.55, 0.8 * d); tw(S, 'dim', 0.9, 0.6 * d); tw(S, 'cardDim', 1, 0.2); tw(S, 'camS', 1, 0.3); tw(S, 'camX', 0, 0.3); tw(S, 'camY', 0, 0.3);
            placeSummary(d);
            sumEl.style.pointerEvents = 'auto';
            sound.charge(0);
        }
        function skip() {
            if (S.closed || S.phase === 'summary' || S.phase === 'fail') return;
            if (!S.complete) { S.skipWhenDone = true; chargeStatus(); return; }
            // drop the rest of the timeline and lay every item out now
            tasks = []; tweens = []; parts = [];
            S.speed = 1; S.bigA = 0; S.flash = 0; S.shake = 0; S.wave.a = 0; S.spot = null; S.cardDim = 1; S.sealed = 0;
            spotK.style.opacity = 0; spotN.style.opacity = 0; spotE.innerHTML = '';
            for (const L of S.lanes) {
                L.spot = false; L.vib = 0; L.lit = 1; L.drop = 0; L.landed = true;
                if (L.entry) { L.state = 'open'; L.bloom = 1; L.lidA = 0; L.col = tone(L.item); makeCard(L).nameA = 1; }
            }
            summary(0.35);
        }

        // ---- one frame
        function tick(dtReal) {
            if (S.closed) return;
            if (S.speed < 1) { if (S.speedHold > 0) S.speedHold -= dtReal; else S.speed = Math.min(1, S.speed + dtReal * 2.6); }
            const dt = dtReal * S.speed;
            S.t += dt;
            runTimeline();
            // results are shown as primed crates one after another, never faster than the eye can count
            if ((S.phase === 'charge' || S.phase === 'enter') && S.queue.length && S.t >= S.nextPrime && S.queue[0].landed) { prime(S.queue.shift()); S.nextPrime = S.t + 0.13; }
            if (S.phase === 'charge') {
                if (!S.complete || S.queue.length) { if (Math.floor(S.t * 4) !== Math.floor((S.t - dt) * 4)) chargeStatus(); }
                else if (S.skipWhenDone) skip();
                else if (S.t - S.chargeFrom > 1.4 && S.t >= S.nextPrime + 0.45) hold();
            }
            for (const L of S.lanes) {
                L.yaw += L.spin * dt;
                if (L.lidFree && L.lidA > 0) {
                    L.lidVy -= 9.5 * dt; L.lidY += L.lidVy * dt; L.lidX += L.lidVx * dt; L.lidRx += L.lidSx * dt; L.lidRz += L.lidSz * dt;
                }
                if (L.deadEl) L.deadEl.style.opacity = (L.deadA || 0).toFixed(3);
            }
            stepParts(dt);
            S.shake *= Math.pow(0.0012, dtReal);
            if (S.flash > 0 && !tweens.some(x => x.o === S && x.k === 'flash')) S.flash = Math.max(0, S.flash - dtReal * 0.9);
            render();
        }
        function render() {
            const sh = S.shake > 0.05 ? S.shake * S.k : 0;
            cam.style.transform = `translate3d(${(S.camX + (sh ? rand(-sh, sh) : 0)).toFixed(2)}px, ${(S.camY + (sh ? rand(-sh, sh) : 0)).toFixed(2)}px, 0) scale(${S.camS.toFixed(4)})`;
            if (bg) bg.draw(S);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, fx.width, fx.height);
            if (!bg) flatBackground();
            // rays behind the best cards
            for (const L of S.lanes) if (L.rays > 0.003 && L.card && !L.spot) drawRays(L.card.x, L.card.y, S.laneW * 1.05 * L.raysR, S.t * 0.35 + L.i, tone(L.item), L.rays * L.card.a * S.cardDim * 0.7);
            if (S.spot && S.spot.a > 0.003) {
                drawRays(S.spot.x, S.spot.y, S.spot.r * 1.25, S.t * 0.22, UNUSUAL, S.spot.a * 0.85);
                drawRays(S.spot.x, S.spot.y, S.spot.r * 0.85, -S.t * 0.3, GOLD, S.spot.a * 0.4);
                ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = S.spot.a * 0.6;
                ctx.drawImage(tinted('glow', GLOW, UNUSUAL), S.spot.x - S.spot.r, S.spot.y - S.spot.r, S.spot.r * 2, S.spot.r * 2);
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
            }
            for (const L of S.lanes) drawCrate(L);
            drawParts();
            renderCards();
            hud.style.opacity = S.hudA.toFixed(3);
            bigEl.style.opacity = (S.bigA * (S.phase === 'hold' ? 1 : S.dim)).toFixed(3);
            bigEl.style.transform = `translate(-50%,-50%) scale(${S.bigS.toFixed(4)})`;
            sumEl.style.opacity = S.sumA.toFixed(3);
            const sp = S.spot;
            spotK.style.opacity = sp ? sp.kA.toFixed(3) : 0;
            spotN.style.opacity = sp ? sp.nA.toFixed(3) : 0;
            if (sp) {
                spotK.style.transform = `scale(${(1.25 - 0.25 * sp.kA).toFixed(3)})`;
                for (const l of sp.letters) { l.el.style.opacity = l.a.toFixed(3); l.el.style.transform = `translateY(${(l.y * 100).toFixed(1)}%) scale(${l.s.toFixed(3)})`; }
            }
        }
        // no WebGL: plain shafts on the 2D canvas so the screen still reads
        function flatBackground() {
            const d = S.dpr;
            ctx.setTransform(d, 0, 0, d, 0, 0);
            ctx.fillStyle = '#0b0a09'; ctx.fillRect(0, 0, S.W, S.H);
            ctx.globalCompositeOperation = 'lighter';
            for (const L of S.lanes) {
                const a = clamp(L.shaft * L.lit * S.dim * 0.5);
                if (a <= 0.003) continue;
                const w = S.laneW * 0.5 * L.shaftW, g = ctx.createLinearGradient(L.x - w, 0, L.x + w, 0);
                g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(${L.col[0]},${L.col[1]},${L.col[2]},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g; ctx.fillRect(L.x - w, 0, w * 2, S.floorY + S.cw * 0.2);
            }
            ctx.globalCompositeOperation = 'source-over';
            if (S.flash > 0.003) { ctx.fillStyle = `rgba(255,246,230,${clamp(S.flash)})`; ctx.fillRect(0, 0, S.W, S.H); }
        }

        // ---- controls
        const soundBtn = root.querySelector('[data-a="sound"]');
        const paintSound = () => { soundBtn.textContent = sound.on ? 'Sound on' : 'Sound off'; soundBtn.classList.toggle('on', sound.on); };
        function close() {
            if (S.closed) return;
            S.closed = true;
            cancelAnimationFrame(raf);
            removeEventListener('resize', layout);
            removeEventListener('keydown', onKey, true);
            sound.close();
            if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
            document.documentElement.style.overflow = prevOverflow;
            root.remove();
            if (opts.onClose) opts.onClose({ complete: S.complete, message: S.failed || S.message || '', entries: S.lanes.filter(L => L.entry).map(L => L.entry) });
        }
        root.addEventListener('click', e => {
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'close') close();
            else if (a === 'skip') skip();
            else if (a === 'full') (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(() => {});
            else if (a === 'sound') { const v = sound.set(!sound.on); try { localStorage.setItem('ubxSound', v ? 'on' : 'off'); } catch { /* fine */ } paintSound(); if (v && S.phase === 'charge') sound.charge(S.charge); }
            else if (a === 'again') {
                // the same results again, as a replay: nothing is opened a second time
                const entries = S.lanes.filter(L => L.entry).map(L => L.entry), o = { ...opts };
                close();
                open({ ...o, count: entries.length, source: playback({ entries }), label: o.sample ? o.label : 'Replay · these items were opened earlier', labelKind: o.sample ? o.labelKind : 'replay', onClose: null, onResults: null });
            }
        });
        function onKey(e) {
            if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (S.phase === 'summary' || S.phase === 'fail') { if (e.key === 'Escape') close(); } else skip();
            }
        }
        addEventListener('keydown', onKey, true);
        addEventListener('resize', layout);
        // the browser needs a click before it plays sound: a saved "on" is honoured when this screen was opened by one
        if (soundPref) sound.set(true);
        paintSound();

        for (const rgb of [WARM, UNIQUE, STRANGE, UNUSUAL, GOLD, BLANK, [255, 255, 255], [120, 108, 96], ...Object.values(TIER_RGB)]) { tinted('glow', GLOW, rgb); tinted('rays', RAYS, rgb); tinted('seam', SEAM, rgb); tinted('ramp', RAMP, rgb); }
        layout();
        enter();
        if (source) Promise.resolve().then(() => source.start(api)).catch(err => fail(`Something went wrong reading the results (${err && err.message ? err.message : err}). Check the log before pressing Open again.`));
        let raf = 0, last = performance.now();
        const loop = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; tick(dt); raf = requestAnimationFrame(loop); };
        if (!opts.manual) raf = requestAnimationFrame(loop);
        else render();
        return { close, skip, step: dt => tick(dt), state: S, el: root };
    }

    // ---------------------------------------------------------------- where the results come from
    /** A batch that is already known (a logged press, or a marked sample), handed over at a steady pace. */
    function playback(batch, { lead = 1.5, gap = 0.42 } = {}) {
        return {
            live: false,
            start(api) {
                batch.entries.forEach((e, i) => api.after(lead + i * gap, () => api.opened(e)));
                api.after(lead + batch.entries.length * gap + 0.25, () => api.done({ entries: batch.entries, message: batch.stopped ? `Opened ${batch.entries.length} of ${batch.requested}. Stopped: ${batch.stopped}.` : '', stopped: !!batch.stopped }));
            }
        };
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function readState() {
        const r = await fetch('/api/state', { cache: 'no-store' });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
        return b;
    }
    /**
     * The real thing: ONE POST to the server's open action (the press that launched this screen), and reads of its
     * log while it works. Each case shows as soon as the bot has logged it; the names come with the last read.
     */
    function liveSource({ caseId, caseName, keyId, count }) {
        let started = false;
        return {
            live: true,
            async start(api) {
                if (started) return; // never a second POST
                started = true;
                let base;
                try { base = await readState(); if (base.error) throw new Error(base.error); } catch (err) { return api.fail(`Nothing was opened: the server could not be reached (${err.message}).`); }
                if (base.busy) return api.fail(`Nothing was opened: the bot is busy (${base.busy}). Try again in a moment.`);
                const before = new Set(base.entries.map(e => e.key));
                const fresh = b => b.entries.filter(e => !before.has(e.key) && e.case === caseName).reverse();
                let settled = null;
                fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ case: caseId, key: keyId, count }) })
                    .then(async r => ({ body: await r.json().catch(() => ({})) }), err => ({ lost: err.message || 'connection lost' }))
                    .then(v => { settled = v; });
                const look = async () => { try { const b = await readState(); for (const e of fresh(b)) api.opened(e); return b; } catch { return null; } };
                while (!settled) { await sleep(1500); if (!settled) await look(); }
                if (settled.lost) {
                    // the page lost the answer, not the bot its work: follow the log until the bot is idle again
                    for (let i = 0; i < 150; i++) { const b = await look(); if (b && b.busy !== 'unbox') break; await sleep(2000); }
                }
                let last = null;
                for (let i = 0; i < 5 && !last; i++) { last = await look(); if (!last) await sleep(1500); }
                const said = settled.body ? settled.body.message || settled.body.error || '' : 'The connection dropped while the bot worked; this is what its log shows.';
                api.done({ entries: last ? fresh(last) : [], message: last ? said : `${said} The log could not be re-read, so some names may be missing.`.trim() });
            }
        };
    }
    async function fetchPrices(names) {
        const r = await fetch('/api/prices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names }) });
        if (!r.ok) return {};
        return (await r.json()).prices || {};
    }

    function setCurrency(code, venue) {
        try { money = new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD' }); } catch { /* keep USD */ }
        if (venue) VENUE = venue;
    }

    window.UnboxShow = { open, playback, liveSource, fetchPrices, readState, setCurrency };
})();
