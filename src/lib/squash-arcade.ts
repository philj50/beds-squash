/** Top-down squash. The ball travels from the front wall down to the bat.
 *
 * Singles court, World Squash: 9.75 m long and 6.40 m wide.
 * The short line is 5.49 m from the front wall.
 * Each service box is a 1.60 m square behind that line.
 * Drawn at 60 px per metre, so the floor is 384 by 585.
 */

export const COURT = { width: 440, height: 660 };

const LEFT = 28;
const RIGHT = 412;
const FRONT = 48;
const BACK = 633;
const RACKET_W = 74;
const RACKET_Y = BACK - 16;
const BALL = 6;
const LIVES = 3;
const BONUS_POINTS = 5;
const BONUS_R = 15;
const BONUS_MAX = 5;

export const PLAY = { left: LEFT, right: RIGHT, front: FRONT, back: BACK };

/** Where the Serve button sits, as a percentage of the canvas. */
export const SERVE_SPOT = {
  x: ((LEFT + RIGHT) / 2 / COURT.width) * 100,
  y: ((FRONT + BACK) / 2 / COURT.height) * 100,
};

export type Phase = 'idle' | 'serve' | 'rally' | 'point' | 'over';
export type TickEvent = 'hit' | 'score' | 'miss' | 'over' | 'bonus';

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  returned: boolean;
  /** Stays at the front until the other ball is on its way back. */
  wait: boolean;
};

export type Arcade = {
  phase: Phase;
  score: number;
  lives: number;
  racketX: number;
  /** Court position of the racket. The back line is the default. */
  racketY: number;
  balls: Ball[];
  twin: boolean;
  wait: number;
  age: number;
  bonusesSpawned: number;
  nextBonus: number;
  bonus: { x: number; y: number; until: number } | null;
};

function parked(count: number): Ball[] {
  const mid = (LEFT + RIGHT) / 2;
  const still = (x: number): Ball => ({ x, y: FRONT + 28, vx: 0, vy: 0, returned: false, wait: false });
  if (count < 2) return [still(mid)];
  return [still(mid - 28), still(mid + 28)];
}

export function createArcade(): Arcade {
  return {
    phase: 'idle',
    score: 0,
    lives: LIVES,
    racketX: (LEFT + RIGHT) / 2,
    racketY: RACKET_Y,
    balls: parked(1),
    twin: false,
    wait: 0,
    age: 0,
    bonusesSpawned: 0,
    nextBonus: 5 + Math.random() * 6,
    bonus: null,
  };
}

export function beginServe(game: Arcade) {
  game.phase = 'serve';
  game.wait = 0.55;
  game.balls = parked(game.twin || game.age >= 60 ? 2 : 1);
}

/** fractionX is 0 at the left sideline and 1 at the right.
 * fractionY is 0 at the front wall and 1 at the back. Leave it out to keep the racket on the back line.
 */
export function setRacket(game: Arcade, fractionX: number, fractionY?: number) {
  const t = Math.min(1, Math.max(0, fractionX));
  game.racketX = LEFT + t * (RIGHT - LEFT);
  if (fractionY == null) {
    game.racketY = RACKET_Y;
    return;
  }
  const y = FRONT + Math.min(1, Math.max(0, fractionY)) * (BACK - FRONT);
  game.racketY = Math.min(RACKET_Y, Math.max(FRONT + 36, y));
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

  maybeTwin(game);
  releaseWaiting(game);
  maybeSpawn(game);
  const speed = pace(game);
  const slices = Math.max(5, Math.ceil((speed * step) / 10));
  let missed = false;
  for (let i = 0; i < slices && !missed; i += 1) {
    const piece = step / slices;
    for (const ball of game.balls) {
      if (ball.wait) {
        ball.y = FRONT + 28;
        ball.vx = 0;
        ball.vy = 0;
        continue;
      }
      const prevY = ball.y;
      ball.x += ball.vx * piece;
      ball.y += ball.vy * piece;

      if (ball.x < LEFT + BALL) {
        ball.x = LEFT + BALL;
        ball.vx = Math.abs(ball.vx);
      }
      if (ball.x > RIGHT - BALL) {
        ball.x = RIGHT - BALL;
        ball.vx = -Math.abs(ball.vx);
      }

      if (game.bonus) {
        const collected = collectBonus(game, ball, events);
        if (!collected && game.bonus && game.age >= game.bonus.until) {
          game.bonus = null;
          game.nextBonus = game.age + bonusGap();
        }
      }

      if (ball.y < FRONT + BALL) {
        ball.y = FRONT + BALL;
        if (ball.returned) {
          game.score += 1;
          ball.returned = false;
          events.push('score');
        }
        const otherComing = game.balls.some((other) => other !== ball && !other.wait && other.vy > 0);
        if (otherComing) {
          ball.wait = true;
          ball.vx = 0;
          ball.vy = 0;
        } else {
          ball.vy = Math.abs(speed);
          ball.vx += wander(game, speed);
          ball.vx = clamp(ball.vx, -speed * 0.8, speed * 0.8);
        }
      }

      const racketY = game.racketY;
      if (ball.vy > 0 && prevY <= racketY + 18 && ball.y >= racketY - BALL) {
        const half = RACKET_W / 2;
        if (ball.x >= game.racketX - half && ball.x <= game.racketX + half) {
          const along = (ball.x - game.racketX) / half;
          ball.y = racketY - BALL;
          ball.vy = -speed;
          ball.vx = along * speed * 0.42 + wander(game, speed) * 0.35;
          ball.vx = clamp(ball.vx, -speed * 0.85, speed * 0.85);
          ball.returned = true;
          events.push('hit');
        }
      }

      if (ball.y > BACK + 10) {
        events.push(loseLife(game));
        missed = true;
        break;
      }
    }
  }
  return events;
}

