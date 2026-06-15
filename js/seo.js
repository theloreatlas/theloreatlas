/**
 * seo.js — Meta tags + JSON-LD structured data.
 * Part of The Lore Atlas SPA (split from app.js, Session 13.5).
 *
 * ⚠️  KEEP IN SYNC WITH scripts/build_pages.py (the build-time pre-renderer).
 *     This file generates per-page <head> at RUNTIME; build_pages.py generates
 *     the SAME output at BUILD TIME for non-JS crawlers. They must produce
 *     identical titles, descriptions, and JSON-LD. Twin function pairs:
 *       firstSentencesForMeta ↔ first_sentences      truncateForMeta ↔ truncate
 *       buildEntityMeta       ↔ build_meta           tryParseEventDate ↔ try_parse_event_date
 *       buildEntityJsonLd     ↔ build_jsonld_for_entity
 *       buildBreadcrumbJsonLd ↔ build_breadcrumb_jsonld
 *     Change one side → change the other, then re-run build_pages.py and confirm
 *     a deployed page's view-source matches the runtime DOM head.
 *     (Full DRY would require a Node build step running this JS — deferred; see PK3.)
 */

// ── Meta tags ────────────────────────────────────────────────────────────────

function truncateForMeta(text, max = 155) {
  if (!text) return '';
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.substring(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return slice.substring(0, lastSpace > 0 ? lastSpace : max).trim() + '…';
}

function firstSentencesForMeta(text, maxChars = 155) {
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g);
  if (!sentences || sentences.length === 0) return truncateForMeta(text, maxChars);
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > maxChars) break;
    out += s + ' ';
  }
  out = out.trim();
  return out || truncateForMeta(sentences[0], maxChars);
}

