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
    { icon: '🤝', label: 'Mutuals', title: 'You follow each other', names: lists.followers.filter((n) => following.has(n) && !isDeleted(n)) },
    {
      icon: '🚫',
      label: "Don't follow me back",
      title: "You follow them, they don't follow you back",
      note: `${hiddenNote}Other deactivated accounts can still appear here. Tap a name to check before unfollowing.`,
      names: notBack.filter((n) => !isDeleted(n)),
    },
    { icon: '👀', label: "I don't follow back", title: 'They follow you, you never followed back', names: lists.followers.filter((n) => !following.has(n) && !isDeleted(n)) },
  ];
}

function openExternal(url) {
  if (webApp?.initData) webApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

function exportButton(label, className) {
  return button(label, () => openExternal(EXPORT_URL), className);
}

function menuRow(icon, label, onclick, { count, className = '' } = {}) {
  const node = button('', onclick, `row ${className}`);
  node.append(
    element('span', { className: 'icon', textContent: icon }),
    element('span', { className: 'label', textContent: label }),
    ...(count === undefined ? [] : [element('span', { className: 'count', textContent: count })]),
    element('span', { className: 'chevron', textContent: '›' }),
  );
  return node;
}

function filePicker(label, className) {
  const input = element('input', { type: 'file', accept: '.zip,application/zip' });
  input.onchange = () => {
    if (input.files[0]) readFile(input.files[0]);
  };
  return element('label', { className, textContent: label }, input);
}

function errorNotice() {
  return notice ? [element('p', { className: 'error', textContent: notice })] : [];
}

function showUpload() {
  const step = (textContent) => element('li', { className: 'step', textContent });
  show(
    element('h1', { textContent: 'See who follows you back' }),
    element('p', { className: 'hint', textContent: 'Uses the data export Instagram gives you. No Instagram login here.' }),
    ...errorNotice(),
    element('ol', { className: 'card steps' },
      step('Open the export page, then choose Export your information and Export to device.'),
      step('Under Customise information, tick only Followers and following. Set Date range to All time.'),
      step('Start the export. When Instagram emails you, download the zip and choose it here.')),
    exportButton('Open Instagram export page', 'primary'),
    filePicker('Choose export zip', 'quiet'),
    element('p', { className: 'hint', textContent: "Your zip is read on this device and never uploaded. Your lists are saved to your own Telegram account, and the bot's owner can't see them." }),
  );
}

function stat(value, label) {
  return element('div', { className: 'stat' },
    element('strong', { textContent: value }),
    element('span', { textContent: label }));
}

function showMenu() {
  show(
    element('div', { className: 'stats' }, stat(lists.followers.length, 'Followers'), stat(lists.following.length, 'Following')),
    element('p', { className: 'hint', textContent: `From your ${lists.updated} export. These totals should match your Instagram profile. If followers look too low, the export probably wasn't set to All time, so export again.` }),
    ...errorNotice(),
    element('div', { className: 'card' },
      ...groups().map((group, i) => menuRow(group.icon, group.label, () => showList(i, 0), { count: group.names.length }))),
    element('div', { className: 'section-label', textContent: 'Update' }),
    exportButton('Request a newer export', 'quiet'),
    filePicker('Choose a newer export', 'quiet'),
    ...(syncs ? [] : [element('p', { className: 'hint', textContent: 'These lists are saved on this device only.' })]),
    element('div', { className: 'section-label', textContent: 'Privacy' }),
    element('div', { className: 'card' }, button('Erase my lists', eraseLists, 'row danger')),
  );
}

function avatarColor(name) {
  let total = 0;
  for (const character of name) total += character.charCodeAt(0);
  return total % 7;
}

function profileLink(name) {
  const url = `https://www.instagram.com/${name}/`;
  return element('li', {}, element('a', {
    className: 'row',
    href: url,
    target: '_blank',
    rel: 'noopener',
    onclick(event) {
      event.preventDefault();
      openExternal(url);
    },
  },
  element('span', { className: `avatar avatar-${avatarColor(name)}`, textContent: name.replace(/[._]/g, '')[0] ?? '?' }),
  element('span', { className: 'label', textContent: name }),
  element('span', { className: 'chevron', textContent: '›' })));
}

function showList(index, number) {
  const group = groups()[index];
  const pages = Math.max(1, Math.ceil(group.names.length / PAGE_SIZE));
  const names = group.names.slice(number * PAGE_SIZE, (number + 1) * PAGE_SIZE);
  const nav = [];
  if (number > 0) nav.push(button('◀️ Previous', () => showList(index, number - 1), 'quiet'));
  if (number < pages - 1) nav.push(button('Next ▶️', () => showList(index, number + 1), 'quiet'));
  show(
    button('‹ Menu', showMenu, 'back'),
    element('h1', { textContent: group.label }),
    element('p', { className: 'hint', textContent: `${group.title}. ${group.names.length} ${group.names.length === 1 ? 'account' : 'accounts'}, page ${number + 1} of ${pages}.` }),
    ...(group.note ? [element('p', { className: 'hint', textContent: group.note })] : []),
    names.length ? element('ul', { className: 'card' }, ...names.map(profileLink)) : element('p', { className: 'hint', textContent: 'Nobody here.' }),
    ...(nav.length ? [element('div', { className: 'nav' }, ...nav)] : []),
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
  show(element('p', { className: 'hint', textContent: 'Saving…' }));
  syncs = await saveLists(lists);
  showMenu();
}

async function readFile(file) {
  show(element('p', { className: 'hint', textContent: 'Reading your file…' }));
  await readExport(file);
}

export const ready = (async () => {
  webApp?.ready();
  webApp?.expand();
  show(element('p', { className: 'hint', textContent: 'Loading…' }));
  lists = await loadLists();
  if (lists) showMenu();
  else showUpload();
})();
