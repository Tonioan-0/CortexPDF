"""
FastAPI backend server for PDF AI Summarizer.
Serves static files and provides REST API for PDF parsing and AI summarization.
"""

import os
import sys

# Load .env from project root
from pathlib import Path
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
import base64
import tempfile
import shutil

# Add backend dir to path so imports work
sys.path.insert(0, str(Path(__file__).parent))

from pdf_parser import extract_pages, get_first_n_chars, get_visible_chunk, compute_text_hash
from sidecar import (
    load_sidecar, save_sidecar, find_matching_summary,
    upsert_summary, soft_delete_summary, SidecarData
)
from ollama_client import (
    generate_document_context, generate_chunk_summary,
    generate_detailed_explanation, check_ollama_health,
    SUMMARY_LANGUAGE, OLLAMA_MODEL
)

app = FastAPI(title="PDF AI Summarizer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ─────────────────────────────────────────────────────────────
frontend_dir = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(frontend_dir / "static")), name="static")

# ── In-memory state ──────────────────────────────────────────────────────────
# Holds the currently open PDF state so we don't re-parse on every request
_state: dict = {
    "pdf_path": None,
    "pages": None,       # list[PageInfo]
    "sidecar": None,     # SidecarData
}


# ── Request / Response models ─────────────────────────────────────────────────

class OpenPDFRequest(BaseModel):
    pdf_path: str
    sidecar_path: Optional[str] = None


class VisiblePagesRequest(BaseModel):
    visible_pages: list[int]          # 0-indexed page numbers visible in viewport
    scroll_offset_top: int = 0
    force_regenerate: bool = False


class DeleteSummaryRequest(BaseModel):
    summary_id: str


class DetailRequest(BaseModel):
    summary_id: str


class RegenerateRequest(BaseModel):
    summary_id: str


# ── Utility ───────────────────────────────────────────────────────────────────

def _require_pdf():
    if _state["pdf_path"] is None or _state["pages"] is None:
        raise HTTPException(status_code=400, detail="No PDF is currently open.")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/")
async def serve_index():
    index_path = frontend_dir / "index.html"
    return FileResponse(str(index_path))


@app.get("/api/health")
async def health():
    ollama_status = await check_ollama_health()
    return {
        "status": "ok",
        "ollama": ollama_status,
        "language": SUMMARY_LANGUAGE,
        "model": OLLAMA_MODEL,
    }


@app.post("/api/open-pdf")
async def open_pdf(req: OpenPDFRequest):
    """
    Open a PDF file and its sidecar JSON (if any).
    Parses pages and generates document context if this is the first open.
    """
    pdf_path = req.pdf_path
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail=f"PDF not found: {pdf_path}")

    # Parse PDF
    pages = extract_pages(pdf_path)
    _state["pdf_path"] = pdf_path
    _state["pages"] = pages

    # Load sidecar
    sidecar = load_sidecar(pdf_path)
    _state["sidecar"] = sidecar

    # If no document context yet, generate it
    if not sidecar.document_context:
        first_text = get_first_n_chars(pages, 2000)
        if first_text:
            try:
                sidecar.document_context = await generate_document_context(first_text)
                save_sidecar(pdf_path, sidecar)
            except Exception as e:
                sidecar.document_context = f"[Context generation failed: {e}]"

    # Return page dimensions for pdf.js rendering coordination
    page_dims = [
        {"page": p.page_num, "width": p.width, "height": p.height}
        for p in pages
    ]

    return {
        "success": True,
        "pdf_path": pdf_path,
        "total_pages": len(pages),
        "document_context": sidecar.document_context,
        "page_dimensions": page_dims,
        "has_existing_summaries": len([s for s in sidecar.summaries if not s.deleted]) > 0,
    }


@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """
    Upload a PDF file (for the file picker flow).
    Saves to a temp location and processes it.
    """
    # Save uploaded file to a temp path
    suffix = ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    # Actually we want to save it next to the app or let user pick location.
    # For now, return the tmp path and let the frontend call open-pdf.
    return {"temp_path": tmp_path, "filename": file.filename}


