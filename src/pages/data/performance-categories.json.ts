import { performanceBoards } from '../../lib/performance-data';
import { performanceCategories } from '../../lib/performance-categories';
export function GET() {
  return new Response(JSON.stringify({schemaVersion:1,categories:performanceCategories,snapshots:Object.values(performanceBoards)}),{headers:{'Content-Type':'application/json; charset=utf-8'}});
}
