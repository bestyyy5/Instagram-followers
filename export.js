import { readZip } from './zip.js';

const FOLLOWERS_FILE = /(^|\/)followers(_\d+)?\.(json|html)$/;
const FOLLOWING_FILE = /(^|\/)following(_\d+)?\.(json|html)$/;
const PROFILE_URL = /^https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)\/?(?:\?.*)?$/;
const USERNAME = /^[a-z0-9._]{1,30}$/;
const MAX_CONTENT = 50 * 1024 * 1024;  // Stops a tiny zip from expanding to fill memory.

// The failure has a message that's safe to show the user.
export class ExportError extends Error {}

function usernameFromUrl(url) {
  const match = PROFILE_URL.exec(url ?? '');
  return match ? match[1] : null;
}

function usernamesFromJson(text) {
  let data = JSON.parse(text);
  // followers files are a bare list; following files wrap it in an object.
  if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray) ?? [];

  return data.map((entry) => {
    const details = entry.string_list_data?.[0] ?? {};
    return details.value || entry.title || usernameFromUrl(details.href);
  });
}

function usernamesFromHtml(text) {
  const links = text.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi);
  return Array.from(links, (link) => usernameFromUrl(link[1]));
}

function addUsernames(names, file) {
  const text = file.text();
  const found = file.name.endsWith('.json') ? usernamesFromJson(text) : usernamesFromHtml(text);
  let valid = 0;
  for (const name of found) {
    const lower = typeof name === 'string' ? name.toLowerCase() : '';
    // Anyone can send a file, so drop anything that isn't a real username.
    if (USERNAME.test(lower)) {
      names.add(lower);
      valid++;
    }
  }
  // Entries with no usernames mean an unknown format, not an empty list.
  if (found.length && !valid) throw new ExportError("I couldn't read that. The usernames in it aren't in a format I recognize.");
}

export function loadExport(bytes) {
  const files = readZip(bytes, (name) => FOLLOWERS_FILE.test(name) || FOLLOWING_FILE.test(name));
  if (files.reduce((total, file) => total + file.size, 0) > MAX_CONTENT) {
    throw new ExportError('The follower files in that zip are too large.');
  }

  const followerFiles = files.filter((file) => FOLLOWERS_FILE.test(file.name));
  const followingFiles = files.filter((file) => FOLLOWING_FILE.test(file.name));
  if (!followerFiles.length || !followingFiles.length) {
    const missing = followerFiles.length ? 'following' : 'followers';
    throw new ExportError(`Could not find the ${missing} file in that zip. Did the export include Followers and following?`);
  }

  const followers = new Set();
  const following = new Set();
  followerFiles.forEach((file) => addUsernames(followers, file));
  followingFiles.forEach((file) => addUsernames(following, file));
  return { followers: [...followers].sort(), following: [...following].sort() };
}
