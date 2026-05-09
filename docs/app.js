/**
 * PDF AI Summarizer - Static GitHub Pages Version
 */

const state = {
    pdfDoc: null,
    pages: [],           // wrapper divs
    scale: 1.5,
    BASE_SCALE: 1.5,
    pdfData: null,
    fileName: '',
    debounceTimer: null,
    debounceMs: 1500,
    lastVisiblePages: [],
    deletedSections: new Set(),
    summaries: {},       // { "1,2": "Summary text..." }
    currentTab: 'active', // 'active' or 'library'
    isEditing: false,
    darkMode: false,
    autoGenerate: true,
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const ui = {
    launchScreen:     document.getElementById('launch-screen'),
    workspaceScreen:  document.getElementById('workspace-screen'),
    btnSelectPdf:     document.getElementById('btn-select-pdf'),
    pdfFileInput:     document.getElementById('pdf-file-input'),
    pdfStatusText:    document.getElementById('pdf-status-text'),
    btnSelectSidecar: document.getElementById('btn-select-sidecar'),
    sidecarFileInput: document.getElementById('sidecar-file-input'),
    sidecarStatusText: document.getElementById('sidecar-status-text'),
    btnOpenWorkspace: document.getElementById('btn-open-workspace'),

    btnBack:      document.getElementById('btn-back'),
    docTitle:     document.getElementById('doc-title'),

    pdfViewport:  document.getElementById('pdf-viewport'),
    pdfContainer: document.getElementById('pdf-container'),
    pageInput:    document.getElementById('page-input'),
    pageTotal:    document.getElementById('page-total'),
    btnPagePrev:  document.getElementById('btn-page-prev'),
    btnPageNext:  document.getElementById('btn-page-next'),
    btnZoomIn:    document.getElementById('btn-zoom-in'),
    btnZoomOut:   document.getElementById('btn-zoom-out'),
    zoomLevel:    document.getElementById('zoom-level'),
    btnCopyText:  document.getElementById('btn-copy-text'),
    btnDarkMode:  document.getElementById('btn-dark-mode'),

    summaryView:    document.getElementById('summary-view'),
    summaryIdle:    document.getElementById('summary-idle'),
    summaryDeleted: document.getElementById('summary-deleted'),
    summaryContent: document.getElementById('summary-content'),
    summaryPagesBadge: document.getElementById('summary-pages-badge'),

    btnRegenerate: document.getElementById('btn-regenerate'),
    btnDelete:     document.getElementById('btn-delete'),
    btnRestore:    document.getElementById('btn-restore'),

    btnSettingsOpen:   document.getElementById('btn-settings-open'),
    aiStatusBadge:     document.getElementById('ai-status-badge'),
    btnCloseSettings:  document.getElementById('btn-close-settings'),
    settingsModal:     document.getElementById('settings-modal'),
    btnSaveSettings:   document.getElementById('btn-save-settings'),

    aiProviderSelect: document.getElementById('ai-provider-select'),
    aiApiKey:         document.getElementById('ai-api-key'),
    aiModel:          document.getElementById('ai-model'),
    aiBaseUrl:        document.getElementById('ai-base-url'),
    aiLanguage:       document.getElementById('ai-language'),
    apiKeyContainer:  document.getElementById('api-key-container'),
    baseUrlContainer: document.getElementById('base-url-container'),

    inlineProviderSelect: document.getElementById('inline-ai-provider'),
    inlineModel:          document.getElementById('inline-ai-model'),
    inlineApiKey:         document.getElementById('inline-ai-api-key'),
    inlineApiKeyLabel:    document.getElementById('inline-api-key-label'),
    inlineLanguage:       document.getElementById('inline-ai-language'),
    btnToggleApiVisibility: document.getElementById('btn-toggle-api-visibility'),
    btnDownloadMd:         document.getElementById('btn-download-md'),

    tabBtnActive:  document.getElementById('tab-btn-active'),
    tabBtnLibrary: document.getElementById('tab-btn-library'),
    libraryCountBadge: document.getElementById('library-count-badge'),
    libraryView:   document.getElementById('library-view'),
    libraryList:   document.getElementById('library-list'),
    summaryEditor: document.getElementById('summary-editor'),
    btnToggleEdit: document.getElementById('btn-toggle-edit'),
    
    // Manual + Text Explain
    toggleAutoGenerate: document.getElementById('toggle-auto-generate'),
    summaryManual: document.getElementById('summary-manual'),
    btnManualGenerate: document.getElementById('btn-manual-generate'),
    explanationModal: document.getElementById('explanation-modal'),
    explanationContent: document.getElementById('explanation-content'),
    btnCloseExplanation: document.getElementById('btn-close-explanation'),
    selectionTooltip: document.getElementById('selection-tooltip')
};

// ── Init ──────────────────────────────────────────────────────────────────
function init() {
    bindEvents();
    loadSettingsUI();
}

// ── Settings helpers ───────────────────────────────────────────────────────
function loadSettingsUI() {
    if (!window.aiClient) return;
    
    // Modal
    ui.aiProviderSelect.value = window.aiClient.provider;
    ui.aiApiKey.value = window.aiClient.apiKey;
    ui.aiModel.value = window.aiClient.model;
    ui.aiBaseUrl.value = window.aiClient.baseUrl;
    if (ui.aiLanguage) ui.aiLanguage.value = window.aiClient.language || 'en';
    
    // Inline
    if (ui.inlineProviderSelect) {
        ui.inlineProviderSelect.value = window.aiClient.provider;
        ui.inlineModel.value = window.aiClient.model;
        if (window.aiClient.provider === 'ollama') {
            ui.inlineApiKey.value = window.aiClient.baseUrl;
            ui.inlineApiKey.disabled = false;
            ui.inlineApiKey.type = 'text';
            ui.inlineApiKeyLabel.textContent = 'Base URL';
        } else {
            ui.inlineApiKey.value = ''; // Always empty on load for security
            ui.inlineApiKey.disabled = false;
            ui.inlineApiKey.type = 'password';
            ui.inlineApiKeyLabel.textContent = 'API Key';
        }
        if (ui.inlineLanguage) ui.inlineLanguage.value = window.aiClient.language || 'en';
    }
    
    toggleSettingsFields();
    updateAiBadge();
}

function updateAiBadge() {
    if (!window.aiClient || !ui.aiStatusBadge) return;
    const names = { ollama:'Ollama', gemini:'Gemini', openai:'OpenAI', claude:'Claude', grok:'Grok' };
    const p = names[window.aiClient.provider] || window.aiClient.provider;
    ui.aiStatusBadge.textContent = `${p}: ${window.aiClient.model}`;
}

function toggleSettingsFields() {
    const provider = ui.aiProviderSelect.value;
    const isOllama = provider === 'ollama';
    
    // Model field is always visible
    
    // API Key vs Base URL logic
    ui.apiKeyContainer.classList.toggle('hidden', isOllama);
    ui.baseUrlContainer.classList.toggle('hidden', !isOllama);
}

// ── Events ────────────────────────────────────────────────────────────────
function bindEvents() {
    // Launch screen - PDF Upload
    const handlePdfFile = (file) => {
        if (!file || !file.name.toLowerCase().endsWith('.pdf')) return;
        state.fileName = file.name;
        ui.pdfStatusText.textContent = file.name;
        ui.pdfStatusText.classList.replace('text-on-surface-variant', 'text-primary');
        ui.pdfStatusText.classList.add('font-medium');
        ui.btnOpenWorkspace.disabled = false;
        const reader = new FileReader();
        reader.onload = (evt) => { state.pdfData = new Uint8Array(evt.target.result); };
        reader.readAsArrayBuffer(file);
    };

    ui.btnSelectPdf.addEventListener('click', () => ui.pdfFileInput.click());
    ui.pdfFileInput.addEventListener('change', (e) => handlePdfFile(e.target.files[0]));

    // Drag and drop for PDF
    ui.btnSelectPdf.addEventListener('dragover', (e) => {
        e.preventDefault();
        ui.btnSelectPdf.classList.add('border-primary', 'bg-surface-container-high');
        ui.btnSelectPdf.classList.remove('border-outline-variant');
    });
    ui.btnSelectPdf.addEventListener('dragleave', (e) => {
        e.preventDefault();
        ui.btnSelectPdf.classList.remove('border-primary', 'bg-surface-container-high');
        ui.btnSelectPdf.classList.add('border-outline-variant');
    });
    ui.btnSelectPdf.addEventListener('drop', (e) => {
        e.preventDefault();
        ui.btnSelectPdf.classList.remove('border-primary', 'bg-surface-container-high');
        ui.btnSelectPdf.classList.add('border-outline-variant');
        if (e.dataTransfer.files.length) {
            ui.pdfFileInput.files = e.dataTransfer.files;
            handlePdfFile(e.dataTransfer.files[0]);
        }
    });

    // Launch screen - Sidecar Upload
    const handleSidecarFile = (file) => {
        if (!file) return;
        ui.sidecarStatusText.textContent = file.name;
        ui.sidecarStatusText.classList.replace('text-on-surface-variant', 'text-primary');
        ui.sidecarStatusText.classList.add('font-medium');
    };

    ui.btnSelectSidecar.addEventListener('click', () => ui.sidecarFileInput.click());
    ui.sidecarFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        handleSidecarFile(file);
        
        const reader = new FileReader();
        reader.onload = (evt) => {
            const content = evt.target.result;
            let loadedSummaries = null;

            if (file.name.endsWith('.json')) {
                try {
                    const data = JSON.parse(content);
                    loadedSummaries = data.summaries || data;
                    if (typeof loadedSummaries !== 'object' || Array.isArray(loadedSummaries)) {
                        throw new Error('Invalid JSON structure. Expected an object mapping page ranges to text.');
                    }
                } catch (err) { 
                    alert(`Error parsing JSON: ${err.message}`);
                    console.error('Failed to parse JSON sidecar', err); 
                }
            } else if (file.name.endsWith('.md')) {
                loadedSummaries = parseMarkdownSidecar(content);
                if (Object.keys(loadedSummaries).length === 0) {
                    alert("No valid research sections found in the Markdown file. \n\nEnsure your file uses '## Pages X-Y' headers to mark summarized sections.");
                    loadedSummaries = null;
                }
            }

            if (loadedSummaries) {
                state.summaries = loadedSummaries;
                console.log('Sidecar loaded successfully:', state.summaries);
                // If already in workspace, refresh
                if (ui.workspaceScreen.classList.contains('active')) {
                    renderLibrary();
                }
            }
        };
        reader.readAsText(file);
    });

    // Drag and drop for Sidecar
    ui.btnSelectSidecar.addEventListener('dragover', (e) => {
        e.preventDefault();
        ui.btnSelectSidecar.classList.add('border-primary', 'bg-surface-container-high');
        ui.btnSelectSidecar.classList.remove('border-outline-variant');
    });
    ui.btnSelectSidecar.addEventListener('dragleave', (e) => {
        e.preventDefault();
        ui.btnSelectSidecar.classList.remove('border-primary', 'bg-surface-container-high');
        ui.btnSelectSidecar.classList.add('border-outline-variant');
    });
    ui.btnSelectSidecar.addEventListener('drop', (e) => {
        e.preventDefault();
        ui.btnSelectSidecar.classList.remove('border-primary', 'bg-surface-container-high');
        ui.btnSelectSidecar.classList.add('border-outline-variant');
        if (e.dataTransfer.files.length) {
            ui.sidecarFileInput.files = e.dataTransfer.files;
            handleSidecarFile(e.dataTransfer.files[0]);
        }
    });

    ui.btnOpenWorkspace.addEventListener('click', () => { if (state.pdfData) openWorkspace(); });

    // Workspace back
    ui.btnBack.addEventListener('click', () => {
        ui.workspaceScreen.classList.remove('active');
        ui.launchScreen.classList.add('active');
        state.pdfData = null;
        state.pdfDoc = null;
        state.summaries = {};
        state.deletedSections.clear();
        state.lastVisiblePages = [];
        state.pages = [];
        ui.pdfContainer.innerHTML = '';
        ui.btnOpenWorkspace.disabled = true;
        ui.pdfStatusText.textContent = 'Upload primary research document';
        ui.pdfStatusText.classList.replace('text-primary', 'text-on-surface-variant');
        ui.pdfStatusText.classList.remove('font-medium');
        ui.pdfFileInput.value = '';
        closeSearch();
    });

    // Scroll
    ui.pdfViewport.addEventListener('scroll', onScroll, { passive: true });

    // Zoom
    ui.btnZoomIn.addEventListener('click',  () => setZoom(state.scale + 0.25));
    ui.btnZoomOut.addEventListener('click', () => setZoom(state.scale - 0.25));

    // Page nav
    ui.btnPagePrev.addEventListener('click', () => goToPage(currentPageNum() - 1));
    ui.btnPageNext.addEventListener('click', () => goToPage(currentPageNum() + 1));
    ui.pageInput.addEventListener('change', () => {
        const n = parseInt(ui.pageInput.value);
        if (n >= 1 && n <= state.pages.length) goToPage(n);
    });
    ui.pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.pageInput.dispatchEvent(new Event('change')); });

    // Copy visible text
    ui.btnCopyText.addEventListener('click', copyVisibleText);

    // Dark mode
    ui.btnDarkMode.addEventListener('click', () => {
        state.darkMode = !state.darkMode;
        ui.pdfContainer.classList.toggle('pdf-dark-mode', state.darkMode);
        const icon = ui.btnDarkMode.querySelector('span');
        icon.textContent = state.darkMode ? 'light_mode' : 'dark_mode';
        icon.classList.toggle('text-primary', state.darkMode);
    });

    // Summary actions
    ui.btnDelete.addEventListener('click', () => {
        const key = state.lastVisiblePages.join(',');
        state.deletedSections.add(key);
        delete state.summaries[key];
        renderLibrary();
        showSummaryState('deleted');
    });
    ui.btnRestore.addEventListener('click', () => {
        state.deletedSections.delete(state.lastVisiblePages.join(','));
        triggerSummarize(true);
    });
    ui.btnRegenerate.addEventListener('click', () => triggerSummarize(true));
    const btnForceRegen = document.getElementById('btn-force-regenerate');
    if (btnForceRegen) {
        btnForceRegen.addEventListener('click', () => {
            state.deletedSections.delete(state.lastVisiblePages.join(','));
            triggerSummarize(true);
        });
    }
    if (ui.btnDownloadMd) ui.btnDownloadMd.addEventListener('click', downloadAnalysisMd);

    // Settings Modal
    const openSettings = () => {
        loadSettingsUI();
        ui.settingsModal.classList.remove('hidden');
        // Must remove opacity-0 AND add opacity-100 for transition to work
        setTimeout(() => {
            ui.settingsModal.classList.remove('opacity-0');
            ui.settingsModal.classList.add('opacity-100');
        }, 10);
    };

    ui.btnToggleApiVisibility.addEventListener('click', () => {
        const type = ui.aiApiKey.type === 'password' ? 'text' : 'password';
        ui.aiApiKey.type = type;
        ui.btnToggleApiVisibility.querySelector('span').textContent = type === 'password' ? 'visibility' : 'visibility_off';
    });
    if (ui.btnSettingsOpen)  ui.btnSettingsOpen.addEventListener('click', openSettings);

    ui.btnCloseSettings.addEventListener('click', closeSettingsModal);
    ui.settingsModal.addEventListener('click', (e) => { if (e.target === ui.settingsModal) closeSettingsModal(); });

    ui.aiProviderSelect.addEventListener('change', () => {
        toggleSettingsFields();
        const defaults = { ollama:'llama3', gemini:'gemini-2.5-flash', openai:'gpt-4o-mini', claude:'claude-sonnet-4-6', grok:'grok-3-mini' };
        ui.aiModel.value = defaults[ui.aiProviderSelect.value] || '';
        if (ui.aiProviderSelect.value === 'ollama') {
            ui.aiBaseUrl.value = 'http://localhost:11434';
        }
    });

    ui.btnSaveSettings.addEventListener('click', () => {
        const lang = ui.aiLanguage ? ui.aiLanguage.value : undefined;
        window.aiClient.saveSettings(ui.aiProviderSelect.value, ui.aiApiKey.value, ui.aiModel.value, ui.aiBaseUrl.value, lang);
        closeSettingsModal();
        updateAiBadge();
        if (ui.inlineProviderSelect) loadSettingsUI(); // Sync inline
        if (ui.workspaceScreen.classList.contains('active')) triggerSummarize(true);
    });
    
    // Inline Settings sync
    if (ui.inlineProviderSelect) {
        ui.inlineProviderSelect.addEventListener('change', () => {
            const p = ui.inlineProviderSelect.value;
            const defaults = { ollama:'llama3', gemini:'gemini-2.5-flash', openai:'gpt-4o-mini', claude:'claude-sonnet-4-6', grok:'grok-3-mini' };
            ui.inlineModel.value = defaults[p] || '';
            
            if (p === 'ollama') {
                ui.inlineApiKey.value = window.aiClient.baseUrl || 'http://localhost:11434';
                ui.inlineApiKey.disabled = false;
                ui.inlineApiKey.type = 'text';
                ui.inlineApiKeyLabel.textContent = 'Base URL';
            } else {
                ui.inlineApiKey.value = '';
                ui.inlineApiKey.disabled = false;
                ui.inlineApiKey.type = 'password';
                ui.inlineApiKeyLabel.textContent = 'API Key';
            }
            saveInlineSettings();
        });
        ui.inlineModel.addEventListener('change', saveInlineSettings);
        ui.inlineApiKey.addEventListener('change', saveInlineSettings);
        if (ui.inlineLanguage) ui.inlineLanguage.addEventListener('change', saveInlineSettings);
    }

    // Tab switching
    ui.tabBtnActive.addEventListener('click', () => switchTab('active'));
    ui.tabBtnLibrary.addEventListener('click', () => switchTab('library'));

    // Editor logic
    ui.summaryEditor.addEventListener('input', () => {
        const key = state.lastVisiblePages.join(',');
        if (key) {
            state.summaries[key] = ui.summaryEditor.value;
            renderLibrary();
        }
    });

    ui.btnToggleEdit.addEventListener('click', () => {
        state.isEditing = !state.isEditing;
        updateEditorVisibility();
    });

    // Auto-generate toggle
    if (ui.toggleAutoGenerate) {
        ui.toggleAutoGenerate.addEventListener('change', (e) => {
            state.autoGenerate = e.target.checked;
            if (state.autoGenerate && state.lastVisiblePages.length > 0) {
                triggerSummarize(); // generate immediately if turned on
            }
        });
    }

    if (ui.btnManualGenerate) {
        ui.btnManualGenerate.addEventListener('click', () => triggerSummarize(true));
    }

    // Text Selection Explanation
    document.addEventListener('selectionchange', () => {
        if (!ui.workspaceScreen.classList.contains('active') || !ui.selectionTooltip) return;
        
        const selection = window.getSelection();
        const text = selection.toString().trim();
        
        if (text.length > 5 && selection.rangeCount > 0) {
            let node = selection.anchorNode;
            let inPdf = false;
            while(node) {
                if (node.id === 'pdf-viewport') { inPdf = true; break; }
                node = node.parentNode;
            }
            
            if (inPdf) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                
                ui.selectionTooltip.style.left = (rect.left + rect.width / 2) + 'px';
                ui.selectionTooltip.style.top = (rect.top - 5) + 'px';
                ui.selectionTooltip.classList.remove('hidden');
                ui.selectionTooltip.dataset.text = text;
                return;
            }
        }
        ui.selectionTooltip.classList.add('hidden');
    });

    if (ui.selectionTooltip) {
        ui.selectionTooltip.addEventListener('mousedown', async function(e) {
            e.preventDefault(); // Prevent text selection from clearing immediately
            e.stopPropagation();
            
            const text = this.dataset.text;
            this.classList.add('hidden');
            window.getSelection().removeAllRanges();
            
            ui.explanationModal.classList.remove('hidden');
            setTimeout(() => ui.explanationModal.classList.remove('opacity-0'), 10);
            
            ui.explanationContent.innerHTML = `<div class="flex flex-col items-center justify-center p-xl gap-md text-on-surface-variant">
                <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p>Analyzing selection with <strong class="text-primary">${window.aiClient ? window.aiClient.provider : 'AI'}</strong>…</p>
            </div>`;
            
            try {
                const prompt = `Please explain the following text from a document in clear, concise terms:\n\n"${text}"`;
                const explanation = await window.aiClient.summarize(prompt);
                ui.explanationContent.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(explanation) : `<pre class="whitespace-pre-wrap text-sm">${explanation}</pre>`;
            } catch(err) {
                ui.explanationContent.innerHTML = `<div class="text-error p-md border border-error/30 rounded-DEFAULT bg-error-container/10">Error: ${err.message}</div>`;
            }
        });
    }

    if (ui.btnCloseExplanation) {
        ui.btnCloseExplanation.addEventListener('click', () => {
            ui.explanationModal.classList.add('opacity-0');
            setTimeout(() => ui.explanationModal.classList.add('hidden'), 200);
        });
    }
}

