import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { runTurn, nameNewStory, TurnOutput } from '../agent/agentLoop';
import { StoryMeta, TimelineEntry, CharacterEntry } from './types';

export const repo = {
  list: () => invoke<StoryMeta[]>('list_stories'),
  load: (storyId: string) => invoke<StoryMeta>('load_story', { storyId }),
  remove: (storyId: string) => invoke<void>('delete_story', { storyId }),
  updateMeta: (meta: StoryMeta) => invoke<StoryMeta>('update_story_meta', { meta }),
  listTimeline: (storyId: string) => invoke<TimelineEntry[]>('list_timeline', { storyId }),
  readTimelineEntry: (storyId: string, seq: number) =>
    invoke<TimelineEntry>('read_timeline_entry', { storyId, seq }),
  writeTimelineEntry: (storyId: string, seq: number, markdown: string) =>
    invoke<void>('write_timeline_entry', { storyId, seq, markdown }),
  deleteTimelineEntry: (storyId: string, seq: number) =>
    invoke<void>('delete_timeline_entry', { storyId, seq }),
  listCharacters: (storyId: string) => invoke<CharacterEntry[]>('list_characters', { storyId }),
  readStorySummary: (storyId: string) => invoke<string>('read_story_summary', { storyId }),
  writeStorySummary: (storyId: string, content: string) =>
    invoke<void>('write_story_summary', { storyId, content }),
};

/** Convert a story-relative file ("0003-scene.png" or "thumbnail.png") to an asset:// URL. */
export async function artifactUrl(storyId: string, relative: string): Promise<string> {
  const absolute = await invoke<string>('resolve_artifact_url', { storyId, relative });
  return convertFileSrc(absolute);
}

export interface NewStoryOutput {
  meta: StoryMeta;
  opening: TimelineEntry;
}

/** Drive the full "create a new story" flow: name it, persist it, run the opening turn. */
export async function createNewStory(seedPrompt: string, signal?: AbortSignal): Promise<NewStoryOutput> {
  // Create the directory with a placeholder title so the agent's opening
  // turn can run in parallel with title generation. Both prompts are
  // independent inferences; in serial that's the title's ~5s on top of the
  // opening turn's tens-of-seconds.
  const meta = await invoke<StoryMeta>('create_story', {
    title: 'Untitled story',
    seedPrompt,
  });
  const [title, turn] = await Promise.all([
    nameNewStory(seedPrompt, signal).then((r) => r.title),
    runTurn({ storyId: meta.id, userInput: seedPrompt, opening: true, signal }),
  ]);

  const opening = await persistTurn(meta.id, 'scene', turn);
  if (turn.imageB64) {
    await invoke<string>('write_thumbnail', { storyId: meta.id, pngB64: turn.imageB64 });
  }
  await repo.updateMeta({ ...meta, title });
  return { meta: await repo.load(meta.id), opening };
}

export async function persistUserTurn(storyId: string, text: string): Promise<TimelineEntry> {
  return invoke<TimelineEntry>('append_turn_text', {
    storyId,
    role: 'user',
    markdown: text,
  });
}

export async function persistTurn(
  storyId: string,
  role: string,
  turn: TurnOutput,
): Promise<TimelineEntry> {
  const entry = await invoke<TimelineEntry>('append_turn_text', {
    storyId,
    role,
    markdown: turn.narration,
  });
  if (turn.imageB64) {
    const filename = await invoke<string>('append_turn_image', {
      storyId,
      seq: entry.seq,
      pngB64: turn.imageB64,
    });
    entry.image = filename;
  }
  if (turn.audioB64 && turn.audioMime) {
    const filename = await invoke<string>('append_turn_audio', {
      storyId,
      seq: entry.seq,
      audioB64: turn.audioB64,
      mime: turn.audioMime,
    });
    entry.audio = filename;
  }
  return entry;
}

export async function advanceStory(
  storyId: string,
  userText: string,
  lastImageRelative?: string,
  signal?: AbortSignal,
): Promise<{ user: TimelineEntry; scene: TimelineEntry; output: TurnOutput }> {
  const user = await persistUserTurn(storyId, userText);
  // Rehydrate the most recent illustration (if any) so the agent's
  // edit_image tool has a source PNG after an app reload.
  let lastImageB64: string | undefined;
  if (lastImageRelative) {
    try {
      lastImageB64 = await invoke<string>('read_artifact_b64', {
        storyId,
        relative: lastImageRelative,
      });
    } catch (e) {
      console.warn('[advanceStory] failed to load prior image; edit_image will fall back', e);
    }
  }
  const output = await runTurn({ storyId, userInput: userText, lastImageB64, signal });
  const scene = await persistTurn(storyId, 'scene', output);
  if (output.ended) {
    const meta = await repo.load(storyId);
    await repo.updateMeta({ ...meta, status: 'ended', outcome: output.outcome ?? 'complete' });
  }
  return { user, scene, output };
}
