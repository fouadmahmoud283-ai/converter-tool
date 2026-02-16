/**
 * Streaming response utilities
 * Handles SSE (Server-Sent Events) and streaming responses
 */

export function generateStreamingUtils(): string {
  return `import { Response } from 'express';

/**
 * Server-Sent Events (SSE) helper
 * 
 * Usage:
 *   const sse = createSSEStream(res);
 *   sse.send({ message: 'Hello' });
 *   sse.send({ message: 'World' }, 'custom-event');
 *   sse.close();
 */
export function createSSEStream(res: Response) {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  let eventId = 0;

  return {
    /**
     * Send an SSE event
     */
    send(data: any, event?: string) {
      eventId++;
      const lines: string[] = [];
      
      lines.push(\`id: \${eventId}\`);
      if (event) {
        lines.push(\`event: \${event}\`);
      }
      lines.push(\`data: \${JSON.stringify(data)}\`);
      lines.push(''); // Empty line to end the event
      
      res.write(lines.join('\\n') + '\\n');
    },

    /**
     * Send a comment (for keep-alive)
     */
    comment(text: string) {
      res.write(\`: \${text}\\n\\n\`);
    },

    /**
     * Close the stream
     */
    close() {
      res.end();
    },

    /**
     * Setup heartbeat to keep connection alive
     */
    startHeartbeat(intervalMs = 30000) {
      const interval = setInterval(() => {
        this.comment('heartbeat');
      }, intervalMs);

      res.on('close', () => {
        clearInterval(interval);
      });

      return () => clearInterval(interval);
    }
  };
}

/**
 * Streaming JSON response helper
 * Useful for large datasets or real-time data
 * 
 * Usage:
 *   const stream = createJSONStream(res);
 *   stream.start();
 *   for (const item of items) {
 *     stream.write(item);
 *   }
 *   stream.end();
 */
export function createJSONStream(res: Response) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  let started = false;
  let count = 0;

  return {
    start() {
      res.write('[');
      started = true;
    },

    write(item: any) {
      if (!started) this.start();
      
      if (count > 0) {
        res.write(',');
      }
      res.write(JSON.stringify(item));
      count++;
    },

    end() {
      if (!started) this.start();
      res.write(']');
      res.end();
    },

    getCount() {
      return count;
    }
  };
}

/**
 * Convert async iterator to streaming response
 */
export async function streamAsyncIterator<T>(
  res: Response,
  iterator: AsyncIterable<T>,
  options: {
    contentType?: string;
    transform?: (item: T) => string;
  } = {}
): Promise<void> {
  const { contentType = 'text/plain', transform = (item) => String(item) } = options;
  
  res.setHeader('Content-Type', contentType);
  res.setHeader('Transfer-Encoding', 'chunked');
  
  try {
    for await (const item of iterator) {
      res.write(transform(item));
    }
    res.end();
  } catch (error) {
    console.error('Streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming error' });
    } else {
      res.end();
    }
  }
}
`;
}

export function generateStreamingTypes(): string {
  return `import { Response } from 'express';

export interface SSEStream {
  send(data: any, event?: string): void;
  comment(text: string): void;
  close(): void;
  startHeartbeat(intervalMs?: number): () => void;
}

export interface JSONStream {
  start(): void;
  write(item: any): void;
  end(): void;
  getCount(): number;
}

export type StreamTransform<T> = (item: T) => string;
`;
}