function switchTab(tab) {
    state.currentTab = tab;
    
    // Update Tab Styles (Image Match)
    ui.tabBtnActive.classList.toggle('border-[#cfbcff]', tab === 'active');
    ui.tabBtnActive.classList.toggle('text-[#cfbcff]', tab === 'active');
    ui.tabBtnActive.classList.toggle('text-white/50', tab !== 'active');
    ui.tabBtnActive.classList.toggle('border-transparent', tab !== 'active');

    ui.tabBtnLibrary.classList.toggle('border-[#cfbcff]', tab === 'library');
    ui.tabBtnLibrary.classList.toggle('text-[#cfbcff]', tab === 'library');
    ui.tabBtnLibrary.classList.toggle('text-white/50', tab !== 'library');
    ui.tabBtnLibrary.classList.toggle('border-transparent', tab !== 'library');

    if (tab === 'library') {
        ui.summaryView.classList.add('hidden');
        ui.summaryIdle.classList.add('hidden');
        ui.summaryDeleted.classList.add('hidden');
        ui.libraryView.classList.remove('hidden');
        renderLibrary();
    } else {
        ui.libraryView.classList.add('hidden');
        showSummaryState(state.lastVisiblePages.length ? 'view' : 'idle');
    }
}

function updateEditorVisibility() {
    const icon = ui.btnToggleEdit.querySelector('span');
    if (state.isEditing) {
        ui.summaryEditor.classList.remove('opacity-0', 'pointer-events-none');
        ui.summaryContent.classList.add('opacity-0', 'pointer-events-none');
        icon.textContent = 'visibility';
        ui.summaryEditor.focus();
    } else {
        ui.summaryEditor.classList.add('opacity-0', 'pointer-events-none');
        ui.summaryContent.classList.remove('opacity-0', 'pointer-events-none');
        icon.textContent = 'edit';
        // Refresh markdown view
        const key = state.lastVisiblePages.join(',');
        if (state.summaries[key]) {
            ui.summaryContent.innerHTML = renderSummaryContent(state.summaries[key]);
        }
    }
}

