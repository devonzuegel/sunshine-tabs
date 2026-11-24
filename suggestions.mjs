import { createHash } from "node:crypto";

const day = 86400000;
const digest = values => createHash("sha256").update(JSON.stringify(values)).digest("hex");
export const contentKey = tabs => digest(tabs.map(t=>t.url).sort());
export const reviewKey = tabs => digest(tabs.map(t=>[t.id,t.url]).sort((a,b)=>a[0]-b[0]));

// The daily run is due at 9am Eastern, with catch-up on the next snapshot.
const clock = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"});
export function cycle(time) {
  const parts=Object.fromEntries(clock.formatToParts(time).map(p=>[p.type,p.value]));
  const date=Date.UTC(+parts.year,+parts.month-1,+parts.day);
  return new Date(date-(+parts.hour<9 ? day : 0)).toISOString().slice(0,10);
}
export function assess(live, sets, now=Date.now()) {
  const kept=sets.filter(s=>s.kept);
  const ids=new Set(kept.filter(s=>s.session===live.session).map(s=>s.kept.window));
  const contents=new Set(kept.map(s=>s.kept.content));
  const windows=Map.groupBy ? Map.groupBy(live.tabs,t=>t.window) : live.tabs.reduce((m,t)=>{
    if(!m.has(t.window))m.set(t.window,[]);m.get(t.window).push(t);return m;
  },new Map());
  const candidates=[];
  for(const [id,tabs] of windows){
    if(ids.has(id) || tabs.some(t=>t.windowState!=="minimized" || t.pinned!==false || !(t.touched>0)))continue;
    const last=Math.max(...tabs.map(t=>Math.max(t.touched,t.windowTouched||0)));
    const days=Math.floor((now-last)/day);
    if(days<14)continue;
    if(tabs.some(t=>!/^https?:\/\//i.test(t.url) || /\b(draft|checkout|unsaved|compose)\b/i.test(t.title+" "+t.url) || /\/(edit|compose)([/?#]|$)/i.test(t.url)))continue;
    if(contents.has(contentKey(tabs)))continue;
    candidates.push({window:id,key:reviewKey(tabs),days,count:tabs.length});
  }
  return candidates.sort((a,b)=>b.days-a.days || a.window-b.window);
}
