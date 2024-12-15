import { i18n, Colors } from '/modules/refs.js'
import { buildNode, buildActionIcon, buildMenuControl } from '/modules/dom.js'

/** Builder for modal dialogue.
 * Buttons with the value `esc` return undefined and `true` & `false` return as boolean rather than string.
 * @param {{
 * title?:string
 * message?:string
 * content?:HTMLElement[]
 * fields?:{type:string,name:string,label:string,value:string,id:string,options:string[]|{id:string,label:string,value:string}[],checked:boolean}[]
 * buttons?:{title:string,value:string,id:string}[]
 * }} options Model elements to include
 * @param {Function=} onChange Event handler for form updates
 */
function showModal({ title, message, content, fields, buttons }, onChange) {
  // console.log("Setting up container...");
  const form = buildNode('form', {
    method: 'dialog',
  })

  // console.log("Adding title...", title, !!title);
  if (title) form.append(buildNode('h1', { textContent: title }))

  // console.log("Adding message...", message, !!message);
  if (message) form.append(buildNode('p', { textContent: message }))

  // console.log("Adding custom content...", content, !!content);
  if (content) form.append(...content)

  // console.log("Adding fields...", fields, !!fields);
  if (fields) {
    const formFields = buildNode('div', {
      classList: ['fields'],
    })
    fields.forEach((field, i) => {
      // console.log(field);
      field.id ||= field.name
      if (i > 0) {
        formFields.append(buildNode('div', {
          classList: ['divider'],
        }))
      }

      if (field.type === 'radio') {
        formFields.append(buildNode('fieldset', {
          children: field.options.map((option, i) => buildMenuControl(
            field.type,
            field.name,
            option.value,
            option.label,
            i === 0,
            { id: option.id },
          )),
        }))
      } else if (field.type === 'checkbox') {
        formFields.append(buildNode('fieldset', {
          children: [buildMenuControl(
            field.type,
            field.name,
            field.value,
            field.label,
            i === 0,
          )],
        }))
      } else {
        const isSelect = (field.type === 'select')
        formFields.append(buildNode('div', {
          classList: ['field'],
          children: [
            buildNode('label', {
              for: field.id,
              textContent: field.label,
            }),
            buildNode(isSelect ? 'select' : 'input', {
              type: field.type,
              name: field.name,
              id: field.id,
              title: field.label,
              value: field.value,
              checked: field.checked,
              children: isSelect && field.options.map(option => buildNode('option', {
                value: option,
                textContent: option,
              })),
            }),
          ],
        }))
      }
    })
    form.append(formFields)
  }

  // console.log("Adding buttons...", buttons, !!buttons);
  if (buttons) {
    const formButtons = buildNode('div', {
      classList: ['buttons'],
    })
    for (const button of buttons) {
      formButtons.append(buildNode('button', {
        type: 'submit',
        value: button.value,
        id: button.id,
        children: [buildNode('h2', {
          textContent: button.title,
        })],
      }))
    }
    form.append(formButtons)
  }

  // console.log("Adding cancel button...");
  const cancelButton = buildActionIcon(i18n('cancel'), 'icon-close', Colors.RED)
  cancelButton.type = 'submit'
  cancelButton.value = 'esc'
  form.append(buildNode('div', {
    classList: ['x'],
    children: [cancelButton],
  }))

  /** @type {HTMLDialogElement} */
  const modal = buildNode('dialog', {
    children: [form],
  })
  document.body.append(modal)

  if (onChange) modal.addEventListener('change', onChange)

  return new Promise((resolve) => {
    modal.addEventListener('close', () => {
      switch (modal.returnValue) {
        case 'esc':
          resolve()
          break

        case 'true':
          resolve(true)
          break

        case 'false':
          resolve(false)
          break

        default:
          resolve(modal.returnValue)
          break
      }
      modal.remove()
    })

    modal.showModal()
  })
}

/** Show an 'alert' in a modal box
 * @param {string} message Text alert to show
 * @param {string=} title Title to show at top of modal
 * @returns {Promise<void>} Always returns `void`
 */
function showAlert(message, title) {
  return showModal({
    ...title ? { title: title } : {},
    message: message,
    buttons: [{ title: i18n('ok'), value: 'esc' }],
  })
}

/** Modal confirmation, returns `true` for the OK action, `false` if cancelled, or undefined if escaped
 * @param {string} message - confirmation message
 * @param {string} [okLabel] - confirmation button text
 * @param {string} [cancelLabel] - cancel button text
 */
function confirmAction(message, okLabel = i18n('ok'), cancelLabel = i18n('cancel')) {
  return showModal({
    message: message,
    buttons: [
      { title: okLabel, value: 'true' },
      { title: cancelLabel, value: 'false' },
    ],
  })
}

/** Modal confirmation, returns `true` for the action, `false` if cancelled, or undefined if escaped
 * @param {string} message - confirmation message
 * @param {{title:string,value:string}[]} selections - list of available selections
 * @param {string|{title:string,value:string}[]} [okLabel] - confirmation button text, may be array
 * @param {string} [cancelLabel] - cancel button text
 */
function confirmSelection(message, selections, okLabel = i18n('ok'), cancelLabel = i18n('cancel')) {
  return showModal({
    message: message,
    fields: [{
      type: 'radio',
      name: 'selection',
      options: selections.map((option, i) => ({
        id: `selection-${i + 1}`,
        label: option.title,
        value: option.value,
      })),
    }],
    buttons: [
      { title: okLabel, value: selections.at(0).value, id: 'submit-request' },
      { title: cancelLabel, value: 'esc' },
    ],
  }, ({ target }) => {
    const button = target.closest('dialog').querySelector('#submit-request')
    button.value = target.value
  })
}

/** Show the About page as a modal */
function showAbout() {
  return showModal({
    content: [
      buildNode('div', {
        classList: ['title'],
        children: [
          buildNode('img', {
            src: '/icons/app/snip128.png',
            classList: ['logo'],
          }),
          buildNode('h1', {
            innerHTML: `${i18n('app_name')} <span class="tinytype">v${chrome.runtime.getManifest().version}</span>`,
          }),
        ],
      }),
      buildNode('p', {
        textContent: i18n('app_description'),
      }),
      buildNode('hr'),
      buildNode('a', {
        href: 'https://github.com/AppliedElegance/Sniplets/issues/',
        target: '_blank',
        textContent: i18n('app_report_issue'),
      }),
      document.createTextNode(' | '),
      buildNode('a', {
        href: 'https://crowdin.com/project/sniplets',
        target: '_blank',
        textContent: i18n('app_translate'),
      }),
      document.createTextNode(' | '),
      buildNode('a', {
        href: 'https://github.com/sponsors/jpc-ae',
        target: '_blank',
        textContent: i18n('app_donate'),
      }),
    ],
    buttons: [{ title: i18n('ok'), value: 'esc' }],
  })
}

/** Show a toast message
 * @param {string} message Text to show in the toast
 * @param {'success'|'warning'|'error'} [type] The css class name to use for the toast
 */
async function toast(message, type = 'success') {
  /** @type {HTMLDivElement} */
  const toast = document.getElementById('t-toast').content.firstElementChild.cloneNode(true)
  toast.textContent = message
  toast.classList.add(type)
  document.body.append(toast)
  setTimeout(() => toast.remove(), 5000)
}

export {
  showModal,
  showAlert,
  confirmAction,
  confirmSelection,
  showAbout,
  toast,
}
