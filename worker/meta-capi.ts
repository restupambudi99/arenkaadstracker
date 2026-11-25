export type MetaLead = {id:string;name:string;email:string|null;phone:string|null;value:number;source:string;ctwa_clid?:string|null};
export type MetaSettings = {pixel_id:string;test_event_code:string;currency:string;include_ctwa_clid:number};
export async function sha256(value:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function hashOptional(value:string|undefined|null) {return value?.trim()?sha256(value.trim().toLowerCase()):undefined;}
export async function buildMetaEvent(lead:MetaLead,eventName:'Lead'|'Purchase',settings:MetaSettings,eventId:string,testCode?:string) {
  const name=lead.name.trim().split(/\s+/),email=await hashOptional(lead.email),phone=await hashOptional(lead.phone?.replace(/\D/g,''));
  const user_data:Record<string,string>={external_id:await sha256(lead.id)};
  if(email)user_data.em=email;
  if(phone)user_data.ph=phone;
  if(name[0])user_data.fn=await sha256(name[0]);
  if(name.length>1)user_data.ln=await sha256(name.slice(1).join(' '));
  if(settings.include_ctwa_clid&&lead.ctwa_clid)user_data.ctwa_clid=lead.ctwa_clid;
  const event:Record<string,unknown>={event_name:eventName,event_time:Math.floor(Date.now()/1000),event_id:eventId,action_source:'chat',user_data};
  if(eventName==='Purchase')event.custom_data={currency:settings.currency,value:Math.max(0,Number(lead.value)||0)};
  return {data:[event],...(testCode?{test_event_code:testCode}:{})};
}
export async function sendMetaEvent(input:{pixelId:string;token:string;payload:unknown;fetcher?:typeof fetch}) {
  const fetcher=input.fetcher??fetch;
  const url=`https://graph.facebook.com/v27.0/${encodeURIComponent(input.pixelId)}/events`;
  let response:Response;
  try {response=await fetcher(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${input.token}`,'Content-Type':'application/json'},body:JSON.stringify(input.payload)});}
  catch {return {status:'failed' as const,responseStatus:null,eventsReceived:0,traceId:null,errorCode:'network_error'};}
  if(response.status>=300&&response.status<400){await response.body?.cancel();return {status:'failed' as const,responseStatus:response.status,eventsReceived:0,traceId:null,errorCode:'redirect_rejected'};}
  const result=await response.json().catch(()=>null) as {events_received?:unknown;fbtrace_id?:unknown;error?:{code?:unknown}}|null;
  const eventsReceived=Number(result?.events_received??0),ok=response.ok&&eventsReceived>0;
  return {status:ok?'sent' as const:'failed' as const,responseStatus:response.status,eventsReceived,traceId:typeof result?.fbtrace_id==='string'?result.fbtrace_id.slice(0,120):null,errorCode:ok?null:String(result?.error?.code??(response.ok?'no_event_received':'meta_rejected')).slice(0,80)};
}
