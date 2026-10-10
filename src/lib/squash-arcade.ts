/** Top-down squash. The ball leaves the front wall, arcs, and bounces once
 * before the service line. The player has to play that ball in the back court
 * before it would bounce again, including boasts off the side wall.
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
/** Short line, the service line: 5.49 m from the front wall on a 9.75 m court. */
const SERVICE_Y = FRONT + (BACK - FRONT) * (5.49 / 9.75);
/** The racket head is drawn this far in front of the hit line. */
const RACKET_HEAD = 22;
const BALL = 7;
const LIVES = 3;
/** How far the ball is drawn above its floor spot, so the bounce reads as an arc. */
const LIFT = 0.5;
/** A normal return stays under this. Anything higher can pass over the racket. */
const HIT_HEIGHT = 140;
const LAUNCH_Y = FRONT + 16;
/** The first bounce is short of the service line. The second would be past the back. */
const FIRST_BOUNCE_Y = SERVICE_Y - 68;
const SECOND_BOUNCE_Y = BACK + 44;
const LAUNCH_Z = 40;
const FIRST_PEAK = 112;
const SECOND_PEAK = 92;
const BALL_COLORS = ['#ff6a00', '#c026d3', '#39d353', '#38bdf8', '#fb7185', '#facc15'];

export const PLAY = { left: LEFT, right: RIGHT, front: FRONT, back: BACK };

/** Where the Serve button sits, as a percentage of the canvas. */
export const SERVE_SPOT = {
  x: ((LEFT + RIGHT) / 2 / COURT.width) * 100,
  y: ((FRONT + BACK) / 2 / COURT.height) * 100,
};

export type Phase = 'idle' | 'serve' | 'rally' | 'point' | 'over';
export type TickEvent = 'hit' | 'score' | 'miss' | 'over' | 'bonus';
export type BonusKind = 'pumpkin' | 'skull' | 'bat';

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  /** Floor bounces since the front wall or the racket last played it. */
  bounces: number;
  returned: boolean;
  /** Stays at the front until the other ball is on its way back. */
  wait: boolean;
  color: number;
  /** Where the last racket shot started, so the return can arc to the front wall. */
  returnFrom: number;
  returnZ: number;
};

export type BonusDrop = {
  x: number;
  y: number;
  until: number;
  born: number;
  points: 10 | 20 | 30;
  kind: BonusKind;
  r: number;
};

export type Arcade = {
  phase: Phase;
  score: number;
  lives: number;
  racketX: number;
  /** Court position of the racket. The back line is the default, and it cannot cross the service line. */
  racketY: number;
  balls: Ball[];
  twin: boolean;
  wait: number;
  age: number;
  nextBonus: number;
  bonus: BonusDrop | null;
  lastBonusPoints: number;
};

function stillBall(x: number): Ball {
  return {
    x,
    y: FRONT + 28,
    vx: 0,
    vy: 0,
    z: 18,
    vz: 0,
    bounces: 0,
    returned: false,
    wait: false,
    color: 0,
    returnFrom: 0,
    returnZ: 0,
  };
}

function parked(count: number): Ball[] {
  const mid = (LEFT + RIGHT) / 2;
  if (count < 2) return [stillBall(mid)];
  return [stillBall(mid - 28), stillBall(mid + 28)];
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
    nextBonus: 2 + Math.random() * 1.5,
    bonus: null,
    lastBonusPoints: 0,
  };
}

export function beginServe(game: Arcade) {
  game.phase = 'serve';
  game.wait = 0.55;
  game.balls = parked(game.twin || game.age >= 60 ? 2 : 1);
}

/** fractionX is 0 at the left sideline and 1 at the right.
 * fractionY is 0 at the front wall and 1 at the back. Leave it out to keep the racket on the back line.
 * The racket head stops on the service line, so it cannot be parked at the front wall.
 */
export function setRacket(game: Arcade, fractionX: number, fractionY?: number) {
  const t = Math.min(1, Math.max(0, fractionX));
  game.racketX = LEFT + t * (RIGHT - LEFT);
  if (fractionY == null) {
    game.racketY = RACKET_Y;
    return;
  }
  const y = FRONT + Math.min(1, Math.max(0, fractionY)) * (BACK - FRONT);
  game.racketY = Math.min(RACKET_Y, Math.max(SERVICE_Y + RACKET_HEAD, y));
}

