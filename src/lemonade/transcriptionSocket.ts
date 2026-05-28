import { getEndpoint, jsonFetch } from './client';

/** OpenAI Realtime-API style WebSocket transcription client. Ported from the
 *  Lemonade reference app (`utils/websocketClient.ts`).
 *
 *  Flow:
 *    1. Fetch `websocket_port` from `/api/v1/health`.
 *    2. Open ws://host:wsPort/realtime?model=NAME.
 *    3. Send `session.update` once connected.
 *    4. Stream base64 PCM16 16 kHz mono chunks via `input_audio_buffer.append`.
 *    5. Receive deltas (`...delta`) and finals (`...completed`).
 *    6. On stop, send `input_audio_buffer.commit` to flush the trailing speech.
 */
export interface TranscriptionCallbacks {
  /** Interim deltas (`isFinal=false`) and committed finals (`isFinal=true`). */
  onTranscription: (text: string, isFinal: boolean) => void;
  onSpeechEvent?: (event: 'started' | 'stopped') => void;
  onAudioBufferCleared?: () => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (msg: string) => void;
}

interface HealthResponse {
  websocket_port?: number;
}

export class TranscriptionSocket {
  private socket: WebSocket;
  private wsPort: number;

  private constructor(wsPort: number, model: string, callbacks: TranscriptionCallbacks) {
    this.wsPort = wsPort;
    const url = buildWebSocketUrl('/realtime', wsPort, new URLSearchParams({ model }));
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.send({ type: 'session.update', session: { model } });
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'session.created':
            callbacks.onConnected?.();
            break;
          case 'session.updated':
            break;
          case 'input_audio_buffer.speech_started':
            callbacks.onSpeechEvent?.('started');
            break;
          case 'input_audio_buffer.speech_stopped':
            callbacks.onSpeechEvent?.('stopped');
            break;
          case 'input_audio_buffer.cleared':
            callbacks.onAudioBufferCleared?.();
            break;
          case 'conversation.item.input_audio_transcription.delta':
            if (typeof msg.delta === 'string') callbacks.onTranscription(msg.delta, false);
            break;
          case 'conversation.item.input_audio_transcription.completed':
            if (typeof msg.transcript === 'string') callbacks.onTranscription(msg.transcript, true);
            break;
          case 'error':
            callbacks.onError?.(msg.error?.message || 'Server error');
            break;
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });

    this.socket.addEventListener('error', () => {
      callbacks.onError?.('WebSocket error');
    });

    this.socket.addEventListener('close', (ev) => {
      if (ev.code !== 1000) {
        callbacks.onError?.(
          `WebSocket closed (code=${ev.code}). Is the server running on port ${this.wsPort}?`,
        );
      }
      callbacks.onDisconnected?.();
    });
  }

  /** Open a connection. Discovers the WebSocket port from Lemonade's
   *  /api/v1/health response (`websocket_port`). */
  static async connect(
    model: string,
    callbacks: TranscriptionCallbacks,
  ): Promise<TranscriptionSocket> {
    const health = await jsonFetch<HealthResponse>('/api/v1/health');
    const wsPort = health.websocket_port;
    if (typeof wsPort !== 'number') {
      throw new Error('Server did not provide websocket_port in /api/v1/health response');
    }
    return new TranscriptionSocket(wsPort, model, callbacks);
  }

  private send(msg: object): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  sendAudio(base64Audio: string): void {
    this.send({ type: 'input_audio_buffer.append', audio: base64Audio });
  }

  commitAudio(): void {
    this.send({ type: 'input_audio_buffer.commit' });
  }

  clearAudio(): void {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  isConnected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.socket.close(1000, 'OK');
  }
}

/** Build a ws:// or wss:// URL from the current Lemonade endpoint, swapping
 *  the port for the WebSocket-only one. */
function buildWebSocketUrl(
  path: string,
  wsPort: number,
  query?: URLSearchParams,
): string {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error('Lemonade endpoint not configured yet');
  const url = new URL(endpoint.base_url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.port = String(wsPort);
  url.pathname = url.pathname.replace(/\/$/, '') + path;
  const params = new URLSearchParams(query);
  if (endpoint.api_key) params.set('api_key', endpoint.api_key);
  url.search = params.toString();
  return url.toString();
}
