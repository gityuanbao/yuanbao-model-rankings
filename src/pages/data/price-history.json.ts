import data from '../../data/price-history.json';
export const prerender = true;
export function GET() { return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
