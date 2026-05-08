"""
Sidecar JSON persistence layer.
Manages reading/writing the .summary.json file that stores summaries
keyed by page range + text hash.
"""

import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class SummaryEntry:
    id: str
    chunk_start_page: int       # 0-indexed
    chunk_end_page: int         # 0-indexed
    chunk_text_hash: str
    language: str
    summary_markdown: str
    deleted: bool = False
    stale: bool = False
    card_position: dict = field(default_factory=lambda: {"scroll_offset_top": 0})


@dataclass
class SidecarData:
    document_context: str = ""
    summaries: list[SummaryEntry] = field(default_factory=list)


def sidecar_path(pdf_path: str) -> str:
    """Return the .summary.json path for a given PDF path."""
    base = os.path.splitext(pdf_path)[0]
    return base + ".summary.json"


def load_sidecar(pdf_path: str) -> SidecarData:
    """Load the sidecar JSON if it exists, else return empty SidecarData."""
    path = sidecar_path(pdf_path)
    if not os.path.exists(path):
        return SidecarData()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        summaries = [SummaryEntry(**s) for s in raw.get("summaries", [])]
        return SidecarData(
            document_context=raw.get("document_context", ""),
            summaries=summaries,
        )
    except Exception:
        return SidecarData()


def save_sidecar(pdf_path: str, data: SidecarData) -> None:
    """Persist the sidecar data to disk."""
    path = sidecar_path(pdf_path)
    raw = {
        "document_context": data.document_context,
        "summaries": [asdict(s) for s in data.summaries],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw, f, indent=2, ensure_ascii=False)


def find_matching_summary(
    data: SidecarData,
    start_page: int,
    end_page: int,
    chunk_hash: str,
) -> Optional[SummaryEntry]:
    """
    Find a cached summary that matches the given page range and text hash.
    Returns None if no match or if the match is stale/deleted.
    """
    for entry in data.summaries:
        if (
            entry.chunk_start_page == start_page
            and entry.chunk_end_page == end_page
        ):
            if entry.chunk_text_hash == chunk_hash:
                # Exact match: return regardless of deleted (caller decides)
                return entry
            else:
                # Page range matches but hash differs → stale
                entry.stale = True
    return None


def upsert_summary(
    data: SidecarData,
    start_page: int,
    end_page: int,
    chunk_hash: str,
    language: str,
    summary_markdown: str,
    scroll_offset_top: int = 0,
) -> SummaryEntry:
    """
    Add or replace a summary entry. If an entry with matching page range
    exists, update it. Otherwise append a new one.
    """
    for i, entry in enumerate(data.summaries):
        if entry.chunk_start_page == start_page and entry.chunk_end_page == end_page:
            data.summaries[i] = SummaryEntry(
                id=entry.id,
                chunk_start_page=start_page,
                chunk_end_page=end_page,
                chunk_text_hash=chunk_hash,
                language=language,
                summary_markdown=summary_markdown,
                deleted=False,
                stale=False,
                card_position={"scroll_offset_top": scroll_offset_top},
            )
            return data.summaries[i]

    new_entry = SummaryEntry(
        id=str(uuid.uuid4()),
        chunk_start_page=start_page,
        chunk_end_page=end_page,
        chunk_text_hash=chunk_hash,
        language=language,
        summary_markdown=summary_markdown,
        deleted=False,
        stale=False,
        card_position={"scroll_offset_top": scroll_offset_top},
    )
    data.summaries.append(new_entry)
    return new_entry


def soft_delete_summary(data: SidecarData, summary_id: str) -> bool:
    """Mark a summary as deleted (soft delete). Returns True if found."""
    for entry in data.summaries:
        if entry.id == summary_id:
            entry.deleted = True
            return True
    return False
