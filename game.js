const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Game Constants & Config ---
const GRAVITY = 0.25;
const FRICTION = 0.995;
const BIRD_SLOW = 0.7; 
const BOOSTER_KICK = 10;

const WALL_TYPES = {
    CONCRETE: { color: '#484f58', speedLoss: 1.5, money: 20, name: 'Concrete' },
    GLASS: { color: '#a5d6ff', speedLoss: 0.3, money: 5, name: 'Glass' },
    GOLD: { color: '#f2cc60', speedLoss: 1.2, money: 200, name: 'Gold' },
    METAL: { color: '#8b949e', speedLoss: 4.0, money: 50, name: 'Metal' }
};

// --- Game State ---
let state = 'AIM'; 
let player, cannon, world;
let cameraX = 0;
let money = parseInt(localStorage.getItem('cannonSmasherMoney')) || 0;
let wallCount = 0;
let particles = [];
let shake = 0;

// --- Upgrades Safety Check ---
let rawUpgrades = localStorage.getItem('cannonSmasherUpgrades');
let upgrades = rawUpgrades ? JSON.parse(rawUpgrades) : {
    power: { level: 1, max: 20, cost: 50, factor: 1.5 },
    cannonSize: { level: 1, max: 10, cost: 200, factor: 1.5 },
    efficiency: { level: 1, max: 20, cost: 75, factor: 0.92 },
    dashes: { level: 0, max: 5, cost: 500, factor: 1 }
};
// Ensure 'dashes' exists for players with old saves
if (!upgrades.dashes) upgrades.dashes = { level: 0, max: 5, cost: 500, factor: 1 };

// --- Classes ---

class Particle {
    constructor(x, y, color, speed = 5) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * speed;
        this.vy = (Math.random() - 0.5) * speed;
        this.size = Math.random() * 4 + 2;
        this.color = color;
        this.life = 1.0;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.1;
        this.life -= 0.02;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - cameraX, this.y, this.size, this.size);
        ctx.restore();
    }
}

class Player {
    constructor() { this.reset(); }
    reset() {
        this.x = 100;
        this.y = canvas.height - 150;
        this.vx = 0;
        this.vy = 0;
        this.w = 30;
        this.h = 30;
        this.rot = 0;
        this.isFlying = false;
        this.dashCount = upgrades.dashes.level;
    }
    dash() {
        if (this.dashCount > 0 && this.isFlying) {
            this.vx += 18;
            this.vy = -6;
            this.dashCount--;
            applyShake(15);
            createParticles(this.x, this.y, 30, '#fff', 10);
        }
    }
    update() {
        if (!this.isFlying) return;
        this.vy += GRAVITY;
        this.vx *= FRICTION;
        this.x += this.vx;
        this.y += this.vy;
        this.rot += this.vx * 0.02;

        if (this.y + this.h > canvas.height - 50) {
            this.y = canvas.height - 50 - this.h;
            this.vx *= 0.994; // Even smoother slide
            this.vy = 0;
            if (Math.abs(this.vx) < 0.2) this.stop();
        }
    }
    stop() {
        this.isFlying = false;
        setTimeout(() => { if (state === 'FLY') finishRun(); }, 1200);
    }
    draw() {
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);
        ctx.rotate(this.rot);
        ctx.fillStyle = '#ff7b72';
        ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(-this.w/2, -this.h/2, this.w, this.h);
        ctx.restore();

        if (this.isFlying && upgrades.dashes.level > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 24px Oswald';
            ctx.textAlign = 'center';
            ctx.fillText(`DASHES: ${this.dashCount}`, this.x - cameraX, this.y - 40);
        }
    }
}

class Cannon {
    constructor() {
        this.x = 100;
        this.y = canvas.height - 100;
        this.angle = -Math.PI / 4;
        this.power = 0;
        this.isCharging = false;
        this.chargeDir = 1;
    }
    update() {
        if (state !== 'AIM') return;
        if (this.isCharging) {
            this.power += 2.5 * this.chargeDir;
            if (this.power >= 100 || this.power <= 0) this.chargeDir *= -1;
        }
    }
    draw() {
        const size = 40 + (upgrades.cannonSize.level * 8);
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);
        ctx.rotate(this.angle);
        ctx.fillStyle = '#30363d';
        ctx.fillRect(-10, -size/2, size, size);
        ctx.strokeStyle = '#8b949e';
        ctx.lineWidth = 3;
        ctx.strokeRect(-10, -size/2, size, size);
        
        if (this.isCharging) {
            ctx.fillStyle = '#f2cc60';
            ctx.fillRect(0, -5, this.power, 10);
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(0, -5, 100, 10);
        }
        ctx.restore();

