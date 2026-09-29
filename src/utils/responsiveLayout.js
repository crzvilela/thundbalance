export const LAYOUT_DEVICES = ['desktop', 'tablet', 'mobile']
export const DEFAULT_EMBED_HEIGHT = 152
export const MAX_EMBED_HEIGHT = 2000

export function makeEmbedLayout() {
  const all = value => Object.fromEntries(LAYOUT_DEVICES.map(device => [device, value]))
  return { width: all('100%'), height: all('152px'), align: all('left'), marginTop: all('0px'), marginBottom: all('0px') }
}

export function validLayoutSize(value) {
  return /^(?:\d+(?:\.\d+)?|\.\d+)(px|%)$/.test(value) && parseFloat(value) > 0
}

export function layoutAtDevice(layout, device) {
  const defaults = makeEmbedLayout()
  const read = field => layout?.[field]?.[device] ?? defaults[field][device]
  const size = field => validLayoutSize(read(field)) ? read(field) : defaults[field][device]
  const margin = field => /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(read(field)) ? read(field) : '0px'
  return {
    width: size('width'), height: size('height'),
    align: ['left', 'center', 'right'].includes(read('align')) ? read('align') : 'left',
    marginTop: margin('marginTop'), marginBottom: margin('marginBottom')
  }
}

// A percentage height uses the original 152px frame as its reference. The
// grid row has auto height, so native percentage heights would collapse.
export function layoutStyle(layout, device) {
  const value = layoutAtDevice(layout, device)
  return {
    width: value.width,
    height: value.height.endsWith('%') ? `${DEFAULT_EMBED_HEIGHT * parseFloat(value.height) / 100}px` : value.height,
    marginTop: value.marginTop, marginBottom: value.marginBottom,
    marginLeft: value.align === 'left' ? '0px' : 'auto',
    marginRight: value.align === 'right' ? '0px' : 'auto'
  }
}

export function responsiveLayoutVariables(layout) {
  const variables = {}
  for (const device of LAYOUT_DEVICES) {
    for (const [property, value] of Object.entries(layoutStyle(layout, device))) {
      variables[`--embed-${device}-${property}`] = value
    }
  }
  return variables
}
