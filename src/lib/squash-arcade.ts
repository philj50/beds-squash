/** Top-down squash. The ball travels from the front wall down to the bat. */

export const COURT = { width: 440, height: 680 };

const LEFT = 32;
const RIGHT = 408;
const FRONT = 58;
const BACK = 648;
const RACKET_W = 74;
const RACKET_Y = BACK - 16;
const BALL = 6;
const LIVES = 3;
const BONUS_POINTS = 5;
const BONUS_R = 15;

export type Phase = 'idle' | 'serve' | 'rally' | 'point' | 'over';
export type TickEvent = 'hit' | 'score' | 'miss' | 'over' | 'bonus';

export type Arcade = {
  phase: Phase;
  score: number;
  lives: number;
  racketX: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  wait: number;
  returned: boolean;
  age: number;
  bonusesSpawned: number;
  nextBonus: number;
  bonus: { x: number; y: number; until: number } | null;
};

export function createArcade(): Arcade {
  return {
    phase: 'idle',
    score: 0,
    lives: LIVES,
    racketX: (LEFT + RIGHT) / 2,
    ballX: (LEFT + RIGHT) / 2,
    ballY: FRONT + 28,
    vx: 0,
    vy: 0,
    wait: 0,
    returned: false,
    age: 0,
    bonusesSpawned: 0,
    nextBonus: 7 + Math.random() * 8,
    bonus: null,
  };
}

export function beginServe(game: Arcade) {
  game.phase = 'serve';
  game.wait = 0.55;
  game.returned = false;
  game.vx = 0;
  game.vy = 0;
  game.ballX = (LEFT + RIGHT) / 2;
  game.ballY = FRONT + 28;
}

/** fraction is 0 at the left sideline and 1 at the right. */
export function setRacket(game: Arcade, fraction: number) {
  const t = Math.min(1, Math.max(0, fraction));
  game.racketX = LEFT + t * (RIGHT - LEFT);
}

function pace(game: Arcade) {
  const heat = Math.max(0, game.age - 52);
  return Math.min(1500, 195 + game.age * 4.6 + heat * heat * 0.22 + game.score * 1.2);
}

export function tick(game: Arcade, dt: number): TickEvent[] {
  const events: TickEvent[] = [];
  if (game.phase === 'over' || game.phase === 'idle') return events;
  const step = Math.min(dt, 0.05);
  game.age += step;
  if (game.phase === 'serve' || game.phase === 'point') {
    game.wait -= step;
    if (game.wait <= 0) launch(game);
    return events;
  }

  maybeSpawn(game);
  const speed = pace(game);
  const slices = Math.max(5, Math.ceil((speed * step) / 10));
  for (let i = 0; i < slices; i += 1) {
    const piece = step / slices;
    game.ballX += game.vx * piece;
    game.ballY += game.vy * piece;

    if (game.ballX < LEFT + BALL) {
      game.ballX = LEFT + BALL;
      game.vx = Math.abs(game.vx);
    }
    if (game.ballX > RIGHT - BALL) {
      game.ballX = RIGHT - BALL;
      game.vx = -Math.abs(game.vx);
    }

    if (game.bonus) {
      const collected = collectBonus(game, events);
      if (!collected && game.bonus && game.age >= game.bonus.until) {
        game.bonus = null;
        game.nextBonus = game.age + 9 + Math.random() * 12;
      }
    }

    if (game.ballY < FRONT + BALL) {
      game.ballY = FRONT + BALL;
      game.vy = Math.abs(speed);
      if (game.returned) {
        game.score += 1;
        game.returned = false;
        events.push('score');
      }
      game.vx += wander(game, speed);
      game.vx = clamp(game.vx, -speed * 0.8, speed * 0.8);
    }

    if (game.vy > 0 && game.ballY >= RACKET_Y - BALL && game.ballY <= RACKET_Y + 18) {
      const half = RACKET_W / 2;
      if (game.ballX >= game.racketX - half && game.ballX <= game.racketX + half) {
        const along = (game.ballX - game.racketX) / half;
        game.ballY = RACKET_Y - BALL;
        game.vy = -speed;
        game.vx = along * speed * 0.42 + wander(game, speed) * 0.35;
        game.vx = clamp(game.vx, -speed * 0.85, speed * 0.85);
        game.returned = true;
        events.push('hit');
      }
    }

    if (game.ballY > RACKET_Y + 26) {
      events.push(loseLife(game));
      break;
    }
  }
  return events;
}

function wander(game: Arcade, speed: number) {
  const heat = Math.max(0, game.age - 48);
  const spread = Math.min(speed * 0.62, 18 + game.age * 3.6 + heat * 6.5);
  return (Math.random() - 0.5) * spread;
}

