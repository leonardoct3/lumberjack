const URL_GLOBAL = /https?:\/\/\S+/gi;

/**
 * One blast, several festas. Promoters announce a whole season in a single
 * message, and each festa comes as a block that ends in its own buy link:
 *
 *   🌊 *RÉVEILLON AREIA BÚZIOS* 🌊 _27.12 a 02.01_ … https://tinyurl.com/Areia2027
 *   🐚 *A VILLA RÉVEILLON BÚZIOS* 🐚 _29 a 31/12_ … https://tinyurl.com/AVilla2027
 *
 * The link is what closes a block, so cutting right after each one keeps a name
 * and a date with the link they belong to. Reading only the first bold segment
 * used to catalogue festa one and drop the rest in silence — and the asks for
 * those festas then piled up as orphans nobody could link to anything.
 *
 * A single link is a single festa, whatever else the text says.
 */
export function splitAdBlocks(text: string): string[] {
  const urls = [...text.matchAll(URL_GLOBAL)];
  if (urls.length < 2) return [text];

  const blocks: string[] = [];
  let start = 0;
  for (const match of urls) {
    const end = (match.index ?? 0) + match[0].length;
    blocks.push(text.slice(start, end));
    start = end;
  }

  // What comes after the last link is a sign-off or a coupon note, never a
  // festa of its own: it rides along instead of becoming an empty block.
  const tail = text.slice(start);
  if (tail.trim().length > 0) {
    blocks[blocks.length - 1] = `${blocks[blocks.length - 1]}${tail}`;
  }

  return blocks.map((block) => block.trim()).filter((block) => block.length > 0);
}
