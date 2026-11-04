/** Read a score aloud.

A phone only starts speaking from a tap, and it will not start a new line from a timer.
Once a tap has begun a line, the next line has to be spoken from the end of the previous one.
Chrome drops a line that is cancelled and spoken in the same moment, so a computer waits a beat.
*/

let held: SpeechSynthesisUtterance | null = null;
let queued: string | null = null;
let chain = false;
let stopped = false;
let nudge = 0;

function onPhone() {
  const agent = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const voiceKey = 'beds-say-voice';
let savedVoiceOn = true;

/** Match commentary turns this off until someone is signed in. */
export function useSavedVoice(on: boolean) {
  savedVoiceOn = on;
}

export function savedVoiceName() {
  try {
    return localStorage.getItem(voiceKey) || '';
  } catch {
    return '';
  }
}

export function saveVoiceName(name: string) {
  try {
    if (name) localStorage.setItem(voiceKey, name);
    else localStorage.removeItem(voiceKey);
  } catch {
    /* The browser is keeping the page private. */
  }
}

function englishVoice(synth: SpeechSynthesis) {
  const voices = synth.getVoices();
  const wanted = savedVoiceOn ? savedVoiceName().trim().toLowerCase() : '';
  if (wanted) {
    const picked = voices.find((voice) => voice.name.toLowerCase() === wanted || voice.voiceURI.toLowerCase() === wanted);
    if (picked) return picked;
  }
  return voices.find((voice) => voice.lang === 'en-GB') ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ?? null;
}

function useVoice(line: SpeechSynthesisUtterance, voice: SpeechSynthesisVoice | null) {
  if (!voice) {
    line.lang = 'en-GB';
    return;
  }
  line.voice = voice;
  line.lang = voice.lang || 'en-GB';
}

function startNudge(synth: SpeechSynthesis) {
  if (onPhone()) return;
  window.clearInterval(nudge);
  let ticks = 0;
  nudge = window.setInterval(() => {
    ticks += 1;
    if (ticks > 12 || stopped || (!synth.speaking && !synth.pending)) {
      window.clearInterval(nudge);
      return;
    }
    synth.pause();
    synth.resume();
  }, 4000);
}

/** Speak the next line from the end of the one before it, so a phone will say it. */
let depth = 0;

function speakChained(text: string, silent: boolean) {
  const synth = window.speechSynthesis;
  if (!synth || stopped || depth > 6) return;
  depth += 1;
  const line = new SpeechSynthesisUtterance(silent ? ' ' : text);
  line.rate = silent ? 0.1 : 0.95;
  line.volume = silent ? 0 : 1;
  if (silent) line.lang = 'en-GB';
  else useVoice(line, englishVoice(synth));
  const finish = () => {
    if (held !== line) return;
    held = null;
    window.clearInterval(nudge);
    if (stopped) return;
    const next = queued;
    queued = null;
    if (next) {
      speakChained(next, false);
      return;
    }
    if (chain) speakChained('.', true);
  };
  line.onend = finish;
  line.onerror = finish;
  held = line;
  synth.resume();
  synth.speak(line);
  if (!silent) startNudge(synth);
  depth -= 1;
}

/** Speak now. Used from a tap, including each point on the marking page. */
export function speakScore(text: string) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  stopped = false;
  queued = null;
  const line = new SpeechSynthesisUtterance(text);
  line.rate = 0.95;
  const voice = englishVoice(synth);
  useVoice(line, voice);
  const finish = () => {
    if (held !== line) return;
    held = null;
    window.clearInterval(nudge);
    if (stopped) return;
    const next = queued;
    queued = null;
    if (next) {
      speakChained(next, false);
      return;
    }
    if (chain) speakChained('.', true);
  };
  line.onend = finish;
  line.onerror = finish;
  held = line;
  const say = () => {
    if (held !== line || stopped) return;
    useVoice(line, englishVoice(synth));
    synth.resume();
    synth.speak(line);
    if (onPhone()) chain = true;
    startNudge(synth);
  };
  synth.cancel();
  if (onPhone()) say();
  else window.setTimeout(say, 80);
  if (!voice) {
    synth.addEventListener(
      'voiceschanged',
      () => {
        if (held === line && !synth.speaking && !stopped) say();
      },
      { once: true },
    );
  }
}

/** A later score on Match commentary. A phone keeps it until the current line ends. */
export function followScore(text: string) {
  if (!text || stopped) return;
  if (onPhone()) {
    if (!chain) return;
    const synth = window.speechSynthesis;
    if (synth && !synth.speaking && !synth.pending && !held) {
      speakChained(text, false);
      return;
    }
    queued = text;
    return;
  }
  speakScore(text);
}

export function stopScore() {
  stopped = true;
  chain = false;
  queued = null;
  held = null;
  window.clearInterval(nudge);
  window.speechSynthesis?.cancel();
}

/** A phone has already been allowed to keep speaking. A computer does not need that. */
export function speechUnlocked() {
  return !onPhone() || chain;
}
