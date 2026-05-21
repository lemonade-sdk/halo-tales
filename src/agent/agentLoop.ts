import { serverFetch } from '../lemonade/client';
import { REQUIRED_MODELS } from '../lemonade/models';
import toolDefinitions from './toolDefinitions.json';
import { editImage, generateImage, textToSpeech } from './omniRouterTools';
import { storyApi } from './storyTools';
import { buildSystemPrompt, STORY_OPENING_INSTRUCTION, TURN_CONTINUATION_INSTRUCTION } from './systemPrompts';
import { makeLogger } from '../util/logger';

const log = makeLogger('agent');

const MAX_TOOL_ITERATIONS = 5;

// Qwen3 thinking-mode sampling preset. Thinking is required for reliable tool
// calling — Qwen3 plans tool use inside reasoning_content; with it disabled
// the model tends to skip tools and just write prose. thinking_budget caps the
// reasoning so the model doesn't burn the whole token allotment musing; if
// Lemonade's template ignores the kwarg, no harm done (the retry path also
// strips chat_template_kwargs entirely).
const STORY_CHAT_OPTIONS = {
  temperature: 0.6,
  top_p: 0.95,
  top_k: 20,
  min_p: 0,
  presence_penalty: 0,
  max_tokens: 6144,
  chat_template_kwargs: {
    enable_thinking: true,
    preserve_thinking: true,
    thinking_budget: 1024,
  },
};

const TITLE_CHAT_OPTIONS = {
  temperature: 0.35,
  top_p: 0.8,
  top_k: 20,
  max_tokens: 96,
  chat_template_kwargs: { enable_thinking: false },
};

interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage;
    finish_reason?: string;
  }>;
}

type ChatCompletionRequest = Record<string, unknown>;

import { StoryOutcome } from '../story/types';

export interface TurnOutput {
  narration: string;
  imageB64?: string;
  audioB64?: string;
  audioMime?: string;
  ended?: boolean;
  outcome?: StoryOutcome;
  epilogue?: string;
}

export interface RunTurnInput {
  storyId: string;
  userInput: string;
  /** Last image (base64 PNG) from the prior turn, used as source for edit_image. */
  lastImageB64?: string;
  /** True when this is the opening turn (no prior history yet). */
  opening?: boolean;
  signal?: AbortSignal;
  /** Optional progress callback so the UI can show "thinking…", tool calls etc. */
  onActivity?: (event: AgentActivity) => void;
}

export type AgentActivity =
  | { kind: 'thinking' }
  | { kind: 'tool_call'; name: string }
  | { kind: 'image_done' }
  | { kind: 'audio_done' }
  | { kind: 'composing' }
  | { kind: 'final' };

const omniToolNames = new Set(['generate_image', 'edit_image', 'text_to_speech']);

function normalizeOutcome(value: unknown): StoryOutcome {
  if (value === 'win' || value === 'loss' || value === 'complete') return value;
  return 'complete';
}

/** Qwen3 thinking-mode emits `<think>...</think>` blocks in the assistant
 *  content. Strip them before showing prose to the player or feeding it to
 *  text-to-speech. */
function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

function activeTools(): ChatTool[] {
  return (toolDefinitions.tools as Array<ChatTool & { requires_role?: string }>).map(
    ({ function: f }) => ({ type: 'function', function: f }),
  );
}

function standardChatBody(body: ChatCompletionRequest): ChatCompletionRequest {
  const {
    top_k: _topK,
    min_p: _minP,
    chat_template_kwargs: _chatTemplateKwargs,
    ...standard
  } = body;
  return standard;
}

async function postChatCompletion(
  body: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const model = (body as { model?: string }).model;
  const msgCount = Array.isArray((body as { messages?: unknown[] }).messages)
    ? ((body as { messages: unknown[] }).messages).length
    : 0;
  const started = performance.now();
  log.info('chat/completions: POST', { model, messages: msgCount });
  const resp = await serverFetch('/api/v1/chat/completions', {
    method: 'POST',
    body,
    signal,
  });
  log.info(
    'chat/completions: response',
    resp.status,
    `(${(performance.now() - started).toFixed(0)}ms)`,
  );
  if (resp.ok || (resp.status !== 400 && resp.status !== 422)) return resp;

  const text = await resp.text().catch(() => '');
  if (!('top_k' in body) && !('chat_template_kwargs' in body)) {
    throw new Error(`chat/completions failed: HTTP ${resp.status} ${text}`);
  }

  log.warn('tuned chat options rejected; retrying with standard options:', text);
  return serverFetch('/api/v1/chat/completions', {
    method: 'POST',
    body: standardChatBody(body),
    signal,
  });
}

