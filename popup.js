let activeTab, busy = true;
const $ = id => document.getElementById(id);
async function send(type, values = {}) { const result = await chrome.runtime.sendMessage({ type, ...values }); if (!result?.ok) throw Error(result?.error || 'Extension unavailable.'); return result; }
function display(state) { $('show').disabled = busy || state.visible; $('hide').disabled = busy || !state.visible; $('status').textContent = state.visible ? 'Reader enabled for this site.' : 'Reader hidden for this site.'; }
async function update(visible, permission) {
  if (busy) return; busy = true; $('show').disabled = $('hide').disabled = true;
  try { if (permission && !await permission) throw Error('Site access was declined.'); const state = await send('SITE_ENABLE', { url: activeTab.url, tabId: activeTab.id, visible }); busy = false; display(state); }
  catch (e) { busy = false; $('status').textContent = e.message; $('show').disabled = false; $('hide').disabled = false; }
}
$('show').onclick = () => { if (!busy) update(true, chrome.permissions.request({ origins: [WNT.permissionPattern(activeTab.url)] })); };
$('hide').onclick = () => update(false);
$('options').onclick = () => chrome.runtime.openOptionsPage();
$('jobs').onclick = () => send('RUNNER_OPEN').catch(e => { $('status').textContent = e.message; });
(async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url || !/^https?:/.test(activeTab.url)) throw Error('Open a regular HTTP(S) novel webpage to enable the reader.');
  const state = await send('SITE_STATE', { url: activeTab.url }); busy = false; display(state);
})().catch(e => { $('status').textContent = e.message; });

let selectedEngine = '', switchingEngine = false;
async function loadEngines() {
  const result = await send('PROFILE_LIST');
  selectedEngine = result.activeProfileId;
  $('engine').replaceChildren(...result.profiles.map(p => new Option(p.name + ' · ' + p.model, p.id)));
  $('engine').value = selectedEngine; $('engine').disabled = false;
}
$('engine').onchange = async () => {
  if (switchingEngine) return;
  const previous = selectedEngine, id = $('engine').value;
  switchingEngine = true; $('engine').disabled = true;
  try {
    const result = await send('PROFILE_SELECT', { id }); selectedEngine = result.activeProfileId;
    $('engineStatus').textContent = 'Selected for new translations. Existing jobs keep their engine.';
  } catch (error) { $('engine').value = previous; $('engineStatus').textContent = error.message; }
  finally { switchingEngine = false; $('engine').disabled = false; }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.activeProfileId || changes.engineProfiles) && !switchingEngine) loadEngines().catch(e => { $('engineStatus').textContent = e.message; });
});
loadEngines().catch(e => { $('engineStatus').textContent = e.message; });
