/**
 * Worker A: Touch Stream Edge Relay (Stateless Ephemeral In-Memory Relay)
 *
 * Responsibilities:
 * 1. Ingest high-frequency touch events pushed via HTTP POST (/ingest) or WebSocket (/ws?role=producer).
 * 2. Zero cloud persistence (ephemeral in-memory broadcast) to all connected Web visualizers via Durable Object WebSocket (/ws?role=consumer).
 * 3. Supports channel isolation via room parameter (default: room=main).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-Room-Id",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (
      url.pathname !== "/ws" &&
      url.pathname !== "/ingest" &&
      url.pathname !== "/status" &&
      request.headers.get("Upgrade") !== "websocket" &&
      env.ASSETS
    ) {
      return env.ASSETS.fetch(request);
    }

    const roomName = url.searchParams.get("room") || request.headers.get("X-Room-Id") || "main";
    const id = env.TOUCH_RELAY.idFromName(roomName);
    const stub = env.TOUCH_RELAY.get(id);

    return stub.fetch(request);
  },
};

export class TouchRelayRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.stats = {
      relayedBatches: 0,
      relayedEvents: 0,
      lastEventAt: null,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 1. WebSocket real-time connection (/ws?role=consumer | /ws?role=producer)
    if (url.pathname === "/ws" || request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const role = url.searchParams.get("role") || "consumer";
      const deviceId = url.searchParams.get("device") || "anonymous";

      this.state.acceptWebSocket(server, [role, `device:${deviceId}`]);

      server.send(
        JSON.stringify({
          type: "welcome",
          relay: "worker-a-touch",
          role,
          connectedConsumers: this.state.getWebSockets("consumer").length,
          stats: this.stats,
          timestamp: Date.now(),
        })
      );

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: CORS_HEADERS,
      });
    }

    // 2. HTTP POST touch batch ingestion (/ingest)
    if (url.pathname === "/ingest" && request.method === "POST") {
      try {
        const payload = await request.json();
        const events = Array.isArray(payload.events)
          ? payload.events
          : Array.isArray(payload)
          ? payload
          : [payload];

        const message = JSON.stringify({
          type: "touch_batch",
          deviceId: payload.deviceId || request.headers.get("X-Device-Id") || "android-node-01",
          screenWidth: payload.screenWidth || 1080,
          screenHeight: payload.screenHeight || 2400,
          soc: payload.soc || null,
          timestamp: Date.now(),
          events,
        });

        const consumers = this.state.getWebSockets("consumer");
        let sentCount = 0;
        for (const ws of consumers) {
          try {
            ws.send(message);
            sentCount++;
          } catch (_) {}
        }

        this.stats.relayedBatches += 1;
        this.stats.relayedEvents += events.length;
        this.stats.lastEventAt = Date.now();

        return new Response(
          JSON.stringify({
            ok: true,
            deliveredTo: sentCount,
            eventsCount: events.length,
          }),
          {
            status: 200,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 3. Health & Telemetry Status (/status)
    if (url.pathname === "/status") {
      return new Response(
        JSON.stringify({
          service: "worker-a-touch",
          mode: "stateless-ephemeral-relay",
          consumers: this.state.getWebSockets("consumer").length,
          producers: this.state.getWebSockets("producer").length,
          stats: this.stats,
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        service: "Digital Wasteland - Worker A (Touch Relay)",
        endpoints: {
          websocket: "/ws?role=consumer|producer&room=main",
          httpIngest: "POST /ingest?room=main",
          status: "GET /status?room=main",
        },
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  async webSocketMessage(ws, message) {
    try {
      const data = typeof message === "string" ? JSON.parse(message) : null;
      if (data && data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        return;
      }

      const outbound =
        typeof message === "string"
          ? message
          : JSON.stringify({ type: "binary_touch", timestamp: Date.now() });

      const consumers = this.state.getWebSockets("consumer");
      for (const client of consumers) {
        if (client !== ws) {
          try {
            client.send(outbound);
          } catch (_) {}
        }
      }

      this.stats.relayedBatches += 1;
      if (data && Array.isArray(data.events)) {
        this.stats.relayedEvents += data.events.length;
      } else {
        this.stats.relayedEvents += 1;
      }
      this.stats.lastEventAt = Date.now();
    } catch (_) {}
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch (_) {}
  }
}
