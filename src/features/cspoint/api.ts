import { api } from '../../lib/utils';
export const csApi = <T,>(path: string, options?: RequestInit) => api<T>('/api/cspoint'+path,options);
export const write = (method: string, data?: unknown): RequestInit => ({method,...(data===undefined?{}:{body:JSON.stringify(data)})});
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Permintaan gagal. Silakan coba lagi.';
export type CsRecord = {id:string; name:string; created_at:string; updated_at:string; [key:string]:unknown};