function pace(game: Arcade) {
  const heat = Math.max(0, game.age - 52);
  return Math.min(460, 280 + game.age * 1.6 + heat * heat * 0.05 + game.score * 0.45);
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
  const slices = Math.max(8, Math.ceil((speed * step) / 6));
  let missed = false;
  for (let i = 0; i < slices && !missed; i += 1) {
    const piece = step / slices;
    for (const ball of game.balls) {
      if (ball.wait) {
        ball.y = FRONT + 28;
        ball.vx = 0;
        ball.vy = 0;
        ball.z = 18;
        ball.vz = 0;
        continue;
      }
      const prevX = ball.x;
      const prevDraw = ball.y - ball.z * LIFT;
      ball.x += ball.vx * piece;
      ball.y += ball.vy * piece;
      ball.z = flightHeight(ball);
      ball.vz = 0;

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
          events.push('score');
        }
        const otherComing = game.balls.some((other) => other !== ball && !other.wait && other.vy > 0);
        if (otherComing) {
          ball.wait = true;
          ball.vx = 0;
          ball.vy = 0;
          ball.vz = 0;
        } else {
          reboundFromFront(ball, speed);
        }
      }

      const drawY = ball.y - ball.z * LIFT;
      if (ball.vy > 0 && ball.z < HIT_HEIGHT && meetsRacket(prevX, prevDraw, ball.x, drawY, game)) {
        const half = RACKET_W / 2;
        const along = (ball.x - game.racketX) / half;
        ball.returnFrom = ball.y;
        ball.returnZ = ball.z;
        ball.vy = -speed;
        const boast = Math.abs(along) > 0.42;
        ball.vx = boast ? Math.sign(along || 1) * speed * (0.72 + Math.abs(along) * 0.28) : along * speed * 0.95;
        ball.vx = clamp(ball.vx, -speed * 0.98, speed * 0.98);
        ball.bounces = 0;
        ball.returned = true;
        ball.z = flightHeight(ball);
        ball.color = (ball.color + 1) % BALL_COLORS.length;
        events.push('hit');
      }

      ball.bounces = !ball.returned && ball.y >= FIRST_BOUNCE_Y ? 1 : 0;
      if (!ball.returned && ball.y > BACK + 8) {
        events.push(loseLife(game));
        missed = true;
        break;
      }
    }
  }
  return events;
}

/** The ball arcs to a bounce short of the service line, then sits up in the back court. */
function flightHeight(ball: Ball) {
  if (ball.returned) return heightReturn(ball);
  return heightTowardPlayer(ball.y);
}

function heightTowardPlayer(y: number) {
  if (y <= FIRST_BOUNCE_Y) {
    const span = FIRST_BOUNCE_Y - LAUNCH_Y;
    const p = clamp((y - LAUNCH_Y) / span, 0, 1);
    return (1 - p) * LAUNCH_Z + 4 * FIRST_PEAK * p * (1 - p);
  }
  const span = SECOND_BOUNCE_Y - FIRST_BOUNCE_Y;
  const p = clamp((y - FIRST_BOUNCE_Y) / span, 0, 1);
  return 4 * SECOND_PEAK * p * (1 - p);
}

function heightReturn(ball: Ball) {
  const span = Math.max(48, ball.returnFrom - LAUNCH_Y);
  const p = clamp((ball.returnFrom - ball.y) / span, 0, 1);
  return (1 - p) * ball.returnZ + p * LAUNCH_Z + 4 * FIRST_PEAK * p * (1 - p);
}

/** The racket is the head plus the shaft. The test follows the ball across the step, so a fast ball cannot skip the head. */
function meetsRacket(x0: number, draw0: number, x1: number, draw1: number, game: Arcade) {
  const top = game.racketY - RACKET_HEAD - BALL;
  const bottom = game.racketY + 8 + BALL;
  const left = game.racketX - RACKET_W / 2 - BALL;
  const right = game.racketX + RACKET_W / 2 + BALL;
  const yLo = Math.min(draw0, draw1);
  const yHi = Math.max(draw0, draw1);
  if (yHi < top || yLo > bottom) return false;
  const span = draw1 - draw0;
  let tEnter = 0;
  let tExit = 1;
  if (Math.abs(span) > 0.0001) {
    const ta = (top - draw0) / span;
    const tb = (bottom - draw0) / span;
    tEnter = Math.max(0, Math.min(ta, tb));
    tExit = Math.min(1, Math.max(ta, tb));
  }
  if (tEnter > tExit) return false;
  const xEnter = x0 + (x1 - x0) * tEnter;
  const xExit = x0 + (x1 - x0) * tExit;
  return Math.max(xEnter, xExit) >= left && Math.min(xEnter, xExit) <= right;
}

