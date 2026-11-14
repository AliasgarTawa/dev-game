const MESSAGES = {
  garage: 'The Garage opens soon: bikes, paint jobs and upgrades.',
  leaderboard: 'Leaderboards unlock once the first track is live.',
  race: 'Race track loads here next. Hang tight, rider.',
};

export function initMenu({ onStart, onInteract, onHover, onReturn, onSettings }) {
  const menu = document.querySelector('.menu');
  const toast = document.querySelector('.toast');
  const buttons = [...menu.querySelectorAll('[data-action]')];
  let toastTimer;
  let racing = false;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function start() {
    if (racing) return;
    onInteract('start');
    racing = true;
    document.body.classList.add('is-racing');
    menu.inert = true;
    onStart();
    setTimeout(() => showToast(MESSAGES.race), 1600);
    setTimeout(() => {
      racing = false;
      document.body.classList.remove('is-racing');
      menu.inert = false;
      buttons[0].focus({ preventScroll: true });
      onReturn();
    }, 4400);
  }

  for (const button of buttons) {
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') onHover();
    });
    button.addEventListener('focus', onHover);
    button.addEventListener('click', () => {
      const { action } = button.dataset;
      if (action === 'start') start();
      else {
        onInteract(action);
        if (action === 'settings') onSettings();
        else showToast(MESSAGES[action]);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (racing) return;
    // Let controls outside the menu (including Music) handle their own keys.
    if (document.activeElement !== document.body && !menu.contains(document.activeElement)) return;
    const index = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      buttons[index < 0 ? 0 : (index + step + buttons.length) % buttons.length].focus();
    } else if (e.key === 'Enter' && index < 0) {
      e.preventDefault();
      start();
    }
  });

  buttons[0].focus({ preventScroll: true });
}