function renderLibrary() {
    const keys = Object.keys(state.summaries).sort((a, b) => parseInt(a) - parseInt(b));
    if (ui.libraryCountBadge) {
        ui.libraryCountBadge.textContent = keys.length;
        ui.libraryCountBadge.classList.toggle('hidden', keys.length === 0);
    }

    if (keys.length === 0) {
        ui.libraryList.innerHTML = `<div class="flex flex-col items-center justify-center h-full opacity-40 text-center p-xl gap-md">
            <span class="material-symbols-outlined text-display-lg">inventory_2</span>
            <p>Your research notes will appear here as you analyze the document.</p>
        </div>`;
        return;
    }

    ui.libraryList.innerHTML = '';
    keys.forEach(key => {
        const content = state.summaries[key];
        const startP = key.split(',')[0];
        const endP = key.split(',').pop();
        const label = startP === endP ? `Page ${startP}` : `Pages ${startP}–${endP}`;

        const card = document.createElement('div');
        card.className = 'bg-white/5 rounded-2xl p-lg border border-white/5 hover:border-[#cfbcff]/40 hover:bg-white/10 transition-all cursor-pointer group shadow-lg';
        card.innerHTML = `
            <div class="flex justify-between items-start mb-md">
                <span class="bg-[#cfbcff]/10 text-[#cfbcff] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border border-[#cfbcff]/20">${label}</span>
                <span class="material-symbols-outlined text-[18px] text-white/30 group-hover:text-[#cfbcff] transition-colors">arrow_forward</span>
            </div>
            <div class="text-sm text-white/60 line-clamp-4 leading-relaxed font-light">${escapeHtml(content.substring(0, 300))}${content.length > 300 ? '...' : ''}</div>
        `;
        card.addEventListener('click', () => {
            const pages = key.split(',').map(Number);
            goToPage(pages[0]);
            switchTab('active');
        });
        ui.libraryList.appendChild(card);
    });
}

