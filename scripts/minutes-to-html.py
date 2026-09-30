"""Convert Beds SRA Word minutes into structured HTML and Markdown.

The Word files are mostly unstyled (Normal / List Paragraph). This infers
headings, officer lists and actions, strips email addresses, and writes a
print-ready HTML page plus a Markdown body for the website.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

ROOT = Path(r"C:\Users\phili\OneDrive\Beds Squash")
SITE = Path(r"C:\SN Work\Beds_Squash")
HTML_OUT = SITE / "data" / "minutes-html"
MD_DIR = SITE / "src" / "content" / "minutes"
LOGO = SITE / "public" / "brand" / "logo-navy.png"

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
MULTI_SPACE = re.compile(r"[ \t]{2,}")
TRAILING_JUNK = re.compile(r"[\s;,:]+$")

SECTION = re.compile(
    r"^(?:"
    r"(?:\d+[.\)]\s*)?"
    r"(?:"
    r"Attendees|Apologies|"
    r"Minutes of\b.{0,80}|"
    r"Outstanding Actions.*|"
    r"Report from .+|"
    r"Update from .+|"
    r"Election of Offic\w*.*|"
    r"Resignations|"
    r"County Association Network|"
    r"A\.?O\.?B\.?.*|Any Other Business|"
    r"Date for Next Meeting|"
    r"Ideas for development.*|"
    r"Reports|"
    r"Fees Payable.*|"
    r"Use of Division .+|"
    r"Other Beds Squash Roles.*|"
    r"Beds Website|"
    r"England Squash Marker"
    r")"
    r")\s*$",
    re.I,
)

TITLE = re.compile(
    r"^(?:Agenda|Minutes) (?:for|of) the Beds SRA\b|"
    r"^Minutes of the AGM\b",
    re.I,
)
VENUE = re.compile(r"^(?:To be held|Held) at\b", re.I)
DATE_ONLY = re.compile(r"^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$")
ROLES = (
    "Chairman|Chair|Secretary|Treasurer|League Organiser|"
    "Development Officer|County Captain|County Coach|"
    "Junior Team Manager|County Association Network|"
    "Child Welfare Officer|County Network|Regional Representative"
)
OFFICER = re.compile(rf"^({ROLES})\s*[-–—:]\s*(.+)$", re.I)
OFFICER_LOOSE = re.compile(rf"^({ROLES})\s+([A-Z].+)$", re.I)
ACTION = re.compile(r"\bACTION:?\b", re.I)

JOBS = [
    ("AGM Minutes 2026.docx", "agm-2026-09-23", "2026-09-23-agm"),
    ("Beds_Squash_26_08_05_Minutes.docx", "committee-2026-08-05", "2026-08-05-committee"),
    ("AGM_Minutes_2025.docx", "agm-2025-09-04", "2025-09-04-agm"),
    ("Beds Squash 25_06_26 Minutes.docx", "committee-2025-06-26", "2025-06-26-committee"),
    ("Beds Squash 25_03_20 Minutes.docx", "committee-2025-03-20", "2025-03-20-committee"),
    ("AGM Minutes 2024.docx", "agm-2024-09-05", "2024-09-05-agm"),
    ("AGM Minutes 2023.docx", "agm-2023", "2023-07-06-agm"),
    ("AGM_Minutes_12Nov2020_V3.docx", "agm-2020-11-12", "2020-11-12-agm"),
]


def scrub(text: str) -> str:
    text = EMAIL.sub("", text)
    text = text.replace("\xa0", " ").replace("\t", " ")
    text = re.sub(r"[;,](\s*[;,])+", ";", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = MULTI_SPACE.sub(" ", text)
    text = re.sub(r"\s+([;,:])", r"\1", text)
    text = TRAILING_JUNK.sub("", text)
    return text.strip()


def style_name(p: Paragraph) -> str:
    return (p.style.name if p.style else "Normal") or "Normal"


def is_sentence(text: str) -> bool:
    words = text.split()
    if DATE_ONLY.match(text):
        return True
    if re.search(r"\b\d+:\d+\b", text):
        return True
    if text.endswith((".", "!", "?")) and len(words) > 3:
        return True
    if len(words) >= 9:
        return True
    if re.match(r"^(Beat|Lost|Narrowly lost|Accounts increased|TV coverage)\b", text, re.I):
        return True
    return False


def publish_title(text: str) -> str:
    if TITLE.match(text):
        return re.sub(r"^Agenda for\b", "Minutes of", text, flags=re.I)
    return text


def heading_level(p: Paragraph, text: str, seen_title: bool) -> int | None:
    if not text or VENUE.match(text) or DATE_ONLY.match(text):
        return None
    if TITLE.match(text) and not seen_title:
        return 1
    if SECTION.match(text):
        return 2
    style = style_name(p)
    if (style.startswith("Heading 1") or style == "Title") and not is_sentence(text):
        return 1
    styled = style.startswith("Heading 2") or style.startswith("Heading 3")
    if styled and not is_sentence(text) and (SECTION.match(text) or len(text) <= 40):
        return 2
    return None


def officer_parts(text: str) -> tuple[str, str] | None:
    dash = OFFICER.match(text)
    if dash:
        return dash.group(1).strip(), dash.group(2).strip()
    if len(text) <= 70 and "proposal" not in text.lower() and "report" not in text.lower():
        loose = OFFICER_LOOSE.match(text)
        if loose:
            return loose.group(1).strip(), loose.group(2).strip()
    vacant = re.fullmatch(rf"({ROLES})", text, flags=re.I)
    if vacant:
        return vacant.group(1).strip(), "—"
    return None


def iter_blocks(doc: Document):
    parent = doc.element.body
    for child in parent.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            yield "p", Paragraph(child, doc)
        elif tag == "tbl":
            yield "tbl", Table(child, doc)


def table_rows(table: Table) -> list[list[str]]:
    rows = []
    for row in table.rows:
        cells = []
        seen = set()
        for cell in row.cells:
            key = cell._tc  # noqa: SLF001
            if key in seen:
                continue
            seen.add(key)
            cells.append(scrub(cell.text.replace("\n", " ")))
        if any(cells):
            rows.append(cells)
    return rows


def blocks_from_docx(path: Path) -> list[tuple]:
    doc = Document(path)
    out: list[tuple] = []
    seen_title = False
    pending_officers: list[tuple[str, str]] = []

    def flush_officers():
        nonlocal pending_officers
        if pending_officers:
            out.append(("officers", pending_officers))
            pending_officers = []

    for kind, item in iter_blocks(doc):
        if kind == "tbl":
            flush_officers()
            rows = table_rows(item)
            if rows:
                out.append(("table", rows))
            continue

        lines = [scrub(part) for part in (item.text or "").split("\n")]
        lines = [ln for ln in lines if ln]
        if not lines:
            continue

        for text in lines:
            officer = officer_parts(text)
            if officer and (officer[1] != "—" or pending_officers):
                pending_officers.append(officer)
                continue
            flush_officers()

            level = heading_level(item, text, seen_title)
            if level == 1:
                out.append(("h1", publish_title(text)))
                seen_title = True
                continue
            if level == 2:
                out.append(("h2", text))
                seen_title = True
                continue
            if VENUE.match(text):
                lede = re.sub(r"^To be held\b", "Held", text, flags=re.I)
                out.append(("lede", lede))
                continue
            if text.lower().startswith(("attendees:", "apologies:", "present:")):
                out.append(("meta", text))
                continue
            if ACTION.search(text):
                out.append(("action", text))
                continue
            out.append(("p", text))

    flush_officers()
    return out


def html_table(rows: list[list[str]], header: bool = False) -> str:
    parts = ["<table>"]
    for i, row in enumerate(rows):
        tag = "th" if header and i == 0 else "td"
        cells = "".join(f"<{tag}>{html.escape(c)}</{tag}>" for c in row)
        parts.append(f"<tr>{cells}</tr>")
    parts.append("</table>")
    return "\n".join(parts)


def to_html(title: str, blocks: list[tuple], logo_data: str) -> str:
    body: list[str] = []
    h1 = next((t for k, t in blocks if k == "h1"), "Bedfordshire Squash & Racketball Association")
    rest = [b for b in blocks if b[0] != "h1"]

    for kind, data in rest:
        if kind == "h2":
            body.append(f"<h2>{html.escape(data)}</h2>")
        elif kind == "lede":
            body.append(f'<p class="lede">{html.escape(data)}</p>')
        elif kind == "meta":
            body.append(f'<p class="meta">{html.escape(data)}</p>')
        elif kind == "action":
            body.append(f'<p class="action">{html.escape(data)}</p>')
        elif kind == "officers":
            rows = [["Role", "Elected"]] + [[r, n] for r, n in data]
            body.append(html_table(rows, header=True))
        elif kind == "table":
            body.append(html_table(data, header=len(data) > 1))
        else:
            body.append(f"<p>{html.escape(data)}</p>")

    return f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>{html.escape(h1)}</title>
<style>
  :root {{
    --navy: #003568;
    --gold: #F2B705;
    --ink: #1a2430;
    --muted: #5a6a7a;
  }}
  * {{ box-sizing: border-box; }}
  @page {{ size: A4; margin: 14mm 14mm 18mm; }}
  html, body {{
    margin: 0;
    padding: 0;
  }}
  body {{
    color: var(--ink);
    font: 11pt/1.45 Georgia, "Times New Roman", serif;
    padding: 4mm 2mm 0;
  }}
  header.brand {{
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 10px;
    margin-bottom: 16px;
    border-bottom: 3px solid var(--gold);
  }}
  header.brand img {{ height: 42px; width: auto; }}
  header.brand .org {{
    font: 600 11pt/1.2 "Segoe UI", Calibri, sans-serif;
    color: var(--navy);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }}
  header.brand .doc {{
    font: 10pt/1.3 "Segoe UI", Calibri, sans-serif;
    color: var(--muted);
  }}
  h1 {{
    font: 700 16pt/1.25 "Segoe UI", Calibri, sans-serif;
    color: var(--navy);
    margin: 0 0 0.4rem;
  }}
  h2 {{
    font: 700 12pt/1.3 "Segoe UI", Calibri, sans-serif;
    color: var(--navy);
    margin: 1.15rem 0 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid #d5dee6;
    page-break-after: avoid;
  }}
  p {{ margin: 0 0 0.45rem; }}
  .lede {{ font-style: italic; color: var(--muted); margin-bottom: 0.9rem; }}
  .meta {{ margin-bottom: 0.8rem; }}
  .action {{
    padding: 0.35rem 0.6rem;
    border-left: 3px solid var(--gold);
    background: #fff8e0;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 0.4rem 0 0.9rem;
    font-size: 10.5pt;
  }}
  th, td {{
    text-align: left;
    padding: 0.28rem 0.5rem;
    border-bottom: 1px solid #d5dee6;
    vertical-align: top;
  }}
  th {{
    font: 650 9pt/1.2 "Segoe UI", Calibri, sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--navy);
    background: #eef4f9;
  }}
  footer.note {{
    font: 8.5pt/1.35 "Segoe UI", Calibri, sans-serif;
    color: var(--muted);
    border-top: 1px solid #d5dee6;
    margin-top: 1.6rem;
    padding-top: 0.55rem;
  }}
</style>
</head>
<body>
<header class="brand">
  <img src="{logo_data}" alt="Bedfordshire Squash">
  <div>
    <div class="org">Bedfordshire Squash &amp; Racketball Association</div>
    <div class="doc">{html.escape(title)}</div>
  </div>
</header>
<h1>{html.escape(h1)}</h1>
{chr(10).join(body)}
<footer class="note">Published by Beds SRA. Email addresses have been removed from this public copy.</footer>
</body>
</html>
"""


