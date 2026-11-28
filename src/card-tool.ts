/**
 * Model-facing card creation for Director Mode.
 *
 * Registered by the host entry behind a per-step condition, so it is absent
 * from every other mode. It exists so the main agent can follow the rule "no
 * existing card, create one first, then delegate".
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

import type { CardService } from './card-store.js';
import { CARD_ID_PATTERN, cardIdFromName, type CharacterCard } from './card-types.js';
import { DIRECTOR_CARD_ID } from './director.js';

/** Model-facing tool name. */
export const CARD_CREATE_TOOL_NAME = 'subagent_card_create';

/** Parameters accepted by {@link createCardCreateTool}. */
export interface CardCreateArgs {
  name: string;
  delegation_guidance: string;
  avoid_guidance?: string;
  system_prompt: string;
  agent_preset?: string;
}

/**
 * Create the Director card creation tool.
 * @param options.cards - host card library shared with the delegation tool.
 * @param options.toolName - configured model-facing delegation tool name.
 * @param options.workerPreset - default worker preset for new cards.
 */
export function createCardCreateTool(options: {
  cards: CardService;
  toolName?: string;
  workerPreset?: string;
}) {
  const { cards } = options;
  const toolName = options.toolName ?? 'subagent_role';
  const workerPreset = options.workerPreset ?? 'standard';
  return defineTool({
    name: CARD_CREATE_TOOL_NAME,
    description:
      'Create a character card in the Director card library. Search first with subagent_card_search and read candidates with subagent_card_get: reuse an existing card when it fits, and create a card here only when nothing matches. Director Mode requires every subagent to be invoked through a character card; after creation, call ' +
      toolName +
      ' with the returned card id. Write a complete fixed role prompt for the child and state both when the card is recommended and when it is not.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Display name for the new card, for example "Security reviewer".',
      },
      delegation_guidance: {
        type: 'string',
        required: true,
        description: 'When the main agent should delegate to this card; shown in the card guidance.',
      },
      avoid_guidance: {
        type: 'string',
        description: 'When the main agent should NOT delegate to this card; shown in the card guidance.',
      },
      system_prompt: {
        type: 'string',
        required: true,
        description: 'The fixed role prompt injected into every child started with this card. Make it self-contained.',
      },
      agent_preset: {
        type: 'string',
        description: 'Worker Agent Preset for the child. Defaults to ' + workerPreset + '; use ptc for code-heavy work.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cardId: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            'Created character card "' +
            value.name +
            '" [' +
            value.cardId +
            ']. Delegate with ' +
            toolName +
            '({ role: "' +
            value.cardId +
            '", prompt: "..." }).',
        },
      ],
    },
    async execute(args: CardCreateArgs) {
      await cards.ready();
      const state = cards.status();
      if (state.state !== 'ready') {
        throw new Error(
          'subagent-director: character card storage is ' + state.state + '; cannot create a card until it is available',
        );
      }
      const existing = new Set(cards.list().map((card: CharacterCard) => card.id));
      existing.add(DIRECTOR_CARD_ID);
      const name = args.name.trim();
      const id = cardIdFromName(name, existing);
      if (!CARD_ID_PATTERN.test(id)) {
        throw new Error('subagent-director: could not derive a valid card id from name "' + name + '"');
      }
      const agentPreset = args.agent_preset?.trim();
      const created = await cards.put(
        {
          id,
          name,
          delegationGuidance: args.delegation_guidance,
          ...(args.avoid_guidance !== undefined && args.avoid_guidance.trim().length > 0
            ? { avoidGuidance: args.avoid_guidance }
            : {}),
          systemPrompt: args.system_prompt,
          ...(agentPreset !== undefined && agentPreset.length > 0 ? { agentPreset } : { agentPreset: workerPreset }),
          enabled: true,
          source: 'local' as const,
        },
        { create: true },
      );
      await cards.recordCardUse(created.id);
      return { cardId: created.id, name: created.name };
    },
  });
}
