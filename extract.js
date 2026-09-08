(() => {
  const BLOCKS = new Set(['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'PRE', 'SENTENCE']);
  function visible(el) {
    if (!(el instanceof Element) || el.closest('[data-wnt-ui],script,style,noscript,nav,header,footer,aside,button,input,textarea,select,[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }
  // Read text nodes exactly once. Never write innerHTML or replace source nodes.
  function paragraphs(root) {
    const result = []; let buffer = '', nodes = [];
    const flush = () => { if (buffer.trim()) result.push({ text: buffer.trim(), nodes: [...nodes] }); buffer = ''; nodes = []; };
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) { buffer += node.nodeValue; nodes.push(node); return; }
      if (!(node instanceof Element) || !visible(node)) return;
      if (node.tagName === 'BR') { flush(); return; }
      const block = BLOCKS.has(node.tagName) || node.matches('.sentence');
      if (block) flush();
      for (const child of node.childNodes) walk(child);
      if (block) flush();
    }
    walk(root); flush();
    return result;
  }
  function findRoot(selector, cached) {
    if (selector) {
      try { const selected = document.querySelector(selector); if (selected && visible(selected) && selected.innerText.trim().length >= 20) return selected; } catch {}
    }
    if (cached?.isConnected && visible(cached) && cached.innerText.trim().length > 100) return cached;
    const candidates = Array.from(document.querySelectorAll('article,main,[role="main"],.chapter-content,.chapter-body,.reading-content,#chapter-content,.novel-text,.content')).filter(visible);
    if (!candidates.length) candidates.push(...Array.from(document.querySelectorAll('div')).filter(visible).filter(el => el.querySelector('p,sentence,.sentence')).slice(0, 150));
    let best = null, score = -Infinity;
    for (const el of candidates.slice(0, 150)) {
      const text = el.innerText || ''; if (text.length < 100) continue;
      const links = Array.from(el.querySelectorAll('a')).slice(0, 300).reduce((sum, a) => sum + (a.innerText || '').length, 0);
      if (links / text.length > 0.25) continue;
      const penalty = el.querySelectorAll('nav,aside,footer,[id*="comment"],[class*="comment"]').length * 1000;
      const value = Math.min(text.length, 50000) - penalty;
      if (value > score) { best = el; score = value; }
    }
    return best;
  }
  function detectStory() {
    const current = new URL(location.href);
    const link = document.querySelector('a[rel="up"],.breadcrumb a[href*="/novel/"],.breadcrumb a[href*="/book/"],[aria-label="breadcrumb"] a[href*="/novel/"]');
    if (link) { try { const url = new URL(link.href); if (url.hostname === current.hostname) return WNT.storyFromURL(url.href); } catch {} }
    return WNT.storyFromURL(current.href);
  }
  function selectorFor(el) {
    const parts = [];
    while (el && el !== document.body) {
      if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
      const tag = el.tagName.toLowerCase(); let index = 1;
      for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === el.tagName) index++;
      parts.unshift(`${tag}:nth-of-type(${index})`); el = el.parentElement;
    }
    return parts.join(' > ') || 'body';
  }
  globalThis.WNTExtract = { paragraphs, findRoot, detectStory, selectorFor, visible };
})();
