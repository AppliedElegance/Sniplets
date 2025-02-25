import { i18n, Colors } from '/modules/refs.js'
import { Folder, Sniplet } from '/modules/spaces.js'

/**
 * DOM helper for element creation including sub-elements
 * @param {string} nodeName
 * @param {{[key:string]:string}} attributes
 */
function buildNode(nodeName, attributes) {
  const element = document.createElement(nodeName)

  for (const a in attributes) {
    // ignores falsy values (false must be a string value for attributes)
    if (!attributes[a]) continue
    switch (a) {
      case 'children': { // append any valid nodes
        const children = attributes.children.filter(e => e)
        if (children.length) element.append(...children)
        break }

      case 'dataset': // append 'data-*' attributes
        for (const key in attributes.dataset) {
          element.dataset[key] = attributes.dataset[key]
        }
        break

      case 'classList': // append classes
        element.classList.add(...attributes.classList)
        break

      case 'style': // append inline styles
        if (typeof attributes.style === 'string') {
          element.style.cssText = attributes.style
        } else {
          for (const key in attributes.style) {
            element.style[key] = attributes.style[key]
          }
        }
        break

      case 'textContent': { // add text content within tag (should not be used along with children)
        const lines = attributes.textContent.split(/\r\n|\r|\n/)
        element.textContent = lines.at(0)
        for (let i = 1; i < lines.length; i++) {
          element.appendChild(document.createElement('br'))
          element.appendChild(document.createTextNode(lines.at(i)))
        }
        break }

      case 'innerHTML': // add template content within tag (should not be used along with children)
        element.innerHTML = attributes.innerHTML
        break

      case 'events': // attach event listeners directly to element
        for (const e of attributes.events) {
          element.addEventListener(e.type, e.listener, e.options || false)
        }
        break

      case 'value':
        element.value = attributes.value
        break

      case 'htmlFor':
        element.htmlFor = attributes.htmlFor
        break

      default: // assume remaining attributes can be set directly
        element.setAttribute(a, (attributes[a] === true) ? '' : attributes[a])
    }
  }
  return element
}

/**
 * Accessible SVG element builder
 * @param {string} title - Accessible descriptor
 * @param {string} sprite - Name of sprite as found in spritesheet
 * @param {string} color - Optional color class to apply to the sprite
 */
function buildSvg(title, sprite, color) {
  // Create inline SVG element with the correct namespace
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('focusable', false)
  if (color) svg.setAttribute('class', color)

  // Add an accessible title field for screen readers
  const svgTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title')
  svgTitle.textContent = title

  // Add a use element referencing the spritesheet
  const svgUse = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  svgUse.setAttribute('href', `/icons/sprites.svg#${sprite}`)
  svgUse.setAttribute('fill', 'inherit')

  // Append the title and sprite to the SVG element
  svg.append(svgTitle, svgUse)

  // return the completed SVG element
  return svg
}

/**
 * Replace the sprite of a contained icon
 * @param {HTMLElement} target - Element containing the icon's `use` tag
 * @param {string} sprite - Name of the sprite
 */
function setSvgSprite(target, sprite) {
  target.querySelector('use').setAttribute('href', `/icons/sprites.svg#${sprite}`)
}

/**
 * builder for icon buttons
 * @param {string} name
 * @param {string} sprite
 * @param {object} dataset
 * @param {string} color
 * @returns {HTMLButtonElement}
 */
function buildActionIcon(name, sprite, dataset, color) {
  return buildNode('button', {
    type: 'button',
    classList: ['icon'],
    dataset: dataset,
    children: [buildSvg(
      name,
      sprite,
      color,
    )],
  })
}

/**
 * Builder for icon popover menus
 * @param {string} id
 * @param {string} name
 * @param {string} sprite
 * @param {HTMLElement[]} list
 * @param {string} color
 */
function buildPopoverMenu(id, name, sprite, list, color) {
  return buildNode('div', {
    classList: ['menu'],
    children: [
      buildActionIcon(`Open ${name} Menu`, sprite, {
        action: 'open-popover',
        target: id,
      }, color),
      buildNode('div', {
        id: id,
        classList: ['card', 'menu-list', 'popover', 'hidden'],
        children: list,
      }),
    ],
  })
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
      dataset: data || { action: name },
      textContent: title,
    })],
  })
}

