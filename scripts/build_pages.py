#!/usr/bin/env python3
"""
build_pages.py — Pre-render per-URL HTML stubs for The Lore Atlas.

For each entity URL, emits a directory + index.html containing:
  - A copy of index.html's <body> (the JS shell — runtime renders content)
  - A per-page <head>: title, meta description, Open Graph tags, canonical
    link, and JSON-LD structured data blocks

Run before every commit that touches data files or index.html.
Idempotent — safe to re-run; produces the same output for the same input.
Also regenerates sitemap.xml from the same walk.

Usage:
  python3 scripts/build_pages.py
"""

import html as html_mod
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / 'data'
INDEX_HTML = REPO_ROOT / 'index.html'
SITEMAP = REPO_ROOT / 'sitemap.xml'
META_CONFIG_PATH = DATA_DIR / 'meta-config.json'

# ── Load shared config ───────────────────────────────────────────────────────

with open(META_CONFIG_PATH) as f:
    CFG = json.load(f)

SITE = CFG['site_name']
SITE_URL = CFG['site_url'].rstrip('/')
SEP = CFG['title_separator']
MAX_DESC = CFG['max_description_chars']
MAX_TITLE = CFG['max_title_chars']
OG_TYPES = CFG['og_types']

# ── Text helpers (mirror JS buildEntityMeta / truncateForMeta) ───────────────

def truncate(text, max_chars=None):
    if max_chars is None:
        max_chars = MAX_DESC
    if not text:
        return ''
    cleaned = ' '.join(str(text).split())
    if len(cleaned) <= max_chars:
        return cleaned
    slice_ = cleaned[:max_chars]
    last_space = slice_.rfind(' ')
    return (slice_[:last_space] if last_space > 0 else slice_).rstrip() + '…'

def first_sentences(text, max_chars=None):
    if max_chars is None:
        max_chars = MAX_DESC
    if not text:
        return ''
    sentences = re.findall(r'[^.!?]+[.!?]+(?=\s|$)', str(text))
    if not sentences:
        return truncate(text, max_chars)
    out = ''
    for s in sentences:
        if len(out + s) > max_chars:
            break
        out += s + ' '
    return out.strip() or truncate(sentences[0], max_chars)

def enforce_title_cap(title):
    if len(title) <= MAX_TITLE:
        return title
    return title[:MAX_TITLE - 1].rstrip() + '…'

def try_parse_event_date(text):
    if not text:
        return None
    months = {'January': '01', 'February': '02', 'March': '03', 'April': '04',
              'May': '05', 'June': '06', 'July': '07', 'August': '08',
              'September': '09', 'October': '10', 'November': '11', 'December': '12'}
    m = re.match(r'^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})', text)
    if m:
        return f'{m.group(2)}-{months[m.group(1)]}'
    m2 = re.match(r'^(\d{4})', text)
    return m2.group(1) if m2 else None

# ── Per-entity-type meta builders ────────────────────────────────────────────

def build_meta(entity, entity_type, series, lookup):
    """Return (title, description, og_type) for an entity."""
    name = entity.get('name') or entity.get('title') or ''
    series_name = series['name']
    og_type = OG_TYPES.get(entity_type, 'article')

    if entity_type == 'relationships':
        a_name = (lookup.get(entity.get('character_a', '')) or {}).get('name', entity.get('character_a', ''))
        b_name = (lookup.get(entity.get('character_b', '')) or {}).get('name', entity.get('character_b', ''))
        title = enforce_title_cap(f'{a_name} and {b_name}{SEP}{SITE}')
        if entity.get('notes'):
            description = first_sentences(entity['notes'])
        else:
            case = lookup.get(entity.get('first_established', ''))
            case_title = case['title'] if case else ''
            base = f"{entity.get('relationship_type', 'relationship')} between {a_name} and {b_name} in {series_name}."
            description = truncate(base + (f' First established in “{case_title}”.' if case_title else ''))

    elif entity_type == 'cases':
        title = enforce_title_cap(f'{name}{SEP}{series_name}{SEP}{SITE}')
        description = first_sentences(entity.get('synopsis', ''))  # NEVER read 'solution'

    elif entity_type == 'events':
        base_title = f'{name}{SEP}{series_name}'
        title = enforce_title_cap(base_title if len(base_title) > 50 else f'{base_title}{SEP}{SITE}')
        date_part = entity.get('date_or_position', '')
        date_part = (date_part + '. ').lstrip('. ') if date_part else ''
        description = truncate(date_part + first_sentences(entity.get('description', ''), MAX_DESC - len(date_part)))

    elif entity_type == 'books':
        title = enforce_title_cap(f'{name}{SEP}{series_name}{SEP}{SITE}')
        base = first_sentences(entity.get('description', ''), 130)
        year_tag = f" Published {entity['publication_year']}." if entity.get('publication_year') else ''
        description = base + year_tag if len(base + year_tag) <= MAX_DESC else base

    elif entity_type == 'characters':
        title = enforce_title_cap(f'{name}{SEP}{series_name}{SEP}{SITE}')
        bio = entity.get('biography', '')
        description = first_sentences(bio) if bio else f"{entity.get('role', 'Character').capitalize()} in {series_name}."

    elif entity_type == 'artifacts':
        title = enforce_title_cap(f'{name}{SEP}{series_name}{SEP}{SITE}')
        base = first_sentences(entity.get('description', ''), 130)
        sig = entity.get('significance', '')
        description = base + (' ' + first_sentences(sig, MAX_DESC - len(base) - 1) if sig and len(base) < MAX_DESC - 20 else '')

    else:  # factions, locations, and any future types
        title = enforce_title_cap(f'{name}{SEP}{series_name}{SEP}{SITE}')
        description = first_sentences(entity.get('description', ''))

    return title, description, og_type

