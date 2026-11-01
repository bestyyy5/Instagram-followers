// The runtime has no zip library and no packages, so this reads zips directly.

const MAX_CODE_BITS = 15;
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildCodes(lengths) {
  const counts = new Uint16Array(MAX_CODE_BITS + 1);
  for (const length of lengths) counts[length]++;
  counts[0] = 0;
  const offsets = new Uint16Array(MAX_CODE_BITS + 2);
  for (let i = 1; i <= MAX_CODE_BITS; i++) offsets[i + 1] = offsets[i] + counts[i];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((length, symbol) => {
    if (length) symbols[offsets[length]++] = symbol;
  });
  return { counts, symbols };
}

const FIXED_LITERALS = buildCodes(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)));
const FIXED_DISTANCES = buildCodes(new Array(30).fill(5));

// Writes at most output.length bytes, so a zip can't expand past its declared size.
function inflate(input, start, end, output) {
  let position = start;
  let bitBuffer = 0;
  let bitCount = 0;
  let written = 0;

  function bits(count) {
    while (bitCount < count) {
      if (position >= end) throw new Error('Truncated data');
      bitBuffer |= input[position++] << bitCount;
      bitCount += 8;
    }
    const value = bitBuffer & ((1 << count) - 1);
    bitBuffer >>>= count;
    bitCount -= count;
    return value;
  }

  function decode({ counts, symbols }) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= MAX_CODE_BITS; length++) {
      code |= bits(1);
      const count = counts[length];
      if (code - count < first) return symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Bad compressed data');
  }

  function dynamicCodes() {
    const literalCount = bits(5) + 257;
    const distanceCount = bits(5) + 1;
    const codeLengthCount = bits(4) + 4;
    const codeLengths = new Array(19).fill(0);
    for (let i = 0; i < codeLengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]] = bits(3);
    const lengthCodes = buildCodes(codeLengths);

    const lengths = new Array(literalCount + distanceCount).fill(0);
    for (let i = 0; i < lengths.length;) {
      const symbol = decode(lengthCodes);
      if (symbol < 16) {
        lengths[i++] = symbol;
        continue;
      }
      let previous = 0;
      let repeat;
      if (symbol === 16) {
        if (i === 0) throw new Error('Bad compressed data');
        previous = lengths[i - 1];
        repeat = 3 + bits(2);
      } else {
        repeat = symbol === 17 ? 3 + bits(3) : 11 + bits(7);
      }
      if (i + repeat > lengths.length) throw new Error('Bad compressed data');
      while (repeat--) lengths[i++] = previous;
    }
    return [buildCodes(lengths.slice(0, literalCount)), buildCodes(lengths.slice(literalCount))];
  }

  let final;
  do {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuffer = 0;
      bitCount = 0;
      if (position + 4 > end) throw new Error('Truncated data');
      const length = input[position] | (input[position + 1] << 8);
      position += 4;
      if (position + length > end || written + length > output.length) throw new Error('Bad compressed data');
      output.set(input.subarray(position, position + length), written);
      position += length;
      written += length;
    } else if (type === 3) {
      throw new Error('Bad compressed data');
    } else {
      const [literals, distances] = type === 1 ? [FIXED_LITERALS, FIXED_DISTANCES] : dynamicCodes();
      for (;;) {
        const symbol = decode(literals);
        if (symbol === 256) break;
        if (symbol < 256) {
          if (written >= output.length) throw new Error('Larger than declared');
          output[written++] = symbol;
          continue;
        }
        if (symbol > 285) throw new Error('Bad compressed data');
        const length = LENGTH_BASE[symbol - 257] + bits(LENGTH_EXTRA[symbol - 257]);
        const distanceSymbol = decode(distances);
        if (distanceSymbol > 29) throw new Error('Bad compressed data');
        const distance = DIST_BASE[distanceSymbol] + bits(DIST_EXTRA[distanceSymbol]);
        if (distance > written || written + length > output.length) throw new Error('Bad compressed data');
        for (let i = 0; i < length; i++, written++) output[written] = output[written - distance];
      }
    }
  } while (!final);

  if (written !== output.length) throw new Error('Smaller than declared');
}

function decodeText(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  // Fallback for runtimes without TextDecoder; multi-byte characters become
  // placeholders, which is fine because usernames are plain ASCII.
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    parts.push(String.fromCharCode.apply(null, Array.from(chunk, (b) => (b < 128 ? b : 63))));
  }
  return parts.join('');
}

// Returns the entries whose name passes `wanted`, as { name, size, text() }.
export function readZip(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let directoryEnd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      directoryEnd = i;
      break;
    }
  }
  if (directoryEnd < 0) throw new Error('Not a zip file');

  const entryCount = view.getUint16(directoryEnd + 10, true);
  let cursor = view.getUint32(directoryEnd + 16, true);
  const entries = [];
  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const headerOffset = view.getUint32(cursor + 42, true);
    const name = decodeText(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;

    entries.push({
      name,
      size,
      text() {
        if (headerOffset + 30 > bytes.length || view.getUint32(headerOffset, true) !== 0x04034b50) throw new Error('Bad zip entry');
        const start = headerOffset + 30 + view.getUint16(headerOffset + 26, true) + view.getUint16(headerOffset + 28, true);
        const end = start + compressedSize;
        if (end > bytes.length) throw new Error('Bad zip entry');
        if (method === 0) return decodeText(bytes.subarray(start, end));
        if (method !== 8) throw new Error('Unsupported compression');
        const output = new Uint8Array(size);
        inflate(bytes, start, end, output);
        return decodeText(output);
      },
    });
  }
  return entries;
}