/** The front wall sends the ball back at an angle, often toward a side wall. */
function reboundFromFront(ball: Ball, speed: number) {
  const paceNow = Math.max(Math.abs(ball.vy), speed * 0.9);
  ball.vy = paceNow;
  if (Math.abs(ball.vx) < paceNow * 0.32) {
    const dir = ball.x < (LEFT + RIGHT) / 2 ? -1 : 1;
    ball.vx = dir * paceNow * (0.42 + Math.random() * 0.38);
  } else {
    ball.vx *= 1.12;
  }
  ball.vx = clamp(ball.vx, -paceNow * 0.95, paceNow * 0.95);
  ball.returned = false;
  ball.bounces = 0;
  ball.returnFrom = 0;
  ball.returnZ = 0;
  ball.y = LAUNCH_Y;
  ball.z = heightTowardPlayer(ball.y);
  ball.vz = 0;
  ball.color = (ball.color + 1) % BALL_COLORS.length;
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
    z: 18,
    vz: 0,
    bounces: 0,
    returned: false,
    wait: true,
    color: 2,
    returnFrom: 0,
    returnZ: 0,
  });
}

/** One ball comes off the front wall. The other stays there until that one is hit back. */
function releaseWaiting(game: Arcade) {
  if (game.balls.some((ball) => !ball.wait && ball.vy > 0)) return;
  const waiting = game.balls.find((ball) => ball.wait);
  if (!waiting) return;
  waiting.wait = false;
  waiting.y = LAUNCH_Y;
  reboundFromFront(waiting, pace(game));
}

function bonusGap() {
  return 2.1 + Math.random() * 2.4;
}

function maybeSpawn(game: Arcade) {
  if (game.bonus || game.age < game.nextBonus) return;
  const roll = Math.random();
  const kind: BonusKind = roll < 0.46 ? 'pumpkin' : roll < 0.78 ? 'skull' : 'bat';
  const points: 10 | 20 | 30 = kind === 'pumpkin' ? 10 : kind === 'skull' ? 20 : 30;
  const r = kind === 'pumpkin' ? 16 : kind === 'skull' ? 13 : 10;
  const life = kind === 'pumpkin' ? 5.4 : kind === 'skull' ? 3.5 : 2.2;
  const spanX = RIGHT - LEFT - 36;
  const spanY = (BACK - FRONT) * 0.78;
  let x = LEFT + 18 + Math.random() * spanX;
  let y = FRONT + 36 + Math.random() * spanY;
  if (kind === 'bat') {
    const side = Math.random() < 0.5;
    x = side ? LEFT + 16 + Math.random() * 42 : RIGHT - 16 - Math.random() * 42;
    if (Math.random() < 0.45) y = FRONT + 28 + Math.random() * 90;
  }
  game.bonus = { x, y, until: game.age + life, born: game.age, points, kind, r };
}

function collectBonus(game: Arcade, ball: Ball, events: TickEvent[]) {
  const bonus = game.bonus;
  if (!bonus) return false;
  const dx = ball.x - bonus.x;
  const dy = ball.y - bonus.y;
  if (dx * dx + dy * dy > (bonus.r + BALL) * (bonus.r + BALL)) return false;
  game.score += bonus.points;
  game.lastBonusPoints = bonus.points;
  game.bonus = null;
  game.nextBonus = game.age + bonusGap();
  events.push('bonus');
  return true;
}

