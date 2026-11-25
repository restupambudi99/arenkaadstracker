export function composeReply(options: Record<string, unknown>): Promise<{text: string | null; guarded?: boolean; problems?: string[]; error?: Error}>;
