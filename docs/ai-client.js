/**
 * AI Client — Handles communication with multiple AI providers.
 * Supports: Ollama (local & remote), Google Gemini, Anthropic Claude, OpenAI, xAI Grok.
 * 
 * API keys are NEVER persisted — they are held in-memory only for the current session.
 */
class AIClient {
    constructor() {
        this.provider = localStorage.getItem('ai_provider') || 'ollama';
        this.apiKey = ''; // ALWAYS empty on start — session only, never saved
        this.model = localStorage.getItem('ai_model') || 'llama3';
        this.baseUrl = localStorage.getItem('ai_base_url') || 'https://your-remote-ollama.com';
        this.language = localStorage.getItem('ai_language') || 'en';
        this.timeoutMs = 120_000; // 2 minute timeout for all requests
    }

    /**
     * Persist non-sensitive settings to localStorage.
     * API key is kept in-memory only.
     */
    saveSettings(provider, apiKey, model, baseUrl, language) {
        this.provider = provider;
        this.apiKey = apiKey; // In-memory only — never touches localStorage
        this.model = model;
        this.baseUrl = baseUrl || this.baseUrl;
        if (language !== undefined) this.language = language;

        localStorage.setItem('ai_provider', provider);
        localStorage.setItem('ai_model', model);
        if (baseUrl) localStorage.setItem('ai_base_url', baseUrl);
        localStorage.setItem('ai_language', this.language);
    }

    /**
     * Main entry point — summarize a text chunk using the configured provider.
     */
    async summarize(text) {
        const langNames = {
            en: 'English', it: 'Italian', es: 'Spanish', fr: 'French',
            de: 'German', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese',
            ko: 'Korean', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
            nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tr: 'Turkish',
        };
        const langName = langNames[this.language] || this.language;
        const langInstruction = this.language && this.language !== 'en'
            ? ` Write the entire summary in ${langName}.`
            : '';

        const prompt = `You are a helpful AI assistant summarizing a section of a document. Provide a clean, structured summary in Markdown format. Keep it concise but cover all key points. Do not include introductory text like "Here is a summary", just provide the Markdown.${langInstruction}\n\nDocument Section:\n${text}`;

        switch (this.provider) {
            case 'ollama':
                return this._callOllama(prompt);
            case 'gemini':
                return this._callGemini(prompt);
            case 'claude':
                return this._callClaude(prompt);
            case 'openai':
                return this._callOpenAI(prompt);
            case 'grok':
                return this._callGrok(prompt);
            default:
                throw new Error(`Unknown AI provider: "${this.provider}"`);
        }
    }

    // ── Ollama (Local & Remote) ────────────────────────────────────────────
    async _callOllama(prompt) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const model = this.model || 'llama3';
        const baseUrl = this.baseUrl || 'https://your-remote-ollama.com';

