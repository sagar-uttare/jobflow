import type {Pipeline} from './core';
import { redis } from './redis';
const ik='https://api.imagekit.io/v1';
const basic=()=>`Basic ${Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString('base64')}`;
async function json(res:Response,service:string){const t=await res.text();if(!res.ok)throw Error(`${service} HTTP ${res.status}: ${t.slice(0,300)}`);try{return JSON.parse(t)}catch{throw Error(`${service}: invalid JSON response`)}}
export type Image={fileId:string;name:string;url:string};
export async function oldest(p:Pipeline):Promise<Image|null>{const q=new URLSearchParams({type:'file',path:p.folder,fileType:'image',limit:'1',sort:'ASC_CREATED'});const r=await fetch(`${ik}/files?${q}`,{headers:{authorization:basic()},signal:AbortSignal.timeout(12000),cache:'no-store'});const x=await json(r,'ImageKit list');if(!Array.isArray(x))throw Error('ImageKit returned an unexpected list response');if(!x.length)return null;const f=x[0];if(!f.fileId||!f.url)throw Error('ImageKit returned an invalid file');const u=new URL(f.url);if(u.protocol!=='https:'||!u.hostname.endsWith('.imagekit.io'))throw Error('Unexpected ImageKit image URL');return {fileId:f.fileId,name:f.name||f.fileId,url:f.url};}
export async function remove(id:string){const r=await fetch(`${ik}/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:{authorization:basic()},signal:AbortSignal.timeout(12000)});if(r.status===404)return; if(!r.ok)throw Error(`ImageKit delete HTTP ${r.status}`);}
export async function extract(file:Image):Promise<{text:string;recruiter:string;company:string}>{const image=await fetch(file.url,{signal:AbortSignal.timeout(15000)});if(!image.ok)throw Error(`Image download HTTP ${image.status}`);const bytes=Buffer.from(await image.arrayBuffer());if(bytes.length>8*1024*1024)throw Error('Image exceeds 8 MB');const mime=image.headers.get('content-type')?.split(';')[0]||'image/jpeg';if(!['image/jpeg','image/png','image/webp','image/gif'].includes(mime))throw Error('Unsupported image type');const prompt=`You are extracting a job advertisement from a screenshot of a social-media feed. Identify the single post whose own body contains the hiring announcement. Read only that post's body: it starts after that post's author header and ends before its reaction/comment/action row or the next feed item. Ignore all navigation, profile headers that are not part of the job text, comments, reactions, advertisements, and every preceding or following feed card. In particular, never use an employer/logo/name visible in a neighboring feed item as this job's company. Return exactly these JSON keys: isJob (boolean), roles (array of role names), company, companyEvidence, location, experience, employment, recruiter, recruiterEvidence, uploaderName, uploaderEvidence, email, recruiterLinkedIn, applyLink, website, skills (array of short skill phrases). Use empty strings and arrays when unknown. Company means the employer/client explicitly named inside this job post's own text only; do not infer it from the poster's profile, email domain, logos, neighboring posts, comments, hashtags, or search results. companyEvidence must be a short exact quote from this job post's body that names the employer; if no such quote exists, leave both company and companyEvidence empty. Do not guess a company. Use recruiter and recruiterEvidence only for a named HR/recruiter contact explicitly identified in the target post body; otherwise leave them empty. Also extract uploaderName and uploaderEvidence for the human author/byline of this exact target post. If a company page shows an individual as the author or sharer, use that individual; if only a company page is shown, leave uploaderName empty. Never use someone who merely liked the post, commented, or appears in an adjacent feed item. uploaderEvidence must quote the target post's author/byline and include uploaderName. The uploader may be used as the fallback HR Name even when their profile title is not HR; do not claim any role beyond the displayed name. Read any contact email exactly as shown. Exclude introductions, company descriptions, marketing text, comments and hashtags from the job facts. Extract every advertised role. Keep skills short and deduplicated. Do not invent or guess facts, links, names or information. Return JSON only.`;
const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:${mime};base64,${bytes.toString('base64')}`,detail:'high'}}]}],max_tokens:1800}),signal:AbortSignal.timeout(35000)});const j=await json(r,'OpenAI');let data;try{data=JSON.parse(j.choices?.[0]?.message?.content)}catch{throw Error('OpenAI response was not valid JSON')};if(data.isJob!==true)throw Error('Image not confidently identified as a job; retained for review');
const val=(x:unknown,max=180)=>typeof x==='string'?x.replace(/[\r\n]+/g,' ').replace(/\*\*/g,'').trim().slice(0,max):'';
const arr=(x:unknown)=>Array.isArray(x)?x.map(v=>val(v,120)).filter(Boolean).slice(0,20):[];
const roles=arr(data.roles),skills=arr(data.skills);if(!roles.length)throw Error('No job roles could be read from the image; image retained for review');
const email=val(data.email),companyCandidate=val(data.company),companyEvidence=val(data.companyEvidence,300),recruiterCandidate=val(data.recruiter),recruiterEvidence=val(data.recruiterEvidence,240),uploaderCandidate=val(data.uploaderName),uploaderEvidence=val(data.uploaderEvidence,240);const norm=(s:string)=>` ${s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()} `;const companyContext=/(?:\bcompany\b|\bemployer\b|\bclient\b|\bhiring\b|\bhired\b|\bopportunity\b|\brole\b|\bposition\b|\bjoin\b|\bat\b|\bfor\b)/i.test(companyEvidence);const explicitCompany=companyCandidate&&companyEvidence&&companyContext&&norm(companyEvidence).includes(norm(companyCandidate))?companyCandidate:'';const company=explicitCompany||companyFromEmail(email)||'';const explicitRecruiter=recruiterCandidate&&/(?:recruiter|recruitment|talent acquisition|human resources|\bhr\b)/i.test(recruiterEvidence)&&norm(recruiterEvidence).includes(norm(recruiterCandidate))?recruiterCandidate:'';const uploader=uploaderCandidate&&uploaderEvidence&&norm(uploaderEvidence).includes(norm(uploaderCandidate))?uploaderCandidate:'';const recruiter=explicitRecruiter||uploader;const lines:string[]=[];
lines.push(`🚀 Hiring: ${roles.length===1?roles[0]:`${roles.length} Open Positions`}`,'');
if(company)lines.push(`🏢 Company: ${company}`);
if(roles.length>1)lines.push('','💼 Open Positions:',...roles.map((role,i)=>`${i+1}. ${role}`));
for(const [label,value] of [['📍 Location',val(data.location)],['⭐ Experience',val(data.experience)],['💼 Employment',val(data.employment)]] as const)if(value)lines.push(`${label}: ${value}`);
if(skills.length)lines.push('','🛠️ Key Skills:',...skills.map(x=>`- ${x}`));
lines.push('','👤 Recruiter / HR Details:',`⭐ HR Name: ${recruiter}`,`📩 Email: ${email}`,`🔗 LinkedIn: `);
if(val(data.applyLink))lines.push(`🔗 Apply Link: ${val(data.applyLink)}`);
if(val(data.website))lines.push('',`🌐 Website: ${val(data.website)}`);
return {text:lines.join('\n'),recruiter,company};}

/** Keep supported fields only; never post unsupported sections or prose. */
export function cleanJobFormat(text:string):string {
 const allowed=/^(?:🚀\s*Hiring:|🏢\s*Company:|📍\s*Location:|⭐\s*Experience:|💼\s*(?:Employment|Role|Open Positions):|🛠️?\s*Key Skills:|👤\s*Recruiter\s*\/\s*HR Details:|⭐\s*HR Name:|📩\s*Email:|🔗\s*LinkedIn:|🏢\s*Company LinkedIn:|🔗\s*Apply Link:|🌐\s*Website:)/i;
 let section:'roles'|'skills'|null=null;const out:string[]=[];
 for(const raw of text.split('\n')){
  let line=raw.trim().replace(/\*\*/g,'');if(!line){if(out.length && out[out.length-1]!=='')out.push('');continue;}
  if(allowed.test(line)){section=/^💼\s*Open Positions:/i.test(line)?'roles':/^🛠️?\s*Key Skills:/i.test(line)?'skills':null;out.push(line);continue;}
  if(section==='skills'&&/^[-•]\s+\S/.test(line)&&line.length<=140){out.push(line.replace(/^•/,'-'));continue;}
  if(section==='roles'&&/^(?:[-•]\s+|\d+[.)]\s*)\S/.test(line)&&line.length<=180){out.push(line.replace(/^•/,'-'));continue;}
  // Unknown heading/prose ends any preceding list and is discarded.
  section=null;
 }
 const cleaned=out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
 if(!/^🚀\s*Hiring:\s*\S/im.test(cleaned))throw Error('Could not reliably extract a hiring title; image retained for review.');
 return cleaned;
}
const freeEmailDomains=new Set(['gmail.com','googlemail.com','yahoo.com','yahoo.co.in','yahoo.in','outlook.com','hotmail.com','hotmail.co.uk','live.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','ymail.com','rediffmail.com','msn.com','mail.com']);
const multiPartTlds=new Set(['co.in','com.au','co.uk','com.sg','co.nz','co.za','com.br','co.jp','com.mx','com.tr','co.id','com.my','com.ph','com.vn']);
function corporateEmailDomain(email:string):string|null {
 const domain=email.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase().replace(/^www\./,'');
 return domain&&!freeEmailDomains.has(domain)?domain:null;
}
function companyFromEmail(email:string):string|null {
 const domain=corporateEmailDomain(email);if(!domain)return null;
 const parts=domain.split('.');const tld=parts.slice(-2).join('.');
 const label=parts.length>=3&&multiPartTlds.has(tld)?parts[parts.length-3]:parts[parts.length-2];
 const words=label.replace(/([a-z])([0-9])/gi,'$1 $2').replace(/([0-9])([a-z])/gi,'$1 $2').replace(/[-_]+/g,' ').split(/\s+/).filter(Boolean);
 return words.length?words.map(w=>/^\d+$/.test(w)?w:w[0].toUpperCase()+w.slice(1).toLowerCase()).join(' '):null;
}
export function websiteFromEmail(text:string):string|null {
 const line=text.split('\n').find(x=>/^\s*📩\s*Email:/i.test(x));
 const email=line?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
 const domain=email?corporateEmailDomain(email):null;
 return domain?`www.${domain}`:null;
}
export async function lookup(recruiter:string,company:string):Promise<{hr:string|null;company:string|null}>{
 async function search(query:string,kind:'hr'|'company'):Promise<string|null>{
  const keys=[process.env.TAVILY_API_KEY,process.env.TAVILY_API_KEY_2,process.env.TAVILY_API_KEY_3].filter((k):k is string=>!!k);
  if(!keys.length)throw Error('No Tavily key configured');
  const cursorKey='jobbot:v1:tavily-key-index';
  const initial=Number(await redis('GET',cursorKey)||0);let index=((Number.isFinite(initial)?initial:0)%keys.length+keys.length)%keys.length;
  let j: {results?: {url?: string;title?: string}[]}|null=null;
  for(let attempt=0;attempt<keys.length;attempt++){
   const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{authorization:`Bearer ${keys[index]}`,'content-type':'application/json'},body:JSON.stringify({query,search_depth:'basic',include_domains:['linkedin.com'],max_results:8}),signal:AbortSignal.timeout(12000)});
   if(r.status===429||r.status===432){
    // Compare-and-advance prevents two concurrent searches from skipping a key.
    await redis('EVAL',"local cur=tonumber(redis.call('get',KEYS[1]) or '0') % tonumber(ARGV[2]); if cur == tonumber(ARGV[1]) then redis.call('set',KEYS[1],(cur+1)%tonumber(ARGV[2])) end; return 1",1,cursorKey,index,keys.length);
    index=(index+1)%keys.length;continue;
   }
   j=await json(r,'Tavily');break;
  }
  if(!j)throw Error('All configured Tavily keys are rate-limited or quota-exhausted');
  const words=(s:string)=>s.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!['private','limited','pvt','ltd','inc','consulting','software'].includes(x));
  const rw=words(recruiter),cw=words(company);if(!cw.length||(kind==='hr'&&!rw.length))return null;
  for(const x of j.results||[]){let u:URL;try{u=new URL(x.url||'')}catch{continue}if(!/(^|\.)linkedin\.com$/i.test(u.hostname)||!(kind==='hr'?/^\/in\/[a-z0-9_-]+\/?$/i:/^\/company\/[a-z0-9_-]+\/?$/i).test(u.pathname))continue;
   const title=String(x.title||'').toLowerCase();if(cw.every(w=>title.includes(w))&&(kind==='company'||rw.every(w=>title.includes(w))))return `https://${u.hostname}${u.pathname.replace(/\/$/,'')}`;
  }return null;
 }
 const [hr,co]=await Promise.allSettled([recruiter&&company?search(`"${recruiter}" "${company}" LinkedIn profile`,'hr'):Promise.resolve(null),company?search(`"${company}" LinkedIn company page`,'company'):Promise.resolve(null)]);
 if(hr.status==='rejected'&&co.status==='rejected')throw Error('Tavily searches failed');return {hr:hr.status==='fulfilled'?hr.value:null,company:co.status==='fulfilled'?co.value:null};
}
export async function send(channel:string,text:string){if(text.length>3900)throw Error('Post exceeds safe Telegram message length; review required');const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:channel,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});const body=await r.text();let j;try{j=JSON.parse(body)}catch{throw Error('Telegram response uncertain; manual review required')};if(!r.ok||!j.ok)throw Error(`Telegram rejected: ${j.description||r.status}`);return j.result?.message_id;}
