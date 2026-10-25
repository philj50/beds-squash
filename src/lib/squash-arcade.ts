/** Top-down squash, mk4. The court is a floor plan.
 * A call says straight, cross or boast. A good return pitches in that back corner.
 * The racket has to be on the T when the ball crosses the short line.
 * First to 11, and from 10-all you need two clear.
 *
 * Singles court, World Squash: 9.75 m long and 6.40 m wide.
 * The short line is 5.49 m from the front wall.
 * Drawn at 60 px per metre, so the floor is 384 by 585.
 */

export const COURT = { width: 440, height: 660 };

const LEFT = 28;
const RIGHT = 412;
const FRONT = 48;
const BACK = 633;
const MID = (LEFT + RIGHT) / 2;
const RACKET_W = 74;
const RACKET_Y = BACK - 16;
/** Short line, the service line: 5.49 m from the front wall on a 9.75 m court. */
const SERVICE_Y = FRONT + (BACK - FRONT) * (5.49 / 9.75);
const RACKET_HEAD = 22;
const BALL = 7;
const LIFT = 0.42;
const HIT_HEIGHT = 150;
const LAUNCH_Y = FRONT + 18;
const SECOND_BOUNCE_Y = BACK + 36;
const T_X = MID;
const T_Y = SERVICE_Y + 34;
const T_R = 52;
const BOX_W = 86;
const BOX_H = 118;

export const PLAY = { left: LEFT, right: RIGHT, front: FRONT, back: BACK };

/** Where the Serve button sits, as a percentage of the canvas. */
export const SERVE_SPOT = {
  x: (MID / COURT.width) * 100,
  y: (((FRONT + BACK) / 2) / COURT.height) * 100,
};

export type Phase = 'idle' | 'serve' | 'rally' | 'point' | 'over';
export type TickEvent = 'hit' | 'you' | 'court' | 'over';
export type Call = 'straight' | 'cross' | 'boast';
export type Side = 'left' | 'right';
export type Winner = 'you' | 'court';

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  /** Going to the front wall after a hit. */
  returned: boolean;
  /** This flight is the result of a shot, so the pitch can score. */
  fromShot: boolean;
  shot: Call | null;
  asked: Call | null;
  fromSide: -1 | 1;
  touchedSide: boolean;
  checkedT: boolean;
  pitched: boolean;
  pitchX: number;
  pitchY: number;
  yStart: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number; side: Side };

export type Arcade = {
  phase: Phase;
  you: number;
  court: number;
  winner: Winner | null;
  call: Call;
  racketX: number;
  racketY: number;
  balls: Ball[];
  age: number;
  wait: number;
  flash: { side: Side; until: number } | null;
};

export function matchWinner(you: number, court: number): Winner | null {
  if (you >= 11 && you - court >= 2) return 'you';
  if (court >= 11 && court - you >= 2) return 'court';
  return null;
}

function corner(side: Side): Box {
  const x0 = side === 'left' ? LEFT + 10 : RIGHT - 10 - BOX_W;
  const y0 = BACK - 12 - BOX_H;
  return { x0, y0, x1: x0 + BOX_W, y1: y0 + BOX_H, side };
}

function stillBall(): Ball {
  return {
    x: MID,
    y: LAUNCH_Y,
    vx: 0,
    vy: 0,
    z: 16,
    returned: false,
    fromShot: false,
    shot: null,
    asked: null,
    fromSide: -1,
    touchedSide: false,
    checkedT: false,
    pitched: false,
    pitchX: MID,
    pitchY: SERVICE_Y,
    yStart: LAUNCH_Y,
  };
}

function pickCall(): Call {
  const roll = Math.random();
  if (roll < 0.34) return 'straight';
  if (roll < 0.67) return 'cross';
  return 'boast';
}

export function createArcade(): Arcade {
  return {
    phase: 'idle',
    you: 0,
    court: 0,
    winner: null,
    call: 'straight',
    racketX: MID,
    racketY: RACKET_Y,
    balls: [stillBall()],
    age: 0,
    wait: 0,
    flash: null,
  };
}

export function beginServe(game: Arcade) {
  game.phase = 'serve';
  game.wait = 0.45;
  game.balls = [stillBall()];
}