function maybeSpawn(game: Arcade) {
  if (game.bonus || game.bonusesSpawned >= 2 || game.age < game.nextBonus) return;
  const midX = (LEFT + RIGHT) / 2;
  const midY = (FRONT + BACK) / 2;
  game.bonus = {
    x: midX + (Math.random() - 0.5) * (RIGHT - LEFT) * 0.28,
    y: midY + (Math.random() - 0.5) * (BACK - FRONT) * 0.16,
    until: game.age + 4.2,
  };
  game.bonusesSpawned += 1;
}

function collectBonus(game: Arcade, events: TickEvent[]) {
  const bonus = game.bonus;
  if (!bonus) return false;
  const dx = game.ballX - bonus.x;
  const dy = game.ballY - bonus.y;
  if (dx * dx + dy * dy > (BONUS_R + BALL) * (BONUS_R + BALL)) return false;
  game.score += BONUS_POINTS;
  game.bonus = null;
  game.nextBonus = game.age + 9 + Math.random() * 12;
  events.push('bonus');
  return true;
}

function launch(game: Arcade) {
  const speed = pace(game);
  game.phase = 'rally';
  game.returned = false;
  game.ballX = LEFT + 40 + Math.random() * (RIGHT - LEFT - 80);
  game.ballY = FRONT + 24;
  game.vy = speed;
  game.vx = (Math.random() - 0.5) * Math.min(160, 50 + game.age * 4);
}

function loseLife(game: Arcade): 'miss' | 'over' {
  game.lives -= 1;
  game.returned = false;
  game.bonus = null;
  if (game.lives <= 0) {
    game.phase = 'over';
    game.vx = 0;
    game.vy = 0;
    return 'over';
  }
  game.phase = 'point';
  game.wait = 0.7;
  game.vx = 0;
  game.vy = 0;
  game.ballX = (LEFT + RIGHT) / 2;
  game.ballY = FRONT + 28;
  return 'miss';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function drawCourt(ctx: CanvasRenderingContext2D, game: Arcade) {
  const { width, height } = COURT;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#07182c';
  ctx.fillRect(0, 0, width, height);

  const floorW = RIGHT - LEFT;
  const floorH = BACK - FRONT;
  ctx.fillStyle = '#123056';
  ctx.fillRect(LEFT, FRONT, floorW, floorH);

  const shortY = FRONT + floorH * (5.49 / 9.75);
  const boxDepth = floorH * (1.6 / 9.75);
  const boxWidth = floorW * (1.6 / 6.4);

  ctx.strokeStyle = '#e23b3b';
  ctx.lineWidth = 2;
  ctx.strokeRect(LEFT, FRONT, floorW, floorH);
  ctx.beginPath();
  ctx.moveTo(LEFT, shortY);
  ctx.lineTo(RIGHT, shortY);
  ctx.moveTo((LEFT + RIGHT) / 2, shortY);
  ctx.lineTo((LEFT + RIGHT) / 2, BACK);
  ctx.stroke();
  ctx.strokeRect(LEFT, shortY, boxWidth, boxDepth);
  ctx.strokeRect(RIGHT - boxWidth, shortY, boxWidth, boxDepth);

  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(LEFT, FRONT);
  ctx.lineTo(RIGHT, FRONT);
  ctx.stroke();

  if (game.bonus) {
    ctx.strokeStyle = '#ffc933';
    ctx.lineWidth = 2;
    drawStar(ctx, game.bonus.x, game.bonus.y, BONUS_R);
  }

  const showBall = game.phase === 'serve' || game.phase === 'rally' || game.phase === 'point' || game.phase === 'over';
  if (showBall) {
    ctx.strokeStyle = '#ffc933';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(game.ballX, game.ballY, BALL, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = '#9fd0ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(game.racketX - RACKET_W / 2, RACKET_Y);
  ctx.lineTo(game.racketX + RACKET_W / 2, RACKET_Y);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(game.racketX, RACKET_Y - 10, 16, 12, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#e7eaef';
  ctx.font = '700 26px Barlow Condensed, Arial Narrow, sans-serif';
  ctx.fillText(String(game.score).padStart(4, '0'), 16, 32);
  ctx.strokeStyle = '#f2b705';
  ctx.lineWidth = 2;
  for (let i = 0; i < game.lives; i += 1) ctx.strokeRect(108 + i * 18, 16, 12, 12);
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const arm = i % 2 === 0 ? radius : radius * 0.42;
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * arm;
    const py = y + Math.sin(angle) * arm;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}
