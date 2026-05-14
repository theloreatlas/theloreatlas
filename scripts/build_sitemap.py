#!/usr/bin/env python3
"""
build_sitemap.py — Generate sitemap.xml for The Lore Atlas.

Reads data/manifest.json and each series' entity _index.json files,
then emits one <url> per real path. Run from the repo root:

    python3 scripts/build_sitemap.py

Output: sitemap.xml in the repo root.
"""

import json
import os
import sys

SITE_URL = "https://theloreatlas.com"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO_ROOT, "data")
OUTPUT = os.path.join(REPO_ROOT, "sitemap.xml")

ENTITY_TYPES = [
    "characters",
    "cases",
    "books",
    "factions",
    "locations",
    "artifacts",
    "events",
    "relationships",
]

# Prefix → entity type (mirrors ENTITY_TYPE_TO_PREFIX in app.js)
PREFIX_MAP = {
    "char":     "characters",
    "case":     "cases",
    "faction":  "factions",
    "book":     "books",
    "loc":      "locations",
    "artifact": "artifacts",
    "event":    "events",
    "rel":      "relationships",
}


def id_to_slug(entity_id):
    """'char_sherlock-holmes' → 'sherlock-holmes'"""
    idx = entity_id.find("_")
    return entity_id[idx + 1:] if idx != -1 else entity_id


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    manifest_path = os.path.join(DATA_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"ERROR: manifest not found at {manifest_path}", file=sys.stderr)
        sys.exit(1)

    manifest = load_json(manifest_path)
    series_list = manifest.get("series", [])

    urls = []

    # Home
    urls.append({"loc": f"{SITE_URL}/", "priority": "1.0", "changefreq": "weekly"})

    for series in series_list:
        series_id = series["id"]
        series_dir = os.path.join(DATA_DIR, series_id)

        # Series overview
        urls.append({
            "loc": f"{SITE_URL}/{series_id}",
            "priority": "0.9",
            "changefreq": "weekly",
        })

        # Graph page
        urls.append({
            "loc": f"{SITE_URL}/{series_id}/graph",
            "priority": "0.7",
            "changefreq": "monthly",
        })

        # Entity list pages + entity detail pages
        for et in ENTITY_TYPES:
            index_path = os.path.join(series_dir, et, "_index.json")
            if not os.path.exists(index_path):
                continue

            entities = load_json(index_path)
            if not entities:
                continue

            # List page
            urls.append({
                "loc": f"{SITE_URL}/{series_id}/{et}",
                "priority": "0.8",
                "changefreq": "monthly",
            })

            # Detail pages
            for entity in entities:
                entity_id = entity.get("id", "")
                if not entity_id:
                    continue
                slug = id_to_slug(entity_id)
                urls.append({
                    "loc": f"{SITE_URL}/{series_id}/{et}/{slug}",
                    "priority": "0.7",
                    "changefreq": "monthly",
                })

    # Emit XML
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for u in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{u['loc']}</loc>")
        lines.append(f"    <changefreq>{u['changefreq']}</changefreq>")
        lines.append(f"    <priority>{u['priority']}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")

    xml = "\n".join(lines) + "\n"
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(xml)

    entity_count = sum(1 for u in urls if u["priority"] == "0.7")
    list_count   = sum(1 for u in urls if u["priority"] == "0.8")
    print(f"sitemap.xml written: {len(urls)} URLs total")
    print(f"  1 home + {len(series_list)} series overview(s) + {len(series_list)} graph page(s)")
    print(f"  {list_count} entity-list page(s)")
    print(f"  {entity_count} entity-detail page(s)")


if __name__ == "__main__":
    main()