function saveInlineSettings() {
    if (!window.aiClient || !ui.inlineProviderSelect) return;
    const p = ui.inlineProviderSelect.value;
    const m = ui.inlineModel.value;
    let ak = window.aiClient.apiKey;
    let base = window.aiClient.baseUrl;
    
    if (p === 'ollama') {
        base = ui.inlineApiKey.value || 'http://localhost:11434';
    } else {
        ak = ui.inlineApiKey.value;
    }
    window.aiClient.saveSettings(p, ak, m, base, ui.inlineLanguage ? ui.inlineLanguage.value : undefined);
    updateAiBadge();
}

function closeSettingsModal() {
    ui.settingsModal.classList.remove('opacity-100');
    ui.settingsModal.classList.add('opacity-0');
    setTimeout(() => ui.settingsModal.classList.add('hidden'), 200);
}

// ── Open workspace ─────────────────────────────────────────────────────────
async function openWorkspace() {
    ui.docTitle.textContent = state.fileName;
    ui.launchScreen.classList.remove('active');
    ui.workspaceScreen.classList.add('active');
    showSummaryState('idle');
    await loadPdfJs();
}

// ── PDF Rendering ──────────────────────────────────────────────────────────
let pageObserver = null;

function initObserver() {
    if (pageObserver) pageObserver.disconnect();
    pageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const wrapper = entry.target;
                if (!wrapper.dataset.rendered) {
                    wrapper.dataset.rendered = "true";
                    lazyRenderPageContent(wrapper);
                }
            }
        });
    }, { root: ui.pdfViewport, rootMargin: '800px 0px' });
}

