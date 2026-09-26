// butterfly.js
const vfxCanvas = document.getElementById('vfx-canvas');
const vfxCtx = vfxCanvas.getContext('2d');

let butterflies = [];
let stardust = [];
let vfxWidth = window.innerWidth;
let vfxHeight = window.innerHeight;

function resizeVFX() {
    vfxWidth = window.innerWidth;
    vfxHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    vfxCanvas.width = vfxWidth * dpr;
    vfxCanvas.height = vfxHeight * dpr;
    vfxCtx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeVFX);
resizeVFX();

const PINK_PALETTE = ['#ff007f', '#ff4fa8', '#ff1493', '#ff85c2'];

class RoseyButterfly {
    constructor(x, y) {
        this.x = x !== undefined ? x : Math.random() * vfxWidth;
        this.y = y !== undefined ? y : Math.random() * vfxHeight;
        const initialAngle = Math.random() * Math.PI * 2;
        this.speedLimit = 0.5 + Math.random() * 1.0;
        this.vx = Math.cos(initialAngle) * this.speedLimit;
        this.vy = Math.sin(initialAngle) * this.speedLimit;
        this.ax = 0; this.ay = 0;
        this.size = 8 + Math.random() * 5;
        this.color = PINK_PALETTE[Math.floor(Math.random() * PINK_PALETTE.length)];
        this.flapSpeed = 0.08 + Math.random() * 0.06;
        this.flapTime = Math.random() * 50;
    }

    update() {
        this.flapTime += this.flapSpeed;
        if (Math.random() < 0.03) {
            this.ax = (Math.random() - 0.5) * 0.15;
            this.ay = (Math.random() - 0.5) * 0.15;
        }
        this.vx += this.ax; this.vy += this.ay;
        this.vx *= 0.98; this.vy *= 0.98;
        const currentSpeed = Math.hypot(this.vx, this.vy) || 1;
        if (currentSpeed > this.speedLimit) {
            this.vx = (this.vx / currentSpeed) * this.speedLimit;
            this.vy = (this.vy / currentSpeed) * this.speedLimit;
        }
        this.x += this.vx; this.y += this.vy;
        const pad = this.size * 2;
        if (this.x < -pad) this.x = vfxWidth + pad;
        if (this.x > vfxWidth + pad) this.x = -pad;
        if (this.y < -pad) this.y = vfxHeight + pad;
        if (this.y > vfxHeight + pad) this.y = -pad;
        // Reduced frequency of dust spawning for better performance
        if (Math.random() < 0.15) stardust.push(new RoseyDust(this.x, this.y, this.color));
    }

    draw() {
        let heading = Math.atan2(this.vy, this.vx) + Math.PI / 2;
        vfxCtx.save();
        vfxCtx.translate(this.x, this.y);
        vfxCtx.rotate(heading);
        let wingFlapScale = Math.sin(this.flapTime);
        // Optimized: removed heavy shadowBlur to prevent CPU lag spikes
        vfxCtx.fillStyle = this.color;
        vfxCtx.beginPath();
        vfxCtx.ellipse(-this.size * 0.5 * wingFlapScale, -this.size * 0.3, this.size * Math.abs(wingFlapScale), this.size * 0.75, Math.PI / 6, 0, Math.PI * 2);
        vfxCtx.fill();
        vfxCtx.beginPath();
        vfxCtx.ellipse(this.size * 0.5 * wingFlapScale, -this.size * 0.3, this.size * Math.abs(wingFlapScale), this.size * 0.75, -Math.PI / 6, 0, Math.PI * 2);
        vfxCtx.fill();
        vfxCtx.fillStyle = '#ffffff';
        vfxCtx.beginPath();
        vfxCtx.ellipse(0, 0, 1.5, this.size * 0.75, 0, 0, Math.PI * 2);
        vfxCtx.fill();
        vfxCtx.restore();
    }
}

class RoseyDust {
    constructor(x, y, color) {
        this.x = x; this.y = y;
        this.vx = (Math.random() - 0.5) * 0.2;
        this.vy = (Math.random() - 0.5) * 0.2 + 0.1;
        this.life = 1.0;
        this.decay = 0.02 + Math.random() * 0.015;
        this.size = 1.0 + Math.random() * 1.5;
        this.color = color;
    }
    update() { this.x += this.vx; this.y += this.vy; this.life -= this.decay; }
    draw() {
        vfxCtx.save();
        vfxCtx.globalAlpha = this.life;
        vfxCtx.fillStyle = this.color;
        vfxCtx.beginPath();
        vfxCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        vfxCtx.fill();
        vfxCtx.restore();
    }
}

for (let i = 0; i < 6; i++) butterflies.push(new RoseyButterfly()); // Reduced count from 8 to 6 for buttery-smooth performance

function renderVFX() {
    vfxCtx.clearRect(0, 0, vfxWidth, vfxHeight);
    for (let i = stardust.length - 1; i >= 0; i--) {
        stardust[i].update();
        if (stardust[i].life <= 0) stardust.splice(i, 1);
        else stardust[i].draw();
    }
    butterflies.forEach(b => { b.update(); b.draw(); });
    requestAnimationFrame(renderVFX);
}
renderVFX();