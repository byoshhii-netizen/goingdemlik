(() => {
  function openDialog({ mode, title, message, value = '', multiline = false, readOnly = false, selectOnOpen = false, confirmText = 'Devam et', acceptText = 'Kaydet' }) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'cig-dialog-overlay';
    overlay.innerHTML = `
      <section class="cig-dialog" role="${mode === 'confirm' ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="cig-dialog-title" aria-describedby="cig-dialog-message">
        <button class="cig-dialog-close" type="button" aria-label="Kapat"><i class="fas fa-xmark"></i></button>
        <div class="cig-dialog-icon"><i class="fas ${mode === 'confirm' ? 'fa-circle-question' : 'fa-pen-to-square'}"></i></div>
        <h2 id="cig-dialog-title"></h2>
        <p id="cig-dialog-message"></p>
        ${mode === 'prompt' ? (multiline ? '<textarea class="cig-dialog-input" rows="5"></textarea>' : '<input class="cig-dialog-input" type="text" />') : ''}
        <div class="cig-dialog-actions">
          <button class="cig-dialog-cancel" type="button">İptal</button>
          <button class="cig-dialog-accept" type="button"></button>
        </div>
      </section>`;
    const dialog = overlay.querySelector('.cig-dialog');
    const input = overlay.querySelector('.cig-dialog-input');
    const cancelButton = overlay.querySelector('.cig-dialog-cancel');
    const acceptButton = overlay.querySelector('.cig-dialog-accept');
    overlay.querySelector('#cig-dialog-title').textContent = title;
    overlay.querySelector('#cig-dialog-message').textContent = message;
    acceptButton.textContent = mode === 'confirm' ? confirmText : acceptText;
    acceptButton.classList.toggle('is-danger', mode === 'confirm');
    if (input) {
      input.value = value;
      input.readOnly = readOnly;
    }

    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        window.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        document.body.classList.remove('cig-dialog-open');
        previousFocus?.focus?.();
        resolve(result);
      };
      const onKeyDown = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(mode === 'confirm' ? false : null);
        } else if (event.key === 'Enter' && (!input || input.tagName !== 'TEXTAREA' || event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          acceptButton.click();
        } else if (event.key === 'Tab') {
          const focusable = [...dialog.querySelectorAll('button, input, textarea')].filter(element => !element.disabled);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };
      cancelButton.addEventListener('click', () => finish(mode === 'confirm' ? false : null));
      overlay.querySelector('.cig-dialog-close').addEventListener('click', () => finish(mode === 'confirm' ? false : null));
      acceptButton.addEventListener('click', () => finish(mode === 'confirm' ? true : input.value));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(mode === 'confirm' ? false : null);
      });
      window.addEventListener('keydown', onKeyDown, true);
      document.body.append(overlay);
      document.body.classList.add('cig-dialog-open');
      requestAnimationFrame(() => {
        (input || acceptButton).focus();
        if (input && selectOnOpen) input.select();
      });
    });
  }

  window.CigCigDialogs = Object.freeze({
    confirm(message, options = {}) {
      return openDialog({ mode: 'confirm', title: options.title || 'İşlemi onayla', message, confirmText: options.confirmText || 'Evet, devam et' });
    },
    prompt(message, value = '', options = {}) {
      return openDialog({
        mode: 'prompt',
        title: options.title || 'Düzenle',
        message,
        value,
        multiline: options.multiline === true,
        readOnly: options.readOnly === true,
        selectOnOpen: options.selectOnOpen === true,
        acceptText: options.acceptText || 'Kaydet',
      });
    },
  });
})();