async function loadPdfJs() {
    ui.pdfContainer.innerHTML = '';
    state.pages = [];
    state.deletedSections.clear();
    state.lastVisiblePages = [];

    const loadingTask = pdfjsLib.getDocument({ data: state.pdfData });
    state.pdfDoc = await loadingTask.promise;

    const total = state.pdfDoc.numPages;
    ui.pageInput.max = total;
    ui.pageInput.value = 1;
    // Set dynamic width based on total pages (increased for readability)
    const charCount = total.toString().length;
    ui.pageInput.style.width = (charCount * 11 + 24) + 'px';
    if (ui.pageTotal) ui.pageTotal.textContent = `/ ${total}`;

    // Fast initial placeholders
    const page1 = await state.pdfDoc.getPage(1);
    const viewport1 = page1.getViewport({ scale: state.scale });
    const defaultWidth = viewport1.width;
    const defaultHeight = viewport1.height;

    initObserver();

    for (let i = 1; i <= total; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = i;
        wrapper.style.width  = defaultWidth + 'px';
        wrapper.style.height = defaultHeight + 'px';
        ui.pdfContainer.appendChild(wrapper);
        state.pages.push(wrapper);
        pageObserver.observe(wrapper);
    }
    updatePageIndicator();
    triggerSummarize();
}

