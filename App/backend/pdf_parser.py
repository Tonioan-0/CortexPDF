"""
PDF Parser using PyMuPDF (fitz).
Extracts text blocks with bounding box coordinates, font size, and boldness flags.
Used to detect headings, paragraph boundaries, and chunk text for summarization.
"""

import fitz  # PyMuPDF
import hashlib
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TextBlock:
    """Represents a single text block extracted from a PDF page."""
    page_num: int          # 0-indexed
    block_num: int
    bbox: tuple            # (x0, y0, x1, y1) in points
    text: str
    font_size: float
    is_bold: bool
    is_heading: bool
    block_type: str        # "text" | "heading"


@dataclass
class PageInfo:
    """Metadata about a single PDF page."""
    page_num: int          # 0-indexed
    width: float
    height: float
    blocks: list[TextBlock] = field(default_factory=list)


def extract_pages(pdf_path: str) -> list[PageInfo]:
    """
    Extract all text blocks from every page of the PDF.
    Returns a list of PageInfo objects with block-level metadata.
    """
    doc = fitz.open(pdf_path)
    pages: list[PageInfo] = []

    for page_num, page in enumerate(doc):
        page_info = PageInfo(
            page_num=page_num,
            width=page.rect.width,
            height=page.rect.height,
        )

        # dict() gives us full block/span/char info
        blocks_raw = page.get_text("dict", flags=fitz.TEXT_PRESERVE_LIGATURES)["blocks"]

        for block_idx, block in enumerate(blocks_raw):
            if block.get("type") != 0:
                # skip image blocks
                continue

            block_text_parts = []
            max_font_size = 0.0
            any_bold = False

            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    span_text = span.get("text", "").strip()
                    if not span_text:
                        continue
                    block_text_parts.append(span.get("text", ""))
                    size = span.get("size", 12.0)
                    flags = span.get("flags", 0)
                    is_bold = bool(flags & 2**4)  # bit 4 = bold
                    if size > max_font_size:
                        max_font_size = size
                    if is_bold:
                        any_bold = True

            full_text = " ".join(block_text_parts).strip()
            if not full_text:
                continue

            # Heuristic: a block is a heading if it's short, bold or large font
            is_heading = _classify_heading(full_text, max_font_size, any_bold)

            tb = TextBlock(
                page_num=page_num,
                block_num=block_idx,
                bbox=tuple(block["bbox"]),
                text=full_text,
                font_size=max_font_size,
                is_bold=any_bold,
                is_heading=is_heading,
                block_type="heading" if is_heading else "text",
            )
            page_info.blocks.append(tb)

        pages.append(page_info)

    doc.close()
    return pages


def _classify_heading(text: str, font_size: float, is_bold: bool) -> bool:
    """
    Heuristic to classify a block as a heading.
    - Short text (< 15 words)
    - Large font size OR bold
    """
    word_count = len(text.split())
    if word_count > 20:
        return False
    if font_size >= 14.0 or is_bold:
        return True
    return False


def get_first_n_chars(pages: list[PageInfo], n: int = 2000) -> str:
    """
    Concatenate text from all pages until we reach n characters.
    Used for generating the document-level context.
    """
    result = []
    total = 0
    for page in pages:
        for block in page.blocks:
            result.append(block.text)
            total += len(block.text)
            if total >= n:
                return " ".join(result)[:n]
    return " ".join(result)


def get_visible_chunk(
    pages: list[PageInfo],
    visible_pages: list[int],
    viewport_bottom_fraction: float = 1.0,
) -> tuple[str, int, int, str]:
    """
    Given which pages are visible, extract the text visible in those pages
    and extend to the next semantic boundary (heading or paragraph end).

    Returns:
        (chunk_text, start_page, end_page, chunk_hash)
        Pages are 0-indexed.
    """
    if not visible_pages:
        return "", 0, 0, ""

    start_page = visible_pages[0]
    end_page = visible_pages[-1]

    # Collect all blocks from the visible range
    chunk_blocks: list[TextBlock] = []
    for page in pages:
        if page.page_num < start_page:
            continue
        if page.page_num > end_page:
            break
        chunk_blocks.extend(page.blocks)

    if not chunk_blocks:
        return "", start_page, end_page, ""

    # Extend to next semantic boundary: find the first heading AFTER the last visible block
    extended_blocks = list(chunk_blocks)
    found_boundary = False

    # Look ahead up to 3 more pages for a heading/section break
    lookahead_end = min(end_page + 3, len(pages) - 1)
    for page in pages:
        if page.page_num <= end_page:
            continue
        if page.page_num > lookahead_end:
            break
        for block in page.blocks:
            if block.is_heading and extended_blocks:
                # Stop before this heading — it starts a new section
                found_boundary = True
                break
            extended_blocks.append(block)
        if found_boundary:
            break
        end_page = page.page_num

    chunk_text = "\n\n".join(b.text for b in extended_blocks)
    chunk_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()

    return chunk_text, start_page, end_page, chunk_hash


def compute_text_hash(text: str) -> str:
    """SHA-256 hash of a text chunk."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
