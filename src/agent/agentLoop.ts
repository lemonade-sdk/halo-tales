import { serverFetch } from '../lemonade/client';
import { REQUIRED_MODELS } from '../lemonade/models';
import toolDefinitions from './toolDefinitions.json';
import { editImage, generateImage, textToSpeech } from './omniRouterTools';
import { storyApi } from './storyTools';
import { buildSystemPrompt, STORY_OPENING_INSTRUCTION, TURN_CONTINUATION_INSTRUCTION } from './systemPrompts';

const MAX_TOOL_ITERATIONS = 5;

const STORY_CHAT_OPTIONS = {
  temperature: 0.55,
  top_p: 0.85,
  top_k: 20,
  max_tokens: 900,
  chat_template_kwargs: { enable_thinking: false },
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
  | { kind: 'final' };

const omniToolNames = new Set(['generate_image', 'edit_image', 'text_to_speech']);

function normalizeOutcome(value: unknown): StoryOutcome {
  if (value === 'win' || value === 'loss' || value === 'complete') return value;
  return 'complete';
}

function activeTools(): ChatTool[] {
  return (toolDefinitions.tools as Array<ChatTool & { requires_role?: string }>).map(
    ({ function: f }) => ({ type: 'function', function: f }),
  );
}

function standardChatBody(body: ChatCompletionRequest): ChatCompletionRequest {
  const {
    top_k: _topK,
    chat_template_kwargs: _chatTemplateKwargs,
    ...standard
  } = body;
  return standard;
}

async function postChatCompletion(
  body: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const resp = await serverFetch('/api/v1/chat/completions', {
    method: 'POST',
    body,
    signal,
  });
  if (resp.ok || (resp.status !== 400 && resp.status !== 422)) return resp;

  const text = await resp.text().catch(() => '');
  if (!('top_k' in body) && !('chat_template_kwargs' in body)) {
    throw new Error(`chat/completions failed: HTTP ${resp.status} ${text}`);
  }

  console.warn('[agent] tuned chat options rejected; retrying with standard options:', text);
  return serverFetch('/api/v1/chat/completions', {
    method: 'POST',
    body: standardChatBody(body),
    signal,
  });
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
  ctx.onActivity?.({ kind: 'tool_call', name });

  if (omniToolNames.has(name)) {
    if (name === 'generate_image' || (name === 'edit_image' && !ctx.lastImageB64)) {
      const img = await generateImage(args.prompt ?? '', signal);
      ctx.output.imageB64 = img.b64;
      ctx.lastImageB64 = img.b64;
      ctx.onActivity?.({ kind: 'image_done' });
      return 'Image generated for the current scene.';
    }
    if (name === 'edit_image') {
      const img = await editImage(args.prompt ?? '', ctx.lastImageB64 ?? '', signal);
      ctx.output.imageB64 = img.b64;
      ctx.lastImageB64 = img.b64;
      ctx.onActivity?.({ kind: 'image_done' });
      return 'Image edited based on the requested change.';
    }
    if (name === 'text_to_speech') {
      const audio = await textToSpeech(args.input ?? '', args.voice ?? 'af_heart', signal);
      ctx.output.audioB64 = audio.b64;
      ctx.output.audioMime = audio.mime;
      ctx.onActivity?.({ kind: 'audio_done' });
      return 'Narration audio rendered.';
    }
  }

  switch (name) {
    case 'read_story_summary':
      return await storyApi.readStorySummary(ctx.storyId);
    case 'update_story_summary':
      await storyApi.writeStorySummary(ctx.storyId, args.content ?? '');
      return 'Story summary updated.';
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

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    ctx.onActivity?.({ kind: 'thinking' });
    const resp = await postChatCompletion({
      model: REQUIRED_MODELS.chat,
      messages,
      tools,
      tool_choice: 'auto',
      ...STORY_CHAT_OPTIONS,
    }, signal);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`chat/completions failed: HTTP ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as ChatCompletionResponse;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('chat/completions returned no message');

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      output.narration = msg.content?.trim() ?? '';
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
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        result = `Tool error: ${errMsg}`;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
        name: call.function.name,
      });
    }
  }

  output.narration = output.narration || '(The storyteller fell silent.)';
  return output;
}

/** Use the chat model to invent a short title for a new story. */
export async function nameNewStory(seedPrompt: string, signal?: AbortSignal): Promise<{ title: string; imagePrompt: string }> {
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