async function lazyRenderPageContent(wrapper) {
    const pageNum = parseInt(wrapper.dataset.page);
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });

    // Correct exact dimensions
    wrapper.style.width  = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    // Canvas
    const canvas = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    wrapper.appendChild(canvas);
    page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise.catch(e => console.warn(e));

    // Text layer (transparent, selectable)
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
    wrapper.appendChild(textLayerDiv);

    try {
        const textContent = await page.getTextContent();
        // Use pdf.js built-in text layer renderer for proper positioning
        await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
            textDivs: [],
        }).promise;
    } catch (_) {
        // Older pdf.js API fallback
        try {
            const textContent = await page.getTextContent();
            for (const item of textContent.items) {
                if (!item.str) continue;
                const span = document.createElement('span');
                span.textContent = item.str;
                const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                const h  = Math.hypot(tx[2], tx[3]);
                span.style.left   = tx[4] + 'px';
                span.style.top    = (tx[5] - h) + 'px';
                span.style.fontSize = h + 'px';
                if (h > 0) span.style.transform = `scaleX(${tx[0] / h})`;
                textLayerDiv.appendChild(span);
            }
        } catch (e2) {
            console.warn('Text layer fallback failed', e2);
        }
    }
}

// ── Zoom ──────────────────────────────────────────────────────────────────
async function setZoom(newScale) {
    state.scale = Math.max(0.5, Math.min(4.0, newScale));
    const pct = Math.round((state.scale / state.BASE_SCALE) * 100);
    ui.zoomLevel.textContent = pct + '%';
    if (!state.pdfDoc) return;
    
    const scrollPct = ui.pdfViewport.scrollTop / ui.pdfViewport.scrollHeight;
    ui.pdfContainer.innerHTML = '';
    state.pages = [];
    
    const total = state.pdfDoc.numPages;
    const page1 = await state.pdfDoc.getPage(1);
    const viewport1 = page1.getViewport({ scale: state.scale });
    const defaultWidth = viewport1.width;
    const defaultHeight = viewport1.height;

    initObserver();

    for (let i = 1; i <= total; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = i;
        wrapper.style.width  = defaultWidth + 'px';
        wrapper.style.height = defaultHeight + 'px';
        ui.pdfContainer.appendChild(wrapper);
        state.pages.push(wrapper);
        pageObserver.observe(wrapper);
    }
    
    // Restore scroll position after DOM paints
    setTimeout(() => {
        ui.pdfViewport.scrollTop = scrollPct * ui.pdfViewport.scrollHeight;
    }, 0);
}