# ── JSON-LD builders ─────────────────────────────────────────────────────────

def build_jsonld_for_entity(entity, entity_type, series, lookup, url):
    """Return a list of JSON-LD block dicts for one entity detail page."""
    desc = first_sentences(
        entity.get('biography') or entity.get('synopsis') or
        entity.get('description') or entity.get('notes') or ''
    )

    if entity_type == 'characters':
        block = {'@context': 'https://schema.org', '@type': 'Person',
                 'name': entity.get('name', ''), 'description': desc, 'url': url}
        if entity.get('aliases'):
            block['alternateName'] = entity['aliases']
        return [block]

    if entity_type == 'books':
        block = {
            '@context': 'https://schema.org', '@type': 'Book',
            'name': entity.get('title', ''),
            'author': {'@type': 'Person', 'name': series.get('author', 'Unknown')},
            'description': desc, 'url': url,
            'inLanguage': 'en', 'genre': 'Mystery',
        }
        if entity.get('publication_year'):
            block['datePublished'] = str(entity['publication_year'])
        return [block]

    if entity_type == 'locations':
        return [{'@context': 'https://schema.org', '@type': 'Place',
                 'name': entity.get('name', ''), 'description': desc, 'url': url}]

    if entity_type == 'factions':
        block = {'@context': 'https://schema.org', '@type': 'Organization',
                 'name': entity.get('name', ''), 'description': desc, 'url': url}
        if entity.get('parent_org'):
            parent = lookup.get(entity['parent_org'], {})
            block['parentOrganization'] = {'@type': 'Organization',
                                           'name': parent.get('name', entity['parent_org'])}
        if entity.get('child_orgs'):
            block['subOrganization'] = [
                {'@type': 'Organization', 'name': lookup.get(cid, {}).get('name', cid)}
                for cid in entity['child_orgs']
            ]
        return [block]

    if entity_type == 'events':
        block = {'@context': 'https://schema.org', '@type': 'Event',
                 'name': entity.get('name', ''), 'description': desc, 'url': url}
        iso_date = try_parse_event_date(entity.get('date_or_position', ''))
        if iso_date:
            block['startDate'] = iso_date
        return [block]

    if entity_type == 'cases':
        source_book = lookup.get(entity.get('source_book', ''))
        is_novel = source_book and source_book.get('type') == 'novel'
        return [{
            '@context': 'https://schema.org', '@type': 'Article',
            'headline': entity.get('title', ''),
            'description': first_sentences(entity.get('synopsis', '')),  # never solution
            'url': url,
            'about': {
                '@type': 'Book' if is_novel else 'ShortStory',
                'name': entity.get('title', ''),
                'author': {'@type': 'Person', 'name': series.get('author', 'Unknown')},
            },
        }]

    if entity_type == 'artifacts':
        return [{'@context': 'https://schema.org', '@type': 'Thing',
                 'name': entity.get('name', ''), 'description': desc, 'url': url}]

    if entity_type == 'relationships':
        a_ent = lookup.get(entity.get('character_a', ''), {})
        b_ent = lookup.get(entity.get('character_b', ''), {})
        a_name = a_ent.get('name', entity.get('character_a', ''))
        b_name = b_ent.get('name', entity.get('character_b', ''))
        return [{
            '@context': 'https://schema.org', '@type': 'Article',
            'headline': f'{a_name} and {b_name}',
            'description': desc, 'url': url,
            'about': [{'@type': 'Person', 'name': a_name}, {'@type': 'Person', 'name': b_name}],
        }]

    return []

