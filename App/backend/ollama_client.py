"""
Ollama client for local LLM inference.
All prompts are sent to the local Ollama API.
"""

import os
import httpx
from typing import Optional

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").strip()
if not OLLAMA_HOST.startswith("http"):
    OLLAMA_HOST = f"http://{OLLAMA_HOST}"
# 0.0.0.0 is a bind address, not a valid connect target — replace with 127.0.0.1
OLLAMA_HOST = OLLAMA_HOST.replace("://0.0.0.0", "://127.0.0.1")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
SUMMARY_LANGUAGE = os.getenv("SUMMARY_LANGUAGE", "English")

print(f"[Ollama Config] OLLAMA_HOST={OLLAMA_HOST!r}  MODEL={OLLAMA_MODEL!r}  LANG={SUMMARY_LANGUAGE!r}")

# Timeout for the Ollama API (streaming response can be slow)
TIMEOUT_SECONDS = 120.0


async def _chat(prompt: str) -> str:
    """
    Send a prompt to Ollama and return the full response text.
    Uses the /api/generate endpoint (non-streaming for simplicity).
    """
    url = f"{OLLAMA_HOST}/api/generate"
    print(f"[Ollama] POST {url}  model={OLLAMA_MODEL}  prompt_len={len(prompt)}")
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "").strip()
    except httpx.HTTPError as e:
        print(f"[Ollama Error] HTTP request to {url} failed: {type(e).__name__}: {e}")
        raise
    except Exception as e:
        print(f"[Ollama Error] Unexpected error during chat to {url}: {type(e).__name__}: {e}")
        raise


async def generate_document_context(first_text: str) -> str:
    """
    Generate a brief document-level context from the first ~2000 chars of the PDF.
    This grounds all subsequent chunk summaries.
    """
    prompt = f"""You are a helpful reading assistant.
Below is the beginning of a document. Please write a brief overview (2-4 sentences) covering:
- The document's title or likely topic
- Its apparent structure or type (e.g., academic paper, manual, report)
- The main subjects it covers

Respond in {SUMMARY_LANGUAGE}.

--- DOCUMENT START ---
{first_text}
--- DOCUMENT END ---

Overview:"""
    return await _chat(prompt)


async def generate_chunk_summary(
    document_context: str,
    chunk_text: str,
    language: Optional[str] = None,
) -> str:
    """
    Generate a concise Markdown summary of a text chunk,
    grounded with the document context.
    """
    lang = language or SUMMARY_LANGUAGE
    prompt = f"""You are a precise reading assistant. Below is context about the overall document, followed by a specific excerpt.
Write a concise but complete summary of the EXCERPT in **{lang}**, formatted as Markdown.
Use bullet points or short paragraphs as appropriate.
Do NOT summarize the whole document — focus only on the excerpt.

## Document Context
{document_context}

## Excerpt to Summarize
{chunk_text}

## Summary (in {lang}, Markdown format):"""
    return await _chat(prompt)


async def generate_detailed_explanation(
    document_context: str,
    chunk_text: str,
    existing_summary: str,
    language: Optional[str] = None,
) -> str:
    """
    Generate an in-depth explanation of a chunk, expanding on the existing summary.
    """
    lang = language or SUMMARY_LANGUAGE
    prompt = f"""You are a thorough reading assistant. You previously wrote a brief summary of a document excerpt.
Now write a much more detailed explanation and analysis of the same excerpt in **{lang}**, using Markdown.
Explain key concepts, implications, terminology, and any nuances.

## Document Context
{document_context}

## Excerpt
{chunk_text}

## Previous Brief Summary
{existing_summary}

## Detailed Explanation (in {lang}, Markdown):"""
    return await _chat(prompt)


async def check_ollama_health() -> dict:
    """Check if Ollama is running and the configured model is available."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            model_available = any(
                OLLAMA_MODEL in m for m in models
            )
            return {
                "running": True,
                "model": OLLAMA_MODEL,
                "model_available": model_available,
                "available_models": models,
            }
    except Exception as e:
        return {"running": False, "error": str(e), "model": OLLAMA_MODEL}
