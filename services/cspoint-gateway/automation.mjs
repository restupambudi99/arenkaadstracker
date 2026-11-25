export function openAutomation(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS arenka_pauses(instance TEXT NOT NULL,jid TEXT NOT NULL,paused INTEGER NOT NULL,PRIMARY KEY(instance,jid));
    CREATE TABLE IF NOT EXISTS arenka_ai_claims(instance TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(instance,id));`);
  return {
    paused:(instance,jid)=>!!db.prepare('SELECT paused FROM arenka_pauses WHERE instance=? AND jid=?').get(instance,jid)?.paused,
    pause:(instance,jid,paused)=>db.prepare('INSERT INTO arenka_pauses VALUES(?,?,?) ON CONFLICT(instance,jid) DO UPDATE SET paused=excluded.paused').run(instance,jid,paused?1:0),
    claim:(instance,id)=>db.prepare('INSERT OR IGNORE INTO arenka_ai_claims VALUES(?,?,?,?)').run(instance,id,'processing',Date.now()).changes>0,
    finish:(instance,id,status)=>db.prepare('UPDATE arenka_ai_claims SET status=?,updated_at=? WHERE instance=? AND id=?').run(status,Date.now(),instance,id),
  };
}

// One queue per number + conversation. A failed/uncertain send is never retried automatically.
export function createResponder({state,messages,callReply,sendText,onError=()=>{}}) {
  const queues=new Map();
  return (number,current,incoming)=>{
    const key=number.id+':'+incoming.jid;
    const task=(queues.get(key)||Promise.resolve()).then(async()=>{
      if(!state.claim(number.id,incoming.id))return;
      const active=()=>{
        const latest=messages.thread(incoming.jid,number.id).at(-1);
        return number.socket===current&&number.status==='connected'&&!state.paused(number.id,incoming.jid)&&latest?.id===incoming.id;
      };
      if(!active()) {state.finish(number.id,incoming.id,'skipped');return;}
      try {
        const thread=messages.thread(incoming.jid,number.id).slice(-30);
        const reply=await callReply(number.id,thread);
        if(!reply || !active()) {state.finish(number.id,incoming.id,'skipped');return;}
        await sendText(number,incoming.jid,reply,'ai');
        state.finish(number.id,incoming.id,'sent');
      } catch(error) {state.finish(number.id,incoming.id,'failed');onError(error);}
    }).catch(onError).finally(()=>{if(queues.get(key)===task)queues.delete(key);});
    queues.set(key,task);
    return task;
  };
}
