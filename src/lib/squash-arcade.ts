/** Side-on retro squash. The ball must come back above the tin. */

export const COURT = { width: 640, height: 360 };
const WALL = 72;
const FLOOR = 308;
const CEILING = 52;
const TIN = 232;
const RACKET_X = 548;
const RACKET_H = 86;
const BALL = 6;
const LIVES = 3;

export type Phase = 'serve' | 'rally' | 'point' | 'over';

export type Arcade = {
  phase: Phase;
  score: number;
  lives: number;
  racketY: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  wait: number;
  returned: boolean;
  speed: number;
};

export function createArcade(): Arcade {
  const game = {
    phase: 'serve' as Phase,
    score: 0,
    lives: LIVES,
    racketY: (FLOOR + CEILING) / 2,
    ballX: WALL + 30,
    ballY: 140,
    vx: 0,
    vy: 0,
    wait: 0.7,
    returned: false,
    speed: 280,
  };
  return game;
}

export function setRacket(game: Arcade, y: number) {
  const half = RACKET_H / 2;
  game.racketY = Math.min(FLOOR - half, Math.max(CEILING + half, y));
}

export function tick(game: Arcade, dt: number): 'none' | 'hit' | 'score' | 'miss' | 'over' {
  if (game.phase === 'over') return 'none';
  const step = Math.min(dt, 0.05);
  if (game.phase === 'serve' || game.phase === 'point') {
    game.wait -= step;
    if (game.wait > 0) return 'none';
    launch(game);
    return 'none';
  }

  let event: 'none' | 'hit' | 'score' | 'miss' | 'over' = 'none';
  const slices = 4;
  for (let i = 0; i < slices; i += 1) {
    const piece = step / slices;
    game.ballX += game.vx * piece;
    game.ballY += game.vy * piece;
    if (game.ballY > FLOOR - BALL) {
      game.ballY = FLOOR - BALL;
      game.vy = -Math.abs(game.vy);
    }
    if (game.ballY < CEILING + BALL) {
      game.ballY = CEILING + BALL;
      game.vy = Math.abs(game.vy);
    }
    if (game.ballX < WALL + BALL) {
      if (game.ballY > TIN) {
        event = loseLife(game);
        break;
      }
      game.ballX = WALL + BALL;
      game.vx = Math.abs(game.speed);
      if (game.returned) {
        game.score += 1;
        game.speed = Math.min(520, game.speed + 10);
        game.returned = false;
        event = 'score';
      }
    }
    if (game.vx > 0 && game.ballX >= RACKET_X - BALL && game.ballX <= RACKET_X + 16) {
      const top = game.racketY - RACKET_H / 2;
      const bottom = game.racketY + RACKET_H / 2;
      if (game.ballY >= top && game.ballY <= bottom) {
        const along = (game.ballY - game.racketY) / (RACKET_H / 2);
        game.ballX = RACKET_X - BALL;
        game.vx = -game.speed;
        game.vy = along * 150;
        game.returned = true;
        event = 'hit';
      }
    }
    if (game.ballX > RACKET_X + 28) {
      event = loseLife(game);
      break;
    }
  }
  return event;
}

function launch(game: Arcade) {
  game.phase = 'rally';
  game.returned = false;
  game.ballX = WALL + 36;
  game.ballY = CEILING + 36 + Math.random() * (TIN - CEILING - 80);
  game.speed = Math.min(520, 240 + game.score * 10);
  game.vx = game.speed;
  game.vy = (Math.random() - 0.5) * 160;
}

function loseLife(game: Arcade): 'miss' | 'over' {
  game.lives -= 1;
  game.returned = false;
  if (game.lives <= 0) {
    game.phase = 'over';
    game.vx = 0;
    game.vy = 0;
    return 'over';
  }
  game.phase = 'point';
  game.wait = 0.85;
  game.vx = 0;
  game.vy = 0;
  game.ballX = WALL + 36;
  game.ballY = (CEILING + TIN) / 2;
  return 'miss';
}

export function drawCourt(ctx: CanvasRenderingContext2D, game: Arcade) {
  const { width, height } = COURT;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#041426';
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, y, width, 1);
  }

  ctx.strokeStyle = '#f2b705';
  ctx.lineWidth = 2;
  ctx.strokeRect(WALL, CEILING, RACKET_X - WALL + 24, FLOOR - CEILING);

  ctx.beginPath();
  ctx.moveTo(WALL, TIN);
  ctx.lineTo(WALL + 18, TIN);
  ctx.stroke();

  ctx.strokeStyle = '#d7263d';
  ctx.lineWidth = 1.5;
  for (let y = TIN; y < FLOOR; y += 8) {
    ctx.beginPath();
    ctx.moveTo(WALL, y);
    ctx.lineTo(WALL + 16, Math.min(FLOOR, y + 8));
    ctx.stroke();
  }

  ctx.strokeStyle = '#9fd0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(RACKET_X, game.racketY - RACKET_H / 2);
  ctx.lineTo(RACKET_X, game.racketY + RACKET_H / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(RACKET_X + 8, game.racketY, 16, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  if (game.phase === 'rally' || game.phase === 'point' || game.phase === 'over') {
    ctx.strokeStyle = '#ffc933';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(game.ballX, game.ballY, BALL, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#e7eaef';
  ctx.font = '700 28px Barlow Condensed, Arial Narrow, sans-serif';
  ctx.fillText(String(game.score).padStart(4, '0'), 16, 34);
  ctx.strokeStyle = '#f2b705';
  ctx.lineWidth = 2;
  for (let i = 0; i < game.lives; i += 1) {
    ctx.strokeRect(96 + i * 18, 16, 12, 12);
  }
}
