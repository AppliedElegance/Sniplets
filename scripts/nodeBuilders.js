/* eslint-disable no-unused-vars */
/* global i18n, colors, getColor, Folder, Sniplet */

/**
 * DOM helper for element creation including sub-elements
 * @param {string} tagName 
 * @param {{[key:string]:string}} attributes
 */
function buildNode(tagName, attributes) {
  const element = document.createElement(tagName);

  for (const a in attributes) {
    // ignores falsy values (false must be a string value for attributes)
    if (!attributes[a]) continue;
    switch (a) {
    case 'children': { // append any valid nodes
      const children = attributes.children.filter((e) => e);
      if (children.length) element.append(...children);
      break; }
    
    case 'dataset': // append 'data-*' attributes
      for (const key in attributes.dataset) {
        element.dataset[key] = attributes.dataset[key];
      }
      break;

    case 'classList': // append classes
      element.classList.add(...attributes.classList);
      break;

    case 'style': // append inline styles
      if (typeof attributes.style === 'string') {
        element.style.cssText = attributes.style;
      } else {
        for (const key in attributes.style) {
          element.style[key] = attributes.style[key];
        }
      }
      break;

    case 'textContent': // add text content within tag (should not be used along with children)
      element.textContent = attributes.textContent;
      break;

    case 'innerHTML': // add template content within tag (should not be used along with children)
      element.innerHTML = attributes.innerHTML;
      break;
    
    case 'events': // attach event listeners directly to element
      for (const e of attributes.events) {
        element.addEventListener(e.type, e.listener, e.options || false);
      }
      break;
    
    case 'value':
      element.value = attributes.value;
      break;

    case 'htmlFor':
      element.htmlFor = attributes.htmlFor;
      break;
  
    default: // assume remaining attributes can be set directly
      element.setAttribute(a, (attributes[a] === true) ? '' : attributes[a]);
    }
  }
  return element;
}

/**
 * Accessible SVG element builder
 * @param {string} title - Accessible descriptor
 * @param {string} sprite - Name of sprite as found in spritesheet
 * @param {string} fill - Optional fill color to apply to the sprite
 * @returns 
 */
function buildSvg(title, sprite, fill) {
  // Create inline SVG element with the correct namespace
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('focusable', false);
  // Add an accessible title field for screen readers
  const svgTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  svgTitle.textContent = title;
  // Add a use element referencing the spritesheet
  const svgUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svgUse.setAttribute('href', `sprites.svg#${sprite}`);
  // Set the sprite colour if requested
  if (fill) svgUse.setAttribute('fill', fill);
  // Append the title and sprite to the SVG element
  svg.append(svgTitle, svgUse);
  // return the completed SVG element
  return svg;
}

/**
 * Replace the sprite of a contained icon
 * @param {HTMLElement} target - Element containing the icon's `use` tag
 * @param {string} sprite - Name of the sprite
 */
function setSvgSprite(target, sprite) {
  target.querySelector('use').setAttribute('href', `sprites.svg#${sprite}`);
}

/**
 * Replace the fill color of a contained icon
 * @param {HTMLElement} target - Element containing the icon's `use` tag
 * @param {string} fill - color to use for the icon
 */
function setSvgFill(target, fill) {
  target.querySelector('use').setAttribute('fill', fill);
}

/**
 * builder for icon buttons
 * @param {string} name 
 * @param {string} sprite 
 * @param {string} color 
 * @param {Object} dataset 
 * @returns {HTMLButtonElement}
 */
function buildActionIcon(name, sprite, color, dataset) {
  return buildNode('button', {
    type: 'button',
    classList: ['icon'],
    dataset: dataset,
    children: [buildSvg(
      name,
      sprite,
      color,
    )],
  });
}

/**
 * Builder for icon popover menus
 * @param {string} id 
 * @param {string} sprite 
 * @param {string} color 
 * @param {HTMLElement[]} list 
 */
function buildPopoverMenu(id, name, sprite, color, list) {
  return buildNode('div', {
    classList: ['menu'],
    children: [
      buildActionIcon(`Open ${name} Menu`, sprite, color, {
        action: 'open-popover',
        target: id,
      }),
      buildNode('div', {
        id: id,
        classList: ['card', 'menu-list', 'popover', 'hidden'],
        children: list,
      }),
    ],
  });
}

