/** Read a score aloud. Phones only speak from a tap, and Chrome drops a line that is cancelled and spoken in the same moment. */

let held: SpeechSynthesisUtterance | null = null;
let nudge = 0;

function onPhone() {
  const agent = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function englishVoice(synth: SpeechSynthesis) {
  const voices = synth.getVoices();
  return voices.find((voice) => voice.lang === 'en-GB') ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ?? null;
}

export function speakScore(text: string) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  const line = new SpeechSynthesisUtterance(text);
  line.lang = 'en-GB';
  line.rate = 0.95;
  const voice = englishVoice(synth);
  if (voice) line.voice = voice;
  held = line;
  const say = () => {
    if (held !== line) return;
    const chosen = englishVoice(synth);
    if (chosen) line.voice = chosen;
    synth.resume();
    synth.speak(line);
  };
  synth.cancel();
  if (onPhone()) say();
  else window.setTimeout(say, 80);
  if (!voice) {
    synth.addEventListener(
      'voiceschanged',
      () => {
        if (held === line && !synth.speaking) say();
      },
      { once: true },
    );
  }
  window.clearInterval(nudge);
  let ticks = 0;
  nudge = window.setInterval(() => {
    ticks += 1;
    if (ticks > 12 || (!synth.speaking && !synth.pending)) {
      window.clearInterval(nudge);
      return;
    }
    synth.pause();
    synth.resume();
  }, 4000);
}

export function stopScore() {
  window.clearInterval(nudge);
  held = null;
  window.speechSynthesis?.cancel();
}
