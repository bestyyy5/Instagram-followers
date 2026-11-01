import { ExportError, loadExport } from './export.js';
import { deleteLists, loadLists, saveLists } from './storage.js';

const PAGE_SIZE = 50;
const DELETED_PREFIX = '__deleted__';  // How Instagram's export names deleted accounts.
const EXPORT_URL = 'https://accountscenter.instagram.com/info_and_permissions/';
const webApp = window.Telegram?.WebApp;
const app = document.getElementById('app');

let lists = null;
let syncs = true;
let notice = '';

function element(tag, properties = {}, ...children) {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
}

function button(text, onclick, className = '') {
  return element('button', { type: 'button', textContent: text, onclick, className });
}

function show(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function isDeleted(name) {
  return name.startsWith(DELETED_PREFIX);
}

function groups() {
  const followers = new Set(lists.followers);
  const following = new Set(lists.following);
  const notBack = lists.following.filter((n) => !followers.has(n));
  const hidden = notBack.filter(isDeleted).length;
  const hiddenNote = hidden ? `${hidden} deleted ${hidden === 1 ? 'account is' : 'accounts are'} hidden. ` : '';
  return [
    { label: '🤝 Mutuals', title: 'You follow each other', names: lists.followers.filter((n) => following.has(n) && !isDeleted(n)) },
    {
      label: "🚫 Don't follow me back",
      title: "You follow them, they don't follow you back",
      note: `${hiddenNote}Other deactivated accounts can still appear here. Tap a name to check before unfollowing.`,
      names: notBack.filter((n) => !isDeleted(n)),
    },
    { label: "👀 I don't follow back", title: 'They follow you, you never followed back', names: lists.followers.filter((n) => !following.has(n) && !isDeleted(n)) },
  ];
}

function openExternal(url) {
  if (webApp?.initData) webApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

function exportButton(label, className = '') {
  return button(label, () => openExternal(EXPORT_URL), className);
}

function filePicker(label) {
  const input = element('input', { type: 'file', accept: '.zip,application/zip' });
  input.onchange = () => {
    if (input.files[0]) readFile(input.files[0]);
  };
  return element('label', { className: 'file' }, label, input);
}

function showUpload() {
  const steps = element('ol', {},
    element('li', { textContent: 'Tap the button below, then choose Export your information and Export to device.' }),
    element('li', { textContent: 'Under Customise information, tick only Followers and following. Set Date range to All time.' }),
    element('li', { textContent: 'Start the export. When Instagram emails you, download the zip and choose it below.' }));
  show(
    element('h1', { textContent: 'Instagram followers' }),
    ...(notice ? [element('p', { className: 'error', textContent: notice })] : []),
    steps,
    exportButton('Open Instagram export page'),
    filePicker('Choose export zip'),
    element('p', { className: 'hint', textContent: 'Your zip is read on this device and never uploaded. Your lists are saved to your own Telegram account, and the bot\'s owner can\'t see them.' }),
  );
}

function showMenu() {
  show(
    element('h1', { textContent: 'Instagram followers' }),
    element('p', { className: 'hint', textContent: `Export from ${lists.updated}. Followers: ${lists.followers.length}  Following: ${lists.following.length}` }),
    ...(notice ? [element('p', { className: 'error', textContent: notice })] : []),
    element('p', { className: 'hint', textContent: "These totals should match your Instagram profile. If followers look too low, the export probably wasn't set to All time, so export again." }),
    ...groups().map((group, i) => button(`${group.label} (${group.names.length})`, () => showList(i, 0))),
    exportButton('Request a newer export', 'secondary'),
    filePicker('Choose a newer export'),
    button('Erase my lists', eraseLists, 'secondary'),
    ...(syncs ? [] : [element('p', { className: 'hint', textContent: 'These lists are saved on this device only.' })]),
  );
}

function profileLink(name) {
  const url = `https://www.instagram.com/${name}/`;
  return element('li', {}, element('a', {
    href: url,
    textContent: name,
    target: '_blank',
    rel: 'noopener',
    onclick(event) {
      event.preventDefault();
      openExternal(url);
    },
  }));
}

function showList(index, number) {
  const group = groups()[index];
  const pages = Math.max(1, Math.ceil(group.names.length / PAGE_SIZE));
  const names = group.names.slice(number * PAGE_SIZE, (number + 1) * PAGE_SIZE);
  const nav = [];
  if (number > 0) nav.push(button('◀️ Previous', () => showList(index, number - 1), 'secondary'));
  if (number < pages - 1) nav.push(button('Next ▶️', () => showList(index, number + 1), 'secondary'));
  show(
    element('h1', { textContent: `${group.title}: ${group.names.length}` }),
    element('p', { className: 'hint', textContent: `Page ${number + 1} of ${pages}` }),
    ...(group.note ? [element('p', { className: 'hint', textContent: group.note })] : []),
    names.length ? element('ul', {}, ...names.map(profileLink)) : element('p', { textContent: 'Nobody here.' }),
    ...(nav.length ? [element('div', { className: 'row' }, ...nav)] : []),
    button('⬅️ Menu', showMenu),
  );
}

async function eraseLists() {
  notice = '';
  try {
    await deleteLists();
    lists = null;
  } catch {
    notice = "Couldn't erase your lists. Check your connection and try again.";
    showMenu();
    return;
  }
  showUpload();
}

function refuse(message) {
  notice = message;
  if (lists) showMenu();
  else showUpload();
}

export async function readExport(source) {
  let found;
  try {
    found = await loadExport(source);
  } catch (e) {
    refuse(e instanceof ExportError ? e.message : "I couldn't read that. Please choose the Instagram export zip.");
    return;
  }
  lists = { ...found, updated: new Date().toISOString().slice(0, 10) };
  notice = '';
  show(element('p', { textContent: 'Saving…' }));
  syncs = await saveLists(lists);
  showMenu();
}

async function readFile(file) {
  show(element('p', { textContent: 'Reading your file…' }));
  await readExport(file);
}

export const ready = (async () => {
  webApp?.ready();
  webApp?.expand();
  show(element('p', { textContent: 'Loading…' }));
  lists = await loadLists();
  if (lists) showMenu();
  else showUpload();
})();
