/**
 * PDF AI Summarizer — Main Frontend Logic (Material 3 Edition)
 */

const API = 'http://localhost:8765/api';

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  pdfPath: null,
  pdfDoc: null,         // pdf.js PDFDocumentProxy
  pages: [],            // rendered canvas wrappers
  scale: 1.5,
  debounceTimer: null,
  debounceMs: 1500,
  currentSummaryId: null,
  isGenerating: false,
  lastVisiblePages: [],
  selectedFile: null,
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const ui = {
  welcomeScreen:   $('welcome-screen'),
  readerScreen:    $('reader-screen'),
  dropZone:        $('drop-zone'),
  pdfFileInput:    $('pdf-file-input'),
  pdfStatusText:   $('pdf-status-text'),
  sidecarZone:     $('sidecar-zone'),
  autoDetectToggle: $('auto-detect-toggle'),
  openWorkspaceBtn: $('open-workspace-btn'),
  ollamaStatusDot:  document.querySelector('#ollama-status .status-dot'),
  ollamaStatusText: document.querySelector('#ollama-status span'),
  welcomeError:    $('welcome-error'),
  
  backBtn:         $('back-btn'),
  docTitle:        $('doc-title'),
  pageIndicator:   $('page-indicator'),
  zoomInBtn:       $('zoom-in-btn'),
  zoomOutBtn:      $('zoom-out-btn'),
  zoomLevel:       $('zoom-level'),
  
  pdfViewport:     $('pdf-viewport'),
  pdfContainer:    $('pdf-container'),
  
  summaryIdle:     $('summary-idle'),
  summaryLoading:  $('summary-loading'),
  summaryContent:  $('summary-content'),
  summaryActions:  $('summary-actions'),
  summaryDeleted:  $('summary-deleted'),
  summaryPagesBadge: $('summary-pages-badge'),
  
  detailPanel:     $('detail-panel'),
  detailContent:   $('detail-content'),
  btnCloseDetail:  $('btn-close-detail'),
  
  btnRegenerate:   $('btn-regenerate'),
  btnDetail:       $('btn-detail'),
  btnDelete:       $('btn-delete'),
  btnRestore:      $('btn-restore'),
  
  modelNameLoading: $('model-name-loading'),
};

// ── Startup ───────────────────────────────────────────────────────────────
(async function init() {
  await checkOllamaStatus();
  await loadConfig();
  bindWelcomeEvents();
  bindReaderEvents();
})();

async function checkOllamaStatus() {
  try {
    const res = await fetch(`${API}/health`);
    const data = await res.json();

    if (data.ollama.running && data.ollama.model_available) {
      ui.ollamaStatusDot.className = 'status-dot w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_#cfbcff]';
      ui.ollamaStatusText.textContent = `Ollama ready · ${data.ollama.model}`;
    } else if (data.ollama.running) {
      ui.ollamaStatusDot.className = 'status-dot w-2 h-2 rounded-full bg-amber-500';
      ui.ollamaStatusText.textContent = `Model "${data.ollama.model}" not found`;
    } else {
      ui.ollamaStatusDot.className = 'status-dot w-2 h-2 rounded-full bg-error';
      ui.ollamaStatusText.textContent = 'Ollama not running';
    }
  } catch {
    ui.ollamaStatusDot.className = 'status-dot w-2 h-2 rounded-full bg-error';
    ui.ollamaStatusText.textContent = 'Backend unreachable';
  }
}

async function loadConfig() {
  try {
    const res  = await fetch(`${API}/config`);
    const conf = await res.json();
    if (ui.modelNameLoading) ui.modelNameLoading.textContent = conf.model || 'Ollama';
    state.debounceMs = conf.debounce_ms || 1500;
  } catch {}
}

// ── Welcome Screen Events ─────────────────────────────────────────────────
function bindWelcomeEvents() {
  ui.dropZone.addEventListener('click', () => ui.pdfFileInput.click());
  
  ui.pdfFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      state.selectedFile = file;
      ui.pdfStatusText.textContent = file.name;
      ui.pdfStatusText.classList.remove('text-on-surface-variant');
      ui.pdfStatusText.classList.add('text-primary', 'font-medium');
      ui.openWorkspaceBtn.disabled = false;
      ui.openWorkspaceBtn.classList.remove('opacity-50');
    }
  });

  ui.sidecarZone.addEventListener('click', () => {
    alert('Sidecar attachment is currently managed automatically by the backend based on the PDF filename.');
  });

  ui.openWorkspaceBtn.addEventListener('click', () => {
    if (state.selectedFile) uploadAndOpen(state.selectedFile);
  });
}

function showWelcomeError(msg) {
  ui.welcomeError.textContent = msg;
  ui.welcomeError.classList.remove('hidden');
}
function hideWelcomeError() { ui.welcomeError.classList.add('hidden'); }