/** Add a hard rule P element spacer to menu lists */
function buildMenuSeparator() {
  return buildNode('p', {
    classList: ['menu-item'],
    children: [buildNode('hr')],
  })
}

/**
 * Submenu builder
 * @param {string} label - Menu name, will be postpended with `…`
 * @param {string} id - Unique identifier
 * @param {HTMLElement[]} items - Submenu items
 */
function buildSubMenu(label, id, items) {
  // don't build empty menus
  if (!items?.length) return
  return buildNode('fieldset', {
    classList: ['menu-item'],
    children: [
      buildNode('div', {
        classList: ['legend'],
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
  })
}

/**
 * Menu item builder for checkbox and radio controls
 * @param {'checkbox'|'radio'} type - Input type (`checkbox`|`radio`)
 * @param {string} name - Name of the form input (must be unique if id not present)
 * @param {string} value - Value sent when checked
 * @param {string} label - The text to show with the control
 * @param {boolean} checked - Whether the control is in a checked state
 * @param {{id: string, dataset: object, classList: string[], hideIcon:boolean}} attributes - id is required for radio options
 */
function buildMenuControl(type, name, value, label, checked, { id, dataset, classList = [], hideIcon = false } = {}) {
  if (!['checkbox', 'radio'].includes(type)) return
  id ||= name
  return buildNode('p', {
    classList: ['menu-item', 'control', ...classList],
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
        tabindex: '0',
        children: [
          ...(hideIcon
            ? []
            : [
                buildNode('div', {
                  classList: ['icon'],
                  children: [buildSvg(
                    label,
                    `control-${type}`,
                  )],
                }),
                buildNode('div', {
                  classList: ['icon', 'checked'],
                  children: [buildSvg(
                    label,
                    `control-${type}-checked`,
                  )],
                }),
              ]
          ),
          buildNode('h3', { textContent: label }),
        ],
      }),
    ],
  })
}

/** Build the list of color options available, with an expand button
 * @param {{seq:number, color:string}} item The seq and color of the sniplet the menu is for
 * @param {boolean} moreColors Whether to show the full list of available colors or just clippings compatible ones
 */
function buildColorMenu(item, moreColors) {
  const colorList = moreColors ? Colors.list : Colors.clippingsList
  return buildSubMenu(i18n('color'), `item-${item.seq}-color-menu`, [
    buildMenuControl('radio',
      `item-${item.seq}-color`, 'default', Colors.get().label, !item.color, {
        id: `item-${item.seq}-color-default`,
        dataset: { action: 'edit', field: 'color', seq: item.seq },
      },
    ),
    ...colorList.map((color, i) => buildMenuControl('radio',
      `item-${item.seq}-color`, color, `${Colors.get(color).heart} ${Colors.get(color).label}`, color === item.color, {
        id: `item-${item.seq}-color-${i}`,
        dataset: { action: 'edit', field: 'color', seq: item.seq },
      },
    )),
    buildMenuControl('checkbox', 'toggle-more-colors', moreColors,
      moreColors ? i18n('menu_less_colors') : i18n('menu_more_colors'), moreColors, {
        id: `toggle-more-colors-${item.seq}`,
        dataset: { seq: item.seq, color: item.color },
        hideIcon: true,
      },
    ),
  ])
}

/**
 * Builder for TreeItem widgets depending on their extended class
 * @param {Folder|Sniplet} item - Folder or Sniplet
 * @param {(Folder|Sniplet)[]} list - Folder list which includes `item`, for calculating dropzone targets
 * @param {number[]} path - Seq path to item
 * @param {Settings} settings - What to show/hide as part of the widget
 */
