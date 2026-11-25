import { RecordsPage, type RecordKind } from './Records';
import { AgentPage, SettingsPage } from './Agent';
import { WhatsAppPage } from './WhatsApp';
import './cspoint.css';

export default function CsPoint({route,workspaceId,go}:{route:string;workspaceId:string;go:(path:string)=>void}) {
  const page=route.split('/')[2];
  if (page==='agent') return <AgentPage go={go}/>;
  if (page==='settings') return <SettingsPage workspaceId={workspaceId}/>;
  if (page==='whatsapp') return <WhatsAppPage go={go}/>;
  if (['products','orders','contacts','templates','knowledge'].includes(page)) return <RecordsPage key={page} kind={page as RecordKind}/>;
  return <section className="cs-module"><h1>Halaman CSPoint tidak ditemukan</h1><button onClick={()=>go('/cspoint/products')}>Buka produk</button></section>;
}
