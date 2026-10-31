import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { AIService } from '../src/ai/service.js';
import { readConfig } from '../src/ai/config.js';
import { Sessions } from '../src/sessions.js';
if (process.env.RUN_LIVE_BENCHMARK !== '1') throw Error('Explicit live opt-in required');
const config = readConfig({...process.env,DEMO_MODE:'live',JEV_MODE:'live'});
if(config.agents.some(a=>a.reason || a.provider!=='gemini') || !process.env.TYPESAFE_API_KEY) throw Error('Two Gemini models and TypeSafe credentials required');
const ai=new AIService(config), sessions=new Sessions(8,'live','live');
const scenarios = process.env.BENCHMARK_SCENARIO === 'normal-traffic' ? ['normal-traffic'] as const : process.env.BENCHMARK_SCENARIO === 'rush-hour' ? ['rush-hour'] as const : ['normal-traffic','rush-hour'] as const;
const pairs=scenarios.map((scenarioId,i)=>{
 const create=(mode:'ai'|'traditional')=>{ const e=sessions.create({requestId:`bench-${i}-${mode}`,mode,scenarioId,seed:2026+i,autoStart:false,speedMultiplier:1});if(mode==='ai')ai.attach(e);e.sim.control('start',0);return e; };
 return {scenarioId,seed:2026+i,fixed:create('traditional'),adaptive:create('ai')};
});
try {
 for(let i=0;i<1200;i++) {
  const start=Date.now(), requests=pairs.reduce((n,p)=>n+p.adaptive.sim.geminiRequests,0);
  if(requests>=100)throw Error('Benchmark request ceiling reached');
  sessions.tick(100);await sleep(Math.max(0,100-(Date.now()-start)));
  if(i%300===299)console.log(`Progress ${(i+1)/10}s; Gemini attempts ${requests}`);
 }
 const results=pairs.map(p=>({scenarioId:p.scenarioId,seed:p.seed,fixed:p.fixed.sim.currentMetrics(),adaptive:p.adaptive.sim.currentMetrics(),decisions:p.adaptive.sim.snapshot().decisionStats,events:p.adaptive.sim.eventHistory(undefined,2000).events}));
 await writeFile(`/tmp/intersection-live-benchmark-${process.env.BENCHMARK_SCENARIO ?? 'paired'}.json`,JSON.stringify({scope:'120-second paired wall-paced live runs; two seeded scenarios',results},null,2));
 console.log(JSON.stringify(results.map(({events:_events,...rest})=>rest),null,2));
}finally{ai.close();sessions.close();}
