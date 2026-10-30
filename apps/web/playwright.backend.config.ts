import {defineConfig,devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export default defineConfig({
 testDir:'./e2e-backend',timeout:60000,expect:{timeout:15000},workers:1,fullyParallel:false,reporter:'list',
 use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:4175',viewport:{width:1280,height:800},launchOptions:{args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist']},trace:'retain-on-failure'},
 webServer:[
  {command:'node apps/server/dist/index.js',cwd:root,url:'http://127.0.0.1:3011/api/health',env:{HOST:'127.0.0.1',PORT:'3011',DEMO_MODE:'mock',JEV_MODE:'mock'},reuseExistingServer:false,timeout:30000},
  {command:'npm run preview -- --host 127.0.0.1 --port 4175 --strictPort',cwd:fileURLToPath(new URL('./',import.meta.url)),url:'http://127.0.0.1:4175',env:{INTERSECTION_BACKEND_URL:'http://127.0.0.1:3011'},reuseExistingServer:false,timeout:30000},
 ],
});
