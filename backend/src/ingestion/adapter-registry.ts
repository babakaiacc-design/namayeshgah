import { EventroSource } from './adapters/eventro.source';
import { ExhibitionSource } from './adapters/exhibition-source';

/**
 * The single place that maps a source row to the code that reads it.
 *
 * Shared by the CLI and the scheduled sync so the two cannot drift into
 * disagreeing about which adapter serves which source.
 */
export const ADAPTERS: Record<string, () => ExhibitionSource> = {
  eventro: () => new EventroSource(),
};

/** Locations to pull per source, using each source's own slugs. */
export const DEFAULT_LOCATIONS: Record<string, string[]> = {
  eventro: ['tehran'],
};

export function buildAdapter(sourceName: string): ExhibitionSource | undefined {
  return ADAPTERS[sourceName]?.();
}

export function knownSources(): string[] {
  return Object.keys(ADAPTERS);
}
