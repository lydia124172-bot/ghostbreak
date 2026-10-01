const SCRIPT_TO_TALK_KEY = 'mooseScriptToTalk';

function redirectTalkToScriptIfHandoff() {
  try {
    const data = JSON.parse(sessionStorage.getItem(SCRIPT_TO_TALK_KEY) || '');
    if (data && data.narration) {
      location.replace('/script#talk');
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

if (!redirectTalkToScriptIfHandoff()) {
  mooseBindTalkUi();
  const narration = document.getElementById('narration');
  if (narration && location.hash === '#talk') {
    narration.focus();
  }
}