function flying(game: Arcade, slot: number): Ball {
  const speed = pace(game);
  const lead = slot === 0;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const mid = (LEFT + RIGHT) / 2;
  return {
    x: lead ? mid + dir * (30 + Math.random() * 70) : mid - dir * 50,
    y: LAUNCH_Y,
    vx: lead ? dir * speed * (0.4 + Math.random() * 0.35) : 0,
    vy: lead ? speed * 0.92 : 0,
    z: lead ? LAUNCH_Z : 18,
    vz: 0,
    bounces: 0,
    returned: false,
    wait: !lead,
    color: Math.floor(Math.random() * BALL_COLORS.length),
    returnFrom: 0,
    returnZ: 0,
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
      ball.vz = 0;
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
  ctx.fillStyle = '#140810';
  ctx.fillRect(0, 0, width, height);

  const floorW = RIGHT - LEFT;
  const floorH = BACK - FRONT;
  ctx.fillStyle = '#2a1233';
  ctx.fillRect(LEFT, FRONT, floorW, floorH);

  const shortY = SERVICE_Y;
  const boxDepth = floorH * (1.6 / 9.75);
  const boxWidth = floorW * (1.6 / 6.4);

  ctx.strokeStyle = '#fb923c';
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

  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(LEFT, FRONT);
  ctx.lineTo(RIGHT, FRONT);
  ctx.stroke();

  drawCobweb(ctx, 8, 8, 54, false);
  drawCobweb(ctx, width - 8, 8, 54, true);
  drawLantern(ctx, 78, 24, 11);
  drawLantern(ctx, width - 78, 24, 11);

  if (game.bonus) {
    const age = game.age - game.bonus.born;
    const pop = Math.min(1, age / 0.16);
    drawBonus(ctx, game.bonus, pop);
  }

  const showBall = game.phase === 'serve' || game.phase === 'rally' || game.phase === 'point' || game.phase === 'over';
  if (showBall) {
    for (const ball of game.balls) {
      ctx.fillStyle = 'rgba(253, 186, 116, 0.9)';
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + 1, BALL * 0.7, BALL * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      const lift = ball.z * LIFT;
      ctx.fillStyle = BALL_COLORS[ball.color % BALL_COLORS.length]!;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y - lift, BALL, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  const racketY = game.racketY;
  ctx.strokeStyle = '#c084fc';
  ctx.fillStyle = '#c084fc';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(game.racketX - RACKET_W / 2, racketY);
  ctx.lineTo(game.racketX + RACKET_W / 2, racketY);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(game.racketX, racketY - 10, 16, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fde68a';
  ctx.font = '700 26px Barlow Condensed, Arial Narrow, sans-serif';
  ctx.fillText(String(game.score).padStart(4, '0'), 16, 32);
  for (let i = 0; i < game.lives; i += 1) drawLantern(ctx, 118 + i * 22, 22, 8);
}

function drawCobweb(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, flip: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.strokeStyle = 'rgba(244, 236, 220, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 4) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
    ctx.stroke();
  }
  for (let ring = 1; ring <= 3; ring += 1) {
    const radius = (size * ring) / 3;
    ctx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const angle = (i / 4) * (Math.PI / 2);
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawLantern(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#166534';
  ctx.fillRect(x - 1.5, y - r - 3, 3, 4);
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(x - 2, y - 2, 4, 3);
}

function drawBonus(ctx: CanvasRenderingContext2D, bonus: BonusDrop, pop: number) {
  ctx.save();
  ctx.translate(bonus.x, bonus.y);
  ctx.scale(pop, pop);
  if (bonus.kind === 'pumpkin') {
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(0, 0, bonus.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -bonus.r + 3);
    ctx.lineTo(0, bonus.r - 3);
    ctx.moveTo(-5, -bonus.r + 4);
    ctx.lineTo(-4, bonus.r - 4);
    ctx.moveTo(5, -bonus.r + 4);
    ctx.lineTo(4, bonus.r - 4);
    ctx.stroke();
    ctx.fillStyle = '#166534';
    ctx.fillRect(-2, -bonus.r - 4, 4, 6);
    ctx.fillStyle = '#111';
    ctx.fillRect(-6, -2, 3, 3);
    ctx.fillRect(3, -2, 3, 3);
  } else if (bonus.kind === 'skull') {
    ctx.fillStyle = '#f5f0e6';
    ctx.beginPath();
    ctx.arc(0, -1, bonus.r * 0.86, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1024';
    ctx.beginPath();
    ctx.arc(-4, -2, 2.4, 0, Math.PI * 2);
    ctx.arc(4, -2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-1.2, 3, 2.4, 4);
  } else {
    ctx.fillStyle = '#4c1d95';
    ctx.beginPath();
    ctx.moveTo(-bonus.r, 2);
    ctx.quadraticCurveTo(-bonus.r * 0.2, -bonus.r, 0, -2);
    ctx.quadraticCurveTo(bonus.r * 0.2, -bonus.r, bonus.r, 2);
    ctx.quadraticCurveTo(0, 4, -bonus.r, 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-3, 0, 1.4, 0, Math.PI * 2);
    ctx.arc(3, 0, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