function buildItemWidget(item, list, path, { view, data }) {
  const index = list.indexOf(item)
  if (index < 0) return
  const widget = buildNode('form')
  const isFolder = item instanceof Folder
  const isSniplet = item instanceof Sniplet

  // widget menu
  const widgetMenu = buildPopoverMenu(
    `item-menu-${item.seq}`,
    i18n('menu_item'),
    `icon-${item.constructor.name.toLowerCase()}`,
    [
      buildColorMenu(item, data.moreColors),
      buildSubMenu(i18n('action_move'), `item-${item.seq}-move-menu`, list.reduce((a, o, i) => {
        const l = list.length - 1
        const b = (title, direction) => buildMenuItem(title, `move-${direction}`,
          o.seq, { action: 'move', seq: item.seq })
        if (i === (index - 1)) {
          a.push(b(i18n('direction_up'), 'up'))
        } else if (i === (index + 1)) {
          a.push(b(i18n('direction_down'), 'down'))
        } else if (i === 0 && l > 1 && item.seq > list[1].seq) {
          a.push(b(i18n('direction_top'), 'top'))
        } else if (i === l && l > 1 && item.seq < list[l - 1].seq) {
          a.push(b(i18n('direction_bottom'), 'bottom'))
        }
        return a
      }, [])),
    ],
    item.color,
  )

  // only folders can be 'opened'
  const widgetTitle = buildNode('input', {
    'type': (isFolder) ? 'button' : 'text',
    'name': 'name',
    'value': item.name,
    'dataset': {
      action: (isFolder) ? 'open-folder' : 'edit',
      seq: item.seq,
      field: 'name',
    },
    'draggable': 'true', // fires drag event so it can be prevented
    'autocomplete': 'off',
    'aria-label': (isFolder) ? i18n('label_folder_name') : i18n('label_sniplet_name'),
  })
  if (isFolder) widgetTitle.dataset.target = path.concat([item.seq])

  const widgetActions = buildNode('div', {
    classList: ['quick-actions'],
    children: [
      ...isFolder
        ? [
            buildActionIcon(i18n('action_rename'), 'icon-rename', {
              action: 'rename',
              seq: item.seq,
            }),
          ]
        : [
            buildActionIcon(i18n('action_insert'), 'icon-insert', {
              action: 'paste',
              seq: item.seq,
            }),
            buildActionIcon(i18n('action_copy'), 'icon-copy', {
              action: 'copy',
              field: 'copy', // so it can be focused
              seq: item.seq,
            }),
          ],
      buildActionIcon(i18n('action_delete'), 'icon-delete', {
        action: 'delete',
        seq: item.seq,
      }, 'red'),
    ],
  })

  const widgetHead = buildNode('div', {
    classList: ['title'],
    children: [
      widgetMenu,
      widgetTitle,
      widgetActions,
    ],
  })

  widget.append(widgetHead)

  // Separate widget contents from title
  if (!isFolder) widget.append(buildNode('hr', { class: item.color }))

  // build editor
  if (isSniplet) {
    // build the body
    const widgetBody = buildNode('div', {
      classList: ['snip-content'],
    })

    // build the editor
    const widgetContent = buildNode('textarea', {
      'name': 'content',
      'classList': ['content-editor'],
      'dataset': {
        action: 'edit',
        seq: item.seq,
        field: 'content',
      },
      'value': item.content,
      'rows': 1,
      'wrap': 'hard', // allows to retrieve current number of lines
      'draggable': 'true', // fires drag event so it can be prevented
      'autocomplete': 'off',
      'aria-label': i18n('label_sniplet_content'),
    })
    widgetBody.append(widgetContent)

    // append the sniplet's sourceURL field if requested
    if (view.sourceURL) {
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
              name: 'sourceURL',
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
      })
      widgetBody.append(widgetSource)
    }

    // append the body
    widget.append(widgetBody)

    // hide the body and add a collapse button if requested
    if (view.collapseEditors) {
      widgetBody.classList.add('collapsed')
      const collapseButton = buildNode('button', {
        type: 'button',
        classList: ['content-collapser'],
        children: [buildNode('span', {
          classList: [item.color],
          textContent: '╲╱',
        })],
        dataset: {
          action: 'toggle-content',
        },
      })
      widget.append(collapseButton)
    }
  }
  return widget
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
        dataset: collapsible && { action: 'collapse' },
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
  })
}

// Build a search box for sniplets
// function buildSearchBox(attributes) {
//   const searchControl = buildNode('div', {
//     classList: ['search-control'],
//   })

//   const searchBox = buildNode('input', {
//     type: 'text',
//     ...attributes,
//   })
//   searchBox.addEventListener('input', (ev) => {
//     console.log(ev)
//   })

//   const resultList = buildNode('div', {
//     classList: ['card', 'search-results', 'hidden'],
//   })

//   searchControl.append(searchBox, resultList)
//   return searchControl
// }

export {
  buildNode,
  buildSvg,
  setSvgSprite,
  buildActionIcon,
  buildPopoverMenu,
  buildMenuItem,
  buildMenuSeparator,
  buildSubMenu,
  buildMenuControl,
  buildColorMenu,
  buildItemWidget,
  buildTreeWidget,
  // buildSearchBox,
}
