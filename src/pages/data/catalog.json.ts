import { catalog } from '../../lib/catalog';
export const prerender = true;
export function GET() { return new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
