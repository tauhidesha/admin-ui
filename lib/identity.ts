const WHATSAPP_SUFFIX = '@c.us';

export type SenderIdentity = {
  docId: string;
  channel: string;
  platformId: string | null;
  normalizedAddress: string;
};

export function parseSenderIdentity(rawValue: string | null | undefined): SenderIdentity {
  const trimmed = (rawValue || '').trim();

  if (!trimmed) {
    return {
      docId: '',
      channel: 'unknown',
      platformId: null,
      normalizedAddress: '',
    };
  }

  const hasWhatsappSuffix = trimmed.endsWith(WHATSAPP_SUFFIX);
  const baseId = hasWhatsappSuffix ? trimmed.slice(0, -WHATSAPP_SUFFIX.length) : trimmed;

  let channel = 'whatsapp';
  let platformId: string | null = baseId;

  if (baseId.includes(':')) {
    const [channelPart, ...rest] = baseId.split(':');
    channel = channelPart || 'unknown';
    platformId = rest.length ? rest.join(':') : null;
  }

  const normalizedAddress = channel === 'whatsapp'
    ? `${baseId}${WHATSAPP_SUFFIX}`
    : baseId;

  return {
    docId: baseId,
    channel,
    platformId,
    normalizedAddress,
  };
}

export function normalizeSenderNumber(value: string) {
  return parseSenderIdentity(value).normalizedAddress || value;
}