/**
 * Build a clickable menu item
 * @param {string} title - Text to display
 * @param {string} name - Name of control
 * @param {string} value - Initial value of the button
 * @param {{[key:string]:string}} data - `data-` (`dataset`) attributes
 */
function buildMenuItem(title, name, value, data) {
  return buildNode('p', {
    classList: ['menu-item'],
    children: [buildNode('button', {
      type: 'button',
      name: name,
      value: value,
      dataset: data || {action: name},
      textContent: title,
    })],
  });
}

/** Add a hard rule P element spacer to menu lists */
function buildMenuSeparator() {
  return buildNode('p', {
    classList: ['menu-item'],
    children: [buildNode('hr')],
  });
}

/**
 * Submenu builder
 * @param {string} label - Menu name, will be postpended with `…`
 * @param {string} id - Unique identifier
 * @param {HTMLElement[]} items - Submenu items
 */
function buildSubMenu(label, id, items) {
  // don't build empty menus
  if (!items?.length) return;
  return buildNode('fieldset', {
    classList: ['menu-item'],
    children: [
      buildNode('legend', {
        children: [buildNode('button', {
          type: 'button',
          textContent: `${label}…`,
          dataset: {
            action: 'open-submenu',
            target: id,
          },
        })],
      }),
      buildNode('div', {
        id: id,
        classList: ['card', 'menu-list', 'hidden'],
        children: items,
      }),
    ],
  });
}

/**
 * Menu item builder for checkbox and radio controls
 * @param {string} type - Input type (`checkbox`|`radio`)
 * @param {string} name - Name of the form input (must be unique if id not present)
 * @param {string} value - Value sent when checked
 * @param {boolean} checked - Whether the control is in a checked state
 * @param {{id: string, title: string, dataset: Object}} attributes - id is required for radio options,
 * the value will be used for the label if no title is provided
 */
function buildMenuControl(type, name, value, checked, {id, title, dataset} = {}) {
  if (!['checkbox', 'radio'].includes(type)) return;
  id ||= name;
  title ||= value;
  return buildNode('p', {
    classList: ['menu-item', 'control'],
    children: [
      buildNode('input', {
        type: type,
        name: name,
        value: value,
        id: id,
        checked: checked,
        dataset: dataset,
      }),
      buildNode('label', {
        for: id,
        title: title,
        tabindex: '0',
        children: [
          buildNode('div', {
            classList: ['icon'],
            children: [buildSvg(
              title,
              `control-${type}`,
            )],
          }),
          buildNode('div', {
            classList: ['icon', 'checked'],
            children: [buildSvg(
              title,
              `control-${type}-checked`,
            )],
          }),
          buildNode('h3', {textContent: title}),
        ],
      }),
    ],
  });
}

/**
 * Builder for TreeItem widgets depending on their extended class
 * @param {TreeItem} item - Folder or Sniplet
 * @param {TreeItem[]} list - Folder list which includes `item`, for calculating dropzone targets
 * @param {number[]} path - Seq path to item
 * @param {Settings} settings - What to show
 * @returns {HTMLElement[]}
 */
