// End-of-session cost logging for the OpenAI adapters.
//
// Prices are USD per 1M tokens (Realtime) or per minute (GPT-Live), from
// https://developers.openai.com/api/docs/pricing (checked Sept 2026). Update
// them when OpenAI changes them. Logged totals are estimates; the OpenAI
// usage dashboard is the source of truth.

interface RealtimePrice {
  textIn: number;
  cachedTextIn: number;
  textOut: number;
  audioIn: number;
  cachedAudioIn: number;
  audioOut: number;
  imageIn: number;
}

const REALTIME_PRICES: Record<string, RealtimePrice> = {
  'gpt-realtime': { textIn: 4, cachedTextIn: 0.4, textOut: 16, audioIn: 32, cachedAudioIn: 0.4, audioOut: 64, imageIn: 5 },
  'gpt-realtime-2': { textIn: 4, cachedTextIn: 0.4, textOut: 24, audioIn: 32, cachedAudioIn: 0.4, audioOut: 64, imageIn: 5 },
  'gpt-realtime-2.1': { textIn: 4, cachedTextIn: 0.4, textOut: 24, audioIn: 32, cachedAudioIn: 0.4, audioOut: 64, imageIn: 5 },
  'gpt-realtime-mini': { textIn: 0.6, cachedTextIn: 0.06, textOut: 2.4, audioIn: 10, cachedAudioIn: 0.3, audioOut: 20, imageIn: 0.8 },
  'gpt-realtime-2.1-mini': { textIn: 0.6, cachedTextIn: 0.06, textOut: 2.4, audioIn: 10, cachedAudioIn: 0.3, audioOut: 20, imageIn: 0.8 },
};

// Input transcription (the adapter enables it for user transcripts), billed separately.
const TRANSCRIBE_PRICES: Record<string, { in: number; out: number; perMinute: number }> = {
  'gpt-4o-mini-transcribe': { in: 1.25, out: 5, perMinute: 0.003 },
};

const LIVE_PRICE_PER_MINUTE = 0.05; // gpt-live-1 voice layer, billed per second

/** Resolves a model id, including dated snapshots (`gpt-realtime-mini-2025-10-06`), to a price-table key. */
function lookup<T>(table: Record<string, T>, model: string | undefined): T | undefined {
  if (!model) return undefined;
  return table[model] ?? table[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(5) : n.toFixed(2)}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** Accumulates OpenAI Realtime usage over one session and logs the total when it ends. */
export class RealtimeCostTracker {
  private model: string | undefined;
  private transcribeModel: string | undefined;
  private cost = 0;
  private unpricedResponses = 0;
  private responses = 0;

  /** Feed every server event; picks out the ones that carry usage. */
  handleEvent(msg: Json): void {
    if ((msg.type === 'session.created' || msg.type === 'session.updated') && msg.session) {
      this.model = msg.session.model ?? this.model;
      this.transcribeModel =
        msg.session.input_audio_transcription?.model ?? msg.session.audio?.input?.transcription?.model ?? this.transcribeModel;
    } else if (msg.type === 'response.done' && msg.response?.usage) {
      this.responses++;
      const price = lookup(REALTIME_PRICES, this.model);
      if (!price) {
        this.unpricedResponses++;
        return;
      }
      const u = msg.response.usage;
      const inD = u.input_token_details ?? {};
      const cached = inD.cached_tokens_details ?? {};
      const outD = u.output_token_details ?? {};
      // text/audio input counts include their cached share — price it separately.
      const cachedText = cached.text_tokens ?? 0;
      const cachedAudio = cached.audio_tokens ?? 0;
      this.cost +=
        (((inD.text_tokens ?? 0) - cachedText) * price.textIn +
          cachedText * price.cachedTextIn +
          ((inD.audio_tokens ?? 0) - cachedAudio) * price.audioIn +
          cachedAudio * price.cachedAudioIn +
          (inD.image_tokens ?? 0) * price.imageIn +
          (outD.text_tokens ?? 0) * price.textOut +
          (outD.audio_tokens ?? 0) * price.audioOut) /
        1e6;
    } else if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.usage) {
      const tp = lookup(TRANSCRIBE_PRICES, this.transcribeModel);
      if (!tp) return;
      this.cost +=
        msg.usage.type === 'duration'
          ? ((msg.usage.seconds ?? 0) / 60) * tp.perMinute
          : ((msg.usage.input_tokens ?? 0) * tp.in + (msg.usage.output_tokens ?? 0) * tp.out) / 1e6;
    }
  }

  /** Logs the session total (if anything was used) and resets for the next session. */
  logAndReset(): void {
    if (this.responses > 0) {
      const note = this.unpricedResponses ? ` (no price for model "${this.model ?? 'unknown'}" — ${this.unpricedResponses} responses not counted)` : '';
      console.info(`[gsplat-talkinghead] OpenAI Realtime session total ≈ ${usd(this.cost)}${note}`);
    }
    this.model = undefined;
    this.transcribeModel = undefined;
    this.cost = 0;
    this.unpricedResponses = 0;
    this.responses = 0;
  }
}

/** Tracks GPT-Live billed voice time over one session and logs the total when it ends. */
export class LiveCostTracker {
  private reportedSeconds = 0;
  private startedAt = 0;

  handleEvent(msg: Json): void {
    if (msg.type === 'session.started') {
      this.startedAt = Date.now();
    } else if ((msg.type === 'session.usage.updated' || msg.type === 'session.closed') && msg.usage) {
      this.reportedSeconds = Math.max(this.reportedSeconds, msg.usage.seconds ?? 0);
    }
  }

  /** Logs the session total (if it started) and resets for the next session. */
  logAndReset(): void {
    if (this.startedAt) {
      // Prefer the server's billed seconds; fall back to wall-clock time if the
      // connection closed before a usage report arrived.
      const elapsed = (Date.now() - this.startedAt) / 1000;
      const seconds = this.reportedSeconds > 0 ? this.reportedSeconds : elapsed;
      console.info(
        `[gsplat-talkinghead] OpenAI GPT-Live session total ≈ ${usd((seconds / 60) * LIVE_PRICE_PER_MINUTE)} ` +
          '(voice; delegated backend model billed separately)',
      );
    }
    this.reportedSeconds = 0;
    this.startedAt = 0;
  }
}