function wander(game: Arcade, speed: number) {
  const heat = Math.max(0, game.age - 48);
  const spread = Math.min(speed * 0.62, 18 + game.age * 3.6 + heat * 6.5);
  return (Math.random() - 0.5) * spread;
}

function maybeTwin(game: Arcade) {
  if (game.age < 60 || game.balls.length >= 2) return;
  game.twin = true;
  const other = game.balls[0];
  const mid = (LEFT + RIGHT) / 2;
  game.balls.push({
    x: other && other.x >= mid ? LEFT + 70 : RIGHT - 70,
    y: FRONT + 28,
    vx: 0,
    vy: 0,
    returned: false,
    wait: true,
  });
}

/** One ball comes down. The other stays at the front until that one is hit back. */
function releaseWaiting(game: Arcade) {
  if (game.balls.some((ball) => !ball.wait && ball.vy > 0)) return;
  const waiting = game.balls.find((ball) => ball.wait);
  if (!waiting) return;
  const speed = pace(game);
  waiting.wait = false;
  waiting.y = FRONT + 24;
  waiting.returned = false;
  waiting.vy = speed;
  waiting.vx = (Math.random() - 0.5) * Math.min(160, 50 + game.age * 4);
}

function bonusGap() {
  return 6 + Math.random() * 8;
}

function maybeSpawn(game: Arcade) {
  if (game.bonus || game.bonusesSpawned >= BONUS_MAX || game.age < game.nextBonus) return;
  const midX = (LEFT + RIGHT) / 2;
  const midY = (FRONT + BACK) / 2;
  game.bonus = {
    x: midX + (Math.random() - 0.5) * (RIGHT - LEFT) * 0.28,
    y: midY + (Math.random() - 0.5) * (BACK - FRONT) * 0.16,
    until: game.age + 4.2,
  };
  game.bonusesSpawned += 1;
}

function collectBonus(game: Arcade, ball: Ball, events: TickEvent[]) {
  const bonus = game.bonus;
  if (!bonus) return false;
  const dx = ball.x - bonus.x;
  const dy = ball.y - bonus.y;
  if (dx * dx + dy * dy > (BONUS_R + BALL) * (BONUS_R + BALL)) return false;
  game.score += BONUS_POINTS;
  game.bonus = null;
  game.nextBonus = game.age + bonusGap();
  events.push('bonus');
  return true;
}

function flying(game: Arcade, slot: number): Ball {
  const speed = pace(game);
  const span = RIGHT - LEFT - 80;
  const along = slot === 0 ? Math.random() : 0.62 + Math.random() * 0.2;
  const lead = slot === 0;
  return {
    x: LEFT + 40 + along * span,
    y: FRONT + 24,
    vx: lead ? (Math.random() - 0.5) * Math.min(160, 50 + game.age * 4) : 0,
    vy: lead ? speed : 0,
    returned: false,
    wait: !lead,
  };
}

function launch(game: Arcade) {
  if (game.age >= 60) game.twin = true;
  const count = game.twin ? 2 : 1;
  game.phase = 'rally';
  game.balls = Array.from({ length: count }, (_, index) => flying(game, index));
}

function loseLife(game: Arcade): 'miss' | 'over' {
  game.lives -= 1;
  game.bonus = null;
  if (game.lives <= 0) {
    game.phase = 'over';
    for (const ball of game.balls) {
      ball.vx = 0;
      ball.vy = 0;
    }
    return 'over';
  }
  game.phase = 'point';
  game.wait = 0.7;
  game.balls = parked(game.twin ? 2 : 1);
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
    for (const ball of game.balls) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = '#9fd0ff';
  ctx.lineWidth = 3;
  const racketY = game.racketY;
  ctx.beginPath();
  ctx.moveTo(game.racketX - RACKET_W / 2, racketY);
  ctx.lineTo(game.racketX + RACKET_W / 2, racketY);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(game.racketX, racketY - 10, 16, 12, 0, 0, Math.PI * 2);
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