/** If TTS audio was generated with text different from the displayed prose
 *  (common on continuation turns where iter 1 calls tts with placeholder text
 *  and iter 2 produces the actual prose), re-narrate so what the player hears
 *  matches what they read. */
async function ensureAudioMatchesNarration(
  ctx: TurnCtx,
  signal?: AbortSignal,
): Promise<void> {
  if (!ctx.output.audioB64) return;
  const narration = ctx.output.narration.trim();
  const source = (ctx.audioSourceText ?? '').trim();
  if (!narration) return;
  if (source === narration) return;
  log.warn(
    'audio desync — re-generating TTS. sourceChars =',
    source.length,
    'narrationChars =',
    narration.length,
  );
  try {
    const audio = await textToSpeech(narration, 'af_heart', signal);
    ctx.output.audioB64 = audio.b64;
    ctx.output.audioMime = audio.mime;
    ctx.audioSourceText = narration;
    log.info('TTS re-narrated — b64 chars =', audio.b64.length);
    ctx.onActivity?.({ kind: 'audio_done' });
  } catch (e) {
    log.error('TTS re-narration failed', e);
  }
}

async function buildContext(storyId: string): Promise<ChatMessage[]> {
  const [summary, characters] = await Promise.all([
    storyApi.readStorySummary(storyId),
    storyApi.listCharacters(storyId),
  ]);
  const characterSummary = characters
    .map((c) => `### ${c.name}\n${c.content.slice(0, 600)}`)
    .join('\n\n');
  const parts: string[] = [];
  if (summary.trim()) parts.push(`# Story so far\n${summary.trim()}`);
  if (characterSummary.trim()) parts.push(`# Characters\n${characterSummary.trim()}`);
  if (!parts.length) return [];
  return [{ role: 'system', content: parts.join('\n\n---\n\n') }];
}

interface TurnCtx {
  storyId: string;
  output: TurnOutput;
  lastImageB64?: string;
  /** Text the model passed to text_to_speech, for desync detection. */
  audioSourceText?: string;
  onActivity?: (e: AgentActivity) => void;
}

