'use client';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import { SearchSchema } from '../contracts/schemas';
import { useApp } from './app-context';
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};
type ModelContext = {
  registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void>;
};
export function WebMCPBridge() {
  const app = useApp(),
    latest = useRef(app);
  latest.current = app;
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const c = new AbortController();
    const tools: Tool[] = [
      {
        name: 'search_rooms',
        description:
          'Read public rooms matching a query and filters. Does not change the visible comparison selection.',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 100 } },
          required: ['query'],
          additionalProperties: false,
        },
        async execute(input) {
          const { query } = z
            .object({ query: z.string().max(100) })
            .strict()
            .parse(input);
          const a = latest.current;
          const result = await a.api.list(
            SearchSchema.parse({
              query,
              sort: 'match',
              filters: a.filters,
              bounds: null,
              onlyMatches: false,
            }),
          );
          return {
            rooms: result.items.map((r) => ({
              id: r.id,
              title: r.title,
              rent: r.rent,
              maintenance: r.maintenance,
              sample: r.source.kind === 'sample',
            })),
            total: result.total,
          };
        },
      },
      {
        name: 'set_comparison',
        description:
          'Stage zero to two existing rooms in the visible comparison bar. This does not request AI or open the comparison page.',
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        inputSchema: {
          type: 'object',
          properties: {
            roomIds: { type: 'array', items: { type: 'string' }, maxItems: 2, uniqueItems: true },
          },
          required: ['roomIds'],
          additionalProperties: false,
        },
        async execute(input) {
          const { roomIds } = z
            .object({
              roomIds: z
                .array(z.string().min(1))
                .max(2)
                .refine((ids) => new Set(ids).size === ids.length),
            })
            .strict()
            .parse(input);
          await Promise.all(roomIds.map((id) => latest.current.api.get(id)));
          flushSync(() => latest.current.setSelected(roomIds));
          return { selected: latest.current.selected };
        },
      },
      {
        name: 'get_comparison',
        description: 'Read the current visible comparison selection.',
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute(input) {
          z.object({}).strict().parse(input);
          return { selected: latest.current.selected };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: c.signal })).catch(
          () => undefined,
        );
      } catch {
        /* Optional browser capability. */
      }
    }
    return () => c.abort();
  }, []);
  return null;
}
