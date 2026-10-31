import {test,expect,type Page} from '@playwright/test';
import {SocketMessageSchema,type ServerEvent} from '@intersection/shared';
test.beforeEach(async({context})=>{await context.addInitScript(()=>{ if (location.origin !== 'null') localStorage.setItem('intersection.preferences.v1',JSON.stringify({dataSource:'backend',quality:'low'})); });});
const visible=(page:Page,id:string)=>page.getByTestId(id).filter({visible:true}).first();
function capture(page:Page){const events:ServerEvent[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',f=>{const p=SocketMessageSchema.safeParse(JSON.parse(String(f.payload)));if(!p.success)errors.push('Invalid socket frame');else if(p.data.type!=='pong')events.push(p.data);}));return {events,errors};}
test('traditional browser simulation uses authoritative motion, controls and metrics with no keys',async({page})=>{
 const {events,errors}=capture(page);await page.goto('/simulate/traditional?skipIntro&scenario=competing-priorities');await expect(visible(page,'session-status')).toHaveText('Running');await expect(page.getByTestId('fixed-time-panel')).toContainText('No AI is called');await expect(page.getByTestId('scene')).toHaveAttribute('data-webgl','ok');
 await expect.poll(()=>events.filter(e=>e.type==='simulation.snapshot').length).toBeGreaterThan(5);
 const snapshots=events.filter(e=>e.type==='simulation.snapshot');const first=snapshots.find(e=>e.payload.vehicles.length>0)!;await expect.poll(()=>events.some(e=>e.type==='simulation.snapshot'&&e.payload.vehicles.some(v=>{const old=first.payload.vehicles.find(x=>x.id===v.id);return old&&JSON.stringify(old.position)!==JSON.stringify(v.position);}))).toBe(true);
 await page.getByTestId('playback').click();await expect(visible(page,'session-status')).toHaveText('Paused');const time=await visible(page,'sim-clock').textContent();await page.waitForTimeout(350);await expect(visible(page,'sim-clock')).toHaveText(time!);
 await page.getByTestId('playback').click();await expect(visible(page,'session-status')).toHaveText('Running');await page.getByRole('button',{name:'4 times speed'}).click();await page.getByRole('tab',{name:'Metrics'}).click();await expect(page.getByTestId('metrics-panel')).toContainText('Time-average queue');
 await page.getByTestId('reset').click();await expect(visible(page,'session-status')).toHaveText('Ready');expect(events.some(e=>e.type==='agent.proposal'||e.type==='jev.arbitration')).toBe(false);expect(errors).toEqual([]);await page.screenshot({path:'/tmp/intersection-traditional.png'});
});
for(const scenario of ['simultaneous-proposals','jev-uncertainty','jev-failure'])test(`AI browser displays actual bridge ${scenario}`,async({page})=>{
 const {events,errors}=capture(page);await page.goto(`/simulate/ai?skipIntro&scenario=${scenario}`);await expect(visible(page,'session-status')).toHaveText('Running');await expect.poll(()=>events.some(e=>e.type==='jev.arbitration'&&['completed','timed_out'].includes(e.payload.bridgePhase??''))).toBe(true);
 await expect(page.getByTestId('agent-card-agent-a')).toContainText('Offline runner');await expect(page.getByTestId('agent-card-agent-b')).toContainText('Offline runner');
 await expect(page.getByTestId('jev-panel')).toContainText('Mock');if(scenario==='jev-failure')await expect(page.getByTestId('jev-state')).toContainText('Timed out');else await expect(page.getByTestId('jev-panel')).toContainText('Synthetic confidence');
 if(scenario==='simultaneous-proposals'){await page.screenshot({path:'/tmp/intersection-ai.png'});await page.setViewportSize({width:390,height:844});await expect(page.getByTestId('agent-card-agent-a')).toBeVisible();await page.screenshot({path:'/tmp/intersection-ai-mobile.png',fullPage:true});}
 await page.getByRole('tab',{name:'Transcript'}).click();await expect(page.getByTestId('transcript')).toContainText('Proposal');expect(errors).toEqual([]);
});
test('browser compares measured independent sessions and renders the honest limitations',async({page})=>{
 const {errors}=capture(page);await page.goto('/simulate/traditional?skipIntro');await expect(visible(page,'session-status')).toHaveText('Running');await page.getByRole('tab',{name:'Compare'}).click();await page.getByRole('button',{name:'Run comparison'}).click();const panel=page.getByTestId('comparison');await expect(panel).toContainText('Limitations');await expect(panel).toContainText('actual adapter mock choices');await expect(panel.getByRole('rowheader',{name:'Completed trips',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('Decision Stats reports authoritative backend totals and resets them', async ({page}) => {
 await page.goto('/simulate/ai?skipIntro&scenario=simultaneous-proposals');
 await page.getByRole('tab',{name:'Decision Stats',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Decision sources'})).toBeVisible();
 await expect(page.getByText('1 accepted decisions from the three sources',{exact:false})).toBeVisible();
 await page.getByTestId('playback').click();
 const sources=await page.getByRole('img',{name:/Deterministic fallback:/}).getAttribute('aria-label');
 await page.getByRole('tab',{name:'Metrics',exact:true}).click();
 await page.getByRole('tab',{name:'Decision Stats',exact:true}).click();
 await expect(page.getByRole('img',{name:/Deterministic fallback:/})).toHaveAttribute('aria-label',sources!);
 await page.getByTestId('reset').click();
 await expect(page.getByText('0 accepted decisions from the three sources',{exact:false})).toBeVisible();
});

test('comparison survives navigation and has a separate live view', async ({page,request}) => {
 const response=await request.post('http://127.0.0.1:3011/api/comparisons',{data:{requestId:'live-view-test',scenarioId:'simultaneous-proposals',seed:2026,durationMs:60000,execution:'realtime',speedMultiplier:1}});
 expect(response.ok()).toBe(true);
 const comparison=await response.json();
 await page.goto(`/comparison?skipIntro&comparison=${comparison.comparisonId}`);
 await expect(page.getByRole('region',{name:'Live intersections'})).toBeVisible();
 await expect(page.getByRole('img',{name:'AI live vehicle positions'})).toBeVisible();
 await expect.poll(()=>page.getByRole('img',{name:'AI live vehicle positions'}).locator('rect').count()).toBeGreaterThan(0);
 await page.screenshot({path:'/tmp/intersection-comparison-desktop.png'});
 await page.goto('/about?skipIntro');
 await page.goto('/comparison?skipIntro');
 await expect(page.getByRole('img',{name:'Fixed live vehicle positions'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/intersection-comparison-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
