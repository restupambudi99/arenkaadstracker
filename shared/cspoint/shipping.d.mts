export type Tariff = { entries: unknown[]; [key: string]: unknown };
export function parseTariffText(text: string): Tariff;
export function resolveShipping(thread: Array<{text: string; outgoing?: boolean}>, docs: Tariff[]): Record<string, unknown>;
export function isTariffDocument(doc: Tariff): boolean;
