// KentaevAI Deep Research: поиск по нескольким источникам + чтение страниц.
// Ключи (необязательные, только на сервере): BRAVE_API_KEY, GOOGLE_API_KEY + GOOGLE_CSE_ID, GITHUB_TOKEN.
// Без ключей работают: Wikipedia, DuckDuckGo, GitHub, arXiv, OpenAlex, Hacker News.
import dns from 'node:dns/promises';

const UA = 'KentaevAI-Research/1.0';
const E = encodeURIComponent;
const hits = new Map();

async function J(url, opt = {}, ms = 7000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: c.signal, headers: { 'User-Agent': UA, ...(opt.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } finally { clearTimeout(t); }
}

const P = {
  async wiki(q, l) {
    const lg = ['ru', 'en', 'kk'].includes(l) ? l : 'en';
    const d = await (await J(`https://${lg}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${E(q)}&gsrlimit=2&prop=extracts|info&exintro=1&explaintext=1&exchars=2000&inprop=url&format=json&origin=*`)).json();
    return Object.values(d.query?.pages || {}).map(p => ({ title: p.title + ' — Wikipedia', url: p.fullurl, text: p.extract || '', w: 3 }));
  },
  async ddg(q) {
    const d = await (await J(`https://api.duckduckgo.com/?q=${E(q)}&format=json&no_html=1&skip_disambig=1`)).json();
    const o = [];
    if (d.AbstractURL && d.AbstractText) o.push({ title: d.Heading || q, url: d.AbstractURL, text: d.AbstractText, w: 2 });
    (d.RelatedTopics || []).filter(x => x.FirstURL).slice(0, 2).forEach(x => o.push({ title: x.Text.slice(0, 90), url: x.FirstURL, text: x.Text, w: 1 }));
    return o;
  },
  async github(q) {
    const h = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) h.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
    const d = await (await J(`https://api.github.com/search/repositories?q=${E(q)}&sort=stars&per_page=3`, { headers: h })).json();
    return (d.items || []).map(r => ({ title: 'GitHub: ' + r.full_name, url: r.html_url, text: `${r.description || ''} Звёзд: ${r.stargazers_count}. Лицензия: ${r.license?.spdx_id || 'нет'}. Обновлено: ${String(r.pushed_at).slice(0, 10)}.`, w: 2, rich: true }));
  },
  async arxiv(q) {
    const x = await (await J(`https://export.arxiv.org/api/query?search_query=all:${E(q)}&max_results=2`)).text();
    return [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
      const g = k => (m[1].match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`)) || [, ''])[1].replace(/\s+/g, ' ').trim();
      return { title: 'arXiv: ' + g('title'), url: g('id'), text: g('summary'), w: 2, rich: true };
    });
  },
  async openalex(q) {
    const d = await (await J(`https://api.openalex.org/works?search=${E(q)}&per-page=3&select=title,doi,publication_year,cited_by_count`)).json();
    return (d.results || []).filter(r => r.doi).map(r => ({ title: r.title, url: r.doi, text: `${r.title} (${r.publication_year}), цитирований: ${r.cited_by_count}`, w: 1.5 }));
  },
  async hn(q) {
    const d = await (await J(`https://hn.algolia.com/api/v1/search?query=${E(q)}&tags=story&hitsPerPage=3`)).json();
    return (d.hits || []).filter(x => x.url).map(x => ({ title: 'HN: ' + x.title, url: x.url, text: '', w: 1.5 }));
  },
  async brave(q) {
    if (!process.env.BRAVE_API_KEY) return [];
    const d = await (await J(`https://api.search.brave.com/res/v1/web/search?q=${E(q)}&count=5`, { headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY } })).json();
    return (d.web?.results || []).map(r => ({ title: r.title, url: r.url, text: (r.description || '').replace(/<[^>]+>/g, ''), w: 3 }));
  },
  async google(q) {
    const { GOOGLE_API_KEY: k, GOOGLE_CSE_ID: cx } = process.env;
    if (!k || !cx) return [];
    const d = await (await J(`https://www.googleapis.com/customsearch/v1?key=${k}&cx=${cx}&q=${E(q)}&num=5`)).json();
    return (d.items || []).map(r => ({ title: r.title, url: r.link, text: r.snippet || '', w: 3 }));
  },
};

const priv = a => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|f[cd]|fe80)/i.test(a);
async function safe(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol) || /^(localhost|.*\.(local|internal))$/i.test(x.hostname)) return false;
    const a = await dns.lookup(x.hostname, { all: true });
    return a.length > 0 && !a.some(r => priv(r.address));
  } catch { return false; }
}

async function page(u) {
  let url = u;
  for (let i = 0; i < 3; i++) {
    if (!(await safe(url))) return '';
    const c = new AbortController(), t = setTimeout(() => c.abort(), 7000);
    try {
      const r = await fetch(url, { redirect: 'manual', signal: c.signal, headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).href; continue; }
      if (!r.ok || !/text\/(html|plain)/.test(r.headers.get('content-type') || '')) return '';
      let h = (await r.text()).slice(0, 600000);
      const art = h.match(/<(article|main)[\s\S]*?<\/\1>/i);
      if (art && art[0].length > 500) h = art[0];
      return h.replace(/<(script|style|nav|footer|header|svg|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 3000);
    } catch { return ''; } finally { clearTimeout(t); }
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), now = Date.now();
  const log = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (log.length >= 12) return res.status(429).json({ error: 'rate_limited' });
  hits.set(ip, [...log, now]);

  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const qs = [...new Set((Array.isArray(b?.queries) ? b.queries : []).map(s => String(s).trim().slice(0, 200)).filter(Boolean))].slice(0, 4);
  if (!qs.length) return res.status(400).json({ error: 'no_queries' });
  const lang = String(b.lang || 'ru').slice(0, 2), errors = [], pool = new Map();

  await Promise.all(qs.flatMap(q => Object.entries(P).map(async ([name, fn]) => {
    try {
      for (const r of await fn(q, lang)) {
        if (!r.url || !/^https?:/.test(r.url)) continue;
        const k = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
        const old = pool.get(k);
        if (old) old.score += 1; else pool.set(k, { ...r, site: name, score: r.w });
      }
    } catch (e) { if (!errors.includes(name)) errors.push(name); }
  })));

  const top = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  await Promise.all(top.filter(s => !s.rich && s.text.length < 600).slice(0, 5).map(async s => {
    const t = await page(s.url); if (t.length > s.text.length) s.text = t;
  }));
  const sources = top.filter(s => s.text).map((s, i) => ({ n: i + 1, title: String(s.title).slice(0, 140), url: s.url, site: s.site, text: s.text.slice(0, 2500) }));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ sources, found: pool.size, visited: sources.length, errors });
}
