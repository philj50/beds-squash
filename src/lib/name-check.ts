/** True when a minigame name is not fit for the public board. */

const WORDS = [
  'fuck',
  'fucker',
  'fucking',
  'fuckyou',
  'motherfucker',
  'shit',
  'shitty',
  'bullshit',
  'dipshit',
  'shithead',
  'cunt',
  'bastard',
  'bitch',
  'wanker',
  'wank',
  'twat',
  'cock',
  'dick',
  'dickhead',
  'prick',
  'knob',
  'knobhead',
  'piss',
  'slut',
  'whore',
  'bollock',
  'bollocks',
  'arse',
  'arsehole',
  'asshole',
  'asswipe',
  'tits',
  'pussy',
  'faggot',
  'nigger',
  'nigga',
  'retard',
  'spastic',
  'fanny',
  'bellend',
  'minge',
  'tosser',
  'bugger',
  'shag',
  'slag',
  'putain',
  'merde',
  'salope',
  'connard',
  'couille',
  'enfoire',
  'mierda',
  'joder',
  'cabron',
  'maricon',
  'gilipollas',
  'puta',
  'scheisse',
  'fotze',
  'arschloch',
  'hurensohn',
  'wichser',
  'cazzo',
  'stronzo',
  'puttana',
  'vaffanculo',
  'merda',
  'kurwa',
  'pierdol',
  'skurwysyn',
  'klootzak',
  'hoer',
  'caralho',
  'porra',
  'foder',
];

export function nameKey(name: string) {
  return fold(name).replace(/[^a-z]+/g, '');
}

function fold(value: string) {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[@4]/g, 'a')
    .replace(/3/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't');
}

function hits(collapsed: string, word: string) {
  if (collapsed === word) return true;
  return word.length >= 5 && collapsed.includes(word);
}

export function rudeName(name: string, allowed: Iterable<string> = []) {
  const key = nameKey(name);
  for (const item of allowed) {
    if (nameKey(item) === key) return false;
  }
  const folded = fold(name);
  const spaced = folded.replace(/[^a-z]+/g, ' ').trim();
  const tokens = new Set(spaced.split(/\s+/).filter(Boolean));
  const collapsed = spaced.replace(/\s/g, '');
  return WORDS.some((word) => tokens.has(word) || hits(collapsed, word));
}
