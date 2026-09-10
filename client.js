const API_BASE = (localStorage.getItem('viral_ai_api') || window.VIRAL_API_URL || 'http://localhost:8787').replace(/\/$/, '');
let apiFile = null;
let apiEdl = [];

function uiToast(message) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(window.__viralToast);
  window.__viralToast = setTimeout(() => { el.style.display = 'none'; }, 3000);
}
function uiFmt(s) {
  if (!Number.isFinite(Number(s))) return '00:00';
  s = Math.max(0, Number(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function setMetric(name, value) {
  const valueEl = document.querySelector(`#${name}Value`);
  const meterEl = document.querySelector(`#${name}Meter`);
  if (valueEl) valueEl.textContent = `${Math.round(value)}%`;
  if (meterEl) meterEl.style.width = `${Math.max(0, Math.min(100, value))}%`;
}
function renderApiEdl(edits, duration) {
  apiEdl = Array.isArray(edits) ? edits : [];
  const card = document.querySelector('#edlCard');
  const box = document.querySelector('#edl');
  const summary = document.querySelector('#edlSummary');
  const track = document.querySelector('#track');
  const head = document.querySelector('#head');
  if (!card || !box || !track || !duration) return;
  card.classList.remove('hidden');
  box.innerHTML = '';
  const kept = apiEdl.filter(x => String(x.action).toUpperCase() !== 'CUT').reduce((sum, x) => sum + Math.max(0, Number(x.end)-Number(x.start)), 0);
  if (summary) summary.textContent = `${apiEdl.length} decisions • keep ${uiFmt(kept)} • cut ${uiFmt(Math.max(0, duration-kept))}`;
  track.querySelectorAll('.clip').forEach(x => x.remove());
  apiEdl.forEach((s, i) => {
    const start = Math.max(0, Number(s.start) || 0);
    const end = Math.min(duration, Number(s.end) || start);
    if (end <= start) return;
    const cut = String(s.action).toUpperCase() === 'CUT';
    const clip = document.createElement('div');
    clip.className = `clip ${cut ? 'cut' : 'keep'}`;
    clip.style.left = `${1 + start / duration * 98}%`;
    clip.style.width = `${Math.max(.2, (end-start) / duration * 98)}%`;
    clip.title = `${uiFmt(start)} - ${uiFmt(end)} • ${cut ? 'CUT' : 'KEEP'}`;
    track.appendChild(clip);
    const row = document.createElement('div');
    row.className = 'editRow';
    row.innerHTML = `<div class="editTop"><b>${uiFmt(start)} → ${uiFmt(end)}</b><span class="${cut ? 'cutText' : 'keepText'}">${cut ? 'CUT' : 'KEEP'}</span></div><div class="editMeta">${String(s.reason || 'AI edit decision')} • confidence ${Math.round((Number(s.confidence) || .7) * 100)}%</div>`;
    row.onclick = () => { const video = document.querySelector('#video'); if (video && Number.isFinite(video.duration)) video.currentTime = start; uiToast(`${cut ? 'Cut' : 'Keep'} segment at ${uiFmt(start)}`); };
    box.appendChild(row);
  });
  if (head) track.appendChild(head);
}
function renderTranscriptPanel(transcript) {
  const panel = document.querySelector('#toolPanel');
  if (!panel) return;
  const text = typeof transcript === 'string' ? transcript : (transcript?.text || '');
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>Transcript</h3><div class="panelText" style="max-height:260px;overflow:auto;white-space:pre-wrap">${escapeHtml(text || 'No speech detected.')}</div>`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
async function checkBackend() {
  try {
    const r = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    return null;
  }
}
async function runRealAnalysis() {
  if (!apiFile) return uiToast('Import a video first');
  const video = document.querySelector('#video');
  const duration = Number(video?.duration || 0);
  if (!duration) return uiToast('Video is still loading');
  const analyze = document.querySelector('#analyze');
  const status = document.querySelector('#statusText');
  if (analyze) { analyze.disabled = true; analyze.textContent = 'Analyzing...'; }
  if (status) status.textContent = 'Uploading video • transcribing speech • building edit plan...';
  try {
    const health = await checkBackend();
    if (!health) throw new Error(`Backend unavailable at ${API_BASE}`);
    const form = new FormData();
    form.append('video', apiFile, apiFile.name);
    form.append('duration', String(duration));
    const response = await fetch(`${API_BASE}/api/analyze`, { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Analysis failed (${response.status})`);
    setMetric('hook', data.hook || 0);
    setMetric('pace', data.pacing || 0);
    setMetric('clarity', data.clarity || 0);
    const score = Math.round(Number(data.score) || 0);
    const scoreEl = document.querySelector('#score');
    const scoreText = document.querySelector('#scoreText');
    const ring = document.querySelector('#ring');
    if (scoreEl) scoreEl.textContent = score;
    if (scoreText) scoreText.textContent = data.engine === 'openai' ? 'AI analysis complete' : 'Backend analysis complete';
    if (ring) ring.style.background = `conic-gradient(var(--g) 0 ${score}%,#242833 ${score}% 100%)`;
    renderApiEdl(data.edits, duration);
    document.querySelector('#recommendations')?.classList.remove('hidden');
    const modelStatus = document.querySelector('#modelStatus');
    if (modelStatus) modelStatus.innerHTML = `AI engine: ${escapeHtml(data.engine || 'backend')}<br>${data.transcript ? 'Transcript + edit analysis ready.' : 'Edit analysis ready. Add an API key on the backend for transcription.'}`;
    if (status) status.textContent = 'Real backend analysis complete • Edit Decision List ready';
    renderTranscriptPanel(data.transcript);
    document.querySelector('#export').disabled = false;
    uiToast('Real AI analysis complete');
  } catch (error) {
    if (status) status.textContent = 'Backend connection needed for real AI analysis';
    uiToast(error.message || 'Backend analysis failed');
  } finally {
    if (analyze) { analyze.disabled = false; analyze.textContent = 'Analyze'; }
  }
}
function installBackendBridge() {
  const input = document.querySelector('#file');
  input?.addEventListener('change', e => { apiFile = e.target.files?.[0] || null; });
  const analyze = document.querySelector('#analyze');
  if (analyze) analyze.onclick = runRealAnalysis;
  const captions = document.querySelector('#captions');
  if (captions) captions.onclick = () => {
    if (window.__lastTranscript) renderTranscriptPanel(window.__lastTranscript);
    else uiToast('Run Analyze first to generate the transcript');
  };
  const apply = document.querySelector('#applyPlan');
  if (apply) apply.onclick = () => {
    if (!apiEdl.length) return uiToast('Run real analysis first');
    document.querySelector('#statusText').textContent = 'AI edit plan applied to preview • cuts highlighted on timeline';
    uiToast('Edit plan applied');
  };
}
window.addEventListener('DOMContentLoaded', installBackendBridge);
