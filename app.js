import { ExportError, loadExport } from './export.js';
import { deleteLists, loadHidden, loadLists, saveHidden, saveLists } from './storage.js';

const PAGE_SIZE = 50;
const DELETED_PREFIX = '__deleted__';  // How Instagram's export names deleted accounts.
const EXPORT_URL = 'https://accountscenter.instagram.com/info_and_permissions/';
const webApp = window.Telegram?.WebApp;
const app = document.getElementById('app');

let lists = null;
let hidden = new Set();
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
  const autoHidden = notBack.filter(isDeleted).length;
  const hiddenNote = autoHidden ? `${autoHidden} deleted ${autoHidden === 1 ? 'account is' : 'accounts are'} hidden. ` : '';
  return [
    { icon: '🤝', label: 'Mutuals', title: 'You follow each other', names: lists.followers.filter((n) => following.has(n) && !isDeleted(n)) },
    {
      icon: '🚫',
      label: "Don't follow me back",
      title: "You follow them, they don't follow you back",
      note: `${hiddenNote}Deleted or deactivated accounts can still appear here. Tap a name to check, and tap ✕ if the account is gone.`,
      canHide: true,
      names: notBack.filter((n) => !isDeleted(n) && !hidden.has(n)),
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

const GUIDE = [
  ['1. Request your data from Instagram', [
    'Tap the button at the bottom of this page, and log in to Instagram if asked.',
    'Choose Export your information, then Create export, then your account, then Export to device. The wording may differ slightly.',
  ]],
  ['2. Use these settings', [
    'Customise information: tap Clear all, then tick only Followers and following. Ticking everything makes a huge file.',
    'Date range: choose All time. Otherwise, older followers go missing and your lists will be wrong.',
    'Format and Media quality: leave them as they are.',
  ]],
  ['3. Wait for the email', [
    'Tap Start export. Instagram emails you when the file is ready, often within minutes or hours, but it can take longer. Check your spam folder too.',
    'Download the zip from the link Instagram gives you, and keep it on the device you use Telegram on. It may be in Files or Downloads.',
  ]],
  ['4. Choose the zip here', [
    "Come back here, tap Choose export zip, and select the file. You don't need to unzip it.",
    'Check that the Followers and Following totals match your Instagram profile.',
  ]],
  ['Reading your lists', [
    'Mutuals: you follow each other.',
    "Don't follow me back: you follow them, but they don't follow you.",
    "I don't follow back: they follow you, but you don't follow them.",
    "Tap a name to open the profile. If an account in Don't follow me back is gone, tap ✕ to hide it.",
  ]],
  ['Good to know', [
    'The lists show the date of your export, not live numbers. Export again whenever you want to refresh them.',
    "Your zip stays on your device. Your lists are saved to your own Telegram account, and the bot's owner can't see them. Erase my lists removes them.",
  ]],
];

function showGuide() {
  show(
    button('‹ Back', () => (lists ? showMenu() : showUpload()), 'back'),
    element('h1', { textContent: 'How to use this' }),
    ...GUIDE.flatMap(([title, lines]) => [
      element('div', { className: 'section-label', textContent: title }),
      element('ul', { className: 'card guide' }, ...lines.map((textContent) => element('li', { textContent }))),
    ]),
    exportButton('Open Instagram export page', 'primary guide-action'),
  );
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
    button('First time? Read the guide', showGuide, 'quiet'),
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
    element('div', { className: 'section-label', textContent: 'Help and privacy' }),
    element('div', { className: 'card' },
      button('How to use this', showGuide, 'row'),
      button('Erase my lists', eraseLists, 'row danger')),
  );
}

function avatarColor(name) {
  let total = 0;
  for (const character of name) total += character.charCodeAt(0);
  return total % 7;
}

function profileLink(name, action) {
  const url = `https://www.instagram.com/${name}/`;
  return element('li', { className: 'person' }, element('a', {
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
  element('span', { className: 'chevron', textContent: '›' })), ...(action ? [action] : []));
}

async function setHidden(name, hide, redraw) {
  if (hide) hidden.add(name);
  else hidden.delete(name);
  redraw();
  if (!await saveHidden([...hidden])) {
    notice = "Couldn't save your hidden accounts to Telegram, so they may come back on another device.";
    redraw();
    notice = '';
  }
}

function showHidden() {
  const names = [...hidden].sort();
  const restore = (name) => {
    const action = button('Restore', () => setHidden(name, false, showHidden), 'person-action');
    return profileLink(name, action);
  };
  show(
    button('‹ Back', () => showList(1, 0), 'back'),
    element('h1', { textContent: 'Hidden accounts' }),
    element('p', { className: 'hint', textContent: "You hid these from Don't follow me back." }),
    ...errorNotice(),
    names.length ? element('ul', { className: 'card' }, ...names.map(restore)) : element('p', { className: 'hint', textContent: 'Nobody here.' }),
  );
}

function showList(index, number) {
  const group = groups()[index];
  const pages = Math.max(1, Math.ceil(group.names.length / PAGE_SIZE));
  number = Math.min(number, pages - 1);
  const names = group.names.slice(number * PAGE_SIZE, (number + 1) * PAGE_SIZE);
  const row = (name) => {
    if (!group.canHide) return profileLink(name);
    const hide = button('✕', () => setHidden(name, true, () => showList(index, number)), 'person-action hide');
    hide.setAttribute('aria-label', `Hide ${name}`);
    return profileLink(name, hide);
  };
  const nav = [];
  if (number > 0) nav.push(button('◀️ Previous', () => showList(index, number - 1), 'quiet'));
  if (number < pages - 1) nav.push(button('Next ▶️', () => showList(index, number + 1), 'quiet'));
  show(
    button('‹ Menu', showMenu, 'back'),
    element('h1', { textContent: group.label }),
    element('p', { className: 'hint', textContent: `${group.title}. ${group.names.length} ${group.names.length === 1 ? 'account' : 'accounts'}, page ${number + 1} of ${pages}.` }),
    ...(group.note ? [element('p', { className: 'hint', textContent: group.note })] : []),
    ...errorNotice(),
    names.length ? element('ul', { className: 'card' }, ...names.map(row)) : element('p', { className: 'hint', textContent: 'Nobody here.' }),
    ...(nav.length ? [element('div', { className: 'nav' }, ...nav)] : []),
    ...(group.canHide && hidden.size ? [button(`Show hidden (${hidden.size})`, showHidden, 'quiet show-hidden')] : []),
  );
}

async function eraseLists() {
  notice = '';
  try {
    await deleteLists();
    lists = null;
    hidden = new Set();
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
  hidden = new Set(await loadHidden());
  if (lists) showMenu();
  else showUpload();
})();
