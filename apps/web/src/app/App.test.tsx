import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServicesProvider, createAppServices } from "./services";
import { App } from "./App";
import { MetricsPanel } from "@/components/metrics/MetricsPanel";
import { SignalHud } from "@/components/simulation/SignalHud";
import { TooltipProvider } from "@/components/ui/tooltip";
import { sessionStateAfter } from "@/test/fixtures";

beforeEach(() => {
  localStorage.setItem("intersection.preferences.v1", JSON.stringify({ dataSource: "mock", quality: "low" }));
  window.history.pushState({}, "", "/?skipIntro");
});

describe("App without WebGL or backend", () => {
  it("loads the home page with the 2D fallback and an honest status", async () => {
    render(<App services={createAppServices()} />);
    expect(await screen.findByRole("heading", { name: "Choose how this intersection is controlled" })).toBeInTheDocument();
    // The 3D module is lazy-loaded behind the intro, so wait for it.
    // Importing three under a busy parallel run can take several seconds.
    expect(await screen.findByTestId("scene", {}, { timeout: 10_000 })).toHaveAttribute("data-webgl", "unavailable");
    expect(await screen.findByText(/3D view unavailable/, {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("connection-status")).toHaveTextContent("Offline demo"));
    expect(screen.getByText(/agents and JEV are simulated here, no models are called/)).toBeInTheDocument();
  });

  it("navigates between Home, Settings and About", async () => {
    const user = userEvent.setup();
    render(<App services={createAppServices()} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: "About" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Team MAGI" })).toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: "Home" }));
    expect(await screen.findByRole("heading", { name: "Choose how this intersection is controlled" })).toBeInTheDocument();
  });

  it("starts the fixed-time controller from Home", async () => {
    const user = userEvent.setup();
    const services = createAppServices();
    render(<App services={services} />);
    await user.click(await screen.findByRole("button", { name: /Run traditional/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/simulate/traditional"));
    await waitFor(() => expect(services.session.store.getState().status).toBe("running"), { timeout: 4000 });
    const hud = (await screen.findAllByTestId("signal-hud"))[0];
    expect(within(hud).getByText(/Fixed-time controller/)).toBeInTheDocument();
    expect(screen.getByTestId("fixed-time-panel")).toHaveTextContent("No AI is called in this mode.");
  });
});

describe("missing values", () => {
  function withState(node: React.ReactNode, seconds: number) {
    const services = createAppServices();
    services.session.store.setState(sessionStateAfter("normal-traffic", seconds));
    return render(<ServicesProvider services={services}><TooltipProvider>{node}</TooltipProvider></ServicesProvider>);
  }

  it("renders unavailable averages as unavailable, never as zero", () => {
    withState(<MetricsPanel mode="ai" />, 0);
    expect(screen.getAllByText("No completed trips")).toHaveLength(2);
    expect(screen.getByText("None completed yet")).toBeInTheDocument();
    expect(screen.getAllByText("No attempts yet")).toHaveLength(2);
  });

  it("renders the HUD before any metrics exist", () => {
    const services = createAppServices();
    render(<ServicesProvider services={services}><TooltipProvider><SignalHud mode="ai" scenarioName="Normal Traffic" /></TooltipProvider></ServicesProvider>);
    expect(screen.getByTestId("signal-phase")).toHaveTextContent("—");
    expect(screen.getByTestId("queue-ns")).toHaveTextContent("—");
    expect(screen.getByTestId("session-status")).toHaveTextContent("No session");
  });
});