async function uploadAndOpen(file) {
  hideWelcomeError();
  const formData = new FormData();
  formData.append('file', file);
  try {
    ui.openWorkspaceBtn.disabled = true;
    ui.openWorkspaceBtn.textContent = 'Opening...';
    
    const res  = await fetch(`${API}/upload-pdf`, { method: 'POST', body: formData });
    const data = await res.json();
    await openPdfByPath(data.temp_path, file.name);
  } catch (e) {
    showWelcomeError('Upload failed: ' + e.message);
    ui.openWorkspaceBtn.disabled = false;
    ui.openWorkspaceBtn.textContent = 'Open Workspace';
  }
}

async function openPdfByPath(pdfPath, displayName) {
  try {
    const res  = await fetch(`${API}/open-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf_path: pdfPath }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to open PDF');
    }
    const data = await res.json();
    state.pdfPath = pdfPath;

    ui.docTitle.textContent = displayName || pdfPath.split(/[\\/]/).pop();

    // Transition to reader
    ui.welcomeScreen.classList.remove('active');
    ui.readerScreen.classList.add('active');

    // Load pdf.js rendering
    await loadPdfJs(`http://localhost:8765/pdf-file`);

  } catch (e) {
    showWelcomeError(e.message);
  }
}

// ── pdf.js Rendering ──────────────────────────────────────────────────────
async function loadPdfJs(url) {
  ui.pdfContainer.innerHTML = '';
  state.pages = [];

  const loadingTask = pdfjsLib.getDocument(url);
  state.pdfDoc = await loadingTask.promise;

  const total = state.pdfDoc.numPages;
  for (let i = 1; i <= total; i++) {
    const page    = await state.pdfDoc.getPage(i);
    const wrapper = createPageCanvas(page, i);
    ui.pdfContainer.appendChild(wrapper);
    state.pages.push(wrapper);
  }
  updatePageIndicator();
}

function createPageCanvas(page, pageNum) {
  const viewport = page.getViewport({ scale: state.scale });
  const wrapper  = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.dataset.page = pageNum;
  wrapper.style.width  = viewport.width + 'px';
  wrapper.style.height = viewport.height + 'px';

  const canvas  = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  wrapper.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  page.render({ canvasContext: ctx, viewport });

  return wrapper;
}

// ── Zoom ──────────────────────────────────────────────────────────────────
async function setZoom(newScale) {
  state.scale = Math.max(0.5, Math.min(3.0, newScale));
  ui.zoomLevel.textContent = Math.round(state.scale * 100 / 1.5 * 100) + '%';
  if (!state.pdfDoc) return;
  ui.pdfContainer.innerHTML = '';
  state.pages = [];
  const total = state.pdfDoc.numPages;
  for (let i = 1; i <= total; i++) {
    const page    = await state.pdfDoc.getPage(i);
    const wrapper = createPageCanvas(page, i);
    ui.pdfContainer.appendChild(wrapper);
    state.pages.push(wrapper);
  }
}

// ── Reader Events ─────────────────────────────────────────────────────────
function bindReaderEvents() {
  ui.backBtn.addEventListener('click', goToWelcome);

  ui.zoomInBtn.addEventListener('click',  () => setZoom(state.scale + 0.25));
  ui.zoomOutBtn.addEventListener('click', () => setZoom(state.scale - 0.25));

  ui.pdfViewport.addEventListener('scroll', onScroll, { passive: true });

  ui.btnRegenerate.addEventListener('click', onRegenerate);
  ui.btnDetail.addEventListener('click',     onExplainDetail);
  ui.btnDelete.addEventListener('click',     onDeleteSummary);
  ui.btnRestore.addEventListener('click',    onRestoreDeleted);
  ui.btnCloseDetail.addEventListener('click', () => { ui.detailPanel.classList.add('hidden'); });
}

function goToWelcome() {
  ui.readerScreen.classList.remove('active');
  ui.welcomeScreen.classList.add('active');
  state.pdfPath = null;
  state.pdfDoc  = null;
  state.pages   = [];
  ui.pdfContainer.innerHTML = '';
  ui.openWorkspaceBtn.disabled = false;
  ui.openWorkspaceBtn.textContent = 'Open Workspace';
  showSummaryState('idle');
  checkOllamaStatus();
}

// ── Scroll & Viewport Detection ───────────────────────────────────────────
function onScroll() {
  updatePageIndicator();
  clearTimeout(state.debounceTimer);
  if (state.isGenerating) return;
  state.debounceTimer = setTimeout(triggerSummarize, state.debounceMs);
}

function updatePageIndicator() {
  const viewportRect = ui.pdfViewport.getBoundingClientRect();
  let currentPage = 1;
  for (const wrapper of state.pages) {
    const rect = wrapper.getBoundingClientRect();
    if (rect.top < viewportRect.top + viewportRect.height / 2) {
      currentPage = parseInt(wrapper.dataset.page);
    }
  }
  ui.pageIndicator.textContent = `Page ${currentPage} of ${state.pages.length}`;
}

function getVisiblePageNums() {
  const viewportRect = ui.pdfViewport.getBoundingClientRect();
  const visible = [];
  for (const wrapper of state.pages) {
    const rect = wrapper.getBoundingClientRect();
    const pageNum = parseInt(wrapper.dataset.page) - 1; // 0-indexed
    if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
      visible.push(pageNum);
    }
  }
  return visible;
}

