export type StoryStatus = 'active' | 'ended';
export type StoryOutcome = 'win' | 'loss' | 'complete';
export type TurnRole = 'scene' | 'user' | 'system';

export interface StoryMeta {
  id: string;
  title: string;
  seed_prompt: string;
  created_at: string;
  updated_at: string;
  status: StoryStatus;
  thumbnail: string | null;
  outcome: StoryOutcome | null;
}

export interface TimelineEntry {
  seq: number;
  role: TurnRole;
  markdown: string;
  image: string | null;
  audio: string | null;
}

export interface CharacterEntry {
  name: string;
  content: string;
}
