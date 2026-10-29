import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type {
  IntersectionState,
  ServerMessage,
} from "@intersection/shared";

const app = Fastify({ logger: true });

await app.register(websocket);

const initialState: IntersectionState = {
  tick: 0,
  vehicles: [],
  lights: {
    north: "red",
    south: "red",
    east: "green",
    west: "green",
  },
};

app.get("/health", async () => ({
  status: "ok",
  service: "intersection-server",
}));

app.get("/api/simulation", async () => initialState);

app.get("/ws", { websocket: true }, (socket) => {
  const message: ServerMessage = {
    type: "simulation:state",
    payload: initialState,
  };

  socket.send(JSON.stringify(message));
});

try {
  await app.listen({
    port: Number(process.env.PORT ?? 3001),
    host: "127.0.0.1",
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}