async function triggerSummarize() {
  const visiblePages = getVisiblePageNums();
  if (!visiblePages.length) return;

  const key = visiblePages.join(',');
  if (key === state.lastVisiblePages.join(',')) return;
  state.lastVisiblePages = visiblePages;

  const scrollOffsetTop = ui.pdfViewport.scrollTop;
  const startP = visiblePages[0] + 1;
  const endP   = visiblePages[visiblePages.length - 1] + 1;
  
  state.isGenerating = true;
  showSummaryState('loading');

  try {
    const res  = await fetch(`${API}/summarize-viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visible_pages: visiblePages,
        scroll_offset_top: scrollOffsetTop,
      }),
    });
    const data = await res.json();

    if (data.deleted) {
      state.currentSummaryId = data.summary_id;
      showSummaryState('deleted');
    } else if (data.summary) {
      renderSummaryCard(data.summary, data.from_cache);
    } else {
      showSummaryState('idle');
    }
  } catch (e) {
    console.error('Summarize error:', e);
    showSummaryState('idle');
  } finally {
    state.isGenerating = false;
  }
}

// ── Summary Card ──────────────────────────────────────────────────────────
function renderSummaryCard(summary, fromCache) {
  state.currentSummaryId = summary.id;

  const s = summary.start_page;
  const e = summary.end_page;
  ui.summaryPagesBadge.textContent = s === e ? `Page ${s}` : `Pages ${s}–${e}`;

  ui.summaryContent.innerHTML = renderMarkdown(summary.markdown);
  ui.detailPanel.classList.add('hidden');

  showSummaryState('card');
}

function showSummaryState(which) {
  ui.summaryIdle.classList.toggle('hidden', which !== 'idle');
  ui.summaryLoading.classList.toggle('hidden', which !== 'loading');
  ui.summaryContent.classList.toggle('hidden', which !== 'card');
  ui.summaryActions.classList.toggle('hidden', which !== 'card');
  ui.summaryDeleted.classList.toggle('hidden', which !== 'deleted');

  if (which !== 'card') ui.detailPanel.classList.add('hidden');
}

// ── Button Handlers ───────────────────────────────────────────────────────
async function onRegenerate() {
  if (!state.currentSummaryId || state.isGenerating) return;
  state.isGenerating = true;
  showSummaryState('loading');
  try {
    const res  = await fetch(`${API}/regenerate-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary_id: state.currentSummaryId }),
    });
    const data = await res.json();
    renderSummaryCard(data.summary, false);
  } catch (e) {
    console.error(e);
    showSummaryState('idle');
  } finally {
    state.isGenerating = false;
  }
}

async function onExplainDetail() {
  if (!state.currentSummaryId || state.isGenerating) return;
  ui.detailContent.innerHTML = '<div class="p-8 text-center text-on-surface-variant">Generating detailed explanation…</div>';
  ui.detailPanel.classList.remove('hidden');
  try {
    const res  = await fetch(`${API}/explain-detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary_id: state.currentSummaryId }),
    });
    const data = await res.json();
    ui.detailContent.innerHTML = renderMarkdown(data.detailed_markdown);
  } catch (e) {
    ui.detailContent.innerHTML = '<p class="text-error p-8">Error generating explanation.</p>';
  }
}

async function onDeleteSummary() {
  if (!state.currentSummaryId) return;
  try {
    await fetch(`${API}/delete-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary_id: state.currentSummaryId }),
    });
    showSummaryState('deleted');
  } catch (e) {
    console.error(e);
  }
}

async function onRestoreDeleted() {
  if (!state.currentSummaryId || state.isGenerating) return;
  state.isGenerating = true;
  showSummaryState('loading');
  try {
    const res  = await fetch(`${API}/regenerate-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary_id: state.currentSummaryId }),
    });
    const data = await res.json();
    renderSummaryCard(data.summary, false);
  } catch (e) {
    showSummaryState('idle');
  } finally {
    state.isGenerating = false;
  }
}
