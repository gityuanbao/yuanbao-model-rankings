import { performance } from '../../lib/performance-data';
import { arenaSource } from '../../lib/performance-schema';
export function GET() {
  const {license,licenseUrl,...sourceInfo}=arenaSource;
  const source={...sourceInfo,url:performance.sourceUrl ?? arenaSource.url,...(performance.models[0].scorePrecision==='rounded'?{}:{license,licenseUrl})};
  return new Response(JSON.stringify({source,...performance}),{headers:{'Content-Type':'application/json; charset=utf-8'}});
}
