import toolDefinitions from './toolDefinitions.json';

interface ToolEntry {
  type?: string;
  requires_role?: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Build the storyteller system prompt with the active tool list interpolated. */
export function buildSystemPrompt(): string {
  const tools = (toolDefinitions.tools as ToolEntry[]).map(
    (t) => `- ${t.function.name}: ${t.function.description}`,
  );
  return toolDefinitions.system_prompt.replace('{tool_list}', tools.join('\n'));
}

export const STORY_OPENING_INSTRUCTION = `Open a new story from the seed. Each tool exactly once: generate_image, text_to_speech, update_story_summary, upsert_character.`;

export const TURN_CONTINUATION_INSTRUCTION = `Advance from the player's choice. Each tool at most once: edit_image (or generate_image on a setting change), text_to_speech, update_story_summary, upsert_character (if anyone changed).`;
