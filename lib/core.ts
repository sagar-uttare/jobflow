import { timingSafeEqual } from 'node:crypto';
export type Pipeline = {name:string;folder:string;privateChannel:string;publicChannel:string;slots:string[];ctaText:string;ctaUrl:string};
export function pipelines(): Pipeline[] {
  const raw=process.env.PIPELINES_JSON; if(!raw) throw Error('PIPELINES_JSON is missing');
  let a: unknown; try {a=JSON.parse(raw)} catch {throw Error('PIPELINES_JSON is not valid JSON')}
  if(!Array.isArray(a)||!a.length) throw Error('PIPELINES_JSON must be a non-empty array');
  const seen=new Set<string>(), folders=new Set<string>();
  for(const p of a){
    if(!p || typeof p!=='object' || !/^[a-z0-9_-]+$/.test(p.name||'') || seen.has(p.name)) throw Error('Pipeline names must be unique lowercase identifiers');
    if(typeof p.folder!=='string'||!p.folder.startsWith('/')||folders.has(p.folder)) throw Error('Each pipeline requires a unique ImageKit folder beginning with /');
    if(!p.privateChannel && !p.publicChannel) throw Error(`${p.name}: configure at least one channel`);
    for(const field of ['privateChannel','publicChannel','ctaText','ctaUrl']) if(typeof p[field]!=='string') throw Error(`${p.name}: ${field} must be a string`);
    if(p.ctaUrl && !/^https:\/\//i.test(p.ctaUrl)) throw Error(`${p.name}: CTA must use HTTPS`);
    if(!Array.isArray(p.slots)||!p.slots.length||p.slots.some((s:unknown)=>typeof s!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))||new Set(p.slots).size!==p.slots.length) throw Error(`${p.name}: slots must be unique HH:MM times`);
    seen.add(p.name);folders.add(p.folder);
  }
  return a as Pipeline[];
}
export function required(){for(const k of ['OPENAI_API_KEY','IMAGEKIT_PRIVATE_KEY','TELEGRAM_BOT_TOKEN','TAVILY_API_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','ADMIN_TOKEN','CRON_SECRET']) if(!process.env[k]) throw Error(`Missing environment variable: ${k}`);}
export function auth(req:Request, name:'ADMIN_TOKEN'|'CRON_SECRET') {const expected=process.env[name]; if(!expected)return false; const header=req.headers.get('authorization'); const key=name==='ADMIN_TOKEN'?req.headers.get('x-admin-key'):header?.startsWith('Bearer ')?header.slice(7):null; if(!key)return false; const a=Buffer.from(key),b=Buffer.from(expected); return a.length===b.length&&timingSafeEqual(a,b);}
export function ist(d=new Date()){const x=new Date(d.getTime()+330*60000);return {date:x.toISOString().slice(0,10), seconds:x.getUTCHours()*3600+x.getUTCMinutes()*60+x.getUTCSeconds(),label:x.toISOString().slice(11,19)+' IST'};}
export function due(p:Pipeline, date=new Date(), windowSeconds=110){const now=ist(date);return p.slots.filter(s=>{const [h,m]=s.split(':').map(Number);const delta=now.seconds-(h*60+m)*60;return delta>=0&&delta<windowSeconds;});}
export function publicCopy(text:string,p:Pipeline){const lines=text.split('\n').map(line=>/^\s*(⭐\s*HR Name|📩\s*Email|🔗\s*LinkedIn|🏢\s*Company LinkedIn|🔗\s*Apply Link):/i.test(line)?line.replace(/:.*/,':'):line); const cta=p.ctaUrl?`${p.ctaText}\n${p.ctaUrl}`:''; const idx=lines.findIndex(x=>x.includes('🌐 Website:'));if(cta){if(idx>=0) lines.splice(idx,0,cta,'');else lines.push('',cta)}return lines.join('\n');}
