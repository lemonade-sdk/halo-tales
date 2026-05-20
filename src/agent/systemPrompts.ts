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

export const STORY_OPENING_INSTRUCTION = `Begin a brand-new story based on the user's prompt. Set the scene with rich detail, introduce at least one character, call generate_image for a cover illustration, call text_to_speech to narrate the opening, then upsert_character and update_story_summary so the world persists. End your turn with an invitation for the player to make their first choice.`;

export const TURN_CONTINUATION_INSTRUCTION = `Advance the story in response to the player's choice. Honor their agency, narrate vividly, illustrate the new beat (edit_image if appropriate, otherwise generate_image), speak the narration aloud (text_to_speech), and keep the synopsis and character sheets fresh. End your turn with an opening for the player's next move.`;