def build_breadcrumb_jsonld(crumbs):
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': c['name'], 'item': c['url']}
            for i, c in enumerate(crumbs)
        ],
    }

def website_jsonld():
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        'name': SITE,
        'url': SITE_URL + '/',
        'potentialAction': {
            '@type': 'SearchAction',
            'target': {'@type': 'EntryPoint', 'urlTemplate': SITE_URL + '/search?q={search_term_string}'},
            'query-input': 'required name=search_term_string',
        },
    }

def serialize_jsonld(block):
    """JSON-serialize a block with </script defence."""
    return json.dumps(block, ensure_ascii=False, indent=2).replace('</', '<\\/')

# ── HTML emission ────────────────────────────────────────────────────────────

def e(text):
    """HTML-escape for attribute values and text content."""
    return html_mod.escape(str(text), quote=True)

def render_head(title, description, og_type, canonical_url, jsonld_blocks):
    t = e(title)
    d = e(description)
    lines = [
        f'  <title>{t}</title>',
        f'  <meta name="description" content="{d}">',
        f'  <link rel="canonical" href="{e(canonical_url)}">',
        f'  <meta property="og:title" content="{t}">',
        f'  <meta property="og:description" content="{d}">',
        f'  <meta property="og:type" content="{e(og_type)}">',
        f'  <meta property="og:url" content="{e(canonical_url)}">',
        f'  <meta property="og:site_name" content="{e(SITE)}">',
        f'  <meta name="twitter:card" content="summary">',
    ]
    for block in jsonld_blocks:
        lines.append(f'  <script type="application/ld+json">{serialize_jsonld(block)}</script>')
    return '\n'.join(lines)

def inject_head(base_html, head_content):
    """Replace title + description in index.html shell and inject per-page head."""
    out = re.sub(r'<title>[^<]*</title>', '', base_html, count=1)
    out = re.sub(r'<meta\s+name="description"[^>]*>', '', out, count=1)
    # Remove existing OG/twitter static tags from the shell (they're per-page now).
    out = re.sub(r'<meta\s+property="og:[^"]*"[^>]*>\n?', '', out)
    out = re.sub(r'<meta\s+name="twitter:[^"]*"[^>]*>\n?', '', out)
    out = re.sub(r'<link\s+rel="canonical"[^>]*>\n?', '', out)
    out = out.replace('</head>', head_content + '\n</head>', 1)
    return out

def emit_page(out_dir, page_html):
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(page_html, encoding='utf-8')

