// Decode directly into the final buffer. Avoid Array.from's temporary number
// array, and let input/cancellation run while processing larger media files.
function yieldToInput() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  // Chained timers are throttled in hidden editor tabs. Message tasks still
  // yield to input without adding a timer delay for every decoded megabyte.
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
export async function decodeBase64(encoded, active = () => true) {
  if (!active()) return;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((encoded.length / 4) * 3 - padding);
  let offset = 0,
    sinceYield = 0;
  for (let start = 0; start < encoded.length; start += 65536) {
    if (!active()) return;
    const part = atob(encoded.slice(start, start + 65536));
    for (let i = 0; i < part.length; i++) bytes[offset++] = part.charCodeAt(i);
    sinceYield += part.length;
    if (sinceYield >= 1048576) {
      sinceYield = 0;
      await yieldToInput();
    }
  }
  return active() ? bytes : undefined;
}
