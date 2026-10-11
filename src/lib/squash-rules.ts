/** Plain-language singles reminders. The official rules decide a match. */

export type SinglesRule = {
  title: string;
  text: string;
};

export const SINGLES_RULES: SinglesRule[] = [
  {
    title: 'Point a rally',
    text: 'The player who wins the rally scores one point, and that player serves to start the next rally.',
  },
  {
    title: 'Eleven, then two clear',
    text: 'A game is played to 11. If the score reaches 10-all, play continues until one player leads by two points.',
  },
  {
    title: 'Best of five',
    text: 'A match is normally the best of five games. Some events play the best of three.',
  },
  {
    title: 'How to serve',
    text: 'Drop the ball and hit it straight to the front wall, above the service line and below the out line. When you hit it, one foot must be on the floor inside the service box, not touching a line. Unless your opponent volleys it, the ball must land in the opposite back quarter, clear of the lines.',
  },
  {
    title: 'A line is out on the serve',
    text: 'The serve is a fault if it touches the service line, the short line, the half-court line, or the out line.',
  },
  {
    title: 'One serve',
    text: 'There is no second serve. A fault gives the rally to the receiver.',
  },
  {
    title: 'Not ready',
    text: 'If you are not ready for the serve, ask for a let and leave the ball. Once you swing, you have taken it. A fault still loses the rally.',
  },
  {
    title: 'A good return',
    text: 'Hit the ball before it bounces twice. It must reach the front wall above the tin and below the out line, and it may hit the side walls or the back wall on the way. It must not bounce on the floor before it hits the front wall.',
  },
  {
    title: 'Down',
    text: 'The rally is lost if the ball hits the tin, or comes back off the front wall and touches the tin.',
  },
  {
    title: 'Out',
    text: 'The out line is out. So is a ball that goes above it, hits the ceiling, or leaves the court.',
  },
  {
    title: 'Get out of the way',
    text: 'After your shot, give your opponent a fair view of the ball, a way to it, room for a reasonable swing, and a free hit to any part of the front wall.',
  },
  {
    title: 'Ask early for a let',
    text: 'If you are blocked, stop and say “Let, please” straight away. The rally is played again, and the server uses the same box. If you play on and ask afterwards, the let is not given.',
  },
  {
    title: 'When it is a stroke',
    text: 'A stroke gives the striker the point. It is a stroke when the opponent was not making every effort to clear and the striker could have played a good return, or when the opponent’s position stopped the swing.',
  },
  {
    title: 'A winning return',
    text: 'If interference stops a shot that was going to be a winner, the striker is awarded a stroke.',
  },
  {
    title: 'Turning',
    text: 'Turning is when you lose sight of the ball or your opponent, or the ball passes behind your body. If you could have played it without turning, and you turned to look for a let, there is no let. If the swing is stopped while you turn, that can be a stroke. A turn that puts your opponent in danger is a matter of conduct.',
  },
  {
    title: 'Same box after a let',
    text: 'After a let, serve again from the same box. At the start of a game, and each time the serve changes hands, the server chooses a box, then alternates for as long as they keep the serve.',
  },
  {
    title: 'Between games',
    text: 'There are up to two minutes between games, and up to one minute after the warm-up before the first ball. Be ready when the time is up. Either player may hit the ball during the break.',
  },
  {
    title: 'The warm-up',
    text: 'Before the match the players warm the ball up together for a maximum of four minutes. Change sides after two minutes, unless you already have. Both players need a fair share of the ball.',
  },
  {
    title: 'A broken ball',
    text: 'If the ball breaks during a rally, that rally is a let. If you stop and the ball is not broken, you lose the rally.',
  },
  {
    title: 'Safety first',
    text: 'The court is a small space. Do not play a shot that could hit your opponent with the ball or the racket. Play can be stopped for safety even when nobody has asked.',
  },
];

export const SINGLES_RULES_URL = 'https://www.worldsquash.sport/rules-of-squash-2/';

/** The calendar day in Britain, so the rule changes at midnight in the county. */
export function londonDayNumber(date: Date): number {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [year, month, day] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function ruleFor(date: Date): SinglesRule & { index: number; when: string } {
  const index = ((londonDayNumber(date) % SINGLES_RULES.length) + SINGLES_RULES.length) % SINGLES_RULES.length;
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return { ...SINGLES_RULES[index], index, when };
}
