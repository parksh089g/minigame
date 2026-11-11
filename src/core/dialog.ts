/**
 * 게임 캔버스 밖(DOM)에 띄우는 작은 창: 글자를 입력받는 창과 코드를 보여 주는 창.
 * 캔버스 안에서는 한글 입력기와 휴대폰 자판이 동작하지 않아서, 글자를 받을 때만 이 창을 쓴다.
 * 창이 떠 있는 동안에는 뒤의 게임 화면이 눌리지 않는다. 뒤로 가기나 Esc, 바깥을 누르면 닫힌다.
 */

export type PromptAnswer =
  | { action: 'confirm'; value: string }
  /** 아래에 따로 둔 버튼(extra)을 눌렀다 */
  | { action: 'extra' }
  | { action: 'cancel' };

export interface PromptOptions {
  title: string;
  /** 제목 아래의 설명 */
  hint?: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel?: string;
  /** 영문 대문자와 숫자로 된 코드를 받는 칸이면 true. 자동 고침을 끄고 글자를 넓게 띄운다. */
  code?: boolean;
  /** 입력값을 확인하고 다듬는다. 쓸 수 없으면 보여 줄 문구를 error로 돌려준다. */
  check?: (value: string) => { value: string } | { error: string };
  /** 아래에 따로 두는 버튼. 실수로 누르지 않게 두 번 눌러야 동작한다. */
  extra?: { label: string; confirmLabel: string };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className = ''): HTMLButtonElement {
  const node = element('button', `dialog-button ${className}`.trim(), label);
  node.type = 'button';
  return node;
}

/**
 * 창을 띄우고, 닫힐 때까지 기다린다. build는 창 안을 채우고, 결과를 정해 닫는 함수(finish)를 받는다.
 * 뒤로 가기나 바깥을 눌러 닫히면 fallback이 결과가 된다.
 */
function open<T>(
  fallback: T,
  build: (card: HTMLFormElement, finish: (result: T) => void) => HTMLElement | null,
): Promise<T> {
  return new Promise((resolve) => {
    const dialog = element('dialog', 'dialog');
    const card = element('form', 'dialog-card');
    card.noValidate = true;
    dialog.appendChild(card);

    let result = fallback;
    const finish = (value: T): void => {
      result = value;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else done();
    };
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      dialog.remove();
      resolve(result);
    };
    dialog.addEventListener('close', done);
    // 카드 바깥(어두운 부분)을 누르면 닫는다.
    dialog.addEventListener('pointerdown', (event) => {
      if (event.target === dialog) finish(fallback);
    });

    const focus = build(card, finish);
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    focus?.focus();
  });
}

/** 글자 한 줄을 입력받는다. */
export function promptText(options: PromptOptions): Promise<PromptAnswer> {
  return open<PromptAnswer>({ action: 'cancel' }, (card, finish) => {
    card.appendChild(element('h2', 'dialog-title', options.title));
    if (options.hint) card.appendChild(element('p', 'dialog-hint', options.hint));

    const input = element('input', `dialog-input${options.code ? ' dialog-input-code' : ''}`);
    input.type = 'text';
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', options.code ? 'characters' : 'off');
    input.enterKeyHint = 'done';
    if (options.maxLength) input.maxLength = options.maxLength;
    input.setAttribute('aria-label', options.title);
    card.appendChild(input);

    const error = element('p', 'dialog-error');
    error.setAttribute('role', 'alert');
    card.appendChild(error);
    input.addEventListener('input', () => {
      error.textContent = '';
    });

    const row = element('div', 'dialog-buttons');
    const cancel = button('취소');
    cancel.addEventListener('click', () => finish({ action: 'cancel' }));
    const confirm = button(options.confirmLabel ?? '확인', 'dialog-primary');
    confirm.type = 'submit';
    row.append(cancel, confirm);
    card.appendChild(row);

    card.addEventListener('submit', (event) => {
      event.preventDefault();
      const checked = options.check ? options.check(input.value) : { value: input.value };
      if ('error' in checked) {
        error.textContent = checked.error;
        input.focus();
        return;
      }
      finish({ action: 'confirm', value: checked.value });
    });

    if (options.extra) {
      const { label, confirmLabel } = options.extra;
      const extra = element('button', 'dialog-link', label);
      extra.type = 'button';
      let armed = false;
      extra.addEventListener('click', () => {
        if (armed) return finish({ action: 'extra' });
        armed = true;
        extra.textContent = confirmLabel;
        extra.classList.add('dialog-link-armed');
      });
      card.appendChild(extra);
    }
    return input;
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 코드를 크게 보여 준다. 복사 버튼이 있고, 닫을 때까지 기다린다. */
export function showCode(options: { title: string; code: string; hint?: string }): Promise<void> {
  return open<void>(undefined, (card, finish) => {
    card.appendChild(element('h2', 'dialog-title', options.title));
    const code = element('output', 'dialog-code', options.code);
    card.appendChild(code);
    if (options.hint) card.appendChild(element('p', 'dialog-hint', options.hint));

    const row = element('div', 'dialog-buttons');
    const copy = button('복사');
    copy.addEventListener('click', () => {
      void copyText(options.code).then((copied) => {
        copy.textContent = copied ? '복사했어요' : '복사하지 못했어요';
      });
    });
    const close = button('닫기', 'dialog-primary');
    close.addEventListener('click', () => finish());
    row.append(copy, close);
    card.appendChild(row);
    return close;
  });
}