        if (state === 'AIM' && !this.isCharging) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px Oswald';
            ctx.textAlign = 'center';
            ctx.fillText("HOLD TO CHARGE", this.x + 50, this.y - 100);
        }
    }
}

class Obstacle {
    constructor(x, type) {
        this.x = x;
        this.type = type;
        this.wallType = null;
        if (type === 'wall') {
            const r = Math.random();
            if (r > 0.96) this.wallType = 'GOLD';
            else if (r > 0.85) this.wallType = 'METAL';
            else if (r > 0.7) this.wallType = 'GLASS';
            else this.wallType = 'CONCRETE';
        }
        this.w = 40;
        this.h = type === 'wall' ? (Math.random() * 250 + 80) : 40;
        this.y = type === 'bird' ? (Math.random() * 350 + 100) : (canvas.height - 50 - this.h);
        this.active = true;
    }
    draw() {
        if (!this.active && this.type === 'wall') return;
        ctx.save();
        ctx.translate(this.x - cameraX, this.y);
        
        if (this.type === 'wall') {
            const data = WALL_TYPES[this.wallType];
            ctx.fillStyle = data.color;
            ctx.fillRect(0, 0, this.w, this.h);
            ctx.strokeStyle = '#fff';
            if (this.wallType === 'GOLD') {
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#f2cc60';
            }
            ctx.strokeRect(0, 0, this.w, this.h);
        } else if (this.type === 'bird') {
            ctx.fillStyle = '#ff7b72';
            ctx.beginPath(); ctx.arc(20, 20, 15, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.stroke();
        } else if (this.type === 'booster') {
            ctx.fillStyle = '#238636';
            ctx.fillRect(0, 0, this.w, this.h);
            ctx.shadowBlur = 20; ctx.shadowColor = '#238636';
            ctx.strokeStyle = '#fff'; ctx.strokeRect(0, 0, this.w, this.h);
        }
        ctx.restore();
    }
}

// --- Functions ---

function createParticles(x, y, count, color, speed) {
    for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color, speed));
}

function applyShake(amt) { shake = amt; }

function generateWorld() {
    world = [];
    let nextX = 600;
    for (let i = 0; i < 300; i++) {
        let roll = Math.random();
        let type = 'wall';
        if (roll > 0.8) type = 'bird';
        else if (roll > 0.65) type = 'booster';
        world.push(new Obstacle(nextX, type));
        nextX += Math.random() * 200 + 150;
    }
}

