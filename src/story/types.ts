export interface StoryMeta {
  id: string;
  title: string;
  seed_prompt: string;
  created_at: string;
  updated_at: string;
  status: 'active' | 'ended';
  thumbnail: string | null;
  outcome: string | null;
}

export interface TimelineEntry {
  seq: number;
  role: string; // 'scene' | 'user' | 'system'
  markdown: string;
  image: string | null;
  audio: string | null;
}

export interface CharacterEntry {
  name: string;
  content: string;
}
