// Dictée vocale (Web Speech API). Disponible sur Chrome/Android et Safari ; sinon le bouton est masqué
// et le micro du clavier du téléphone reste utilisable dans le champ.
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const voiceSupported = () => !!SR;

let rec = null;
let activeBtn = null;

export function stopVoice() {
  if (rec) { try { rec.stop(); } catch { /* ignore */ } }
}
export function toggleVoice(textarea, btn) {
  if (!SR) return;
  if (rec) { stopVoice(); return; }
  rec = new SR();
  rec.lang = 'fr-FR';
  rec.continuous = true;
  rec.interimResults = false;
  activeBtn = btn;
  btn.classList.add('live');
  btn.setAttribute('aria-pressed', 'true');
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const t = e.results[i][0].transcript.trim();
      if (!t) continue;
      textarea.value = (textarea.value.trim() ? textarea.value.replace(/\s*$/, '\n') : '') + t.charAt(0).toUpperCase() + t.slice(1);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  const end = () => {
    activeBtn?.classList.remove('live');
    activeBtn?.setAttribute('aria-pressed', 'false');
    rec = null; activeBtn = null;
  };
  rec.onend = end;
  rec.onerror = end;
  try { rec.start(); } catch { end(); }
}
