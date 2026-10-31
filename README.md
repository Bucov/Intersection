# Intersection — by MAGI

**Watch the same intersection run with fixed traffic lights or AI-assisted control, then compare the results.**

Intersection is a traffic simulation made by Team MAGI, first-year students at the University of Novi Sad, Faculty of Technical Sciences, for the Jigjoy October 2026 hackathon.


<img width="1886" height="896" alt="image" src="https://github.com/user-attachments/assets/079ab674-5120-4322-9586-5e045a2ebc2c" />


The traditional controller repeats a fixed schedule. The AI controller uses two agents working at the same time to propose signal timings. When their proposals conflict, **JEV**, a TypeSafe decision model, arbitrates through our [Mozaik JEV adapter fork](https://github.com/Bucov/mozaik-Jev-adapter). A deterministic safety layer checks changes before the lights switch.

**You can try the project without API keys or an AI account.** The default setup uses simulated AI responses. Connecting real Gemini, Claude and JEV models is optional.

But we highly recommend you connect real models

## Run it on your computer

These instructions work from a fresh download or clone. You do not need a code editor or programming experience. You will copy commands into a terminal—a window where you type instructions for your computer.

### 1. Install the requirements

| Requirement | What to install |
| --- | --- |
| Node.js and npm | Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/en/download). npm comes with Node.js; it does not need a separate download. |
| Git | Install from [git-scm.com](https://git-scm.com/downloads) if you want to use the clone command below. You can skip Git by downloading a ZIP instead. |
| Web browser | Use a current browser with hardware acceleration/WebGL enabled for the 3D view. The app also has a 2D fallback when 3D is unavailable. |
| Internet connection | Needed to download the project and install its dependencies. Live AI also needs internet access. The no-key demo does not call model providers. |

After installing Node.js and Git, close and reopen your terminal. On Windows, use **Command Prompt**; on macOS or Linux, open **Terminal**.

Check Node.js and npm by entering these commands, one at a time:

```sh
node --version
npm --version
```

Both should print a version number. Node's number must start with `v22` or higher. If a command is not recognised, restart the terminal and check that Node.js was installed.

### 2. Download the project

If you installed Git, run:

```sh
git clone https://github.com/Bucov/Intersection.git
cd Intersection
```

If you have already cloned the repository, open a terminal inside its `Intersection` folder instead.

**Without Git:** on the [GitHub repository page](https://github.com/Bucov/Intersection), choose **Code → Download ZIP**. Extract the ZIP, open the extracted folder, and open a terminal there. The folder should contain `package.json`, `apps` and `packages`. On Windows, you can type `cmd` in File Explorer's address bar while inside that folder and press Enter.

Run every command below from this project folder.

### 3. Install and build

Run these commands one at a time. Wait for each command to finish before entering the next:

```sh
npm ci
npm run build
```

`npm ci` downloads the project's dependencies. The build prepares the application. The first installation may take several minutes. You only need to install dependencies once for a fresh copy; repeat it if the project's dependencies change.

There is no separate database to install, and the packaged JEV adapter is already included in `vendor/`.

### 4. Start the simulation server

In the same terminal, run:

```sh
npm run dev:server
```

**Leave this terminal open.** The command stays running: that is expected. The server normally listens on port `3001`.

On a fresh clone, it uses mock AI and needs no keys or `.env` file.

### 5. Start the website

Open a **second terminal in the same project folder**. Keep the first one running, and enter:

```sh
npm run dev:web
```

Leave this terminal open too. It will print a local website address, usually:

**http://localhost:5173**

Open the exact address printed in your browser. If another program already uses port `5173`, the printed address may use a different port.

### 6. Try your first run

1. Open **Settings** and choose **Data source → Backend only**. The connection status should show that the backend is ready.
2. Go Home by clicking **intersection** in the header.
3. Choose **Run traditional** to watch the fixed-time lights, or **Run AI** to try the AI controller with mock responses.
4. Use **Pause**, the timeline and the information tabs to inspect what happened.
5. Open **compare** in the header to run both controllers on matching traffic.

For a browser-only demonstration, select **Settings → Data source → Offline demo**. This runs the simulation in your browser and does not need the server terminal. Its agents, arbitration and inference timings are simulated.

### Stop or restart

Press **Ctrl+C** in each running terminal to stop the project. Closing the browser alone does not stop the servers.

Next time, open two terminals in the project folder and run `npm run dev:server` in one and `npm run dev:web` in the other. You do not need to repeat `npm ci` for every visit.

### Common setup problems

| Problem | What to do |
| --- | --- |
| `node`, `npm` or `git` is not recognised | Install the relevant program, then close and reopen the terminal. Git is optional if you use Download ZIP. |
| npm cannot find `package.json` | Your terminal is in the wrong folder. Open it in the extracted/cloned project folder containing `package.json`. |
| PowerShell says `npm.ps1` cannot run | Use Windows Command Prompt for these instructions. |
| Installation fails | Confirm Node.js is version 22 or newer and that your internet connection works. Run `npm ci` again from the project folder. |
| The website says the backend is unavailable | Check that the first terminal is still running `npm run dev:server`. The normal backend address is `http://127.0.0.1:3001`. |
| The website will not open | Keep the website terminal running and use the exact URL it prints. |
| The animation is slow | Choose **Settings → Rendering quality → Low**. |
| Session capacity is reached | Stop and restart the server terminal to clear the sessions retained in memory. |

## Optional: connect real AI models

Skip this section to use the default no-key demo. Live mode uses your provider accounts and their API quotas.

1. Make a copy of `apps/server/.env.example` in the **same folder** and name the copy `.env`. Use a plain-text editor to edit it. Make sure it is not named `.env.txt`.
2. In a terminal in the project folder, list the supported model names:

   ```sh
   npm run models -w @intersection/server
   ```

3. In `.env`, set the following values. Replace the model placeholders with exact supported names from that list, and replace the key placeholders with your keys:

   ```dotenv
   DEMO_MODE=live
   JEV_MODE=live

   AGENT_A_PROVIDER=gemini
   AGENT_A_MODEL=PASTE_SUPPORTED_GEMINI_MODEL_NAME
   GEMINI_API_KEY=PASTE_YOUR_GEMINI_KEY

   AGENT_B_PROVIDER=claude
   AGENT_B_MODEL=PASTE_SUPPORTED_CLAUDE_MODEL_NAME
   ANTHROPIC_API_KEY=PASTE_YOUR_ANTHROPIC_KEY

   TYPESAFE_API_KEY=PASTE_YOUR_TYPESAFE_KEY
   MOZAIK_CLOUD=off
   ```

   Obtain Gemini access through [Google AI Studio](https://aistudio.google.com/), Claude access through [Anthropic](https://console.anthropic.com/), and JEV access through [TypeSafe’s API console](https://console.typesafe.ai/). Both agents can use Gemini or both can use Claude; you only need the corresponding provider key. The normal direct Claude connection does not need an `ANTHROPIC_BASE_URL` override.

4. Save the file and restart `npm run dev:server`. Choose **Backend only** in Settings and start an AI simulation. Inspect the agent and JEV status: moving vehicles alone do not prove that live models are working, because fallback control can keep traffic moving.

Your `.env` file is ignored by Git. Keep actual keys there, rather than in source files or screenshots. The browser-only demo remains simulated even when the server has live keys. To return the backend to no-key mode, set both `DEMO_MODE` and `JEV_MODE` to `mock` and restart it.

<details>
<summary>Optional Mozaik cloud dashboard</summary>

The application does not need a Mozaik cloud account. To view agent loops on the cloud dashboard, run this once from the project folder:

```sh
npx @mozaik-ai/cloud-sdk pair
```

Follow the sign-in/approval link it prints, then set `MOZAIK_CLOUD=on` in `apps/server/.env` and restart the server. Streaming uploads agent-loop events; set `MOZAIK_REDACTION=content` to omit prompt and answer content. Leave streaming off if you do not need it.

</details>

## Technical reference

The project uses React, TypeScript and Three.js through React Three Fiber for the interface, Fastify and WebSockets for the server, Mozaik for concurrent agents, and the JEV adapter for TypeSafe arbitration.

| Folder | Contents |
| --- | --- |
| `apps/web` | Website, 3D scenes and browser-only demo |
| `apps/server` | Simulation server, signal safety rules and AI coordination |
| `packages/shared` | Shared API schemas, types and decision counters |
| `vendor` | Packaged JEV adapter and its source/verification information |
| `docs` | API reference, statistics definitions, testing and benchmark evidence |

Further reading: [API contract](docs/API_CONTRACT.md), [Decision Stats](docs/DECISION_STATS.md), [testing](docs/TESTING.md), [traffic methodology and benchmarks](docs/TRAFFIC_CONTROL_TUNING.md), and [adapter provenance](vendor/README.md).

## Features

### Two ways to control the intersection

- **Traditional:** a fixed-time schedule repeats regardless of traffic demand. No AI is called.
- **AI-assisted:** two concurrent agents observe North/South and East/West traffic and propose signal plans. JEV arbitrates conflicting proposals. The safety layer validates the resulting requests, and deterministic fallback is available when a decision fails or cannot be used.

Both use a four-way, straight-through traffic simulation. Backend mock mode exercises the agent/adapter integration without real model calls; live mode connects the configured providers. The independent browser-only demo lets visitors explore without a backend.

<img width="1732" height="803" alt="image" src="https://github.com/user-attachments/assets/f3f7c02b-3a98-4349-94ee-dee906e57f78" />

### A live 3D view and playback controls

Watch cars, vans, buses/trucks and emergency vehicles approach the intersection, queue and pass through the lights. Change the camera between angled and top views, pause/resume the simulation, adjust its speed, or reset it. The Space key toggles play/pause when you are not editing a control. Low rendering quality and reduced-motion support make the interface more usable across devices.

### Timeline and rewind

The timeline draws signal phases, concurrent agent requests, JEV arbitration and safety outcomes as rows of squares. It shows how decisions overlap and how long they take. A session strip shows the run's signal history.

Pause to scrub through recorded snapshots and inspect an earlier moment. Resume to return to the live simulation. Rewind is a view of recorded state; it does not rerun past AI calls or permanently branch the simulation.
<img width="1283" height="322" alt="image" src="https://github.com/user-attachments/assets/9f80c5ff-4617-4ea4-b226-7fa090758b2e" />

### Scenarios and injected events

Explore Normal Traffic, Rush Hour, Reverse Rush, Sudden Surge, Ambulance Priority and Competing Priorities. AI-specific scenarios demonstrate simultaneous proposals, uncertain arbitration and provider failure. Some demonstration outcomes are guaranteed only with mock models; live responses can differ.

The Events menu also lets you introduce emergency vehicles, demand surges, temporary congestion and simulated provider faults during a run.

### Decision explanations and statistics

Inspect agent observations and proposals, JEV selections, public rationale, confidence and safety outcomes. Event/transcript views help explain why a plan was retained, changed, rejected or replaced by fallback.
<img width="1523" height="793" alt="image" src="https://github.com/user-attachments/assets/29a60cf0-fd47-46c3-8628-70661128c885" />

Statistics distinguish proposals from accepted decisions and track agreement, JEV and fallback outcomes. Traffic metrics include queues, completed trips, waiting/travel time, throughput and emergency signal delay. Missing measurements remain unavailable rather than appearing as zero. Charts show how the run develops over time.

### Paired comparison

The **compare** page runs fixed-time and AI control in isolated sessions with the same seed, scenario, traffic parameters and signal timings. View both intersections side by side, inspect their playback, and compare waiting, queues, completed trips, throughput and emergency delay.

Mock comparisons can run faster than real time. Live comparisons run at normal speed because model responses take real time. Results describe the selected run; they do not assume that AI wins.

### Settings and repeatable debugging

Save a default scenario, duration, starting speed and an optional fixed seed. Expand the configuration groups to change:

- Arrival rates and initial queues for each approach.
- The initial green direction and minimum, fixed and maximum green durations.
- Yellow and all-red clearance durations.
- Vehicle mix and police responding probability.
- Random surge/congestion probabilities and event intervals.

Settings are validated before saving and apply to new runs. Traffic overrides are saved per scenario; custom signal timings apply to new runs across scenarios. Settings also control the data source, rendering quality and intro replay. Model selection, request timing and JEV confidence thresholds remain server-controlled.

To repeat traffic inputs, paste the seed shown in the simulation controls and use the same scenario, parameters and data source. **Use last run** restores the previous simulation's seed and configuration together. **Run again** and Reset retain the current seed. Leave Seed blank to generate fresh traffic on new runs.

### What the simulation does—and does not—demonstrate

This is a simplified, straight-lane hackathon simulation, not a real-world traffic-control system or proof that AI always improves traffic. A seed reproduces generated inputs on the same engine/version and data source; live model decisions, response times and manually injected events may differ. Browser-demo timings are synthetic, while backend inference timings are measured in wall time. Backend sessions are held in memory and disappear when the server restarts; browser settings are saved locally on that browser.
