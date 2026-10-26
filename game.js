(() => {
  'use strict';

  // ---------- Grundeinstellungen ----------
  const W = 960;
  const H = 540;
  const T = 32; // Kachelgröße in Pixeln

  const GRAVITY = 2000;
  const MAX_FALL = 900;
  const RUN_SPEED = 260;
  const GROUND_ACCEL = 2200;
  const AIR_ACCEL = 1500;
  const FRICTION = 2600;
  const JUMP_VELOCITY = 780;
  const JUMP_CUT = 1.6; // zusätzliche Schwerkraft, wenn Sprungtaste früh losgelassen wird
  const COYOTE_TIME = 0.1;
  const JUMP_BUFFER = 0.12;
  const SPRING_VELOCITY = 1100;
  const STOMP_VELOCITY = 520;
  const ENEMY_SPEED = 60;
  const MOVER_SPEED = 70;
  const INVULN_TIME = 1.5; // Unverwundbarkeit nach einem Treffer
  const HURT_LOCK = 0.3; // so lange wird die Steuerung nach einem Treffer ignoriert
  const KNOCKBACK_X = 300;
  const KNOCKBACK_Y = 450;
  const STEP = 1 / 120;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------- Bildschirmgröße ----------
  function resize() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Speicher (Highscore) ----------
  function loadHighscore() {
    try { return parseInt(localStorage.getItem('plattformer-highscore'), 10) || 0; } catch (e) { return 0; }
  }
  function saveHighscore(v) {
    try { localStorage.setItem('plattformer-highscore', String(v)); } catch (e) { /* egal */ }
  }

  // ---------- Sound ----------
  let audio = null;
  let muted = false;
  function initAudio() {
    if (audio) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  function tone(freq, endFreq, dur, type, vol) {
    if (!audio || muted) return;
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
  const sfx = {
    jump: () => tone(320, 640, 0.15, 'square', 0.08),
    coin: () => { tone(988, 988, 0.06, 'square', 0.06); setTimeout(() => tone(1319, 1319, 0.12, 'square', 0.06), 60); },
    stomp: () => tone(400, 90, 0.18, 'triangle', 0.15),
    spring: () => tone(200, 900, 0.3, 'sine', 0.12),
    die: () => tone(500, 60, 0.7, 'sawtooth', 0.08),
    hurt: () => tone(300, 120, 0.25, 'square', 0.1),
    clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, f, 0.18, 'square', 0.07), i * 120)),
    life: () => [660, 880, 1100].forEach((f, i) => setTimeout(() => tone(f, f, 0.1, 'triangle', 0.1), i * 80)),
  };

  // ---------- Eingabe ----------
  const input = { left: false, right: false, jump: false, jumpBuffer: 0, confirm: false };
  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  };

  function press(action) {
    initAudio();
    if (action === 'jump') {
      if (!input.jump) input.jumpBuffer = JUMP_BUFFER;
      input.confirm = true;
    }
    input[action] = true;
  }
  function release(action) { input[action] = false; }

  window.addEventListener('keydown', (e) => {
    const action = keyMap[e.code];
    if (action) {
      e.preventDefault();
      if (!e.repeat) press(action);
      return;
    }
    if (e.code === 'Enter') { initAudio(); input.confirm = true; }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'KeyM') muted = !muted;
  });
  window.addEventListener('keyup', (e) => {
    const action = keyMap[e.code];
    if (action) release(action);
  });
  window.addEventListener('blur', () => { input.left = input.right = input.jump = false; });

  document.querySelectorAll('#touch button').forEach((btn) => {
    const action = btn.dataset.key;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('active'); press(action); });
    const up = (e) => { e.preventDefault(); btn.classList.remove('active'); release(action); };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });
  canvas.addEventListener('pointerdown', () => { initAudio(); input.confirm = true; });

  // ---------- Spielzustand ----------
  const game = {
    state: 'title', // title | playing | paused | dying | clear | gameover | win
    levelIndex: 0,
    lives: 3,
    score: 0,
    coins: 0,
    highscore: loadHighscore(),
    timer: 0,
    levelTime: 0,
    time: 0,
  };

  let level = null;
  let player = null;
  let particles = [];
  const camera = { x: 0, y: 0 };

  function togglePause() {
    if (game.state === 'playing') game.state = 'paused';
    else if (game.state === 'paused') game.state = 'playing';
  }

  // ---------- Level laden ----------
  function loadLevel(index) {
    const def = LEVELS[index];
    const rows = def.map;
    const height = rows.length;
    const width = Math.max(...rows.map((r) => r.length));
    const tiles = rows.map((r) => r.padEnd(width, ' ').split(''));

    const lvl = {
      name: def.name,
      theme: def.theme,
      width, height, tiles,
      pixelWidth: width * T,
      pixelHeight: height * T,
      coins: [], enemies: [], springs: [], movers: [],
      start: { x: T, y: (height - 3) * T },
      flag: null,
    };

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const ch = tiles[r][c];
        const x = c * T;
        const y = r * T;
        if (ch === 'o') {
          lvl.coins.push({ x: x + T / 2, y: y + T / 2, taken: false, phase: c * 0.4 });
        } else if (ch === 'E') {
          lvl.enemies.push({ x: x + 2, y: y + T - 24, w: 28, h: 24, vx: -ENEMY_SPEED, vy: 0, dead: 0, alive: true, onGround: false });
        } else if (ch === 'P') {
          lvl.start = { x: x + 5, y: y + T - 30 };
        } else if (ch === 'F') {
          lvl.flag = { x, y, col: c, row: r, lowered: 0 };
        } else if (ch === 'S') {
          lvl.springs.push({ x, y, anim: 0 });
        } else if (ch === 'M') {
          // Bewegliche Plattform fährt bis kurz vor den nächsten Boden rechts davon
          let end = c + 6;
          for (let cc = c + 1; cc < width; cc++) {
            if (tiles[height - 2] && tiles[height - 2][cc] === '#') { end = cc - 3; break; }
          }
          lvl.movers.push({ x, y, w: 3 * T, h: 14, minX: x, maxX: Math.max(x, end * T), vx: MOVER_SPEED, dx: 0 });
        } else {
          continue;
        }
        tiles[r][c] = ' ';
      }
    }
    return lvl;
  }

  function startLevel(index) {
    game.levelIndex = index;
    level = loadLevel(index);
    player = {
      x: level.start.x, y: level.start.y, w: 22, h: 30,
      vx: 0, vy: 0, onGround: false, ground: null,
      facing: 1, coyote: 0, squash: 1, runAnim: 0,
      invuln: 0, hurt: 0, safeX: level.start.x, safeY: level.start.y,
    };
    particles = [];
    game.levelTime = 0;
    game.levelCoins = 0;
    camera.x = 0;
    game.state = 'playing';
  }

  function newGame() {
    game.lives = 3;
    game.score = 0;
    game.coins = 0;
    startLevel(0);
  }

  // ---------- Kacheln ----------
  function tileAt(c, r) {
    if (c < 0 || c >= level.width) return '#'; // Ränder sind Wände
    if (r < 0 || r >= level.height) return ' ';
    return level.tiles[r][c];
  }
  const isSolid = (ch) => ch === '#' || ch === '=';
  const isOneWay = (ch) => ch === '-';

  // ---------- Physik ----------
  function moveBody(b, dt, carry) {
    b.hitWall = false;

    // Horizontal
    const dx = b.vx * dt + (carry || 0);
    b.x += dx;
    const top = Math.floor(b.y / T);
    const bottom = Math.floor((b.y + b.h - 0.01) / T);
    if (dx > 0) {
      const c = Math.floor((b.x + b.w - 0.01) / T);
      for (let r = top; r <= bottom; r++) {
        if (isSolid(tileAt(c, r))) { b.x = c * T - b.w; b.hitWall = true; break; }
      }
    } else if (dx < 0) {
      const c = Math.floor(b.x / T);
      for (let r = top; r <= bottom; r++) {
        if (isSolid(tileAt(c, r))) { b.x = (c + 1) * T; b.hitWall = true; break; }
      }
    }

    // Vertikal
    const prevBottom = b.y + b.h;
    b.y += b.vy * dt;
    b.onGround = false;
    b.ground = null;
    const left = Math.floor(b.x / T);
    const right = Math.floor((b.x + b.w - 0.01) / T);

    if (b.vy > 0) {
      const r = Math.floor((b.y + b.h) / T);
      for (let c = left; c <= right; c++) {
        const ch = tileAt(c, r);
        if (isSolid(ch) || (isOneWay(ch) && prevBottom <= r * T + 0.5)) {
          b.y = r * T - b.h; b.vy = 0; b.onGround = true; break;
        }
      }
    } else if (b.vy < 0) {
      const r = Math.floor(b.y / T);
      for (let c = left; c <= right; c++) {
        if (isSolid(tileAt(c, r))) {
          b.y = (r + 1) * T; b.vy = 0; break;
        }
      }
    }

    // Bewegliche Plattformen (nur von oben begehbar)
    if (b.vy >= 0 && !b.onGround) {
      for (const m of level.movers) {
        if (b.x + b.w > m.x && b.x < m.x + m.w && prevBottom <= m.y + 0.5 && b.y + b.h >= m.y) {
          b.y = m.y - b.h; b.vy = 0; b.onGround = true; b.ground = m; break;
        }
      }
    }
  }

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- Partikel ----------
  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: 0.5 + Math.random() * 0.3, max: 0.8, color, size: 2 + Math.random() * 3 });
    }
  }
  function dust(x, y) {
    for (let i = 0; i < 6; i++) {
      particles.push({ x: x + (Math.random() - 0.5) * 16, y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 60, life: 0.35, max: 0.35, color: 'rgba(255,255,255,0.8)', size: 3 + Math.random() * 2 });
    }
  }

  // ---------- Update ----------
  function addScore(points) {
    game.score += points;
  }

  function addCoin() {
    game.coins++;
    game.levelCoins++;
    addScore(10);
    if (game.coins % 50 === 0) { game.lives++; sfx.life(); }
  }

  function killPlayer() {
    if (game.state !== 'playing') return;
    game.state = 'dying';
    game.timer = 1.4;
    player.vy = -650;
    player.vx = 0;
    sfx.die();
  }

  // Ein Leben abziehen, der Spieler bleibt aber im Level
  function hurtPlayer(fromX) {
    const p = player;
    if (p.invuln > 0 || game.state !== 'playing') return;
    game.lives--;
    if (game.lives <= 0) { killPlayer(); return; }
    p.invuln = INVULN_TIME;
    p.hurt = HURT_LOCK;
    const away = p.x + p.w / 2 < fromX ? -1 : 1;
    p.vx = away * KNOCKBACK_X;
    p.vy = -KNOCKBACK_Y;
    p.squash = 0.8;
    burst(p.x + p.w / 2, p.y + p.h / 2, '#ff5d5d', 10, 180);
    sfx.hurt();
  }

  // In einen Abgrund gefallen: Leben weg und zurück auf den letzten sicheren Boden
  function fellIntoPit() {
    const p = player;
    game.lives--;
    if (game.lives <= 0) { killPlayer(); return; }
    p.x = p.safeX;
    p.y = p.safeY;
    p.vx = 0;
    p.vy = 0;
    p.invuln = INVULN_TIME;
    p.hurt = 0;
    sfx.hurt();
  }

  function updatePlaying(dt) {
    game.levelTime += dt;

    // Bewegliche Plattformen
    for (const m of level.movers) {
      const old = m.x;
      m.x += m.vx * dt;
      if (m.x > m.maxX) { m.x = m.maxX; m.vx = -MOVER_SPEED; }
      if (m.x < m.minX) { m.x = m.minX; m.vx = MOVER_SPEED; }
      m.dx = m.x - old;
    }

    // Spieler
    const p = player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    const dir = p.hurt > 0 ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const accel = p.onGround ? GROUND_ACCEL : AIR_ACCEL;
    if (dir !== 0) {
      p.vx += dir * accel * dt;
      p.vx = Math.max(-RUN_SPEED, Math.min(RUN_SPEED, p.vx));
      p.facing = dir;
    } else if (p.hurt <= 0) {
      const f = (p.onGround ? FRICTION : AIR_ACCEL * 0.5) * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }

    p.coyote = p.onGround ? COYOTE_TIME : p.coyote - dt;
    input.jumpBuffer -= dt;
    if (input.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -JUMP_VELOCITY;
      p.coyote = 0;
      input.jumpBuffer = 0;
      p.squash = 1.35;
      dust(p.x + p.w / 2, p.y + p.h);
      sfx.jump();
    }

    p.vy += GRAVITY * dt;
    if (!input.jump && p.vy < 0) p.vy += GRAVITY * JUMP_CUT * dt;
    p.vy = Math.min(p.vy, MAX_FALL);

    const wasOnGround = p.onGround;
    const fallSpeed = p.vy;
    const prevBottom = p.y + p.h;
    const carry = p.ground ? p.ground.dx : 0;
    moveBody(p, dt, carry);
    if (p.hitWall) p.vx = 0;
    if (p.onGround && !wasOnGround && fallSpeed > 300) {
      p.squash = 0.7;
      dust(p.x + p.w / 2, p.y + p.h);
    }
    p.squash += (1 - p.squash) * Math.min(1, dt * 12);
    p.runAnim += Math.abs(p.vx) * dt * 0.05;

    if (p.y > level.pixelHeight + 64) { fellIntoPit(); return; }
    // Letzte sichere Position merken (fester Boden, keine bewegliche Plattform)
    if (p.onGround && !p.ground) { p.safeX = p.x; p.safeY = p.y; }

    // Stacheln
    const hitbox = { x: p.x + 3, y: p.y + 4, w: p.w - 6, h: p.h - 4 };
    const c0 = Math.floor(hitbox.x / T), c1 = Math.floor((hitbox.x + hitbox.w) / T);
    const r0 = Math.floor(hitbox.y / T), r1 = Math.floor((hitbox.y + hitbox.h) / T);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) === '^' && overlap(hitbox, { x: c * T + 4, y: r * T + 14, w: T - 8, h: T - 14 })) {
          hurtPlayer(c * T + T / 2);
        }
      }
    }

    if (game.state !== 'playing') return;

    // Münzen
    for (const coin of level.coins) {
      if (!coin.taken && overlap(p, { x: coin.x - 10, y: coin.y - 10, w: 20, h: 20 })) {
        coin.taken = true;
        addCoin();
        burst(coin.x, coin.y, '#ffd84a', 10, 160);
        sfx.coin();
      }
    }

    // Federn
    for (const s of level.springs) {
      s.anim = Math.max(0, s.anim - dt);
      const box = { x: s.x + 4, y: s.y + 18, w: T - 8, h: T - 18 };
      if (p.vy >= 0 && overlap(p, box) && prevBottom <= box.y + 12) {
        p.y = box.y - p.h;
        p.vy = -SPRING_VELOCITY;
        p.squash = 1.5;
        s.anim = 0.3;
        sfx.spring();
      }
    }

    // Gegner
    for (const e of level.enemies) {
      if (!e.alive) {
        e.dead -= dt;
        continue;
      }
      e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
      moveBody(e, dt, 0);
      if (e.hitWall) e.vx = -e.vx;
      if (e.onGround) {
        const aheadX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
        const below = tileAt(Math.floor(aheadX / T), Math.floor((e.y + e.h + 1) / T));
        if (!isSolid(below) && !isOneWay(below)) e.vx = -e.vx;
      }
      if (e.y > level.pixelHeight + 64) e.alive = false;

      if (overlap(p, e)) {
        if (p.vy > 0 && prevBottom <= e.y + 12) {
          e.alive = false;
          e.dead = 0.5;
          p.vy = input.jump ? -JUMP_VELOCITY * 0.9 : -STOMP_VELOCITY;
          p.squash = 1.3;
          addScore(100);
          burst(e.x + e.w / 2, e.y + e.h / 2, '#7be06a', 12, 200);
          sfx.stomp();
        } else {
          hurtPlayer(e.x + e.w / 2);
        }
      }
    }

    if (game.state !== 'playing') return;

    // Ziel
    const f = level.flag;
    if (f && overlap(p, { x: f.x + 8, y: f.y - 5 * T, w: 16, h: 6 * T })) {
      game.state = 'clear';
      game.timer = 3;
      game.timeBonus = Math.max(0, Math.floor(300 - game.levelTime)) * 5;
      addScore(game.timeBonus);
      p.vx = 0;
      sfx.clear();
    }
  }

  function updateParticles(dt) {
    for (const pt of particles) {
      pt.life -= dt;
      pt.vy += 600 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
    particles = particles.filter((pt) => pt.life > 0);
  }

  function updateCamera(dt, instant) {
    const lookAhead = player.facing * 60;
    const targetX = player.x + player.w / 2 - W / 2 + lookAhead;
    const maxX = Math.max(0, level.pixelWidth - W);
    const clamped = Math.max(0, Math.min(maxX, targetX));
    camera.x = instant ? clamped : camera.x + (clamped - camera.x) * Math.min(1, dt * 6);
    camera.y = Math.max(0, level.pixelHeight - H);
  }

  function finishRun() {
    if (game.score > game.highscore) {
      game.highscore = game.score;
      saveHighscore(game.score);
    }
  }

  function update(dt) {
    game.time += dt;
    const confirm = input.confirm;
    input.confirm = false;

    switch (game.state) {
      case 'title':
        if (!level) level = loadLevel(0);
        camera.x = (Math.sin(game.time * 0.1) * 0.5 + 0.5) * (level.pixelWidth - W);
        camera.y = Math.max(0, level.pixelHeight - H);
        if (confirm) { input.jumpBuffer = 0; newGame(); }
        break;
      case 'playing':
        updatePlaying(dt);
        updateParticles(dt);
        updateCamera(dt);
        break;
      case 'paused':
        if (confirm) game.state = 'playing';
        break;
      case 'dying':
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        updateParticles(dt);
        game.timer -= dt;
        if (game.timer <= 0) {
          finishRun();
          game.state = 'gameover';
        }
        break;
      case 'clear':
        updateParticles(dt);
        game.timer -= dt;
        if (level.flag) level.flag.lowered = Math.min(1, level.flag.lowered + dt * 1.2);
        if (Math.random() < 0.3) burst(player.x + player.w / 2, player.y, `hsl(${Math.random() * 360},90%,60%)`, 1, 250);
        if (game.timer <= 0) {
          if (game.levelIndex + 1 < LEVELS.length) {
            startLevel(game.levelIndex + 1);
            updateCamera(0, true);
          } else {
            finishRun();
            game.state = 'win';
          }
        }
        break;
      case 'gameover':
      case 'win':
        if (confirm) { input.jumpBuffer = 0; game.state = 'title'; level = loadLevel(0); }
        break;
    }
  }

  // ---------- Zeichnen ----------
  const THEMES = {
    day: { sky: ['#5bb8ff', '#cdeeff'], far: '#9fd49a', near: '#6fbf5f', grass: '#4caf50', grassLight: '#7ed957', dirt: '#8b5a2b', dirtDark: '#6e441f', cloud: 'rgba(255,255,255,0.9)' },
    sunset: { sky: ['#ff7e5f', '#ffd29a'], far: '#d98a6a', near: '#a8654f', grass: '#5d9e3a', grassLight: '#8fcf55', dirt: '#7a4a2a', dirtDark: '#5c361d', cloud: 'rgba(255,236,220,0.85)' },
    night: { sky: ['#070b24', '#28306b'], far: '#1f2550', near: '#151a3b', grass: '#3d6e6a', grassLight: '#5fa39b', dirt: '#3b3f55', dirtDark: '#2b2e40', cloud: 'rgba(180,190,255,0.25)' },
  };

  const hash = (a, b) => {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  function drawBackground(theme) {
    const th = THEMES[theme];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (theme === 'night') {
      for (let i = 0; i < 90; i++) {
        const sx = (hash(i, 1) * W * 2 - camera.x * 0.05) % W;
        const sy = hash(i, 2) * H * 0.6;
        const tw = 0.5 + 0.5 * Math.sin(game.time * 2 + i);
        ctx.fillStyle = `rgba(255,255,255,${0.3 + tw * 0.6})`;
        ctx.fillRect((sx + W) % W, sy, 2, 2);
      }
      ctx.fillStyle = '#fff6cf';
      ctx.beginPath();
      ctx.arc(780, 90, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = th.sky[0];
      ctx.beginPath();
      ctx.arc(765, 80, 36, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = theme === 'day' ? 'rgba(255,250,200,0.9)' : 'rgba(255,240,180,0.9)';
      ctx.beginPath();
      ctx.arc(800, theme === 'day' ? 90 : 330, 46, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wolken
    ctx.fillStyle = th.cloud;
    for (let i = 0; i < 8; i++) {
      const span = W + 300;
      const cx = ((hash(i, 7) * span - camera.x * 0.15 - game.time * 8 * (1 + i % 3)) % span + span) % span - 150;
      const cy = 50 + hash(i, 9) * 160;
      const s = 0.7 + hash(i, 11) * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, 22 * s, 0, Math.PI * 2);
      ctx.arc(cx + 24 * s, cy - 10 * s, 28 * s, 0, Math.PI * 2);
      ctx.arc(cx + 52 * s, cy, 22 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hügel (Parallax)
    drawHills(th.far, 0.2, 330, 70, 0.006);
    drawHills(th.near, 0.45, 390, 60, 0.011);
  }

  function drawHills(color, factor, base, amp, freq) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const off = camera.x * factor;
    for (let x = 0; x <= W; x += 8) {
      const wx = x + off;
      const y = base - Math.sin(wx * freq) * amp - Math.sin(wx * freq * 2.3 + 1) * amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawTiles(theme) {
    const th = THEMES[theme];
    const c0 = Math.max(0, Math.floor(camera.x / T));
    const c1 = Math.min(level.width - 1, Math.floor((camera.x + W) / T));
    for (let r = 0; r < level.height; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = level.tiles[r][c];
        if (ch === ' ') continue;
        const x = Math.round(c * T - camera.x);
        const y = Math.round(r * T - camera.y);
        if (ch === '#') drawGround(x, y, c, r, th);
        else if (ch === '=') drawBrick(x, y, theme);
        else if (ch === '-') drawPlank(x, y);
        else if (ch === '^') drawSpikes(x, y);
      }
    }
  }

  function drawGround(x, y, c, r, th) {
    ctx.fillStyle = th.dirt;
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = th.dirtDark;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(x + Math.floor(hash(c, r * 3 + i) * 26) + 2, y + Math.floor(hash(r, c * 3 + i) * 26) + 2, 4, 4);
    }
    const above = tileAt(c, r - 1);
    if (above !== '#') {
      ctx.fillStyle = th.grass;
      ctx.fillRect(x, y, T, 10);
      ctx.fillStyle = th.grassLight;
      ctx.fillRect(x, y, T, 4);
      ctx.fillStyle = th.grass;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 8 + 2, y + 10, 4, 3 + Math.floor(hash(c, i) * 4));
    }
  }

  function drawBrick(x, y, theme) {
    ctx.fillStyle = theme === 'night' ? '#6b5d8a' : '#c8642c';
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = theme === 'night' ? '#4b3f66' : '#8e3f17';
    ctx.fillRect(x, y + 15, T, 2);
    ctx.fillRect(x, y + 31, T, 1);
    ctx.fillRect(x + 15, y, 2, 15);
    ctx.fillRect(x + 7, y + 17, 2, 14);
    ctx.fillRect(x + 23, y + 17, 2, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y, T, 2);
  }

  function drawPlank(x, y) {
    ctx.fillStyle = '#b07a3e';
    ctx.fillRect(x, y, T, 10);
    ctx.fillStyle = '#d9a35c';
    ctx.fillRect(x, y, T, 3);
    ctx.fillStyle = '#7a5226';
    ctx.fillRect(x, y + 9, T, 2);
    ctx.fillRect(x + 4, y + 11, 3, 6);
    ctx.fillRect(x + 25, y + 11, 3, 6);
  }

  function drawSpikes(x, y) {
    for (let i = 0; i < 3; i++) {
      const sx = x + 2 + i * 10;
      ctx.fillStyle = '#c9d1d9';
      ctx.beginPath();
      ctx.moveTo(sx, y + T);
      ctx.lineTo(sx + 5, y + 12);
      ctx.lineTo(sx + 10, y + T);
      ctx.fill();
      ctx.fillStyle = '#8b949e';
      ctx.beginPath();
      ctx.moveTo(sx + 5, y + 12);
      ctx.lineTo(sx + 10, y + T);
      ctx.lineTo(sx + 5, y + T);
      ctx.fill();
    }
  }

  function drawCoins() {
    for (const coin of level.coins) {
      if (coin.taken) continue;
      const x = coin.x - camera.x;
      if (x < -20 || x > W + 20) continue;
      const y = coin.y - camera.y + Math.sin(game.time * 3 + coin.phase) * 3;
      const sx = Math.abs(Math.cos(game.time * 3 + coin.phase));
      ctx.fillStyle = '#e0a800';
      ctx.beginPath();
      ctx.ellipse(x, y, 9 * sx + 1, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.ellipse(x, y, 6 * sx + 0.5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x - 2 * sx, y - 5, 2 * sx, 4);
    }
  }

  function drawSprings() {
    for (const s of level.springs) {
      const x = s.x - camera.x;
      const y = s.y - camera.y;
      const compress = s.anim > 0.2 ? 6 : s.anim > 0 ? -4 : 0;
      ctx.fillStyle = '#555';
      ctx.fillRect(x + 4, y + T - 4, T - 8, 4);
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const top = y + 18 + compress;
      for (let i = 0; i <= 4; i++) {
        const yy = top + 3 + (y + T - 4 - top - 3) * (i / 4);
        ctx.lineTo(x + (i % 2 ? 10 : 22), yy);
      }
      ctx.stroke();
      ctx.fillStyle = '#e53935';
      ctx.fillRect(x + 3, top, T - 6, 5);
    }
  }

  function drawMovers(theme) {
    for (const m of level.movers) {
      const x = Math.round(m.x - camera.x);
      const y = Math.round(m.y - camera.y);
      ctx.fillStyle = theme === 'night' ? '#8a93b8' : '#7b8794';
      ctx.fillRect(x, y, m.w, m.h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, y, m.w, 3);
      ctx.fillStyle = '#3e4651';
      ctx.fillRect(x, y + m.h - 3, m.w, 3);
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 8 + i * 26, y + 5, 4, 4);
    }
  }

  function drawEnemies() {
    for (const e of level.enemies) {
      if (!e.alive && e.dead <= 0) continue;
      const x = e.x - camera.x;
      const y = e.y - camera.y;
      if (x < -40 || x > W + 40) continue;
      if (!e.alive) {
        ctx.fillStyle = '#5aa84a';
        ctx.beginPath();
        ctx.ellipse(x + e.w / 2, y + e.h - 4, 16, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const wob = Math.sin(game.time * 10 + e.x * 0.1) * 2;
      ctx.fillStyle = '#5aa84a';
      ctx.beginPath();
      ctx.moveTo(x - 1, y + e.h);
      ctx.quadraticCurveTo(x - 2, y + 2 - wob, x + e.w / 2, y + wob);
      ctx.quadraticCurveTo(x + e.w + 2, y + 2 - wob, x + e.w + 1, y + e.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + 8, y + 8, 4, 3, -0.5, 0, Math.PI * 2);
      ctx.fill();
      const look = e.vx > 0 ? 2 : -2;
      for (const ex of [9, 19]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x + ex, y + 12, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(x + ex + look, y + 12, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#2e6b25';
      ctx.fillRect(x + 6, y + 6, 6, 2);
      ctx.fillRect(x + 16, y + 6, 6, 2);
    }
  }

  function drawFlag() {
    const f = level.flag;
    if (!f) return;
    const x = f.x - camera.x + 14;
    const base = f.y - camera.y + T;
    const top = base - 6 * T;
    ctx.fillStyle = '#ddd';
    ctx.fillRect(x, top, 4, 6 * T);
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(x + 2, top, 6, 0, Math.PI * 2);
    ctx.fill();
    const fy = top + 8 + f.lowered * (5 * T - 30);
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.moveTo(x + 4, fy);
    for (let i = 0; i <= 10; i++) {
      ctx.lineTo(x + 4 + i * 4, fy + Math.sin(game.time * 6 + i * 0.6) * 2 + i * 0.4);
    }
    ctx.lineTo(x + 4, fy + 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.fillRect(x - 6, base - 8, 16, 8);
  }

  function drawPlayer() {
    const p = player;
    const sy = p.squash;
    const sx = 1 / sy;
    const w = p.w * sx;
    const h = p.h * sy;
    const cx = p.x + p.w / 2 - camera.x;
    const by = p.y + p.h - camera.y;
    const x = cx - w / 2;
    const y = by - h;
    const dying = game.state === 'dying';
    // Blinken während der Unverwundbarkeit
    if (p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0) return;

    // Füße
    const moving = p.onGround && Math.abs(p.vx) > 20;
    const step = moving ? Math.sin(p.runAnim * 4) * 4 : 0;
    ctx.fillStyle = '#2b2d42';
    ctx.fillRect(cx - 9 + step, by - 5, 8, 5);
    ctx.fillRect(cx + 1 - step, by - 5, 8, 5);

    // Körper
    ctx.fillStyle = '#ff5d5d';
    roundRect(x, y, w, h - 3, 8);
    ctx.fill();
    ctx.fillStyle = '#ffb3b3';
    roundRect(x + 4, y + h * 0.55, w - 8, h * 0.3, 5);
    ctx.fill();

    // Mütze
    ctx.fillStyle = '#3a6ff7';
    roundRect(x - 1, y - 2, w + 2, 9, 4);
    ctx.fill();
    ctx.fillRect(cx + p.facing * 4 - (p.facing < 0 ? 12 : 0), y + 3, 12, 4);

    // Augen
    const look = p.facing * 2;
    for (const ex of [-4, 5]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx + ex + look, y + 13, 3.5, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      if (dying) {
        ctx.fillRect(cx + ex + look - 3, y + 12, 6, 2);
      } else {
        ctx.beginPath();
        ctx.arc(cx + ex + look * 1.5, y + 14, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawParticles() {
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - camera.x - pt.size / 2, pt.y - camera.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  function text(str, x, y, size, color, align) {
    ctx.font = `bold ${size}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(str, x, y);
  }

  function drawHeart(x, y, s) {
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.fill();
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(10, 10, 330, 40, 10);
    ctx.fill();
    for (let i = 0; i < Math.min(game.lives, 6); i++) drawHeart(32 + i * 24, 20, 20);
    if (game.lives > 6) text('+' + (game.lives - 6), 32 + 6 * 24, 30, 16, '#fff', 'left');
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.arc(230, 30, 9, 0, Math.PI * 2);
    ctx.fill();
    text('× ' + game.coins, 245, 31, 18, '#fff', 'left');
    text(String(game.score).padStart(6, '0'), W - 20, 30, 20, '#fff', 'right');
    text(`Level ${game.levelIndex + 1}: ${level.name}`, W / 2, 30, 18, '#fff');
    text('⏱ ' + Math.floor(game.levelTime) + 's', W - 20, 58, 14, '#fff', 'right');
  }

  function overlay(alpha) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawWorld() {
    drawBackground(level.theme);
    drawTiles(level.theme);
    drawFlag();
    drawSprings();
    drawMovers(level.theme);
    drawCoins();
    drawEnemies();
  }

  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const startHint = isTouch ? 'Tippe zum Starten' : 'Drücke Leertaste zum Starten';

  function render() {
    if (!level) return;
    drawWorld();

    if (game.state === 'title') {
      overlay(0.35);
      const bob = Math.sin(game.time * 2) * 6;
      text('Hüpf-Abenteuer', W / 2, 150 + bob, 72, '#ffd84a');
      text('Ein 2D-Plattformer', W / 2, 215, 24, '#fff');
      if (Math.floor(game.time * 2) % 2 === 0) text(startHint, W / 2, 310, 28, '#fff');
      text('← → / A D: laufen     Leertaste / ↑ / W: springen', W / 2, 390, 18, '#ddd');
      text('Auf Gegner springen · Münzen sammeln · Fahne erreichen', W / 2, 420, 18, '#ddd');
      text('P: Pause     M: Ton an/aus', W / 2, 450, 16, '#bbb');
      if (game.highscore > 0) text('Highscore: ' + game.highscore, W / 2, 500, 20, '#ffd84a');
      return;
    }

    drawPlayer();
    drawParticles();
    drawHud();

    if (game.state === 'paused') {
      overlay(0.5);
      text('Pause', W / 2, H / 2 - 20, 56);
      text(isTouch ? 'Tippe zum Weiterspielen' : 'P oder Leertaste zum Weiterspielen', W / 2, H / 2 + 40, 20);
    } else if (game.state === 'clear') {
      text('Level geschafft!', W / 2, H / 2 - 40, 56, '#ffd84a');
      text(`Zeitbonus: +${game.timeBonus}`, W / 2, H / 2 + 20, 24);
      text(`Münzen in diesem Level: ${game.levelCoins}`, W / 2, H / 2 + 55, 20);
    } else if (game.state === 'gameover') {
      overlay(0.6);
      text('Game Over', W / 2, H / 2 - 60, 68, '#ff5d5d');
      text('Punkte: ' + game.score, W / 2, H / 2 + 10, 28);
      text('Highscore: ' + game.highscore, W / 2, H / 2 + 50, 22, '#ffd84a');
      text(isTouch ? 'Tippe für das Hauptmenü' : 'Leertaste für das Hauptmenü', W / 2, H / 2 + 110, 20);
    } else if (game.state === 'win') {
      overlay(0.55);
      text('Gewonnen! 🎉', W / 2, H / 2 - 70, 64, '#ffd84a');
      text('Alle Level geschafft!', W / 2, H / 2 - 10, 26);
      text(`Punkte: ${game.score}   Münzen: ${game.coins}`, W / 2, H / 2 + 35, 24);
      text('Highscore: ' + game.highscore, W / 2, H / 2 + 75, 22, '#ffd84a');
      text(isTouch ? 'Tippe für das Hauptmenü' : 'Leertaste für das Hauptmenü', W / 2, H / 2 + 125, 20);
    }
  }

  // ---------- Hauptschleife ----------
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    let steps = 0;
    while (acc >= STEP && steps < 12) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    render();
    requestAnimationFrame(frame);
  }

  // Für automatisierte Tests zugänglich machen
  window.__game = { game, input, get player() { return player; }, get level() { return level; }, startLevel };

  requestAnimationFrame(frame);
})();
