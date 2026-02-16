/**
 * WebSocket support templates
 * Converts Deno WebSocket patterns to ws/socket.io
 */

export function generateWebSocketSetup(): string {
  return `import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
}

/**
 * Setup WebSocket server with heartbeat and connection management
 */
export function setupWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  // Heartbeat to detect broken connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (!extWs.isAlive) {
        console.log('Terminating inactive WebSocket connection');
        return ws.terminate();
      }
      extWs.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const extWs = ws as ExtendedWebSocket;
    extWs.isAlive = true;
    
    console.log(\`WebSocket client connected from \${req.socket.remoteAddress}\`);

    ws.on('pong', () => {
      extWs.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleWebSocketMessage(ws, message);
      } catch (error) {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });

  console.log('🔌 WebSocket server ready at /ws');
  return wss;
}

/**
 * Handle incoming WebSocket messages
 * Customize this function based on your needs
 */
function handleWebSocketMessage(ws: WebSocket, message: any): void {
  const { type, payload } = message;

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
    
    case 'subscribe':
      // Handle subscription to channels/topics
      console.log(\`Subscription request: \${payload?.channel}\`);
      ws.send(JSON.stringify({ type: 'subscribed', channel: payload?.channel }));
      break;
    
    case 'unsubscribe':
      console.log(\`Unsubscribe request: \${payload?.channel}\`);
      ws.send(JSON.stringify({ type: 'unsubscribed', channel: payload?.channel }));
      break;
    
    default:
      console.log(\`Unknown message type: \${type}\`);
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(wss: WebSocketServer, message: any, filter?: (ws: WebSocket) => boolean): void {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      if (!filter || filter(client)) {
        client.send(data);
      }
    }
  });
}

/**
 * Send message to a specific client by userId
 */
export function sendToUser(wss: WebSocketServer, userId: string, message: any): boolean {
  const data = JSON.stringify(message);
  let sent = false;
  
  wss.clients.forEach((client) => {
    const extWs = client as ExtendedWebSocket;
    if (extWs.userId === userId && client.readyState === WebSocket.OPEN) {
      client.send(data);
      sent = true;
    }
  });
  
  return sent;
}
`;
}

export function generateWebSocketTypes(): string {
  return `import { WebSocket } from 'ws';

export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: number;
}

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  channels?: Set<string>;
}

export type WebSocketHandler = (ws: WebSocket, message: WebSocketMessage) => void | Promise<void>;
`;
}

/**
 * Detect if a Deno function uses WebSocket
 */
export function detectWebSocketUsage(content: string): boolean {
  const wsPatterns = [
    /Deno\.upgradeWebSocket/,
    /new\s+WebSocket\s*\(/,
    /\.onopen\s*=/,
    /\.onmessage\s*=/,
    /\.onclose\s*=/,
    /socket\.send\s*\(/,
  ];
  
  return wsPatterns.some(pattern => pattern.test(content));
}