/** fractionX is 0 at the left sideline and 1 at the right.
 * fractionY is 0 at the front wall and 1 at the back.
 * The racket stops on the short line.
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
  return Math.min(320, 200 + game.age * 0.45 + (game.you + game.court) * 3.2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function aimAt(ball: Ball, x: number, y: number, speed: number) {
  const dx = x - ball.x;
  const dy = y - ball.y;
  const dist = Math.hypot(dx, dy) || 1;
  ball.vx = (dx / dist) * speed;
  ball.vy = (dy / dist) * speed;
}

function sideOf(x: number): -1 | 1 {
  return x < MID ? -1 : 1;
}

function classify(ball: Ball, game: Arcade): Call {
  const along = (ball.x - game.racketX) / (RACKET_W / 2);
  if (Math.abs(along) >= 0.72) return 'boast';
  const side = sideOf(ball.x);
  if (along * side < -0.12) return 'cross';
  return 'straight';
}

function playShot(ball: Ball, game: Arcade, speed: number) {
  const side = sideOf(ball.x);
  ball.shot = classify(ball, game);
  ball.asked = game.call;
  ball.fromSide = side;
  ball.returned = true;
  ball.fromShot = false;
  ball.touchedSide = false;
  ball.checkedT = true;
  ball.pitched = true;
  ball.yStart = ball.y;
  ball.z = 36;
  if (ball.shot === 'boast') {
    const wallX = side < 0 ? LEFT + BALL : RIGHT - BALL;
    aimAt(ball, wallX, ball.y - 90, speed);
    return;
  }
  const aimX = ball.shot === 'cross' ? (side < 0 ? MID + 78 : MID - 78) : side < 0 ? MID - 72 : MID + 72;
  aimAt(ball, aimX, FRONT + BALL, speed);
}

function targetSide(ball: Ball): Side {
  const stay = ball.fromSide < 0 ? 'left' : 'right';
  const cross = ball.fromSide < 0 ? 'right' : 'left';
  return ball.shot === 'cross' ? cross : stay;
}

function shotStands(ball: Ball) {
  if (!ball.shot || ball.shot !== ball.asked) return false;
  if (ball.shot === 'boast') return ball.touchedSide;
  return !ball.touchedSide;
}

function sendBack(ball: Ball, game: Arcade, speed: number) {
  const side = targetSide(ball);
  const box = corner(side);
  ball.pitchX = (box.x0 + box.x1) / 2;
  ball.pitchY = box.y0 + 22;
  ball.x = clamp(ball.x, LEFT + 24, RIGHT - 24);
  ball.y = LAUNCH_Y;
  ball.returned = false;
  ball.fromShot = true;
  ball.shot = null;
  ball.asked = null;
  ball.touchedSide = false;
  ball.checkedT = false;
  ball.pitched = false;
  ball.yStart = LAUNCH_Y;
  aimAt(ball, ball.pitchX, ball.pitchY, speed * 0.9);
  game.call = pickCall();
}

function feed(game: Arcade) {
  const side: Side = Math.random() < 0.5 ? 'left' : 'right';
  const box = corner(side);
  const ball = stillBall();
  ball.x = MID + (Math.random() - 0.5) * 40;
  ball.y = LAUNCH_Y;
  ball.pitchX = (box.x0 + box.x1) / 2;
  ball.pitchY = box.y0 + 22;
  ball.fromShot = false;
  aimAt(ball, ball.pitchX, ball.pitchY, pace(game) * 0.88);
  game.call = pickCall();
  game.balls = [ball];
  game.phase = 'rally';
}

function stopBall(ball: Ball) {
  ball.vx = 0;
  ball.vy = 0;
}

function awardCourt(game: Arcade): TickEvent {
  game.court += 1;
  game.flash = null;
  const winner = matchWinner(game.you, game.court);
  for (const ball of game.balls) stopBall(ball);
  if (winner) {
    game.phase = 'over';
    game.winner = winner;
    return 'over';
  }
  game.phase = 'point';
  game.wait = 0.7;
  game.balls = [stillBall()];
  return 'court';
}

function awardYou(game: Arcade, side: Side): TickEvent {
  game.you += 1;
  game.flash = { side, until: game.age + 0.7 };
  const winner = matchWinner(game.you, game.court);
  for (const ball of game.balls) stopBall(ball);
  if (winner) {
    game.phase = 'over';
    game.winner = winner;
    return 'over';
  }
  game.phase = 'point';
  game.wait = 0.55;
  game.balls = [stillBall()];
  return 'you';
}

function onTheT(game: Arcade) {
  const dx = game.racketX - T_X;
  const dy = game.racketY - T_Y;
  return dx * dx + dy * dy <= T_R * T_R;
}

function inBox(x: number, y: number, box: Box) {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

export function tick(game: Arcade, dt: number): TickEvent[] {
  const events: TickEvent[] = [];
  if (game.phase === 'over' || game.phase === 'idle') return events;
  const step = Math.min(dt, 0.05);
  game.age += step;
  if (game.phase === 'serve' || game.phase === 'point') {
    game.wait -= step;
    if (game.wait <= 0) feed(game);
    return events;
  }

  const speed = pace(game);
  const slices = Math.max(8, Math.ceil((speed * step) / 6));
  let stopped = false;
  for (let i = 0; i < slices && !stopped; i += 1) {
    const piece = step / slices;
    for (const ball of game.balls) {
      const prevX = ball.x;
      const prevDraw = ball.y - ball.z * LIFT;
      ball.x += ball.vx * piece;
      ball.y += ball.vy * piece;
      ball.z = heightOf(ball);

      if (ball.x < LEFT + BALL) {
        ball.x = LEFT + BALL;
        ball.vx = Math.abs(ball.vx);
        if (ball.returned) ball.touchedSide = true;
      }
      if (ball.x > RIGHT - BALL) {
        ball.x = RIGHT - BALL;
        ball.vx = -Math.abs(ball.vx);
        if (ball.returned) ball.touchedSide = true;
      }

      if (ball.returned && ball.y <= FRONT + BALL) {
        ball.y = FRONT + BALL;
        if (!shotStands(ball)) {
          events.push(awardCourt(game));
          stopped = true;
          break;
        }
        sendBack(ball, game, speed);
        continue;
      }

      if (!ball.returned && !ball.checkedT && ball.y >= SERVICE_Y) {
        ball.checkedT = true;
        if (!onTheT(game)) {
          events.push(awardCourt(game));
          stopped = true;
          break;
        }
      }

      if (!ball.returned && !ball.pitched && ball.y >= ball.pitchY) {
        ball.pitched = true;
        if (ball.fromShot) {
          const side = ball.pitchX < MID ? 'left' : 'right';
          const box = corner(side);
          events.push(inBox(ball.x, ball.pitchY, box) ? awardYou(game, side) : awardCourt(game));
          stopped = true;
          break;
        }
      }

      const drawY = ball.y - ball.z * LIFT;
      if (!ball.returned && ball.pitched && ball.vy > 0 && ball.z < HIT_HEIGHT && meetsRacket(prevX, prevDraw, ball.x, drawY, game)) {
        playShot(ball, game, speed);
        events.push('hit');
      }

      if (!ball.returned && ball.y > BACK + 8) {
        events.push(awardCourt(game));
        stopped = true;
        break;
      }
    }
  }
  return events;
}

function heightOf(ball: Ball) {
  if (ball.returned) {
    const span = Math.max(48, ball.yStart - FRONT);
    const p = clamp((ball.yStart - ball.y) / span, 0, 1);
    return 4 * 64 * p * (1 - p);
  }
  const bounce = ball.pitchY;
  if (ball.y <= bounce) {
    const span = Math.max(24, bounce - LAUNCH_Y);
    const p = clamp((ball.y - LAUNCH_Y) / span, 0, 1);
    return 4 * 78 * p * (1 - p);
  }
  const span = Math.max(24, SECOND_BOUNCE_Y - bounce);
  const p = clamp((ball.y - bounce) / span, 0, 1);
  return 4 * 58 * p * (1 - p);
}

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

export function drawCourt(ctx: CanvasRenderingContext2D, game: Arcade) {
  const { width, height } = COURT;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#10243a';
  ctx.fillRect(0, 0, width, height);

  const floorW = RIGHT - LEFT;
  const floorH = BACK - FRONT;
  ctx.fillStyle = '#1f6b45';
  ctx.fillRect(LEFT, FRONT, floorW, floorH);

  const shortY = SERVICE_Y;
  const boxDepth = floorH * (1.6 / 9.75);
  const boxWidth = floorW * (1.6 / 6.4);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 2;
  ctx.strokeRect(LEFT, FRONT, floorW, floorH);
  ctx.beginPath();
  ctx.moveTo(LEFT, shortY);
  ctx.lineTo(RIGHT, shortY);
  ctx.moveTo(MID, shortY);
  ctx.lineTo(MID, BACK);
  ctx.stroke();
  ctx.strokeRect(LEFT, shortY, boxWidth, boxDepth);
  ctx.strokeRect(RIGHT - boxWidth, shortY, boxWidth, boxDepth);

  for (const side of ['left', 'right'] as const) {
    const box = corner(side);
    const lit = game.flash?.side === side && game.age < game.flash.until;
    ctx.fillStyle = lit ? 'rgba(244, 196, 48, 0.55)' : 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = lit ? '#f4c430' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = lit ? 3 : 2;
    ctx.fillRect(box.x0, box.y0, BOX_W, BOX_H);
    ctx.strokeRect(box.x0, box.y0, BOX_W, BOX_H);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(T_X, T_Y, T_R, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#e23b2f';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(LEFT, FRONT);
  ctx.lineTo(RIGHT, FRONT);
  ctx.stroke();

  ctx.fillStyle = '#f6f1e4';
  ctx.font = '700 34px Barlow Condensed, Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = game.call === 'boast' ? 'BOAST' : game.call === 'cross' ? 'CROSS' : 'STRAIGHT';
  ctx.fillText(label, MID, FRONT + 54);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (game.phase !== 'idle') {
    for (const ball of game.balls) {
      ctx.fillStyle = 'rgba(16, 36, 24, 0.35)';
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + 2, BALL * 0.85, BALL * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      const lift = ball.z * LIFT;
      ctx.fillStyle = '#f5e642';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y - lift, BALL, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.strokeStyle = '#f4c430';
  ctx.fillStyle = '#f4c430';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(game.racketX - RACKET_W / 2, game.racketY);
  ctx.lineTo(game.racketX + RACKET_W / 2, game.racketY);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(game.racketX, game.racketY - 10, 16, 12, 0, 0, Math.PI * 2);
  ctx.fill();
}
