export interface Membership { warehouse: string; role: 'Staff'|'Admin'|'Head' }
export interface AuthSession { user: {id: string; username: string}; memberships: Membership[] }
export interface CountSummary { id: string; location: string; status: string; counted_by: string; correction_of?: string }
export interface CountRow { product: string; batch: string; counted_quantity: number|null; system_quantity?: number; reason?: string; explanation?: string }
export interface CountDetail extends CountSummary { lines: CountRow[]; adjustment?: {id: string;status: string}|null }
export class ApiError extends Error { constructor(public status: number,message: string) { super(message); } }
export async function api<T>(path: string, warehouse?: string, input?: unknown, key?: string): Promise<T> {
 const response=await fetch(`/api${path}`,{credentials:'same-origin',method:input===undefined?'GET':'POST',headers:{...(warehouse?{'X-Warehouse':warehouse}:{}),...(input===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},body:input===undefined?undefined:JSON.stringify(input)});
 const result=await response.json();
 if(!response.ok) throw new ApiError(response.status,result.error || 'Request failed');
 return result;
}