def page_url(*parts):
    """Build a canonical URL with trailing slash."""
    return SITE_URL + '/' + '/'.join(str(p) for p in parts) + '/'

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    base_html = INDEX_HTML.read_text(encoding='utf-8')
    manifest = json.loads((DATA_DIR / 'manifest.json').read_text())

    sitemap_urls = [SITE_URL + '/']
    emitted = 0
    errors = []

    for series in manifest['series']:
        series_id = series['id']

        # Build cross-reference lookup (needed for relationship/faction meta).
        lookup = {}
        all_entities_by_type = {}
        for et, idx_path in series['entity_indexes'].items():
            entities = json.loads((REPO_ROOT / idx_path).read_text())
            all_entities_by_type[et] = entities
            for ent in entities:
                if ent.get('id'):
                    lookup[ent['id']] = ent

        # ── Series overview ──────────────────────────────────────────────────
        s_url = page_url(series_id)
        s_title = enforce_title_cap(f"{series['name']}{SEP}{SITE}")
        s_desc = truncate(series.get('description', ''))
        s_breadcrumb = build_breadcrumb_jsonld([
            {'name': 'Home', 'url': SITE_URL + '/'},
            {'name': series['name'], 'url': s_url},
        ])
        s_head = render_head(s_title, s_desc, 'website', s_url,
                             [website_jsonld(), s_breadcrumb])
        emit_page(REPO_ROOT / series_id, inject_head(base_html, s_head))
        sitemap_urls.append(s_url)
        emitted += 1

        for et, idx_path in series['entity_indexes'].items():
            entities = all_entities_by_type[et]

            # ── Entity-type list page ────────────────────────────────────────
            list_url = page_url(series_id, et)
            et_label = et.capitalize()
            list_title = enforce_title_cap(f'{et_label}{SEP}{series["name"]}{SEP}{SITE}')
            list_desc = truncate(
                f'Browse all {len(entities)} {et_label.lower()} in the {series["name"]} '
                f'encyclopedia. Each entry links to relationships, cases, and source texts.'
            )
            list_breadcrumb = build_breadcrumb_jsonld([
                {'name': 'Home', 'url': SITE_URL + '/'},
                {'name': series['name'], 'url': page_url(series_id)},
                {'name': et_label, 'url': list_url},
            ])
            list_head = render_head(list_title, list_desc, 'website', list_url,
                                    [website_jsonld(), list_breadcrumb])
            emit_page(REPO_ROOT / series_id / et, inject_head(base_html, list_head))
            sitemap_urls.append(list_url)
            emitted += 1

            # ── Entity detail pages ──────────────────────────────────────────
            for ent in entities:
                eid = ent.get('id', '')
                if not eid:
                    errors.append(f'Entity missing id in {idx_path}: {ent}')
                    continue
                # Relationships derive their display name from character references.
                if et == 'relationships':
                    a = lookup.get(ent.get('character_a', ''), {})
                    b = lookup.get(ent.get('character_b', ''), {})
                    name_or_title = (f"{a.get('name', ent.get('character_a', ''))}"
                                     f" and {b.get('name', ent.get('character_b', ''))}")
                else:
                    name_or_title = ent.get('name') or ent.get('title')
                if not name_or_title:
                    errors.append(f'Entity {eid} missing name/title — skipping')
                    continue

                slug = eid.split('_', 1)[1] if '_' in eid else eid
                detail_url = page_url(series_id, et, slug)

                try:
                    title, description, og_type = build_meta(ent, et, series, lookup)
                except Exception as exc:
                    errors.append(f'build_meta failed for {eid}: {exc}')
                    continue

                detail_crumbs = [
                    {'name': 'Home', 'url': SITE_URL + '/'},
                    {'name': series['name'], 'url': page_url(series_id)},
                    {'name': et_label, 'url': list_url},
                    {'name': name_or_title, 'url': detail_url},
                ]
                jsonld_blocks = [website_jsonld(), build_breadcrumb_jsonld(detail_crumbs)]
                entity_blocks = build_jsonld_for_entity(ent, et, series, lookup, detail_url)
                jsonld_blocks.extend(entity_blocks)

                detail_head = render_head(title, description, og_type, detail_url, jsonld_blocks)
                emit_page(REPO_ROOT / series_id / et / slug, inject_head(base_html, detail_head))
                sitemap_urls.append(detail_url)
                emitted += 1

        # ── Graph page ───────────────────────────────────────────────────────
        graph_url = page_url(series_id, 'graph')
        graph_title = enforce_title_cap(f"{series['name']} Relationship Graph{SEP}{SITE}")
        graph_desc = (f"Interactive force-directed graph of all character relationships in "
                      f"{series['name']}. Hover for details, click to navigate.")
        graph_breadcrumb = build_breadcrumb_jsonld([
            {'name': 'Home', 'url': SITE_URL + '/'},
            {'name': series['name'], 'url': page_url(series_id)},
            {'name': 'Relationship Graph', 'url': graph_url},
        ])
        graph_head = render_head(graph_title, graph_desc, 'website', graph_url,
                                 [website_jsonld(), graph_breadcrumb])
        emit_page(REPO_ROOT / series_id / 'graph', inject_head(base_html, graph_head))
        sitemap_urls.append(graph_url)
        emitted += 1

    # ── Regenerate sitemap.xml ───────────────────────────────────────────────
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for u in sitemap_urls:
        lines.append(f'  <url><loc>{u}</loc></url>')
    lines.append('</urlset>')
    SITEMAP.write_text('\n'.join(lines) + '\n', encoding='utf-8')

    print(f'Emitted {emitted} pages, regenerated sitemap.xml ({len(sitemap_urls)} URLs)')

    if errors:
        print(f'\n{len(errors)} error(s):')
        for err in errors:
            print(f'  {err}')
        sys.exit(1)

if __name__ == '__main__':
    main()
