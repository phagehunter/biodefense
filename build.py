#!/usr/bin/env python3
"""Build index.html from src/template.html, data/programs.json and data/meta.json.

    python3 build.py

Hero totals, the change figure, the program index and the metadata are all
computed from the data, so a refresh with fetch_data.py never leaves a stale
number in the copy.
"""
import collections
import datetime
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
P = json.loads((ROOT / "data" / "programs.json").read_text(encoding="utf-8"))
META = json.loads((ROOT / "data" / "meta.json").read_text(encoding="utf-8"))
DEPT_NAMES = {"HHS": "Health and Human Services", "DoD": "Defense", "USDA": "Agriculture", "DHS": "Homeland Security", "State": "State (incl. USAID)",
              "EPA": "Environmental Protection Agency", "DOE": "Energy", "Commerce": "Commerce", "NSF": "National Science Foundation", "VA": "Veterans Affairs"}


def big(v):
    return f"${v / 1000:,.2f}B" if abs(v) >= 1000 else f"${v:,.1f}M"


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def program_index():
    by = collections.defaultdict(list)
    for r in P:
        by[r["dept"]].append(r)
    out = []
    for d in sorted(by, key=lambda d: -sum(r["years"].get("2026R", 0) for r in by[d])):
        rs = sorted(by[d], key=lambda r: (r["unit"], r["program"]))
        items = "".join(f'<li><a href="#q={html.escape(r["program"])}" data-q="{html.escape(r["program"])}">{html.escape(r["program"])}</a> <span class="u">{html.escape(r["unit"])}</span></li>' for r in rs)
        out.append(f'    <details class="card"><summary><span class="n">{html.escape(d)} · {html.escape(DEPT_NAMES.get(d, d))}</span><span class="c">{len(rs)} lines</span></summary><ul>{items}</ul></details>')
    return "\n".join(out)


def json_ld():
    url = "https://curtishoffmann.com/biodefense/"
    person = {"@type": "Person", "name": "Curtis Hoffmann", "url": "https://curtishoffmann.com/"}
    return json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": url, "url": url, "name": "US Biodefense Budget, every federal line FY2019–FY2026",
         "description": "Interactive breakdown of US federal biodefense spending by department, category and program, from the Council on Strategic Risks' dataset.",
         "author": person, "dateModified": META["converted"], "isPartOf": {"@type": "WebSite", "name": "Curtis Hoffmann", "url": "https://curtishoffmann.com/"},
         "primaryImageOfPage": url + "assets/og-image.png"},
        {"@type": "Dataset", "@id": url + "data/programs.json", "name": "US biodefense budget lines (CSR Biodefense Budget Breakdown, reshaped)",
         "description": f"{META['programs']} federal biodefense budget lines with actual, enacted and requested funding FY2019–FY2026, by department, subunit and spending category.",
         "creator": {"@type": "Organization", "name": "Council on Strategic Risks, Janne E. Nolan Center", "url": "https://councilonstrategicrisks.org/"},
         "isBasedOn": META["source_url"], "dateModified": META["converted"],
         "keywords": ["biodefense", "biosecurity", "federal budget", "HHS", "DoD", "BARDA", "Strategic National Stockpile"],
         "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": url + "data/programs.json"}},
        {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Curtis Hoffmann", "item": "https://curtishoffmann.com/"}, {"@type": "ListItem", "position": 2, "name": "US Biodefense Budget", "item": url}]}]}, indent=1, ensure_ascii=False)


def asset_version():
    """Short hash of the stylesheet and script, so a change to either busts browser caches."""
    import hashlib
    h = hashlib.sha256()
    for f in ("styles.css", "app.js"):
        fp = ROOT / "assets" / f
        if fp.exists():
            h.update(fp.read_bytes())
    return h.hexdigest()[:10]


def main():
    t = META["totals"]
    a, e, r = t.get("2024A", 0), t.get("2025E", 0), t.get("2026R", 0)
    d = r - e
    chg = f"{'+' if d >= 0 else '−'}{big(abs(d))} ({'+' if d >= 0 else '−'}{abs(d) / e * 100:.1f}%)"
    rep = {
        "{{N_PROGRAMS}}": f"{META['programs']:,}", "{{N_DEPTS}}": str(len(META["departments"])),
        "{{TOTAL_A}}": big(a), "{{TOTAL_E}}": big(e), "{{TOTAL_R}}": big(r), "{{TOTAL_CHG}}": chg, "{{TOTAL_CUT}}": big(abs(d)),
        "{{N_MOVED}}": str(META["merged_moves"]), "{{CITATION}}": html.escape(META["citation"]),
        "{{CONVERTED}}": datetime.date.fromisoformat(META["converted"]).strftime("%-d %B %Y"),
        "{{ASSET_VERSION}}": asset_version(),
        "{{PROGRAM_INDEX}}": program_index(), "{{JSON_LD}}": json_ld(),
        "{{META_JSON}}": json.dumps(META, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/"),
    }
    page = (ROOT / "src" / "template.html").read_text(encoding="utf-8")
    for k, v in rep.items():
        page = page.replace(k, v)
    assert "{{" not in page, "unreplaced placeholder near: " + page[page.index("{{"):page.index("{{") + 40]
    (ROOT / "index.html").write_text(page, encoding="utf-8")
    print(f"wrote index.html ({len(page):,} bytes): {META['programs']} lines, FY26 request {big(r)}, change {chg}")


if __name__ == "__main__":
    main()
