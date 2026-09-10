#!/usr/bin/env python3
"""
validate_data.py — Data integrity validator for The Lore Atlas.

Errors (exit 1 if any are found):
  1. Every ID reference resolves to an existing entity — covers all foreign-key
     fields, including ownership_chain[].character_id, parent_org, child_orgs,
     source_book, stories_contained, and events.
  2. Each ID's prefix matches its directory's entity type.
  3. Thresholds: both first_mention and full_reveal are present, and
     full_reveal >= first_mention. The book is in range, and the chapter is
     within that book's chapter count (mirrors SpoilerGate.getChapterCount in
     js/spoiler.js). A relationship's first_mention is >= both of its
     characters' first_mention.
  4. Back-references agree on both sides:
       faction.key_members         <-> character.affiliations
       case.characters_involved    <-> character.cases
       relationship.character_a/b  <-> character.relationships
       event.characters_involved/cases_linked/location <-> entity.events
       parent_org                  <-> child_orgs

Warnings (printed, do not fail the build):
  - Forward-reference scan: a prose field names another entity (by name or
    alias, more than 5 characters) whose first_mention comes after this
    entity's own display gate (full_reveal for prose fields, including
    notable_elements). Only entities that are themselves subject to spoiler
    gating (i.e. carry first_mention/full_reveal) are scanned as sources or
    used as match targets — books are excluded on both sides since PK2
    documents them as the reference frame for gating, not subject to it.

Usage:
  python3 scripts/validate_data.py [--verbose]

Exit codes: 0 = no errors (warnings may still be printed), 1 = errors found.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / 'data'

# ── Static config (mirrors js/spoiler.js) ────────────────────────────────────

NOVEL_CHAPTER_COUNTS = {
    'book_a-study-in-scarlet':            14,
    'book_the-sign-of-the-four':          12,
    'book_the-hound-of-the-baskervilles': 15,
    'book_the-valley-of-fear':            14,
}

PREFIX_TO_TYPE = {
    'book': 'books',
    'char': 'characters',
    'case': 'cases',
    'faction': 'factions',
    'loc': 'locations',
    'artifact': 'artifacts',
    'event': 'events',
    'rel': 'relationships',
}
TYPE_TO_PREFIX = {v: k for k, v in PREFIX_TO_TYPE.items()}

# Reference fields: entity_type -> [(field, target_type, 'single'|'list')]
REF_FIELDS = {
    'characters': [
        ('affiliations', 'factions', 'list'),
        ('relationships', 'relationships', 'list'),
        ('cases', 'cases', 'list'),
        ('events', 'events', 'list'),
    ],
    'cases': [
        ('source_book', 'books', 'single'),
        ('characters_involved', 'characters', 'list'),
        ('locations', 'locations', 'list'),
        ('artifacts_involved', 'artifacts', 'list'),
        ('events', 'events', 'list'),
    ],
    'factions': [
        ('key_members', 'characters', 'list'),
        ('cases_involved', 'cases', 'list'),
        ('parent_org', 'factions', 'single'),
        ('child_orgs', 'factions', 'list'),
    ],
    'books': [
        ('stories_contained', 'cases', 'list'),
    ],
    'locations': [
        ('characters_associated', 'characters', 'list'),
        ('cases_occurring_here', 'cases', 'list'),
        ('events', 'events', 'list'),
    ],
    'artifacts': [
        ('appearance_history', 'cases', 'list'),
    ],
    'events': [
        ('characters_involved', 'characters', 'list'),
        ('cases_linked', 'cases', 'list'),
        ('location', 'locations', 'single'),
    ],
    'relationships': [
        ('character_a', 'characters', 'single'),
        ('character_b', 'characters', 'single'),
        ('first_established', 'cases', 'single'),
    ],
}

# Types that carry first_mention / full_reveal thresholds (books do not).
GATED_TYPES = ['characters', 'cases', 'factions', 'locations', 'artifacts', 'events', 'relationships']

# Prose fields scanned by the forward-reference check, per entity type.
# (field, is_list_of_strings)
PROSE_FIELDS = {
    'characters': [('biography', False)],
    'cases': [('synopsis', False), ('solution', False), ('notable_elements', True)],
    'factions': [('description', False)],
    'locations': [('description', False)],
    'artifacts': [('description', False), ('significance', False)],
    'events': [('description', False)],
    'relationships': [('notes', False)],
}


def load_all():
    """Return {entity_type: [entities]} and a flat {id: (entity, entity_type)} lookup."""
    manifest = json.loads((DATA_DIR / 'manifest.json').read_text())
    series = manifest['series'][0]
    by_type = {}
    lookup = {}
    for et, idx_path in series['entity_indexes'].items():
        entities = json.loads((REPO_ROOT / idx_path).read_text())
        by_type[et] = entities
        for ent in entities:
            lookup[ent['id']] = (ent, et)
    return by_type, lookup


def pos_tuple(threshold):
    return (threshold['book'], threshold['chapter'])


def get_chapter_count(book_entity):
    if book_entity['id'] in NOVEL_CHAPTER_COUNTS:
        return NOVEL_CHAPTER_COUNTS[book_entity['id']]
    if book_entity.get('stories_contained'):
        return len(book_entity['stories_contained'])
    return 20


def main():
    verbose = '--verbose' in sys.argv

    by_type, lookup = load_all()
    errors = []
    warnings = []

    books_by_chrono = {b['chronological_order']: b for b in by_type.get('books', [])}
    valid_chrono = set(books_by_chrono.keys())

    # ── Check 2: ID prefix matches directory type ────────────────────────────
    for et, entities in by_type.items():
        expected_prefix = TYPE_TO_PREFIX[et]
        for ent in entities:
            eid = ent.get('id', '')
            prefix = eid.split('_', 1)[0] if '_' in eid else eid
            if prefix != expected_prefix:
                errors.append(f"[prefix] {eid} lives in '{et}' but has prefix '{prefix}' "
                              f"(expected '{expected_prefix}')")

    # ── Check 1: ID references resolve ───────────────────────────────────────
    def check_ref(source_id, field, target_id, target_type):
        if target_id is None:
            return
        found = lookup.get(target_id)
        if found is None:
            errors.append(f"[ref] {source_id}.{field} -> '{target_id}' does not exist")
            return
        _, actual_type = found
        if actual_type != target_type:
            errors.append(f"[ref] {source_id}.{field} -> '{target_id}' is a {actual_type}, "
                          f"expected {target_type}")

    for et, entities in by_type.items():
        for ent in entities:
            eid = ent.get('id', '?')
            for field, target_type, multiplicity in REF_FIELDS.get(et, []):
                value = ent.get(field)
                if not value:
                    continue
                if multiplicity == 'single':
                    check_ref(eid, field, value, target_type)
                else:
                    for target_id in value:
                        check_ref(eid, field, target_id, target_type)
            # Special case: artifacts.ownership_chain[].character_id
            for i, entry in enumerate(ent.get('ownership_chain', []) or []):
                check_ref(eid, f'ownership_chain[{i}].character_id',
                          entry.get('character_id'), 'characters')

    # ── Check 3: thresholds ───────────────────────────────────────────────────
    for et in GATED_TYPES:
        for ent in by_type.get(et, []):
            eid = ent.get('id', '?')
            first = ent.get('first_mention')
            full = ent.get('full_reveal')
            if not first or not full:
                errors.append(f"[threshold] {eid} missing first_mention or full_reveal")
                continue
            for label, t in (('first_mention', first), ('full_reveal', full)):
                book = t.get('book')
                chapter = t.get('chapter')
                if book not in valid_chrono:
                    errors.append(f"[threshold] {eid}.{label} book {book} out of range "
                                  f"(valid: {sorted(valid_chrono)})")
                    continue
                max_ch = get_chapter_count(books_by_chrono[book])
                if not isinstance(chapter, int) or chapter < 1 or chapter > max_ch:
                    errors.append(f"[threshold] {eid}.{label} chapter {chapter} out of range "
                                  f"for book {book} (1-{max_ch})")
            if pos_tuple(full) < pos_tuple(first):
                errors.append(f"[threshold] {eid}: full_reveal {full} < first_mention {first}")

    for ent in by_type.get('relationships', []):
        eid = ent.get('id', '?')
        first = ent.get('first_mention')
        if not first:
            continue
        for role in ('character_a', 'character_b'):
            char_id = ent.get(role)
            char = lookup.get(char_id)
            if not char:
                continue
            char_first = char[0].get('first_mention')
            if char_first and pos_tuple(first) < pos_tuple(char_first):
                errors.append(f"[threshold] {eid}.first_mention {first} is before its "
                              f"{role} ({char_id})'s first_mention {char_first}")

    # ── Check 4: back-references agree on both sides ─────────────────────────
    def symmetric_list(a_id, a_field, a_list, b_type, b_field):
        """Every id in a_list must have a back-reference (a_id in its b_field list)."""
        for b_id in (a_list or []):
            b = lookup.get(b_id)
            if not b:
                continue  # already reported as a broken ref
            b_ent, b_actual_type = b
            if b_actual_type != b_type:
                continue
            if a_id not in (b_ent.get(b_field) or []):
                errors.append(f"[backref] {a_id}.{a_field} includes '{b_id}', but "
                              f"{b_id}.{b_field} does not include '{a_id}'")

    for faction in by_type.get('factions', []):
        symmetric_list(faction['id'], 'key_members', faction.get('key_members'),
                        'characters', 'affiliations')
    for char in by_type.get('characters', []):
        symmetric_list(char['id'], 'affiliations', char.get('affiliations'),
                        'factions', 'key_members')

    for case in by_type.get('cases', []):
        symmetric_list(case['id'], 'characters_involved', case.get('characters_involved'),
                        'characters', 'cases')
    for char in by_type.get('characters', []):
        symmetric_list(char['id'], 'cases', char.get('cases'),
                        'cases', 'characters_involved')

    for rel in by_type.get('relationships', []):
        rid = rel['id']
        for role in ('character_a', 'character_b'):
            char_id = rel.get(role)
            char = lookup.get(char_id)
            if not char:
                continue
            char_ent, char_type = char
            if char_type != 'characters':
                continue
            if rid not in (char_ent.get('relationships') or []):
                errors.append(f"[backref] {rid}.{role} is '{char_id}', but "
                              f"{char_id}.relationships does not include '{rid}'")
    for char in by_type.get('characters', []):
        for rid in char.get('relationships') or []:
            rel = lookup.get(rid)
            if not rel:
                continue
            rel_ent, rel_type = rel
            if rel_type != 'relationships':
                continue
            if char['id'] not in (rel_ent.get('character_a'), rel_ent.get('character_b')):
                errors.append(f"[backref] {char['id']}.relationships includes '{rid}', but "
                              f"{rid} does not reference '{char['id']}' as character_a/b")

    for event in by_type.get('events', []):
        eid = event['id']
        symmetric_list(eid, 'characters_involved', event.get('characters_involved'),
                        'characters', 'events')
        symmetric_list(eid, 'cases_linked', event.get('cases_linked'),
                        'cases', 'events')
        loc_id = event.get('location')
        if loc_id:
            loc = lookup.get(loc_id)
            if loc and loc[1] == 'locations' and eid not in (loc[0].get('events') or []):
                errors.append(f"[backref] {eid}.location is '{loc_id}', but "
                              f"{loc_id}.events does not include '{eid}'")
    for et in ('characters', 'cases', 'locations'):
        for ent in by_type.get(et, []):
            for evid in ent.get('events') or []:
                ev = lookup.get(evid)
                if not ev:
                    continue
                ev_ent, ev_type = ev
                if ev_type != 'events':
                    continue
                back_ids = set(ev_ent.get('characters_involved') or [])
                back_ids |= set(ev_ent.get('cases_linked') or [])
                if ev_ent.get('location'):
                    back_ids.add(ev_ent['location'])
                if ent['id'] not in back_ids:
                    errors.append(f"[backref] {ent['id']}.events includes '{evid}', but "
                                  f"{evid} does not reference '{ent['id']}' back")

    for faction in by_type.get('factions', []):
        parent_id = faction.get('parent_org')
        if parent_id:
            parent = lookup.get(parent_id)
            if parent and parent[1] == 'factions' and faction['id'] not in (parent[0].get('child_orgs') or []):
                errors.append(f"[backref] {faction['id']}.parent_org is '{parent_id}', but "
                              f"{parent_id}.child_orgs does not include '{faction['id']}'")
        for child_id in faction.get('child_orgs') or []:
            child = lookup.get(child_id)
            if child and child[1] == 'factions' and child[0].get('parent_org') != faction['id']:
                errors.append(f"[backref] {faction['id']}.child_orgs includes '{child_id}', but "
                              f"{child_id}.parent_org is not '{faction['id']}'")

    # ── Warnings: forward-reference scan ──────────────────────────────────────
    # Build the name/alias index over entities that are themselves gated
    # (books are excluded — PK2 documents them as ungated reference frames).
    name_index = []  # (pattern, target_id, first_mention)
    for et in GATED_TYPES:
        for ent in by_type.get(et, []):
            first = ent.get('first_mention')
            if not first:
                continue
            names = []
            if ent.get('name'):
                names.append(ent['name'])
            if ent.get('title'):
                names.append(ent['title'])
            names.extend(ent.get('aliases') or [])
            for name in names:
                if len(name) > 5:
                    name_index.append((re.compile(r'\b' + re.escape(name) + r'\b', re.IGNORECASE),
                                       ent['id'], first))

    for et, fields in PROSE_FIELDS.items():
        for ent in by_type.get(et, []):
            source_id = ent['id']
            gate = ent.get('full_reveal')
            if not gate:
                continue
            for field, is_list in fields:
                value = ent.get(field)
                if not value:
                    continue
                texts = value if is_list else [value]
                for text in texts:
                    for pattern, target_id, target_first in name_index:
                        if target_id == source_id:
                            continue
                        if pos_tuple(target_first) > pos_tuple(gate) and pattern.search(text):
                            warnings.append(f"[forward-ref] {source_id}.{field} names "
                                            f"'{target_id}' (first_mention {target_first}) "
                                            f"before its own full_reveal {gate}")

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"Checked {sum(len(v) for v in by_type.values())} entities across {len(by_type)} types.")
    print(f"{len(errors)} error(s), {len(warnings)} warning(s).")

    if errors:
        print("\nErrors:")
        for e in errors:
            print(f"  {e}")

    if warnings:
        if verbose:
            print("\nWarnings:")
            for w in warnings:
                print(f"  {w}")
        else:
            print("(run with --verbose to list warnings)")

    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