def md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def to_markdown(blocks: list[tuple]) -> str:
    lines: list[str] = []
    for kind, data in blocks:
        if kind == "h1":
            continue
        if kind == "h2":
            lines.append(f"\n## {data}\n")
        elif kind == "lede":
            lines.append(f"*{data}*\n")
        elif kind == "meta":
            lines.append(f"{data}\n")
        elif kind == "action":
            lines.append(f"> {data}\n")
        elif kind == "officers":
            lines.append("| Role | Elected |")
            lines.append("| --- | --- |")
            for role, name in data:
                lines.append(f"| {md_cell(role)} | {md_cell(name)} |")
            lines.append("")
        elif kind == "table":
            if not data:
                continue
            width = max(len(r) for r in data)
            padded = [r + [""] * (width - len(r)) for r in data]
            header, *rest = padded
            lines.append("| " + " | ".join(md_cell(c) for c in header) + " |")
            lines.append("| " + " | ".join("---" for _ in header) + " |")
            for row in rest:
                lines.append("| " + " | ".join(md_cell(c) for c in row) + " |")
            lines.append("")
        else:
            lines.append(f"{data}\n")
    return "\n".join(lines).strip() + "\n"


def replace_markdown_body(path: Path, body: str) -> None:
    original = path.read_text(encoding="utf-8")
    if not original.startswith("---"):
        raise SystemExit(f"No frontmatter in {path}")
    end = original.find("\n---", 3)
    if end < 0:
        raise SystemExit(f"Unclosed frontmatter in {path}")
    front = original[: end + 4]
    path.write_text(front + "\n\n" + body.strip() + "\n", encoding="utf-8", newline="\n")


def logo_data_uri() -> str:
    import base64

    encoded = base64.b64encode(LOGO.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def main() -> None:
    HTML_OUT.mkdir(parents=True, exist_ok=True)
    logo = logo_data_uri()
    for src, html_slug, md_slug in JOBS:
        blocks = blocks_from_docx(ROOT / src)
        h1 = next((t for k, t in blocks if k == "h1"), html_slug)
        (HTML_OUT / f"{html_slug}.html").write_text(to_html(h1, blocks, logo), encoding="utf-8")
        md_path = MD_DIR / f"{md_slug}.md"
        if md_path.exists():
            replace_markdown_body(md_path, to_markdown(blocks))
        kinds: dict[str, int] = {}
        for k, _ in blocks:
            kinds[k] = kinds.get(k, 0) + 1
        print(f"{html_slug}: {len(blocks)} blocks {kinds}")


if __name__ == "__main__":
    main()