function setMetaTag(nameOrProperty, content) {
  const isOg = nameOrProperty.startsWith('og:');
  const attr = isOg ? 'property' : 'name';
  let tag = document.querySelector(`meta[${attr}="${nameOrProperty}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, nameOrProperty);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function removeMetaTag(nameOrProperty) {
  const isOg = nameOrProperty.startsWith('og:');
  const attr = isOg ? 'property' : 'name';
  const tag = document.querySelector(`meta[${attr}="${nameOrProperty}"]`);
  if (tag) tag.remove();
}

function buildEntityMeta(entity, entityType, seriesName) {
  const cfg = LoreLoader.getMetaConfig() || {};
  const SITE = cfg.site_name || 'The Lore Atlas';
  const ogTypes = cfg.og_types || {};
  let title, description, ogType = ogTypes[entityType] || 'article';

  switch (entityType) {
    case 'characters': {
      title = `${entity.name} | ${seriesName} | ${SITE}`;
      description = entity.biography
        ? firstSentencesForMeta(entity.biography)
        : `${entity.role || 'Character'} in ${seriesName}.`;
      break;
    }
    case 'cases': {
      title = `${entity.title} | ${seriesName} | ${SITE}`;
      description = firstSentencesForMeta(entity.synopsis);
      break;
    }
    case 'books': {
      title = `${entity.title} | ${seriesName} | ${SITE}`;
      ogType = 'book';
      const base = firstSentencesForMeta(entity.description, 130);
      const yearTag = entity.publication_year ? ` Published ${entity.publication_year}.` : '';
      description = (base + yearTag).length <= 160 ? base + yearTag : truncateForMeta(base);
      break;
    }
    case 'locations': {
      title = `${entity.name} | ${seriesName} | ${SITE}`;
      description = firstSentencesForMeta(entity.description);
      break;
    }
    case 'artifacts': {
      title = `${entity.name} | ${seriesName} | ${SITE}`;
      const base = firstSentencesForMeta(entity.description, 130);
      const sig = entity.significance ? ' ' + firstSentencesForMeta(entity.significance, 160 - base.length - 1) : '';
      description = base + sig;
      break;
    }
    case 'factions': {
      title = `${entity.name} | ${seriesName} | ${SITE}`;
      description = firstSentencesForMeta(entity.description);
      break;
    }
    case 'events': {
      const baseTitle = `${entity.name} | ${seriesName}`;
      title = baseTitle.length > 50 ? baseTitle : `${baseTitle} | ${SITE}`;
      const datePart = entity.date_or_position ? `${entity.date_or_position}. ` : '';
      description = truncateForMeta(datePart + firstSentencesForMeta(entity.description, 155 - datePart.length));
      break;
    }
    case 'relationships': {
      const a = LoreLoader.getById(entity.character_a);
      const b = LoreLoader.getById(entity.character_b);
      const aName = a ? a.name : entity.character_a;
      const bName = b ? b.name : entity.character_b;
      title = `${aName} and ${bName} | ${SITE}`;
      if (entity.notes) {
        description = firstSentencesForMeta(entity.notes);
      } else {
        const caseEntity = entity.first_established ? LoreLoader.getById(entity.first_established) : null;
        const caseTitle = caseEntity ? caseEntity.title : entity.first_established;
        description = `${entity.relationship_type} between ${aName} and ${bName} in ${seriesName}.${caseTitle ? ` First established in "${caseTitle}".` : ''}`;
      }
      break;
    }
    default: {
      title = `${entity.name || entity.title || ''} | ${seriesName} | ${SITE}`;
      description = firstSentencesForMeta(entity.description || entity.biography || '');
    }
  }

  return { title, description, ogType };
}

// ── JSON-LD structured data ──────────────────────────────────────────────────

function setJsonLd(parts, entity, entityType, seriesObj) {
  // Remove all existing JSON-LD blocks (defensive — prevents orphans on SPA nav).
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => s.remove());

  const cfg = LoreLoader.getMetaConfig() || {};
  const SITE_URL = cfg.site_url || 'https://theloreatlas.com';
  let canonPath = window.location.pathname;
  if (canonPath !== '/' && !canonPath.endsWith('/')) canonPath += '/';
  const url = SITE_URL + canonPath;

  const blocks = [];

  // WebSite with SearchAction — present on every page.
  blocks.push({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': cfg.site_name || 'The Lore Atlas',
    'url': SITE_URL + '/',
    'potentialAction': {
      '@type': 'SearchAction',
      'target': {
        '@type': 'EntryPoint',
        'urlTemplate': SITE_URL + '/search?q={search_term_string}'
      },
      'query-input': 'required name=search_term_string'
    }
  });

  // BreadcrumbList — every non-home page.
  if (parts.length > 0 && parts[0] !== 'search') {
    blocks.push(buildBreadcrumbJsonLd(parts, entity, entityType, seriesObj, SITE_URL));
  }

  // Per-entity schema — entity detail pages only.
  if (parts.length === 3 && entity) {
    const block = buildEntityJsonLd(entity, entityType, seriesObj, url);
    if (block) blocks.push(block);
  }

  for (const block of blocks) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    // textContent is safe — </script> sequences in JSON won't terminate the tag.
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  }
}

function buildEntityJsonLd(entity, entityType, seriesObj, url) {
  const desc = firstSentencesForMeta(
    entity.biography || entity.synopsis || entity.description || entity.notes || ''
  );

  switch (entityType) {
    case 'characters':
      return {
        '@context': 'https://schema.org',
        '@type': 'Person',
        'name': entity.name,
        ...(entity.aliases && entity.aliases.length ? { 'alternateName': entity.aliases } : {}),
        'description': desc,
        'url': url
      };

    case 'books':
      return {
        '@context': 'https://schema.org',
        '@type': 'Book',
        'name': entity.title,
        'author': { '@type': 'Person', 'name': (seriesObj && seriesObj.author) || 'Unknown' },
        'datePublished': entity.publication_year ? String(entity.publication_year) : undefined,
        'description': desc,
        'url': url,
        'inLanguage': 'en',
        'genre': 'Mystery'
      };

    case 'locations':
      return {
        '@context': 'https://schema.org',
        '@type': 'Place',
        'name': entity.name,
        'description': desc,
        'url': url
      };

    case 'factions': {
      const block = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        'name': entity.name,
        'description': desc,
        'url': url
      };
      if (entity.parent_org) {
        const parent = LoreLoader.getById(entity.parent_org);
        block.parentOrganization = { '@type': 'Organization', 'name': parent ? parent.name : entity.parent_org };
      }
      if (entity.child_orgs && entity.child_orgs.length) {
        block.subOrganization = entity.child_orgs.map(id => {
          const child = LoreLoader.getById(id);
          return { '@type': 'Organization', 'name': child ? child.name : id };
        });
      }
      return block;
    }

    case 'events': {
      const block = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        'name': entity.name,
        'description': desc,
        'url': url
      };
      const isoDate = tryParseEventDate(entity.date_or_position);
      if (isoDate) block.startDate = isoDate;
      return block;
    }

    case 'cases': {
      const sourceBook = entity.source_book ? LoreLoader.getById(entity.source_book) : null;
      const isNovel = sourceBook && sourceBook.type === 'novel';
      return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': entity.title,
        'description': firstSentencesForMeta(entity.synopsis || ''),  // never solution
        'url': url,
        'about': {
          '@type': isNovel ? 'Book' : 'ShortStory',
          'name': entity.title,
          'author': { '@type': 'Person', 'name': (seriesObj && seriesObj.author) || 'Unknown' }
        }
      };
    }

    case 'artifacts':
      return {
        '@context': 'https://schema.org',
        '@type': 'Thing',
        'name': entity.name,
        'description': desc,
        'url': url
      };

    case 'relationships': {
      const a = LoreLoader.getById(entity.character_a);
      const b = LoreLoader.getById(entity.character_b);
      const aName = a ? a.name : entity.character_a;
      const bName = b ? b.name : entity.character_b;
      return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': `${aName} and ${bName}`,
        'description': desc,
        'url': url,
        'about': [
          { '@type': 'Person', 'name': aName },
          { '@type': 'Person', 'name': bName }
        ]
      };
    }
  }
  return null;
}

function buildBreadcrumbJsonLd(parts, entity, entityType, seriesObj, SITE_URL) {
  const crumbs = [{ name: 'Home', url: SITE_URL + '/' }];

  if (parts.length >= 1 && parts[0] !== 'search') {
    const sName = seriesObj ? seriesObj.name : parts[0];
    crumbs.push({ name: sName, url: `${SITE_URL}/${parts[0]}/` });
  }
  if (parts.length >= 2) {
    if (parts[1] === 'graph') {
      crumbs.push({ name: 'Relationship Graph', url: `${SITE_URL}/${parts[0]}/graph/` });
    } else {
      const etConfig = ENTITY_TYPES.find(e => e.key === parts[1]);
      crumbs.push({
        name: etConfig ? etConfig.label : parts[1],
        url: `${SITE_URL}/${parts[0]}/${parts[1]}/`
      });
    }
  }
  if (parts.length >= 3 && entity) {
    const a = entity.character_a ? LoreLoader.getById(entity.character_a) : null;
    const b = entity.character_b ? LoreLoader.getById(entity.character_b) : null;
    const relName = a && b ? `${a.name} and ${b.name}` : null;
    crumbs.push({
      name: entity.name || entity.title || relName || entity.id,
      url: SITE_URL + (window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/')
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': crumbs.map((c, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'name': c.name,
      'item': c.url
    }))
  };
}

function tryParseEventDate(text) {
  if (!text) return null;
  const months = { January:'01', February:'02', March:'03', April:'04', May:'05', June:'06',
    July:'07', August:'08', September:'09', October:'10', November:'11', December:'12' };
  const m = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/);
  if (m) return `${m[2]}-${months[m[1]]}`;
  const yearMatch = text.match(/^(\d{4})/);
  return yearMatch ? yearMatch[1] : null;
}

function setMetaTags(parts, entity, entityType, seriesName, notFound) {
  const cfg = LoreLoader.getMetaConfig() || {};
  const SITE = cfg.site_name || 'The Lore Atlas';
  const SITE_URL = cfg.site_url || 'https://theloreatlas.com';
  // og:url uses canonical (trailing-slash) path, matching setCanonical().
  let canonPath = window.location.pathname;
  if (canonPath !== '/' && !canonPath.endsWith('/')) canonPath += '/';
  const fullUrl = SITE_URL + canonPath;

  setMetaTag('og:site_name', SITE);
  setMetaTag('og:url', fullUrl);
  setMetaTag('twitter:card', 'summary');

  // Always remove robots tag first; re-add only on noindex routes.
  removeMetaTag('robots');

  let title, description, ogType;

  if (notFound) {
    title = `Page not found | ${SITE}`;
    description = `The page you're looking for doesn't exist on The Lore Atlas.`;
    ogType = 'website';
    setMetaTag('robots', 'noindex');
  } else if (parts.length === 0 || (parts.length === 1 && parts[0] === 'series')) {
    title = `${SITE} | Public Domain Literary Encyclopedia`;
    const staticDesc = document.querySelector('meta[name="description"]');
    description = staticDesc ? staticDesc.getAttribute('content') : '';
    ogType = 'website';
  } else if (parts[0] === 'search') {
    title = `Search | ${SITE}`;
    description = `Search characters, cases, locations, and more across The Lore Atlas's public domain literary encyclopedias.`;
    ogType = 'website';
    setMetaTag('robots', 'noindex');
  } else if (parts.length === 1) {
    title = `${seriesName} | ${SITE}`;
    const series = LoreLoader.getSeriesById(parts[0]);
    description = series ? truncateForMeta(series.description) : '';
    ogType = 'website';
  } else if (parts.length === 2 && parts[1] === 'graph') {
    title = `${seriesName} Relationship Graph | ${SITE}`;
    description = `Interactive force-directed graph of all character relationships in ${seriesName}. Hover for details, click to navigate.`;
    ogType = 'website';
  } else if (parts.length === 2) {
    const etConfig = ENTITY_TYPES.find(e => e.key === parts[1]);
    const count = LoreLoader.getAll(parts[0], parts[1]).length;
    title = `${etConfig ? etConfig.label : parts[1]} | ${seriesName} | ${SITE}`;
    description = `Browse all ${count} ${etConfig ? etConfig.label.toLowerCase() : parts[1]} in the ${seriesName} encyclopedia. Each entry links to relationships, cases, and source texts.`;
    ogType = 'website';
  } else if (parts.length === 3 && entity) {
    const built = buildEntityMeta(entity, entityType, seriesName);
    title = built.title;
    description = built.description;
    ogType = built.ogType;
  } else {
    title = `${SITE} | Public Domain Literary Encyclopedia`;
    description = '';
    ogType = 'website';
  }

  // Enforce hard length cap on title (from meta-config).
  const maxTitle = cfg.max_title_chars || 70;
  if (title && title.length > maxTitle) {
    title = title.substring(0, maxTitle - 1).trimEnd() + '…';
  }

  document.title = title || SITE;
  setMetaTag('description', description || '');
  setMetaTag('og:title', title || SITE);
  setMetaTag('og:description', description || '');
  setMetaTag('og:type', ogType || 'website');
}