@app.post("/api/summarize-viewport")
async def summarize_viewport(req: VisiblePagesRequest):
    """
    Main summarization endpoint. Called when user stops scrolling.
    - Checks cache first
    - Calls Ollama only if needed
    - Persists result
    """
    _require_pdf()
    pages = _state["pages"]
    sidecar: SidecarData = _state["sidecar"]
    pdf_path = _state["pdf_path"]

    # Extract the chunk for visible pages
    chunk_text, start_page, end_page, chunk_hash = get_visible_chunk(
        pages, req.visible_pages
    )

    if not chunk_text.strip():
        return {"summary": None, "from_cache": False, "message": "No text in visible area"}

    # Check cache (unless force regenerate)
    if not req.force_regenerate:
        cached = find_matching_summary(sidecar, start_page, end_page, chunk_hash)
        if cached:
            if cached.deleted:
                # Soft-deleted: don't auto-summarize, return deleted state
                return {
                    "summary": None,
                    "from_cache": True,
                    "deleted": True,
                    "summary_id": cached.id,
                    "message": "This region was deleted. Use Regenerate to re-summarize.",
                }
            # Return cached summary
            return {
                "summary": {
                    "id": cached.id,
                    "markdown": cached.summary_markdown,
                    "start_page": cached.chunk_start_page + 1,  # 1-indexed for display
                    "end_page": cached.chunk_end_page + 1,
                    "language": cached.language,
                    "stale": cached.stale,
                },
                "from_cache": True,
                "deleted": False,
            }

    # Generate new summary via Ollama
    try:
        summary_md = await generate_chunk_summary(
            document_context=sidecar.document_context,
            chunk_text=chunk_text,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama error: {e}")

    # Persist
    entry = upsert_summary(
        sidecar,
        start_page=start_page,
        end_page=end_page,
        chunk_hash=chunk_hash,
        language=SUMMARY_LANGUAGE,
        summary_markdown=summary_md,
        scroll_offset_top=req.scroll_offset_top,
    )
    save_sidecar(pdf_path, sidecar)

    return {
        "summary": {
            "id": entry.id,
            "markdown": summary_md,
            "start_page": start_page + 1,
            "end_page": end_page + 1,
            "language": entry.language,
            "stale": False,
        },
        "from_cache": False,
        "deleted": False,
    }


@app.post("/api/delete-summary")
async def delete_summary(req: DeleteSummaryRequest):
    """Soft-delete a summary entry."""
    _require_pdf()
    sidecar = _state["sidecar"]
    pdf_path = _state["pdf_path"]
    found = soft_delete_summary(sidecar, req.summary_id)
    if not found:
        raise HTTPException(status_code=404, detail="Summary not found")
    save_sidecar(pdf_path, sidecar)
    return {"success": True}


@app.post("/api/regenerate-summary")
async def regenerate_summary(req: RegenerateRequest):
    """Force-regenerate a summary (even if deleted or stale)."""
    _require_pdf()
    sidecar: SidecarData = _state["sidecar"]
    pdf_path = _state["pdf_path"]

    # Find the existing entry to get page range
    target = None
    for entry in sidecar.summaries:
        if entry.id == req.summary_id:
            target = entry
            break

    if target is None:
        raise HTTPException(status_code=404, detail="Summary not found")

    pages = _state["pages"]
    visible = list(range(target.chunk_start_page, target.chunk_end_page + 1))
    chunk_text, start_page, end_page, chunk_hash = get_visible_chunk(pages, visible)

    if not chunk_text.strip():
        raise HTTPException(status_code=400, detail="No text available for this range")

    try:
        summary_md = await generate_chunk_summary(
            document_context=sidecar.document_context,
            chunk_text=chunk_text,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama error: {e}")

    entry = upsert_summary(
        sidecar,
        start_page=start_page,
        end_page=end_page,
        chunk_hash=chunk_hash,
        language=SUMMARY_LANGUAGE,
        summary_markdown=summary_md,
        scroll_offset_top=target.card_position.get("scroll_offset_top", 0),
    )
    save_sidecar(pdf_path, sidecar)

    return {
        "summary": {
            "id": entry.id,
            "markdown": summary_md,
            "start_page": start_page + 1,
            "end_page": end_page + 1,
            "language": entry.language,
            "stale": False,
        }
    }


@app.post("/api/explain-detail")
async def explain_detail(req: DetailRequest):
    """Generate a more detailed explanation for an existing summary."""
    _require_pdf()
    sidecar: SidecarData = _state["sidecar"]

    target = None
    for entry in sidecar.summaries:
        if entry.id == req.summary_id:
            target = entry
            break

    if target is None:
        raise HTTPException(status_code=404, detail="Summary not found")

    pages = _state["pages"]
    visible = list(range(target.chunk_start_page, target.chunk_end_page + 1))
    chunk_text, _, _, _ = get_visible_chunk(pages, visible)

    try:
        detailed_md = await generate_detailed_explanation(
            document_context=sidecar.document_context,
            chunk_text=chunk_text,
            existing_summary=target.summary_markdown,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama error: {e}")

    return {"detailed_markdown": detailed_md}


@app.get("/api/summaries")
async def get_all_summaries():
    """Return all non-deleted summaries for the current PDF."""
    _require_pdf()
    sidecar: SidecarData = _state["sidecar"]
    result = []
    for entry in sidecar.summaries:
        if not entry.deleted:
            result.append({
                "id": entry.id,
                "start_page": entry.chunk_start_page + 1,
                "end_page": entry.chunk_end_page + 1,
                "language": entry.language,
                "stale": entry.stale,
                "scroll_offset_top": entry.card_position.get("scroll_offset_top", 0),
            })
    return {"summaries": result}


@app.get("/api/config")
async def get_config():
    return {
        "language": SUMMARY_LANGUAGE,
        "model": OLLAMA_MODEL,
        "debounce_ms": int(os.getenv("DEBOUNCE_MS", "1500")),
    }


@app.get("/pdf-file")
async def serve_pdf():
    """Serve the currently open PDF file for pdf.js."""
    _require_pdf()
    return FileResponse(
        _state["pdf_path"],
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )
