export const defaultView = { q: "", sort: "order", dir: -1, age: "" };
export function prepare(t) {
  let site;
  try {
    site = new URL(t.url).hostname || new URL(t.url).protocol;
  } catch {
    site = "Unknown site";
  }
  return {
    ...t,
    site,
    search: (t.title + " " + t.url + " " + site).toLowerCase(),
  };
}
const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
function textKey(tab, sort) {
  if (sort === "title") return tab.title || tab.url;
  if (sort === "window") return tab.windowLabel || String(tab.window);
  if (sort === "group") return tab.groupLabel;
  return tab.site;
}
const thirtyDays = 30 * 86400000;
export function revisitGrace(previous, current, now) {
  if (previous?.grace?.until > now) return previous.grace;
  const touched = current.touched;
  if (previous?.touched > 0 && touched > previous.touched &&
      previous.touched <= touched - thirtyDays && touched <= now && touched + 30000 > now) {
    return {until: touched + 30000, priorTouch: previous.touched};
  }
}
function viewTouch(tab, age, now) {
  return Number(age) === 30 && tab.grace?.until > now ? tab.grace.priorTouch : tab.touched;
}
export function matchingTabs(tabs, v, now = Date.now()) {
  const query = v.q.trim().toLowerCase(),
    midnight = new Date(now).setHours(0, 0, 0, 0);
  return tabs.filter(
    (t) =>
      (!query || t.search.includes(query)) &&
      (!v.age ||
        (v.age === "today"
          ? t.opened >= midnight
          : viewTouch(t, v.age, now) && viewTouch(t, v.age, now) <= now - Number(v.age) * 86400000)),
  );
}
export function matches(tabs, v, now = Date.now()) {
  const rows = matchingTabs(tabs, v, now);
  const touchForView = tab => viewTouch(tab, v.age, now);
  return rows.sort((a, b) => {
    if (["title", "site", "group", "window"].includes(v.sort)) {
      const cmp = collator.compare(textKey(a, v.sort), textKey(b, v.sort));
      if (cmp) return v.dir * cmp;
      if (v.sort === "title") {
        const byUrl = collator.compare(a.url, b.url);
        if (byUrl) return v.dir * byUrl;
      }
    } else if (v.sort !== "order") {
      const x = v.sort === "touched" ? touchForView(a) : a[v.sort],
        y = v.sort === "touched" ? touchForView(b) : b[v.sort];
      if (x == null && y != null) return 1;
      if (x != null && y == null) return -1;
      if (x !== y) return v.dir * (x - y);
    }
    return a.window - b.window || a.index - b.index;
  });
}
export function duplicates(rows) {
  const groups = new Map();
  for (const t of rows) {
    if (!t.url) continue;
    const g = groups.get(t.url) || [];
    g.push(t);
    groups.set(t.url, g);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
export function markdown(tabs) {
  return tabs
    .map(
      (t) =>
        "[" +
        (t.title || t.url).replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ") +
        "](<" +
        t.url.replace(/[<>\s]/g, encodeURIComponent) +
        ">)",
    )
    .join("\n");
}

// Rank recurring phrases from local tab titles ahead of generic site names.
// Use every tab, including singletons. Short labels group related pages, while
// explicit product names distinguish tools from the subjects being researched.
const windowThemes = [
  ["Heroku", /(?:^|\.)heroku\.com$/i],
  ["Meetings", /(?:^|\.)otter\.ai$/i],
  ["Maps", /^(?:earth|maps)\.google\./i],
  ["Social profiles & posts", /(?:^|\.)(?:x|twitter|linkedin|facebook)\.com$/i],
  ["Prediction markets", /(?:^|\.)manifold\.markets$/i],
];
const relatedTerms = [
  ["investment", /\b(invest\w*|fundrais\w*|funds?|funding|capital|ventures?|offering|pitch)\b/i],
  ["meeting", /\b(otter|meetings?|transcripts?)\b/i],
  ["reading", /\b(reading|books?|articles?|blogs?|substack)\b/i],
  ["profile", /\b(profiles?|linkedin|bios?|biographies)\b/i],
  ["deck", /\b(decks?|slides?|presentations?)\b/i],
  ["development", /\b(heroku|deploy\w*|hosting|devops)\b/i],
];
function topicWords(text) {
  const words = new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter(w => !/^(the|and|for|with|from|window|tabs?|my|other|research|google|www|com|org|net|new|pages?)$/.test(w)));
  for (const [term,pattern] of relatedTerms) if (pattern.test(text)) words.add(term);
  return words;
}
export function groupingFindings(name, tabs) {
  if (!name || /^(miscellaneous|misc|everything|general|mixed|work|personal|unsorted)$/i.test(name.trim())) return [];
  const expected = topicWords(name);
  if (!expected.size) return [];
  const subjects = tabs.map(tab => {
    let source = (tab.title || "") + " " + (tab.site || "") + " " + (tab.groupLabel || "");
    if (tab.url?.includes("docs.google.com/presentation/")) source += " slides";
    return {tab, words:topicWords(source)};
  });
  const matches = words => [...expected].some(w => words.has(w));
  const supported = subjects.some(({words}) => matches(words));
  return subjects.filter(({words,tab}) => !matches(words) && words.size && tab.title &&
    (supported || relatedTerms.some(([term]) => expected.has(term)))).map(({tab}) => ({
      key:JSON.stringify([name.trim().toLowerCase(),tab.url]),
      id:tab.id, title:tab.title, site:tab.site,
      reason:"Its title and site (" + tab.site + ") don’t show a clear connection to “" + name + "”."
    }));
}

export function mixedWindowNames(tabs) {
  const topics = new Map();
  for (const tab of tabs) {
    const site = (tab.site || "").replace(/^www\./, "");
    const title = tab.title || "";
    let topic = windowThemes.find(([, pattern]) => pattern.test(site))?.[0];
    if (!topic) {
      if (/real estate|capital management|invest(?:ing|ment|or)|ventures|offering deck|capital\.com|aureon partners/i.test(title + " " + site)) topic = "Investment research";
      else if (/perplexity\.ai$/i.test(site) || / - Google Search$/i.test(title)) topic = "Web research";
      else topic = tab.group >= 0 && tab.groupLabel && tab.groupLabel !== "Unnamed group"
        ? tab.groupLabel : site || title.slice(0, 36) || "Other tabs";
    }
    topics.set(topic, (topics.get(topic) || 0) + 1);
  }
  if (topics.size < 2) return [];
  const labels = [...topics.keys()].sort((a,b) => topics.get(b)-topics.get(a) || a.localeCompare(b));
  const short = new Map([["Investment research","Investing"], ["Web research","Search"],
    ["Social profiles & posts","Social"], ["Prediction markets","Forecasts"]]);
  const joined = labels.map(name => short.get(name) || name).join(" · ");
  return [joined, labels.join(" / "), labels[0] + " with " + labels.slice(1).join(", "),
    labels.join(", ") + " workspace"];
}

export function windowNameSuggestions(tabs) {
  const groups = new Map(), phrases = new Map(), sites = new Map();
  const generic = /^(the|and|for|from|with|your|this|that|http|https|www|com|google|docs|sheets|slides|drive|youtube|new|tab|untitled|document|spreadsheet|presentation|inbox|search|home|page|sign|login|linkedin)$/i;
  const count = (map, name) => map.set(name, (map.get(name) || 0) + 1);
  for (const tab of tabs) {
    if (tab.group >= 0 && tab.groupLabel && tab.groupLabel !== "Unnamed group") count(groups, tab.groupLabel);
    if (tab.site) count(sites, tab.site);
    const title = (tab.title || "").replace(/^\s*\(\d+\)\s*/, "").split(/\s+[|–—]\s+|\s+-\s+(?:Google|YouTube|LinkedIn)/i)[0];
    const words = title.match(/[\p{L}][\p{L}\p{N}'’-]*/gu) || [];
    const seen = new Set();
    for (let i=0; i<Math.min(words.length,16); i++) {
      const word=words[i];
      if (word.length < 3 || generic.test(word)) continue;
      seen.add(word);
      if(i+1<words.length && !generic.test(words[i+1]) && words[i+1].length>=3)
        seen.add(word+" "+words[i+1]);
    }
    for(const phrase of seen) count(phrases,phrase);
  }
  const rank=map=>[...map].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).map(([name])=>name);
  const topics=[...phrases].filter(([,n])=>n>=2).sort((a,b)=>
    (b[1]*(b[0].includes(" ")?1.5:1))-(a[1]*(a[0].includes(" ")?1.5:1)) || a[0].localeCompare(b[0])
  ).map(([name])=>name);
  const domains=rank(sites);
  const firstTitle=tabs.slice().sort((a,b)=>a.index-b.index)[0]?.title?.trim();
  return [...new Set([...mixedWindowNames(tabs), ...rank(groups), ...topics, firstTitle?.slice(0,48), domains.slice(0,2).join(" + "), ...domains].filter(Boolean))];
}

// Window dates use the whole inventory, even while a search hides some tabs.
export function windowDates(tabs) {
  const dates = new Map();
  for (const tab of tabs) {
    const entry = dates.get(tab.window) || {created:null, touched:null};
    entry.created = tab.windowCreated || entry.created;
    entry.touched = Math.max(entry.touched || 0, tab.windowTouched || 0, tab.touched || 0) || null;
    dates.set(tab.window, entry);
  }
  return dates;
}
export function sortedWindows(windows, dates, mode) {
  const entries = [...windows];
  if (!mode || mode === "tabs") return entries;
  const [field, direction] = mode.split("-");
  return entries.sort(([a], [b]) => {
    const x = dates.get(a)?.[field], y = dates.get(b)?.[field];
    if (x == null || y == null) return (x == null) - (y == null) || a-b;
    return (direction === "oldest" ? x-y : y-x) || a-b;
  });
}
