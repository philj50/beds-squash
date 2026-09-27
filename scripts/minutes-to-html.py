"""Turn Beds SRA Word minutes into print-ready HTML, with email addresses removed."""
import html
import re
from pathlib import Path

from docx import Document

ROOT = Path(r"C:\Users\phili\OneDrive\Beds Squash")
OUT = Path(r"C:\SN Work\Beds_Squash\data\minutes-html")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

JOBS = [
    ("AGM Minutes 2026.docx", "agm-2026-09-23"),
    ("Beds_Squash_26_08_05_Minutes.docx", "committee-2026-08-05"),
    ("AGM_Minutes_2025.docx", "agm-2025-09-04"),
    ("Beds Squash 25_06_26 Minutes.docx", "committee-2025-06-26"),
    ("Beds Squash 25_03_20 Minutes.docx", "committee-2025-03-20"),
    ("AGM Minutes 2024.docx", "agm-2024-09-05"),
    ("AGM Minutes 2023.docx", "agm-2023"),
    ("AGM_Minutes_12Nov2020_V3.docx", "agm-2020-11-12"),
]

def paragraphs(path: Path) -> list[str]:
    doc = Document(path)
    lines = []
    for p in doc.paragraphs:
        text = EMAIL.sub("[email removed]", p.text).strip()
        if text:
            lines.append(text)
    for table in doc.tables:
        for row in table.rows:
            cells = [EMAIL.sub("[email removed]", c.text).strip() for c in row.cells]
            cells = [c for c in cells if c]
            if cells:
                lines.append(" — ".join(dict.fromkeys(cells)))
    return lines

def page(title: str, lines: list[str]) -> str:
    body = "\n".join(f"<p>{html.escape(line)}</p>" for line in lines)
    return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>
  body {{ font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; max-width: 720px; margin: 2rem auto; line-height: 1.45; }}
  h1 {{ font-family: "Segoe UI", sans-serif; font-size: 1.4rem; letter-spacing: 0.02em; }}
  p {{ margin: 0 0 0.55rem; }}
  .note {{ font-family: "Segoe UI", sans-serif; font-size: 0.8rem; color: #555; border-top: 1px solid #ccc; margin-top: 2rem; padding-top: 0.6rem; }}
</style></head><body>
<h1>Bedfordshire Squash &amp; Racketball Association</h1>
{body}
<p class="note">Published by Beds SRA. Email addresses have been removed from this public copy.</p>
</body></html>"""

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for src, slug in JOBS:
        lines = paragraphs(ROOT / src)
        (OUT / f"{slug}.html").write_text(page(slug, lines), encoding="utf-8")
        print(f"{slug}: {len(lines)} paragraphs")

if __name__ == "__main__":
    main()
