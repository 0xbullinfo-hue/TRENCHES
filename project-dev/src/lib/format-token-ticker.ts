/**
 * Converts the legacy public ticker to the current display ticker.
 *
 * This is a presentation-only transformation.
 * It must never be used for token mint addresses,
 * contract verification, wallet calculations, or API identifiers.
 */
export function formatTokenTicker(value: string): string {
  return value.replace(/\$GENESIS\b/g, '$H42');
}

