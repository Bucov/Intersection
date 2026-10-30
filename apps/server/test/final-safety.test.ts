import {afterEach,expect,it,vi} from 'vitest';
import {MockJevAdapter,type ArbitrationProvider} from 'mozaik-jev-adapter';
import {ServerEventSchema} from '@intersection/shared';
import {AIService} from '../src/ai/service.js';
import {readConfig} from '../src/ai/config.js';
import {ObservationSchema,ProposalSchema,type Observation,type Proposal} from '../src/ai/schemas.js';
import {Sessions} from '../src/sessions.js';
const resources:AIService[]=[];afterEach(()=>{for(const s of resources.splice(0))s.close();vi.unstubAllEnvs();});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean){for(let i=0;i<100;i++){if(fn())return;await sleep(5);}throw Error('cycle did not finish');}
function setup(provider?:ArbitrationProvider<Observation,Proposal>){const ai=new AIService({...readConfig({}),mockLatencyMs:0},undefined,provider);resources.push(ai);const pool=new Sessions();const entry=pool.create({requestId:'x',mode:'ai',scenarioId:'simultaneous-proposals',seed:7,autoStart:false,speedMultiplier:1});ai.attach(entry);entry.sim.control('start',0);pool.tick(100);return {ai,entry,c:ai.coordinators.get(entry.sim.sessionId)!};}
it('catches missing live TypeSafe constructor credentials without disabling the simulation',()=>{
 vi.stubEnv('TYPESAFE_API_KEY','');const ai=new AIService({...readConfig({}),jevMode:'live'});resources.push(ai);expect(ai.jevUnavailable).toMatch(/TYPESAFE_API_KEY/);expect(ai.providers()[1].status).toBe('missing_credentials');
});
it('preserves null adapter confidence and probabilities, then falls back',async()=>{
 const provider:ArbitrationProvider<Observation,Proposal>={arbitrate:async(r,o)=>({...await new MockJevAdapter({stateSchema:ObservationSchema,proposalSchema:ProposalSchema,fixture:'agent-a'}).arbitrate(r,o),confidence:null,probabilities:null,abstainProbability:null})};
 const {entry,c}=setup(provider);await until(()=>c.cycle===null);const events=entry.sim.drain();const record=events.find(e=>e.type==='jev.arbitration'&&e.payload.status==='completed');expect(record?.type==='jev.arbitration'&&record.payload.adapterResult).toMatchObject({confidence:null,probabilities:null,abstainProbability:null});expect(record?.type==='jev.arbitration'&&record.payload.result).toBeNull();expect(events.some(e=>e.type==='arbitration.fallback'&&e.payload.reason==='low_confidence')).toBe(true);events.forEach(e=>ServerEventSchema.parse(e));expect(entry.sim.currentMetrics().jevUnmeasuredDecisionCount).toBe(1);
});
it('rejects an adapter selecting an ID outside the stored candidate set',async()=>{
 const provider:ArbitrationProvider<Observation,Proposal>={arbitrate:async(r,o)=>({...await new MockJevAdapter({stateSchema:ObservationSchema,proposalSchema:ProposalSchema}).arbitrate(r,o),status:'selected',selectedCandidateId:'forged'})};
 const {entry,c}=setup(provider);await until(()=>c.cycle===null);const events=entry.sim.drain();expect(events.some(e=>e.type==='jev.arbitration'&&e.payload.bridgeReason==='invalid_response')).toBe(true);expect(events.some(e=>e.type==='decision.outcome'&&e.payload.status==='accepted')).toBe(false);
});
it('rechecks queue drift at action time even when decision revision still matches',async()=>{
 const provider=new MockJevAdapter({stateSchema:ObservationSchema,proposalSchema:ProposalSchema,fixture:'agent-a',latencyMs:60});const {ai,entry,c}=setup(provider);await until(()=>ai.bridge.pendingCount===1);
 // More than twelve initial NS queued vehicles clear while the phase remains green.
 entry.sim.advance(119);await until(()=>c.cycle===null);const events=entry.sim.drain();expect(events.some(e=>e.type==='decision.outcome'&&e.payload.status==='rejected')).toBe(true);expect(events.some(e=>e.type==='arbitration.fallback'&&e.payload.reason==='stale_result')).toBe(true);
});
it('holds all-red while a vehicle footprint remains in the intersection',()=>{
 const {entry}=setup();const sim=entry.sim;sim.control('pause',0); // stop pending asynchronous work
 // The tested state is a deliberately slow crossing vehicle, introduced through the
 // existing scenario speed-factor input and observed through ordinary snapshots.
 sim.control('resume',0);sim.inject({type:'temporary_congestion',approach:'north',speedFactor:0.1,durationMs:60000},0);
 sim.requestGreen('EW_GREEN',8000,'clearance-test');let held=false;
 for(let i=0;i<600;i++){sim.advance(1);const s=sim.snapshot();if(s.signal.clearanceBlockedByVehicles){held=true;expect(s.signal.phase).toBe('ALL_RED');expect(s.occupiedVehicleIds.length).toBeGreaterThan(0);}sim.drain();}
 expect(held).toBe(true);
});
