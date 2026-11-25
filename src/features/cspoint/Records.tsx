import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { money } from '../../lib/utils';
import { csApi, errorMessage, write, type CsRecord } from './api';
import { pdfText } from './Pdf';

export type RecordKind='products'|'orders'|'contacts'|'templates'|'knowledge';
const config:Record<RecordKind,{title:string;singular:string;description:string;columns:[string,string][]}>={
  products:{title:'Produk',singular:'produk',description:'Katalog, harga paket, dan informasi stok untuk tim CS serta AI Agent.',columns:[['name','Produk'],['sku','SKU'],['price','Harga / paket'],['stock','Stok']]},
  orders:{title:'Pesanan',singular:'pesanan',description:'Catat pesanan dan status pengerjaannya. Nilai pesanan tidak otomatis masuk ke revenue tracking.',columns:[['name','Pelanggan'],['phone','WhatsApp'],['total','Total'],['status','Status']]},
  contacts:{title:'Kontak',singular:'kontak',description:'Buku kontak CSPoint untuk menyimpan nomor dan label pelanggan.',columns:[['name','Nama'],['phone','WhatsApp'],['tag','Label']]},
  templates:{title:'Template follow-up',singular:'template',description:'Simpan pesan FU1 sampai FU5 dan salin saat diperlukan. Pengiriman tetap dilakukan oleh tim CS.',columns:[['name','Template'],['stage','Tahap'],['body','Isi pesan']]},
  knowledge:{title:'Knowledge & ongkir',singular:'pengetahuan',description:'Tambahkan teks atau PDF sebagai referensi AI. Pisahkan daftar tarif ongkir dari informasi produk.',columns:[['name','Dokumen'],['category','Jenis'],['size','Karakter'],['source','Sumber']]},
};
export function ErrorBox({message,retry}:{message:string;retry?:()=>void}) {return <div className="cs-error" role="alert"><span>{message}</span>{retry&&<Button type="button" variant="secondary" onClick={retry}>Coba lagi</Button>}</div>;}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}) {return <label className="cs-field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function Dialog({title,close,children,error}:{title:string;close:()=>void;children:ReactNode;error?:string}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();const dialog=ref.current;return()=>dialog?.close();},[]);
  return <dialog ref={ref} className="cs-dialog" onCancel={event=>{event.preventDefault();close();}} aria-label={title}><div className="cs-dialog-head"><h2>{title}</h2><Button variant="ghost" type="button" onClick={close} aria-label="Tutup dialog">Tutup</Button></div>{error&&<ErrorBox message={error}/>} {children}</dialog>;
}
export function RecordsPage({kind,go}:{kind:RecordKind;go:(path:string)=>void}) {
  const [items,setItems]=useState<CsRecord[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[query,setQuery]=useState(''),[search,setSearch]=useState('');
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState<Partial<CsRecord>|null>(null),[deleting,setDeleting]=useState<CsRecord|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const meta=config[kind];
  const reload=useCallback(async()=>{setLoading(true);setError('');try{const result=await csApi<{items:CsRecord[];total:number}>(`/records/${kind}?page=${page}&q=${encodeURIComponent(search)}`);setItems(result.items);setTotal(result.total);}catch(e){setError(errorMessage(e));}finally{setLoading(false);}},[kind,page,search]);
  useEffect(()=>{void reload();},[reload]);
  const edit=async(item:CsRecord)=>{setBusy(true);setError('');try{setEditing(await csApi<CsRecord>(`/records/${kind}/${item.id}`));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
  const remove=async()=>{if(!deleting)return;setBusy(true);try{await csApi(`/records/${kind}/${deleting.id}`,write('DELETE'));setDeleting(null);setNotice('Data dihapus.');if(items.length===1&&page>1)setPage(page-1);else await reload();}catch(e){setError(errorMessage(e));setDeleting(null);}finally{setBusy(false);}};
  return <section className="cs-module">
    <div className="cs-heading"><div><h1>{meta.title}</h1><p>{meta.description}</p>{kind==='products'&&<p className="cs-crosslink">Form dan katalog untuk WhatsApp memakai data produk yang sama.</p>}{kind==='contacts'&&<p className="cs-crosslink">Kontak disimpan terpisah dari leads sampai Anda menautkannya.</p>}</div><div className="cs-actions">{kind==='products'&&<Button variant="secondary" onClick={()=>go('/whatsapp/broadcast')}>Buka broadcast</Button>}{kind==='contacts'&&<Button variant="secondary" onClick={()=>go('/leads')}>Lihat leads</Button>}<Button onClick={()=>setEditing({})}>Tambah {meta.singular}</Button></div></div>
    {notice&&<p className="cs-notice" role="status">{notice}</p>}
    <form className="cs-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);setSearch(query);}}><Input aria-label={`Cari ${meta.singular}`} placeholder={`Cari ${meta.singular}`} value={query} onChange={e=>setQuery(e.target.value)} maxLength={100}/><Button variant="secondary">Cari</Button><Button type="button" variant="ghost" onClick={()=>void reload()}>Muat ulang</Button></form>
    {error?<ErrorBox message={error} retry={()=>void reload()}/>:loading?<p role="status" className="cs-empty">Memuat {meta.singular}…</p>:<>
      {!items.length?<div className="cs-empty"><h2>{search?'Tidak ada hasil pencarian':`Belum ada ${meta.singular}`}</h2><p>{search?'Coba kata pencarian yang lain.':`Tambahkan ${meta.singular} pertama untuk workspace ini.`}</p></div>:<div className="cs-table-wrap"><table><thead><tr>{meta.columns.map(([key,label])=><th key={key}>{label}</th>)}<th>Aksi</th></tr></thead><tbody>{items.map(item=><tr key={item.id}>{meta.columns.map(([key])=><td key={key}>{key==='total'?money(Number(item[key]??0)):key==='category'?(item[key]==='shipping'?'Tarif ongkir':'Pengetahuan'):String(item[key]??'Belum diisi')}</td>)}<td><div className="cs-row-actions">{kind==='contacts'&&<Button variant="secondary" disabled={busy||!item.phone} title={item.phone?'Cari leads dengan nomor WhatsApp ini':'Tambahkan nomor WhatsApp untuk mencari lead'} onClick={()=>go(`/leads?q=${encodeURIComponent(String(item.phone??''))}`)}>Cari lead</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void edit(item)}>Ubah</Button>{kind==='templates'&&<Button variant="ghost" onClick={()=>void navigator.clipboard.writeText(String(item.body??'')).then(()=>setNotice('Template disalin.'),()=>setError('Clipboard tidak tersedia.'))}>Salin</Button>}<Button variant="ghost" disabled={busy} onClick={()=>setDeleting(item)}>Hapus</Button></div></td></tr>)}</tbody></table></div>}
      <div className="cs-pagination"><span>{total} data · Halaman {page} dari {Math.max(1,Math.ceil(total/25))}</span><div><Button variant="secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>Sebelumnya</Button><Button variant="secondary" disabled={page*25>=total} onClick={()=>setPage(page+1)}>Berikutnya</Button></div></div>
    </>}
    {kind==='knowledge'&&<ShippingCheck/>}
    {editing&&<RecordEditor kind={kind} initial={editing} close={()=>setEditing(null)} saved={()=>{setEditing(null);setNotice('Data tersimpan.');void reload();}}/>}
    {deleting&&<Dialog title={`Hapus ${meta.singular}`} close={()=>!busy&&setDeleting(null)}><p>Hapus “{deleting.name}” dari workspace ini? Tindakan ini tidak dapat dibatalkan.</p><div className="cs-actions"><Button variant="secondary" disabled={busy} onClick={()=>setDeleting(null)}>Batal</Button><Button variant="danger" disabled={busy} onClick={()=>void remove()}>{busy?'Menghapus…':'Hapus data'}</Button></div></Dialog>}
  </section>;
}
function RecordEditor({kind,initial,close,saved}:{kind:RecordKind;initial:Partial<CsRecord>;close:()=>void;saved:()=>void}) {
  const [values,setValues]=useState<Record<string,unknown>>({status:'Menunggu Bayar',stage:'FU1',category:'knowledge',stock:0,total:0,...initial});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const field=(key:string,label:string,options:{type?:string;max?:number;required?:boolean;area?:boolean}={})=><Field label={label}>{options.area?<textarea value={String(values[key]??'')} maxLength={options.max} required={options.required} rows={key==='content'?10:4} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>:<Input type={options.type??'text'} min={options.type==='number'?0:undefined} max={options.type==='number'?1e12:undefined} step={options.type==='number'?1:undefined} maxLength={options.max} required={options.required} value={String(values[key]??'')} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>}</Field>;
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{await csApi(`/records/${kind}${initial.id?'/'+initial.id:''}`,write(initial.id?'PUT':'POST',values));saved();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
  const upload=async(file?:File)=>{if(!file)return;setBusy(true);setError('');try{const content=await pdfText(file);setValues(v=>({...v,content,name:v.name||file.name,source:file.name,mime:'application/pdf'}));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
  return <Dialog title={`${initial.id?'Ubah':'Tambah'} ${config[kind].singular}`} close={()=>!busy&&close()}><form onSubmit={submit} className="cs-form">
    {field('name',kind==='orders'?'Nama pelanggan':'Nama',{max:160,required:true})}
    {kind==='products'&&<>{field('sku','SKU',{max:60})}{field('price','Harga atau paket',{max:240})}{field('stock','Stok',{type:'number',required:true})}{field('description','Deskripsi',{area:true,max:2000})}</>}
    {(kind==='contacts'||kind==='orders')&&field('phone','Nomor WhatsApp',{type:'tel',max:30})}
    {kind==='contacts'&&field('tag','Label',{max:40})}
    {kind==='orders'&&<><Field label="Status"><Select value={String(values.status)} onChange={e=>setValues(v=>({...v,status:e.target.value}))}>{['Menunggu Bayar','Diproses','Selesai'].map(v=><option key={v}>{v}</option>)}</Select></Field>{field('total','Total pesanan (Rp)',{type:'number',required:true})}{field('note','Catatan',{area:true,max:2000})}</>}
    {kind==='templates'&&<><Field label="Tahap follow-up"><Select value={String(values.stage)} onChange={e=>setValues(v=>({...v,stage:e.target.value}))}>{['FU1','FU2','FU3','FU4','FU5'].map(v=><option key={v}>{v}</option>)}</Select></Field>{field('body','Isi pesan',{area:true,max:4000,required:true})}</>}
    {kind==='knowledge'&&<><Field label="Jenis referensi"><Select value={String(values.category)} onChange={e=>setValues(v=>({...v,category:e.target.value}))}><option value="knowledge">Pengetahuan produk / bisnis</option><option value="shipping">Daftar tarif ongkir</option></Select></Field><Field label="Baca dari PDF" hint="Maksimal 8 MB. Periksa teks hasil ekstraksi sebelum menyimpan. PDF asli tetap di perangkat Anda."><Input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>void upload(e.target.files?.[0])}/></Field>{field('content','Teks referensi',{area:true,max:500000,required:true})}</>}
    {error&&<ErrorBox message={error}/>}
    <div className="cs-actions"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Batal</Button><Button disabled={busy}>{busy?'Memproses…':'Simpan'}</Button></div>
  </form></Dialog>;
}
function ShippingCheck() {
  const [destination,setDestination]=useState(''),[result,setResult]=useState<Record<string,unknown>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const labels:Record<string,string>={found:'Tarif ditemukan',confirm:'Perlu konfirmasi admin',ambiguous:'Ada beberapa tujuan yang cocok',need_district:'Lengkapi kecamatan',java:'Gunakan aturan ongkir Pulau Jawa di instruksi AI',not_found:'Tujuan tidak ditemukan dalam referensi',unavailable:'Daftar tarif belum tersedia',none:'Lengkapi tujuan pengiriman'};
  return <section className="cs-panel"><h2>Cek referensi ongkir</h2><p>Cocokkan kecamatan dan kabupaten dengan daftar tarif yang Anda simpan.</p><form className="cs-toolbar" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setResult(null);try{setResult(await csApi('/shipping/check',write('POST',{destination})));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}><Input aria-label="Tujuan pengiriman" placeholder="Kecamatan dan kabupaten/kota tujuan" required maxLength={500} value={destination} onChange={e=>setDestination(e.target.value)}/><Button disabled={busy}>{busy?'Memeriksa…':'Cek ongkir'}</Button></form>{error&&<ErrorBox message={error}/>} {result&&<div className="cs-result" role="status"><b>{labels[String(result.status)]??String(result.status)}</b>{typeof result.destination==='string'&&<p>{result.destination}</p>}{typeof result.amount==='string'&&<p>{result.amount}{result.final===false?' (tarif dasar, perlu konfirmasi)':''}</p>}{Array.isArray(result.options)&&<ul>{result.options.map((option:{destination:string;amount:string},i)=><li key={i}>{option.destination}: {option.amount}</li>)}</ul>}</div>}</section>;
}
