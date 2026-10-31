import { afterEach, expect, it } from 'vitest';
import { AIService } from '../src/ai/service.js';
import { readConfig } from '../src/ai/config.js';
import { Sessions } from '../src/sessions.js';
import { MockJevAdapter, type ArbitrationProvider } from 'mozaik-jev-adapter';
import { ObservationSchema, ProposalSchema, type Observation, type Proposal } from '../src/ai/schemas.js';
const cleanups: (() => void)[]=[];
afterEach(()=>cleanups.splice(0).forEach(f=>f()));
it('recovers failed agents with a fresh full snapshot and concrete actions, retaining the schedule exactly',async()=>{
 let ids:string[]=[];
 let vehicleCount=0;
 const provider: ArbitrationProvider<Observation,Proposal>={arbitrate:async(r,o)=>{
  ids=r.candidates.map(c=>c.id); vehicleCount=r.state.vehicles?.length ?? 0;
  const result=await new MockJevAdapter({stateSchema:ObservationSchema,proposalSchema:ProposalSchema,fixture:'agent-a'}).arbitrate(r,o);
  return {...result,status:'selected',selectedCandidateId:ids.find(id=>id.endsWith('keep-plan'))!,confidence:0.99,probabilities:null,abstainProbability:null};
 }};
 const ai=new AIService(readConfig({}),async()=>{throw Error('provider unavailable')},provider);
 const sessions=new Sessions(2,'mock','mock');cleanups.push(()=>{ai.close();sessions.close()});
 const e=sessions.create({requestId:'test',mode:'ai',scenarioId:'simultaneous-proposals',seed:42,autoStart:false,speedMultiplier:1});
 ai.attach(e);e.sim.control('start',0);e.sim.advance(1);
 const before=e.sim.signalView();e.poll?.();await e.settle?.();
 expect(ids.some(id=>id.endsWith('schedule-ns'))).toBe(true);
 expect(ids.some(id=>id.endsWith('schedule-ew'))).toBe(true);
 expect(ids.some(id=>id.endsWith('keep-plan'))).toBe(true);
 expect(vehicleCount).toBeGreaterThan(0);
 expect(e.sim.signalView()).toEqual(before);
 expect(e.sim.snapshot().decisionStats?.accepted.jev).toBe(1);
 expect(e.sim.snapshot().jev.lastArbitration?.recoveryReason).toBe('provider_error');
});
