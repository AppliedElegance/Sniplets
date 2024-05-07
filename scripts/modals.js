/* eslint-disable no-unused-vars */

/** Builder for modal dialogue.
 * Buttons with the value `esc` return undefined and `true` & `false` return as boolean rather than string.
 * @param {{
 * title?:string
 * message?:string
 * content?:HTMLElement[]
 * fields?:{type:string,name:string,label:string,value:string,options:string[],checked:Boolean}[]
 * buttons?:{title:string,value:string,id:string}[]
 * }} options
 * @param {Function} [onChange] 
 */
function showModal({title, message, content, fields, buttons}, onChange) {  
  // console.log("Setting up container...");
  const form = buildNode('form', {
    method: `dialog`,
  });

  // console.log("Adding title...", title, !!title);
  if (title) form.append(buildNode('h1', { textContent: title }));

  // console.log("Adding message...", message, !!message);
  if (message) form.append(buildNode('p', { textContent: message }));

  // console.log("Adding custom content...", content, !!content);
  if (content) form.append(...content);

  // console.log("Adding fields...", fields, !!fields);
  if (fields) {
    const formFields = buildNode('div', {
      classList: [`fields`],
    });
    fields.forEach((field, i) => {
      // console.log(field);
      if (i > 0) {
        formFields.append(buildNode('div', {
          classList: [`divider`],
        }));
      }
      const isSelect = (field.type === 'select');
      const isCheckable = (['checkbox', 'radio'].includes(field.type));
      formFields.append(buildNode('div', {
        classList: [`field`, `${field.type}-control`],
        children: [
          ...isCheckable ? [] : [buildNode('label', {
            for: field.name,
            textContent: field.label + (isCheckable ? '' : ':'),
          })],
          buildNode(isSelect ? 'select' : 'input', {
            type: field.type,
            name: field.name,
            id: field.name,
            title: field.label,
            value: field.value,
            checked: field.checked,
            children: isSelect && field.options.map(option => buildNode('option', {
              value: option,
              textContent: option,
            })),
          }),
          ...isCheckable ? [buildNode('label', {
            for: field.name,
            textContent: `${ field.label }:`,
          })] : [],
        ],
      }));
    });
    form.append(formFields);
  }

  // console.log("Adding buttons...", buttons, !!buttons);
  if (buttons) {
    const formButtons = buildNode('div', {
      classList: [`buttons`],
    });
    for (const button of buttons) {
      formButtons.append(buildNode('button', {
        type: `submit`,
        value: button.value,
        id: button.id,
        children: [buildNode('h2', {
          textContent: button.title,
        })],
      }));
    }
    form.append(formButtons);
  }

  // console.log("Adding cancel button...");
  const cancelButton = buildActionIcon(i18n('cancel'), `icon-close`, getColor('Red').value);
  cancelButton.type = `submit`;
  cancelButton.value = `esc`;
  form.append(buildNode('div', {
    classList: [`x`],
    children: [cancelButton],
  }));

  /** @type {HTMLDialogElement} */
  const modal = buildNode('dialog', {
    children: [form],
  });
  document.body.append(modal);

  if (onChange) modal.addEventListener('change', onChange);

  return new Promise((resolve) => {
    modal.addEventListener('close', () => {
      switch (modal.returnValue) {
      case 'esc':
        resolve();
        break;
        
      case 'true':
        resolve(true);
        break;

      case 'false':
        resolve(false);
        break;
    
      default:
        resolve(modal.returnValue);
        break;
      }
      modal.remove();
    });

    modal.showModal();
  });
}

/** Modal alert, always returns `void`
 * @param {string} message
 * @param {string} [title] 
 */
function showAlert(message, title) {
  return showModal({
    ...title ? {title: title} : {},
    message: message,
    buttons: [{title: i18n('ok'), value: `esc`}],
  });
}

/** Modal confirmation, returns `true` for the action, `false` if cancelled, or undefined if escaped
 * @param {string} message - confirmation message
 * @param {string} action - confirmation button text
 */
function confirmAction(message, action) {
  return showModal({
    message: message,
    buttons: [
      {title: action || i18n('ok'), value: `true`},
      {title: i18n('cancel'), value: `false`},
    ],
  });
}

/** Show the About page as a modal */
function showAbout() {
  return showModal({
    content: [
      buildNode('div', {
        classList: [`title`],
        children: [
          buildNode('img', {
            src: `../icons/snip128.png`,
            classList: [`logo`],
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
      buildNode('a', {href: `https://github.com/jpc-ae/Snippets/issues/`, textContent: i18n('app_report_issue')}),
      document.createTextNode(` | `),
      buildNode('a', {href: `https://github.com/sponsors/jpc-ae`, textContent: i18n('app_donate')}),
    ],
    buttons: [{title: i18n('ok'), value: `esc`}],
  });
}

/** Request and update values for custom fields
 * @param {Map<string,{type:string,value:string,options:string[]}>} fields 
 * @returns {Promise<Map<string,{type:string,value:string,options:string[]}>>}
 */
async function mergeCustomFields(content, fields) {
  // console.log(fields, fields instanceof Map);
  if (!fields?.size) return content;
  //build modal
  const submission = await showModal({
    title: i18n('title_custom_placeholders'),
    fields: Array.from(fields.entries(), ([placeholder, field], i) => ({
        type: field.type,
        name: `placeholder-${i}`,
        label: placeholder,
        value: field.value,
        options: field.options,
      })),
    buttons: [
      {
        title: i18n('confirm'),
        value: JSON.stringify(Array.from(fields.entries())),
        id: 'confirmFields',
      },
    ],
  }, (event) => {
    // console.log(event);
    /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} */
    const input = event.target;
    const modal = input.closest('dialog');
    /** @type {HTMLButtonElement} */
    const button = modal.querySelector('#confirmFields');
    /** @type {Map} */
    const fields = new Map(JSON.parse(button.value));
    // console.log(button.value, fields, input.title, input.value);
    const field = fields.get(input.title);
    field.value = input.value;
    fields.set(input.title, field);
    button.value = JSON.stringify(Array.from(fields.entries()));
    // console.log(button.value, fields);
  });
  // console.log(confirmedFields);
  const confirmedFields = submission && new Map(JSON.parse(submission));
  return content.replaceAll(
    /\$\[(.+?)(?:\(.+?\))?(?:\{.+?\})?\]/g,
    (match, placeholder) => confirmedFields.get(placeholder)?.value || match,
  );
}

async function requestOrigins(origins) {
  const allUrls = JSON.stringify(chrome.runtime.getManifest().optional_host_permissions || []);
  // console.log(origins?.length);
  const request = await showModal({
    message: i18n('request_origins'),
    fields: [
      {
        type: `radio`,
        name: `request`,
        label: i18n('request_all_site_permissions'),
        value: allUrls,
        checked: true,
      },
      ...origins?.length ? [{
        type: `radio`,
        name: `request`,
        label: i18n('request_site_permissions'),
        value: JSON.stringify(origins),
      }] : [],
    ],
    buttons: [
      {title: i18n('action_permit'), value: allUrls, id: 'submit-request'},
      {title: i18n('action_cancel'), value: 'esc'},
    ],
  }, ({target}) => {
    const permitButton = target.closest('dialog').querySelector('#submit-request');
    permitButton.value = target.value;
  });
  if (request) {
    return await chrome.permissions.request({origins: JSON.parse(request)})
    .catch((e) => console.warn(e));
  }
  return false;
}