// ── Page navigation ────────────────────────────────────────────────────────
function currentPageNum() {
    return parseInt(ui.pageInput.value) || 1;
}

function goToPage(n) {
    if (!state.pdfDoc) return;
    const clamped = Math.max(1, Math.min(state.pages.length, n));
    ui.pageInput.value = clamped;
    const wrapper = state.pages[clamped - 1];
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Scroll & Viewport ──────────────────────────────────────────────────────
function onScroll() {
    updatePageIndicator();
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => triggerSummarize(false), state.debounceMs);
}

function updatePageIndicator() {
    if (!state.pages.length) return;
    const viewportRect = ui.pdfViewport.getBoundingClientRect();
    let currentPage = 1;
    for (const w of state.pages) {
        const r = w.getBoundingClientRect();
        if (r.top < viewportRect.top + viewportRect.height / 2) currentPage = parseInt(w.dataset.page);
    }
    if (ui.pageInput) ui.pageInput.value = currentPage;
}

function getVisiblePageNums() {
    const vr = ui.pdfViewport.getBoundingClientRect();
    return state.pages
        .filter(w => { const r = w.getBoundingClientRect(); return r.bottom > vr.top && r.top < vr.bottom; })
        .map(w => parseInt(w.dataset.page));
}

// ── Copy visible text ──────────────────────────────────────────────────────
async function copyVisibleText() {
    const visible = getVisiblePageNums();
    let text = '';
    for (const num of visible) {
        try {
            const page = await state.pdfDoc.getPage(num);
            const c = await page.getTextContent();
            text += c.items.map(i => i.str).join(' ') + '\n\n';
        } catch (_) {}
    }
    try {
        await navigator.clipboard.writeText(text.trim());
        const icon = ui.btnCopyText.querySelector('span');
        const orig = icon.textContent;
        icon.textContent = 'check';
        setTimeout(() => { icon.textContent = orig; }, 1500);
    } catch (_) {}
}

