import 'dotenv/config';
import { buildApp } from './app.js';
const {app}=await buildApp();
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close();});
await app.listen({port:Number(process.env.PORT??3001),host:process.env.HOST??'127.0.0.1'});
