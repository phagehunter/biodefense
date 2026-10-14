#!/usr/bin/env python3
"""Build data/programs.json from the Council on Strategic Risks' Biodefense Budget Breakdown dataset.

    python3 fetch_data.py path/to/csr_biodefense.xlsx

The workbook is published by CSR's Janne E. Nolan Center at
https://councilonstrategicrisks.org/nolan/biodefense-budget-breakdown/ ("Access the
dataset (.xlsx)"). Download it there, then run this script. It uses only the Python
standard library (an .xlsx file is a zip of XML sheets), so nothing needs installing.

Each sheet is one department. Columns vary slightly by sheet, so they are read by
header name. Year columns are headed like "2024 A" (actual), "2025 E (CR+)" (enacted)
and "2026 R" (request); they become keys "2024A", "2025E", "2026R" in the output.

Output records
  dept       department short name (sheet name)
  unit       department subunit / agency
  program    project or program line name
  pe         DoD program element (number / name), when the sheet has one
  type       type of spending (RDT&E, procurement, ...), when given
  category   CSR spending category
  desc       CSR's description (from budget justifications)
  years      {"2019A": 25.272, ...}  millions of dollars; missing cells omitted
  moved      optional note when the line moved between subunits across years

Rows that share a department and program name but never overlap in time (one has
zeros wherever the other has values) are the same program under a reorganization.
They are merged into one record with the newest unit and a "moved" note, so a
program that moved offices does not look like a program that was eliminated.
"""
import collections
import datetime
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def read_xlsx(path):
    """Yield (sheet_name, rows) with rows as lists of cell values (str/float/None)."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {rel.get("Id"): rel.get("Target") for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    for sh in wb.find("m:sheets", NS):
        target = rels[sh.get(f"{{{NS['r']}}}id")]
        target = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            vals = {}
            for c in row.findall("m:c", NS):
                col = re.match(r"[A-Z]+", c.get("r")).group(0)
                idx = 0
                for ch in col:
                    idx = idx * 26 + (ord(ch) - 64)
                t, v = c.get("t"), c.find("m:v", NS)
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
                elif v is not None:
                    try:
                        val = float(v.text)
                    except ValueError:
                        val = v.text
                else:
                    val = None
                vals[idx - 1] = val
            if vals:
                width = max(vals) + 1
                rows.append([vals.get(i) for i in range(width)])
        yield sh.get("name"), rows


YEAR_RE = re.compile(r"^(20\d\d)\s*([AER])\b")


def clean(s):
    return re.sub(r"\s+", " ", str(s)).strip() if s is not None else ""


def convert(path):
    records = []
    for sheet, rows in read_xlsx(path):
        if not rows:
            continue
        header = [clean(h) for h in rows[0]]
        col = {h: i for i, h in enumerate(header) if h}
        year_cols = [(m.group(1) + m.group(2), i) for i, h in enumerate(header) for m in [YEAR_RE.match(h)] if m]
        for row in rows[1:]:
            get = lambda name: clean(row[col[name]]) if name in col and col[name] < len(row) else ""
            program = get("Project") or get("Program Element (Number/Name)")
            if not program:
                continue
            years = {}
            for key, i in year_cols:
                v = row[i] if i < len(row) else None
                if v is None or v == "":
                    continue
                try:
                    years[key] = round(float(v), 3)
                except (TypeError, ValueError):
                    pass
            rec = {"dept": sheet.strip(), "unit": get("Department Subunit"), "program": program,
                   "category": get("Spending Category"), "desc": get("Description"), "years": years}
            pe = get("Program Element (Number/Name)") if get("Project") else ""
            if pe:
                rec["pe"] = pe
            if get("Type of Spending"):
                rec["type"] = get("Type of Spending")
            records.append(rec)
    return merge_moves(records)


def merge_moves(records):
    """Merge same-name lines that never overlap in time (reorganizations)."""
    groups = collections.defaultdict(list)
    for r in records:
        groups[(r["dept"], r["program"].lower())].append(r)
    out = []
    for key, rs in groups.items():
        if len(rs) == 1:
            out.append(rs[0]); continue
        rs.sort(key=lambda r: max((k for k, v in r["years"].items() if v), default="0000"))
        merged = dict(rs[0]); merged["years"] = dict(rs[0]["years"])
        units = [rs[0]["unit"]]
        ok = True
        for r in rs[1:]:
            overlap = any(merged["years"].get(k) and v for k, v in r["years"].items())
            if overlap:
                ok = False; break
            for k, v in r["years"].items():
                if v or k not in merged["years"]:
                    merged["years"][k] = v
            if r["unit"] != merged["unit"]:
                units.append(r["unit"])
            merged["unit"] = r["unit"]
            if r.get("desc") and len(r["desc"]) > len(merged.get("desc", "")):
                merged["desc"] = r["desc"]
            if r.get("pe"):
                merged["pe"] = r["pe"]
        if ok:
            if len(units) > 1:
                merged["moved"] = "Previously under " + "; then ".join(units[:-1]) + "."
            out.append(merged)
        else:
            seen = collections.Counter()
            for r in rs:  # genuinely distinct lines with the same name: keep, disambiguate
                r = dict(r)
                pe = re.search(r"PE\s*(\w+)", r.get("pe", ""))
                tag = ("PE " + pe.group(1)) if pe else (" · ".join(t for t in (r.get("type"), r.get("unit")) if t) or "line")
                seen[tag] += 1
                r["program"] = f"{r['program']} [{tag}{' ' + str(seen[tag]) if seen[tag] > 1 else ''}]"
                out.append(r)
    out.sort(key=lambda r: (r["dept"], r["unit"], r["program"]))
    return out


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    records = convert(argv[1])
    years = sorted({k for r in records for k in r["years"]})
    tot = {y: round(sum(r["years"].get(y, 0) for r in records), 3) for y in years}
    by_dept = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in records:
        for y, v in r["years"].items():
            by_dept[r["dept"]][y] += v
    meta = {
        "source": "Council on Strategic Risks, Janne E. Nolan Center, Biodefense Budget Breakdown dataset",
        "source_url": "https://councilonstrategicrisks.org/nolan/biodefense-budget-breakdown/",
        "citation": "Chwalek, Sabrina. \"US Biodefense Budget Breakdown: Fiscal Year 2026 Update.\" Council on Strategic Risks, 9 December 2025.",
        "converted": datetime.date.today().isoformat(),
        "units": "millions of US dollars, nominal",
        "year_keys": "A = actual, E = enacted, R = requested",
        "years": years,
        "programs": len(records),
        "departments": sorted({r["dept"] for r in records}),
        "categories": sorted({r["category"] for r in records if r["category"]}),
        "totals": tot,
        "totals_by_department": {d: {y: round(v, 3) for y, v in ys.items()} for d, ys in sorted(by_dept.items())},
        "merged_moves": sum(1 for r in records if r.get("moved")),
    }
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "programs.json").write_text(json.dumps(records, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (ROOT / "data" / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote data/programs.json ({len(records)} programs, {len(years)} year columns) and data/meta.json")
    for y in ("2024A", "2025E", "2026R"):
        print(f"  total {y}: {tot.get(y, 0):,.1f}")


if __name__ == "__main__":
    main(sys.argv)