// ── Summarize ─────────────────────────────────────────────────────────────
async function triggerSummarize(force = false) {
    const visiblePages = getVisiblePageNums();
    if (!visiblePages.length) return;

    const key = visiblePages.join(',');
    if (!force && key === state.lastVisiblePages.join(',')) return;
    state.lastVisiblePages = visiblePages;

    if (state.deletedSections.has(key)) { showSummaryState('deleted'); return; }

    const startP = visiblePages[0];
    const endP   = visiblePages[visiblePages.length - 1];
    ui.summaryPagesBadge.textContent = startP === endP ? `Page ${startP}` : `Pages ${startP}–${endP}`;
    
    // Check cache: exact match or subset match
    let targetKey = key;
    let foundCached = false;
    
    if (!force) {
        if (state.summaries[key]) {
            foundCached = true;
        } else {
            // Check if visiblePages is completely covered by an existing summary
            for (const existingKey of Object.keys(state.summaries)) {
                const pagesInKey = existingKey.split(',').map(Number);
                const isCovered = visiblePages.every(p => pagesInKey.includes(p));
                if (isCovered) {
                    targetKey = existingKey;
                    foundCached = true;
                    break;
                }
            }
        }
    }

    if (foundCached) {
        // Update badge to reflect the actual cached summary range being shown
        const sP = targetKey.split(',')[0];
        const eP = targetKey.split(',').pop();
        ui.summaryPagesBadge.textContent = sP === eP ? `Page ${sP}` : `Pages ${sP}–${eP}`;
        
        ui.summaryEditor.value = state.summaries[targetKey];
        ui.summaryContent.innerHTML = renderSummaryContent(state.summaries[targetKey]);
        showSummaryState('view');
        renderLibrary();
        return;
    }

    if (!state.autoGenerate && !force) {
        showSummaryState('manual-prompt');
        return;
    }

    ui.summaryEditor.value = '';
    ui.summaryContent.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center p-xl gap-md text-on-surface-variant">
        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p>Generating analysis with <strong class="text-primary">${window.aiClient ? window.aiClient.provider : 'AI'}</strong>…</p>
    </div>`;
    showSummaryState('view');

    try {
        const rawText = await extractTextFromPages(visiblePages);
        if (!rawText.trim()) throw new Error('No text found on these pages (scanned PDF?)');
        const safeText = rawText.substring(0, 15000);
        const markdown = await window.aiClient.summarize(safeText);
        state.summaries[key] = markdown;
        ui.summaryEditor.value = markdown;
        ui.summaryContent.innerHTML = renderSummaryContent(markdown);
        renderLibrary();
    } catch (e) {
        ui.summaryContent.innerHTML = `<div class="text-error p-md border border-error/30 rounded-DEFAULT bg-error-container/10">
            <strong>Failed:</strong> ${escapeHtml(e.message)}
        </div>`;
    }
}

function renderSummaryContent(markdown) {
    return typeof renderMarkdown === 'function' ? renderMarkdown(markdown) : `<pre class="whitespace-pre-wrap text-sm">${markdown}</pre>`;
}

function parseMarkdownSidecar(md) {
    const sections = {};
    // Split by "## Page X" or "## Pages X-Y"
    const parts = md.split(/## Pages?\s+/i);
    parts.shift(); // Content before the first header is ignored
    
    for (const part of parts) {
        const lines = part.split('\n');
        const rangeStr = lines.shift().trim(); // First line after "## Pages " is the range
        const content = lines.join('\n').trim();
        
        if (rangeStr && content) {
            let key = '';
            // Case: "1-5"
            if (rangeStr.includes('-')) {
                const match = rangeStr.match(/(\d+)\s*-\s*(\d+)/);
                if (match) {
                    const start = parseInt(match[1]);
                    const end = parseInt(match[2]);
                    if (!isNaN(start) && !isNaN(end) && start <= end) {
                        key = Array.from({length: end - start + 1}, (_, i) => i + start).join(',');
                    }
                }
            } 
            // Case: "1" or "1, 2, 3"
            else {
                key = rangeStr.split(/[,&]/)
                    .map(n => n.trim())
                    .filter(n => n && !isNaN(parseInt(n)))
                    .join(',');
            }
            
            if (key) sections[key] = content;
        }
    }
    return sections;
}

function downloadAnalysisMd() {
    let md = `# CortexPDF Analysis: ${state.fileName}\n\n`;
    const sortedKeys = Object.keys(state.summaries).sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const key of sortedKeys) {
        const range = key.includes(',') ? `${key.split(',')[0]}-${key.split(',').pop()}` : key;
        md += `## Pages ${range}\n\n${state.summaries[key]}\n\n---\n\n`;
    }
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.fileName.replace('.pdf', '')}_analysis.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function extractTextFromPages(pageNums) {
    let text = '';
    for (const num of pageNums) {
        try {
            const page = await state.pdfDoc.getPage(num);
            const c = await page.getTextContent();
            text += c.items.map(i => i.str).join(' ') + '\n\n';
        } catch (_) {}
    }
    return text;
}

// ── Summary states ─────────────────────────────────────────────────────────
function showSummaryState(which) {
    if (state.currentTab === 'library') return;
    ui.summaryIdle.classList.toggle('hidden', which !== 'idle');
    ui.summaryView.classList.toggle('hidden', which !== 'view');
    if (ui.summaryManual) ui.summaryManual.classList.toggle('hidden', which !== 'manual-prompt');
    // summary-deleted needs display:flex, so toggle both hidden and flex
    ui.summaryDeleted.classList.toggle('hidden', which !== 'deleted');
    ui.summaryDeleted.classList.toggle('flex', which === 'deleted');
}

// ── closeSearch stub (referenced by back button, not yet implemented) ──────
function closeSearch() {
    // No-op: search bar feature not yet implemented
}

// ── HTML escaping utility ──────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Initialize
init();