function init() {
    resize();
    player = new Player();
    cannon = new Cannon();
    generateWorld();
    wallCount = 0;
    cameraX = 0;
    particles = [];
    updateUI();
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function update() {
    // Gradient Sky
    let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#0d1117');
    grad.addColorStop(1, '#1f6feb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sun
    ctx.fillStyle = '#f2cc60';
    ctx.beginPath(); ctx.arc(canvas.width - 100, 100, 40, 0, Math.PI*2); ctx.fill();

    ctx.save();
    if (shake > 0) {
        ctx.translate(Math.random()*shake - shake/2, Math.random()*shake - shake/2);
        shake *= 0.9;
    }

    // Ground
    ctx.fillStyle = '#21262d';
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);

    if (state === 'FLY') {
        player.update();
        cameraX = Math.max(0, player.x - 200);
        checkCollisions();
    } else if (state === 'AIM') {
        cannon.update();
    }

    world.forEach(obs => {
        if (obs.x - cameraX > -100 && obs.x - cameraX < canvas.width + 100) obs.draw();
    });

    particles.forEach((p, i) => {
        p.update();
        p.draw();
        if (p.life <= 0) particles.splice(i, 1);
    });

    cannon.draw();
    player.draw();
    ctx.restore();

    if (state === 'FLY') {
        document.getElementById('distance-display').innerText = `Dist: ${Math.floor(player.x/10)}m`;
        document.getElementById('speed-display').innerText = `Speed: ${Math.floor(player.vx)}`;
    }
    requestAnimationFrame(update);
}

function checkCollisions() {
    world.forEach(obs => {
        if (!obs.active) return;
        if (player.x + player.w/2 > obs.x && player.x - player.w/2 < obs.x + obs.w &&
            player.y + player.h/2 > obs.y && player.y - player.h/2 < obs.y + obs.h) {
            
            if (obs.type === 'wall') {
                const data = WALL_TYPES[obs.wallType];
                const efficiencyFactor = Math.pow(upgrades.efficiency.factor, upgrades.efficiency.level - 1);
                const loss = data.speedLoss * efficiencyFactor;
                
                if (player.vx > 5 || obs.wallType === 'GLASS') {
                    player.vx -= loss;
                    obs.active = false;
                    wallCount++;
                    applyShake(10);
                    createParticles(obs.x + 20, player.y, 15, data.color, 8);
                    if (obs.wallType === 'GOLD') money += 200;
                    else money += data.money;
                } else {
                    player.vx = 0;
                }
            } else if (obs.type === 'bird') {
                player.vx *= BIRD_SLOW;
                obs.active = false;
                applyShake(5);
                createParticles(obs.x + 20, obs.y + 20, 10, '#ff7b72', 5);
            } else if (obs.type === 'booster') {
                player.vy = -12;
                player.vx += 18;
                applyShake(15);
                createParticles(obs.x + 20, obs.y + 20, 20, '#238636', 10);
            }
        }
    });
}

function launch() {
    if (state !== 'AIM') return;
    state = 'FLY';
    document.getElementById('start-screen').classList.add('hidden');
    const basePower = 38;
    const powerMult = (cannon.power / 100) * 1.5;
    const upgradePower = basePower + (upgrades.power.level * upgrades.power.factor * 1.5);
    const finalPower = upgradePower * (0.6 + powerMult);
    player.vx = Math.cos(cannon.angle) * finalPower;
    player.vy = Math.sin(cannon.angle) * finalPower;
    player.isFlying = true;
    applyShake(25);
    createParticles(cannon.x, cannon.y, 50, '#f2cc60', 15);
}

function finishRun() {
    state = 'RESULT';
    const dist = Math.floor(player.x/10);
    money += dist;
    localStorage.setItem('cannonSmasherMoney', money);
    document.getElementById('run-summary').innerText = `Distance: ${dist}m | Walls Smashed: ${wallCount}`;
    document.getElementById('reward-text').innerText = `Total Money: $${money}`;
    document.getElementById('result-screen').classList.remove('hidden');
    updateUI();
}

function updateUI() {
    document.getElementById('money-display').innerText = `$${money}`;
}

function openShop() {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('result-screen').classList.add('hidden');
    document.getElementById('shop-screen').classList.remove('hidden');
    renderShop();
}

function renderShop() {
    const list = document.getElementById('upgrades-list');
    list.innerHTML = '';
    Object.keys(upgrades).forEach(key => {
        const u = upgrades[key];
        const item = document.createElement('div');
        item.className = 'upgrade-item';
        const isMax = u.level >= u.max;
        const currentCost = u.cost * (u.level + 1);
        item.innerHTML = `
            <div class="upgrade-info">
                <div class="upgrade-name">${key.toUpperCase()}</div>
                <div class="upgrade-level">Lvl ${u.level}/${u.max}</div>
            </div>
            <button class="buy-btn ${isMax ? 'maxed' : ''}" ${isMax ? 'disabled' : ''}>
                ${isMax ? 'MAXED' : '$' + currentCost}
            </button>
        `;
        item.querySelector('button').onclick = () => {
            if (!isMax && money >= currentCost) {
                money -= currentCost;
                u.level++;
                localStorage.setItem('cannonSmasherMoney', money);
                localStorage.setItem('cannonSmasherUpgrades', JSON.stringify(upgrades));
                updateUI();
                renderShop();
            }
        };
        list.appendChild(item);
    });
}

// --- Inputs ---

window.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.screen')) return;
    if (state === 'AIM') {
        cannon.isCharging = true;
        cannon.power = 0;
        document.getElementById('start-screen').classList.add('hidden');
    } else if (state === 'FLY') {
        player.dash();
    }
});

window.addEventListener('mouseup', () => {
    if (state === 'AIM' && cannon.isCharging) {
        launch();
        cannon.isCharging = false;
    }
});

window.addEventListener('mousemove', (e) => {
    if (state === 'AIM') {
        const dx = (e.clientX + cameraX) - cannon.x;
        const dy = e.clientY - cannon.y;
        cannon.angle = Math.atan2(dy, dx);
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state === 'FLY') player.dash();
});

document.getElementById('start-btn').onclick = () => document.getElementById('start-screen').classList.add('hidden');
document.getElementById('restart-btn').onclick = () => {
    document.getElementById('result-screen').classList.add('hidden');
    document.getElementById('start-screen').classList.remove('hidden');
    state = 'AIM';
    init();
};
document.getElementById('shop-btn').onclick = openShop;
document.getElementById('result-shop-btn').onclick = openShop;
document.getElementById('close-shop-btn').onclick = () => {
    document.getElementById('shop-screen').classList.add('hidden');
    document.getElementById('start-screen').classList.remove('hidden');
    state = 'AIM';
    init();
};

init();
update();
window.onresize = resize;

i want to add a sense of breaking the wall add subtle vibrations and have wall type be destroyed as it would so gass shatters lots and far where metal stamps hole through 
