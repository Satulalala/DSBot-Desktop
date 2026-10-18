function specificOrLegacyToken(snowluma, specificKey) {
  const specific = snowluma?.[specificKey];
  if (typeof specific === 'string' && specific.length > 0) return specific;
  const legacy = snowluma?.accessToken;
  return typeof legacy === 'string' && legacy.length > 0 ? legacy : '';
}

export function snowLumaWsAccessToken(snowluma = {}) {
  return specificOrLegacyToken(snowluma, 'wsAccessToken') || undefined;
}

export function snowLumaHttpAuthHeaders(snowluma = {}) {
  const token = specificOrLegacyToken(snowluma, 'httpAccessToken');
  return token
    ? { authorization: `Bearer ${token}` }
    : {};
}