function buildItemWidget(item, list, path, settings) {
  const index = list.indexOf(item);
  if (index < 0) return;
  const widget = [];
  const isFolder = item instanceof Folder;
  const isSniplet = item instanceof Sniplet;

  // widget menu
  const widgetMenu = buildPopoverMenu(
    `item-menu-${item.seq}`,
    i18n('menu_item'),
    `icon-${item.constructor.name.toLowerCase()}`,
    getColor(item.color).value,
    [
      buildSubMenu(i18n('color'), `item-${item.seq}-color-menu`, Array.from(colors).map(([color, {label}], i) =>
        buildMenuControl('radio', `item-${item.seq}-color`,
        color, ((color === item.color) || (!item.color && color === 'default')), {
          id: `item-${item.seq}-color-${i}`,
          title: label,
          dataset: {action: 'edit', field: 'color', seq: item.seq},
        }),
      )),
      buildSubMenu(i18n('action_move'), `item-${item.seq}-move-menu`, list.reduce((a, o, i) => {
        const l = list.length - 1;
        const b = (title, direction) => buildMenuItem(title, `move-${direction}`,
          o.seq, {action: 'move', seq: item.seq});
        if (i === (index - 1)) {
          a.push(b(i18n('direction_up'), 'up'));
        } else if (i === (index + 1)) {
          a.push(b(i18n('direction_down'), 'down'));
        } else if (i === 0 && l > 1 && item.seq > list[1].seq) {
          a.push(b(i18n('direction_top'), 'top'));
        } else if (i === l && l > 1 && item.seq < list[l-1].seq) {
          a.push(b(i18n('direction_bottom'), 'bottom'));
        }
        return a;
      }, [])),
    ],
  );

  // only folders can be 'opened'
  const widgetTitle = buildNode('input', {
    type: (isFolder) ? 'button' : 'text',
    name: 'name',
    value: item.name,
    dataset: {
      action: (isFolder) ? 'open-folder' : 'edit',
      seq: item.seq,
      field: 'name',
    },
    draggable: 'true', // fires drag event so it can be prevented
    autocomplete: 'off',
    'aria-label': (isFolder) ? i18n('label_folder_name') : i18n('label_sniplet_name'),
  });
  if (isFolder) widgetTitle.dataset.target = path.concat([item.seq]).join('-');

  const widgetActions = buildNode('div', {
    classList: ['quick-actions'],
    children: [
      ...isFolder ? [
        buildActionIcon(i18n('action_rename'), 'icon-rename', 'inherit', {
          action: 'rename',
          seq: item.seq,
        }),
      ] : [
        buildActionIcon(i18n('action_insert'), 'icon-insert', 'inherit', {
          action: 'paste',
          seq: item.seq,
        }),
        buildActionIcon(i18n('action_copy'), 'icon-copy', 'inherit', {
          action: 'copy',
          field: 'copy', // so it can be focused
          seq: item.seq,
        }),
      ],
      buildActionIcon(i18n('action_delete'), 'icon-delete', getColor('red').value, {
        action: 'delete',
        seq: item.seq,
      }),
    ],
  });

  const widgetHead = buildNode('div', {
    classList: ['title'],
    children: [
      widgetMenu,
      widgetTitle,
      widgetActions,
    ],
  });

  widget.push(widgetHead);

  // Separate widget contents from title
  if (!isFolder) widget.push(buildNode('hr'));

  if (isSniplet) {
    const widgetBody = buildNode('div', {
      classList: ['snip-content'],
      children: [buildNode('textarea', {
        name: 'content',
        dataset: {
          action: 'edit',
          seq: item.seq,
          field: 'content',
        },
        textContent: item.content,
        rows: 1,
        draggable: 'true', // fires drag event so it can be prevented
        autocomplete: 'off',
        'aria-label': i18n('label_sniplet_content'),
      })],
    });
    widget.push(widgetBody);
    if (settings.view.sourceURL) {
      const widgetSource = buildNode('div', {
        classList: ['fields', 'source-url'],
        children: [buildNode('div', {
          classList: ['field'],
          children: [
            buildNode('label', {
              for: `source-${item.seq}`,
              textContent: i18n('label_src'),
            }),
            buildNode('input', {
              type: 'url',
              id: `source-${item.seq}`,
              placeholder: '…',
              value: item.sourceURL,
              dataset: {
                action: 'edit',
                seq: item.seq,
                field: 'sourceURL',
              },
            }),
          ],
        })],
      });
      widget.push(widgetSource);
    }
  }
  return widget;
}

/**
 * Builder for folder tree items
 * @param {boolean} collapsible 
 * @param {string} color 
 * @param {string} target 
 * @param {string} text 
 */
function buildTreeWidget(collapsible, color, target, text) {
  return buildNode('div', {
    classList: ['title'],
    draggable: 'true',
    children: [
      // expand/collapse button only available if subfolders were found
      buildNode('button', {
        type: 'button',
        disabled: !collapsible,
        dataset: collapsible && {action: 'collapse'},
        classList: ['icon'],
        children: [
          buildSvg(i18n('label_folder'), collapsible ? 'icon-folder-collapse' : 'icon-folder', color),
        ],
      }),
      // folder name
      buildNode('button', {
        type: 'button',
        classList: ['name'],
        dataset: {
          action: 'open-folder',
          target: target,
        },
        children: [
          buildNode('h2', {
            textContent: text,
          }),
        ],
      }),
    ],
  });
}