        // Use /api/chat (recommended for instruction-tuned models)
        const res = await this._fetchWithTimeout(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
            }),
        });

        if (!res.ok) {
            const errText = await this._safeReadError(res);
            throw new Error(`Ollama error (${res.status}): ${errText}`);
        }

        const data = await res.json();

        // /api/chat returns { message: { role, content } }
        if (data.message && data.message.content) {
            return data.message.content;
        }

        // Fallback for /api/generate response shape
        if (data.response) {
            return data.response;
        }

        throw new Error('Ollama returned an unexpected response format.');
    }

    // ── Google Gemini ──────────────────────────────────────────────────────
    async _callGemini(prompt) {
        if (!this.apiKey) {
            throw new Error('Gemini requires an API key. Set it in Settings.');
        }

        const model = this.model || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

        const res = await this._fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 4096,
                },
            }),
        });

        if (!res.ok) {
            const errText = await this._safeReadError(res);
            throw new Error(`Gemini error (${res.status}): ${errText}`);
        }

        const data = await res.json();

        // Validate response structure
        if (!data.candidates || !data.candidates.length) {
            const blockReason = data.promptFeedback?.blockReason;
            if (blockReason) {
                throw new Error(`Gemini blocked the request: ${blockReason}`);
            }
            throw new Error('Gemini returned no candidates.');
        }

        const candidate = data.candidates[0];

        // Check for content filter
        if (candidate.finishReason === 'SAFETY') {
            throw new Error('Gemini blocked the response due to safety filters.');
        }

        if (!candidate.content || !candidate.content.parts || !candidate.content.parts.length) {
            throw new Error('Gemini returned an empty response.');
        }

        return candidate.content.parts[0].text;
    }

    // ── Anthropic Claude ───────────────────────────────────────────────────
    async _callClaude(prompt) {
        if (!this.apiKey) {
            throw new Error('Claude requires an API key. Set it in Settings.');
        }

        const model = this.model || 'claude-sonnet-4-6';

        const res = await this._fetchWithTimeout('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                // Required for direct browser→Anthropic requests (CORS)
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model,
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!res.ok) {
            const errText = await this._safeReadError(res);
            throw new Error(`Claude error (${res.status}): ${errText}`);
        }

        const data = await res.json();

        // Validate response
        if (!data.content || !data.content.length) {
            throw new Error('Claude returned an empty response.');
        }

        // Claude returns content as an array of blocks; find the text block
        const textBlock = data.content.find(b => b.type === 'text');
        if (!textBlock) {
            throw new Error('Claude response contained no text content.');
        }

        return textBlock.text;
    }

    // ── OpenAI ─────────────────────────────────────────────────────────────
    async _callOpenAI(prompt) {
        if (!this.apiKey) {
            throw new Error('OpenAI requires an API key. Set it in Settings.');
        }

        const model = this.model || 'gpt-4o-mini';

        const res = await this._fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!res.ok) {
            const errText = await this._safeReadError(res);
            throw new Error(`OpenAI error (${res.status}): ${errText}`);
        }

        const data = await res.json();

        if (!data.choices || !data.choices.length) {
            throw new Error('OpenAI returned no choices.');
        }

        return data.choices[0].message.content;
    }

    // ── xAI Grok ───────────────────────────────────────────────────────────
    async _callGrok(prompt) {
        if (!this.apiKey) {
            throw new Error('Grok requires an API key. Set it in Settings.');
        }

        const model = this.model || 'grok-3-mini';

        const res = await this._fetchWithTimeout('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!res.ok) {
            const errText = await this._safeReadError(res);
            throw new Error(`Grok error (${res.status}): ${errText}`);
        }

        const data = await res.json();

        if (!data.choices || !data.choices.length) {
            throw new Error('Grok returned no choices.');
        }

        return data.choices[0].message.content;
    }

    // ── Utilities ──────────────────────────────────────────────────────────

    /**
     * Fetch with an AbortController timeout.
     * Prevents requests from hanging indefinitely.
     */
    async _fetchWithTimeout(url, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`Request timed out after ${this.timeoutMs / 1000}s. Is the AI service running?`);
            }
            if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
                if (isLocal) {
                    throw new Error(`Cannot connect to local AI server at ${this.baseUrl}. Local instances often fail due to browser CORS policies. Please use a remote instance (e.g., via ngrok).`);
                } else {
                    throw new Error(`Cannot connect to AI server at ${this.baseUrl}. Is the remote server running and allowing CORS?`);
                }
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Safely read an error response body.
     * APIs return structured error JSON — extract the useful message.
     */
    async _safeReadError(res) {
        try {
            const body = await res.json();
            // { error: { message: "..." } } — Anthropic, OpenAI, Grok, Gemini
            if (body.error?.message) return body.error.message;
            // { error: "..." } — Ollama
            if (body.error && typeof body.error === 'string') return body.error;
            // { message: "..." } — some APIs
            if (body.message) return body.message;
            return JSON.stringify(body);
        } catch (_) {
            try {
                return await res.text();
            } catch (__) {
                return res.statusText || 'Unknown error';
            }
        }
    }
}

window.aiClient = new AIClient();
