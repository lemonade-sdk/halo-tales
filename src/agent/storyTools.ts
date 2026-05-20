import { invoke } from '@tauri-apps/api/core';

export interface CharacterEntry {
  name: string;
  content: string;
}

export const storyApi = {
  readStorySummary: (storyId: string) =>
    invoke<string>('read_story_summary', { storyId }),
  writeStorySummary: (storyId: string, content: string) =>
    invoke<void>('write_story_summary', { storyId, content }),
  listCharacters: (storyId: string) =>
    invoke<CharacterEntry[]>('list_characters', { storyId }),
  readCharacter: (storyId: string, name: string) =>
    invoke<string>('read_character', { storyId, name }),
  upsertCharacter: (storyId: string, name: string, content: string) =>
    invoke<string>('upsert_character', { storyId, name, content }),
  deleteCharacter: (storyId: string, name: string) =>
    invoke<void>('delete_character', { storyId, name }),
};