async function dispatchTool(
  call: ToolCall,
  ctx: TurnCtx,
  signal?: AbortSignal,
): Promise<string> {
  const args = (() => {
    try {
      return JSON.parse(call.function.arguments || '{}');
    } catch {
      return {};
    }
  })();
  const name = call.function.name;
  log.info('tool_call', name, 'args keys:', Object.keys(args));
  ctx.onActivity?.({ kind: 'tool_call', name });

  if (omniToolNames.has(name)) {
    if (name === 'generate_image' || (name === 'edit_image' && !ctx.lastImageB64)) {
      const img = await generateImage(args.prompt ?? '', signal);
      ctx.output.imageB64 = img.b64;
      ctx.lastImageB64 = img.b64;
      log.info('generate_image OK — b64 chars =', img.b64.length);
      ctx.onActivity?.({ kind: 'image_done' });
      return 'Image generated for the current scene.';
    }
    if (name === 'edit_image') {
      const img = await editImage(args.prompt ?? '', ctx.lastImageB64 ?? '', signal);
      ctx.output.imageB64 = img.b64;
      ctx.lastImageB64 = img.b64;
      log.info('edit_image OK — b64 chars =', img.b64.length);
      ctx.onActivity?.({ kind: 'image_done' });
      return 'Image edited based on the requested change.';
    }
    if (name === 'text_to_speech') {
      const input = typeof args.input === 'string' ? args.input : '';
      ctx.audioSourceText = input;
      log.info(
        'text_to_speech input — chars =',
        input.length,
        'prefix =',
        JSON.stringify(input.slice(0, 80)),
      );
      const audio = await textToSpeech(input, args.voice ?? 'af_heart', signal);
      ctx.output.audioB64 = audio.b64;
      ctx.output.audioMime = audio.mime;
      log.info('text_to_speech OK — b64 chars =', audio.b64.length);
      ctx.onActivity?.({ kind: 'audio_done' });
      return 'Narration audio rendered.';
    }
  }

  switch (name) {
    case 'read_story_summary':
      return await storyApi.readStorySummary(ctx.storyId);
    case 'update_story_summary': {
      const content = typeof args.content === 'string' ? args.content : '';
      if (!content.trim()) {
        log.warn('update_story_summary called with empty content; skipping write');
        return 'No-op: update_story_summary requires non-empty `content`.';
      }
      await storyApi.writeStorySummary(ctx.storyId, content);
      return 'Story summary updated.';
    }
    case 'list_characters': {
      const chars = await storyApi.listCharacters(ctx.storyId);
      return chars.map((c) => `- ${c.name}: ${c.content.split('\n').find((l) => l.trim()) ?? ''}`).join('\n') || '(no characters yet)';
    }
    case 'read_character':
      return await storyApi.readCharacter(ctx.storyId, args.name ?? '');
    case 'upsert_character':
      await storyApi.upsertCharacter(ctx.storyId, args.name ?? '', args.content ?? '');
      return `Character ${args.name} saved.`;
    case 'end_story': {
      const outcome = normalizeOutcome(args.outcome);
      ctx.output.ended = true;
      ctx.output.outcome = outcome;
      ctx.output.epilogue = args.epilogue ?? '';
      return `Story marked as ${outcome}.`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export async function runTurn(input: RunTurnInput): Promise<TurnOutput> {
  const { storyId, userInput, opening, signal, onActivity, lastImageB64 } = input;
  const tools = activeTools();
  const systemPrompt = buildSystemPrompt();

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];
  const context = await buildContext(storyId);
  messages.push(...context);
  const instructionPrefix = opening ? STORY_OPENING_INSTRUCTION : TURN_CONTINUATION_INSTRUCTION;
  messages.push({
    role: 'user',
    content: `${instructionPrefix}\n\nPlayer turn:\n${userInput}`,
  });

  const output: TurnOutput = { narration: '' };
  const ctx: TurnCtx = { storyId, output, lastImageB64, onActivity };

  log.info('runTurn: begin', { storyId, opening: !!opening, userInputChars: userInput.length });
  // Fire 'thinking' once per turn rather than per iteration. The renderer's
  // step indicator treats this as "writing the opening scene"; we don't want
  // it to re-spin every time the agent loop swings back to the model.
  ctx.onActivity?.({ kind: 'thinking' });
  const calledTools = new Set<string>();
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // Once the producer-side tools have all run at least once, the model has
    // nothing left to do but write the displayed prose. Force tool_choice to
    // 'none' to short-circuit pathological loops (e.g. the model regenerating
    // the same image over and over without ever wrapping up).
    const hasImage =
      calledTools.has('generate_image') || calledTools.has('edit_image');
    const hasAudio = calledTools.has('text_to_speech');
    const hasSummary = calledTools.has('update_story_summary');
    const toolChoice: 'auto' | 'none' =
      hasImage && hasAudio && hasSummary ? 'none' : 'auto';
    log.info(
      'runTurn: iteration',
      i + 1,
      'of',
      MAX_TOOL_ITERATIONS,
      'tool_choice =',
      toolChoice,
    );
    // Once we force the model into prose-only mode, it's about to spend ~20-30s
    // writing the displayed prose. Surface that to the UI so the spinner moves
    // off the (already-completed) tool steps and onto a fresh "composing" one.
    if (toolChoice === 'none') {
      ctx.onActivity?.({ kind: 'composing' });
    }
    const resp = await postChatCompletion({
      model: REQUIRED_MODELS.chat,
      messages,
      tools,
      tool_choice: toolChoice,
      ...STORY_CHAT_OPTIONS,
    }, signal);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      log.error('runTurn: chat/completions failed', resp.status, text);
      throw new Error(`chat/completions failed: HTTP ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as ChatCompletionResponse & {
      error?: { message?: string; code?: number };
    };
    if (data.error) {
      const msg = data.error.message ?? JSON.stringify(data.error);
      log.error('runTurn: backend returned error body', msg);
      throw new Error(`Lemonade error: ${msg}`);
    }
    const choice = data.choices?.[0] as
      | { message?: ChatMessage; finish_reason?: string }
      | undefined;
    const msg = choice?.message;
    if (!msg) {
      log.error('runTurn: chat/completions returned no message', data);
      throw new Error('chat/completions returned no message');
    }
    const rawContent = msg.content ?? '';
    const reasoning = (msg as { reasoning_content?: string }).reasoning_content ?? '';
    log.info(
      'runTurn: assistant message — toolCalls =',
      msg.tool_calls?.length ?? 0,
      'contentChars =',
      rawContent.length,
      'reasoningChars =',
      reasoning.length,
      'finish_reason =',
      choice?.finish_reason,
      'contentPrefix =',
      JSON.stringify(rawContent.slice(0, 200)),
    );

    // Capture displayed prose from any iteration. Our prompt instructs the
    // model to write the prose alongside its tool calls in the same response,
    // so without this we'd throw away the player-facing text and end up with
    // only an empty timeline entry. Strip <think>...</think> first — Qwen3
    // thinking-mode emits those in the assistant content and they must not
    // reach the player or text-to-speech.
    const content = stripThinking(rawContent);
    if (content) output.narration = content;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Belt and suspenders: ensure we never persist an empty narration. The
      // model occasionally returns an empty assistant message (e.g. when
      // thinking blew the token budget) — without this, the timeline saves a
      // blank card.
      if (!output.narration.trim()) {
        output.narration = '(The storyteller fell silent.)';
        log.warn('runTurn: empty model response; using fallback narration');
      }
      log.info('runTurn: final narration chars =', output.narration.length);
      await ensureAudioMatchesNarration(ctx, signal);
      ctx.onActivity?.({ kind: 'final' });
      return output;
    }

    // Push the assistant message (with tool_calls) so the model has its own context
    // on the next iteration — without it, OpenAI-compatible servers reject the
    // follow-up 'tool' messages with an "orphaned tool call" error.
    messages.push({
      role: 'assistant',
      content: msg.content ?? '',
      tool_calls: msg.tool_calls,
    });

    for (const call of msg.tool_calls) {
      let result: string;
      try {
        result = await dispatchTool(call, ctx, signal);
        calledTools.add(call.function.name);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        log.error('dispatchTool threw —', call.function.name, errMsg);
        result = `Tool error: ${errMsg}`;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
        name: call.function.name,
      });
    }

    // If this iteration produced both displayed prose AND every required
    // tool, exit immediately. Without this, iter 2 (forced to no tool_choice)
    // tends to write a *different* scene from the one the model just sent
    // through text_to_speech — leaving displayed text and narrated audio out
    // of sync. The prose from this iteration is the canonical one.
    const haveImage =
      calledTools.has('generate_image') || calledTools.has('edit_image');
    const haveAudio = calledTools.has('text_to_speech');
    const haveSummary = calledTools.has('update_story_summary');
    if (output.narration.trim() && haveImage && haveAudio && haveSummary) {
      log.info('runTurn: iter produced prose + all required tools — early exit');
      await ensureAudioMatchesNarration(ctx, signal);
      ctx.onActivity?.({ kind: 'final' });
      return output;
    }
  }

  output.narration = output.narration || '(The storyteller fell silent.)';
  await ensureAudioMatchesNarration(ctx, signal);
  return output;
}

/** Use the chat model to invent a short title for a new story. */
export async function nameNewStory(seedPrompt: string, signal?: AbortSignal): Promise<{ title: string; imagePrompt: string }> {
  log.info('nameNewStory: begin');
  const resp = await postChatCompletion({
    model: REQUIRED_MODELS.chat,
    messages: [
      {
        role: 'system',
        content:
          'You name new interactive stories. Reply with strict JSON only: {"title": string (4-7 words, no quotes), "imagePrompt": string (a vivid 1-sentence cover-art prompt)}.',
      },
      {
        role: 'user',
        content: `Seed: ${seedPrompt}\n\nReturn the JSON only.`,
      },
    ],
    ...TITLE_CHAT_OPTIONS,
  }, signal);
  if (!resp.ok) throw new Error('nameNewStory: HTTP ' + resp.status);
  const data = await resp.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? '';
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('no JSON');
    const obj = JSON.parse(raw.slice(start, end + 1));
    return {
      title: String(obj.title || 'Untitled story'),
      imagePrompt: String(obj.imagePrompt || seedPrompt),
    };
  } catch {
    return { title: 'Untitled story', imagePrompt: seedPrompt };
  }
}
