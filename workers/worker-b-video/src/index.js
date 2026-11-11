/**
 * Worker B: 15-second Low-Bitrate Video Chunk Edge Relay
 *
 * Responsibilities:
 * 1. Ingest low-bitrate MP4 chunks uploaded from Android client every 15 seconds (POST /upload-chunk).
 * 2. Broadcast video chunks in real-time via WebSocket to connected reveal viewports.
 * 3. Maintain ephemeral in-memory ring buffer (up to 10 latest chunks) in Durable Object state,
 *    automatically backfilling late-joining or reconnecting viewers without cloud object storage.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Device-Id, X-Room-Id, X-Chunk-Index, X-Chunk-Duration, X-Mime-Type, X-Recorded-At",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (
      url.pathname !== "/ws" &&
      url.pathname !== "/upload-chunk" &&
      url.pathname !== "/status" &&
      request.headers.get("Upgrade") !== "websocket" &&
      env.ASSETS
    ) {
      return env.ASSETS.fetch(request);
    }

    const roomName = url.searchParams.get("room") || request.headers.get("X-Room-Id") || "main";
    const id = env.VIDEO_RELAY.idFromName(roomName);
    const stub = env.VIDEO_RELAY.get(id);

    return stub.fetch(request);
  },
};

export class VideoChunkRelayRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.recentRingBuffer = []; // In-memory ephemeral ring buffer (holds up to 10 recent chunks)
    this.stats = {
      relayedChunks: 0,
      relayedBytes: 0,
      lastChunkAt: null,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 1. WebSocket connection (/ws?role=consumer)
    if (url.pathname === "/ws" || request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const role = url.searchParams.get("role") || "consumer";
      const deviceId = url.searchParams.get("device") || "reveal-station";

      this.state.acceptWebSocket(server, [role, `device:${deviceId}`]);

      server.send(
        JSON.stringify({
          type: "welcome",
          relay: "worker-b-video",
          role,
          connectedConsumers: this.state.getWebSockets("consumer").length,
          stats: this.stats,
          timestamp: Date.now(),
        })
      );

      // Backfill buffered recent chunks to newly connected consumers
      if (role === "consumer" && this.recentRingBuffer.length > 0) {
        for (const item of this.recentRingBuffer) {
          try {
            server.send(item.envelope);
            server.send(item.videoBuffer);
          } catch (_) {}
        }
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: CORS_HEADERS,
      });
    }

    // 2. HTTP POST chunk ingestion (/upload-chunk)
    if (url.pathname === "/upload-chunk" && request.method === "POST") {
      try {
        const contentType = request.headers.get("Content-Type") || "";
        let videoBuffer;
        let meta = {};

        if (contentType.includes("multipart/form-data")) {
          const formData = await request.formData();
          const file = formData.get("chunk") || formData.get("video") || formData.get("file");
          if (!file || typeof file.arrayBuffer !== "function") {
            throw new Error("Missing video chunk field in multipart/form-data");
          }
          videoBuffer = await file.arrayBuffer();
          meta = {
            deviceId: formData.get("deviceId") || request.headers.get("X-Device-Id") || "android-node-01",
            chunkIndex: Number(formData.get("chunkIndex") || request.headers.get("X-Chunk-Index") || this.stats.relayedChunks),
            durationSec: Number(formData.get("durationSec") || request.headers.get("X-Chunk-Duration") || 15),
            mimeType: file.type || formData.get("mimeType") || "video/mp4",
            recordedAt: Number(formData.get("recordedAt") || Date.now()),
          };
        } else {
          videoBuffer = await request.arrayBuffer();
          meta = {
            deviceId: request.headers.get("X-Device-Id") || url.searchParams.get("deviceId") || "android-node-01",
            chunkIndex: Number(request.headers.get("X-Chunk-Index") || url.searchParams.get("chunkIndex") || this.stats.relayedChunks),
            durationSec: Number(request.headers.get("X-Chunk-Duration") || url.searchParams.get("duration") || 15),
            mimeType: request.headers.get("X-Mime-Type") || contentType || "video/mp4",
            recordedAt: Number(request.headers.get("X-Recorded-At") || Date.now()),
          };
        }

        const chunkId = `chunk-${meta.recordedAt}-${meta.chunkIndex}`;
        const envelope = JSON.stringify({
          type: "chunk_meta",
          chunkId,
          ...meta,
          byteLength: videoBuffer.byteLength,
          relayedAt: Date.now(),
        });

        // Store in ephemeral memory ring buffer
        this.recentRingBuffer.push({ chunkId, envelope, videoBuffer });
        if (this.recentRingBuffer.length > 10) {
          this.recentRingBuffer.shift();
        }

        const consumers = this.state.getWebSockets("consumer");
        let deliveredCount = 0;
        for (const ws of consumers) {
          try {
            ws.send(envelope);
            ws.send(videoBuffer);
            deliveredCount++;
          } catch (_) {}
        }

        this.stats.relayedChunks += 1;
        this.stats.relayedBytes += videoBuffer.byteLength;
        this.stats.lastChunkAt = Date.now();

        return new Response(
          JSON.stringify({
            ok: true,
            chunkId,
            byteLength: videoBuffer.byteLength,
            deliveredTo: deliveredCount,
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

    // 3. Status Query (/status)
    if (url.pathname === "/status") {
      return new Response(
        JSON.stringify({
          service: "worker-b-video",
          mode: "stateless-binary-stream-relay",
          consumers: this.state.getWebSockets("consumer").length,
          bufferedRecentChunks: this.recentRingBuffer.length,
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
        service: "Digital Wasteland - Worker B (15s Video Chunk Relay)",
        endpoints: {
          websocket: "/ws?role=consumer&room=main",
          uploadChunk: "POST /upload-chunk?room=main",
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
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }
        if (parsed.type === "clear_archive") {
          this.recentRingBuffer = [];
          for (const consumer of this.state.getWebSockets("consumer")) {
            try {
              consumer.send(JSON.stringify({ type: "archive_cleared" }));
            } catch (_) {}
          }
          return;
        }
      } catch (_) {}
    }
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch (_) {}
  }
}
